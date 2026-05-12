'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizationList, useUser } from '@clerk/nextjs';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';
import { fetchJson } from '@/lib/fetch-json';

/**
 * Bridges /select-org → /onboarding for users starting a new club. The
 * onboarding wizard assumes a club already exists for the signed-in
 * user — its layout calls `getTenantContext()` and redirects on
 * `NO_ORGANIZATION`. The Clerk org is the auth-level tenant key, and
 * our `clubs` row is created server-side by the `organization.created`
 * webhook handler. So a brand-new user has to:
 *
 *   1. Create a Clerk organization (this page)
 *   2. Wait for the `organization.created` webhook to populate `clubs`
 *      and the `organizationMembership.created` webhook to populate
 *      `club_members`
 *   3. Navigate to /onboarding once the membership is visible
 *
 * Without this page, /select-org's "Start a club" button linked
 * directly to /onboarding, which redirected back to /select-org
 * (NO_ORGANIZATION) — a user-visible hang on the very first action a
 * club admin takes.
 */

const createClubSchema = z.object({
  name: z
    .string()
    .min(2, 'Club name must be at least 2 characters')
    .max(80, 'Club name must be at most 80 characters'),
});

type CreateClubInput = z.input<typeof createClubSchema>;
type CreateClubOutput = z.output<typeof createClubSchema>;

const WEBHOOK_POLL_INTERVAL_MS = 1000;
const WEBHOOK_POLL_TIMEOUT_MS = 30_000;

export default function StartClubPage() {
  const router = useRouter();
  const { isLoaded: userLoaded } = useUser();
  const { isLoaded: orgsLoaded, createOrganization, setActive } = useOrganizationList();
  const [stage, setStage] = useState<'idle' | 'creating' | 'syncing'>('idle');

  const form = useForm<CreateClubInput, unknown, CreateClubOutput>({
    resolver: zodResolver(createClubSchema),
    defaultValues: { name: '' },
  });

  async function onSubmit(data: CreateClubOutput) {
    if (!createOrganization || !setActive) {
      toast.error('Sign-in is still loading — please try again in a moment.');
      return;
    }

    setStage('creating');
    try {
      const org = await createOrganization({ name: data.name });
      // Switching the active session-org NOW so subsequent server-side
      // `auth()` calls see `orgId` populated. The webhook will create the
      // `clubs` row asynchronously; we poll below until it lands.
      await setActive({ organization: org.id });

      setStage('syncing');
      const ok = await pollForClubMembership({
        timeoutMs: WEBHOOK_POLL_TIMEOUT_MS,
        intervalMs: WEBHOOK_POLL_INTERVAL_MS,
      });

      if (!ok) {
        // The Clerk org IS created and the user IS its admin in Clerk —
        // but our `organization.created` Svix webhook hasn't been processed
        // yet. The dashboard layout will re-poll on its own next refresh,
        // so the safe move is to send the user to /onboarding and let
        // its layout handle the still-syncing state on the next tick.
        toast.warning(
          'Club created — finalising setup. If onboarding looks empty, refresh in a few seconds.',
        );
      }

      router.push('/onboarding');
    } catch (err) {
      reportMutationError('start_club.create', err, { name: data.name });
      toast.error(
        err instanceof Error ? err.message : 'Could not create your club — please try again.',
      );
      setStage('idle');
    }
  }

  const ready = userLoaded && orgsLoaded;
  const submitting = stage !== 'idle';

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <CavaliqLogo height={32} priority />
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-14 sm:px-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Start your club</CardTitle>
            <CardDescription>
              We&apos;ll set up a workspace for your stable. You can change the name and other
              details later in Settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Club name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. JSR Equestrian Club"
                          autoFocus
                          disabled={submitting || !ready}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={submitting || !ready}>
                  {stage === 'creating' && (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating club…
                    </>
                  )}
                  {stage === 'syncing' && (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Finalising setup…
                    </>
                  )}
                  {stage === 'idle' && (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create club & continue
                    </>
                  )}
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  By creating a club you become its admin. You&apos;ll be billed on a 14-day trial —
                  no card required up front.
                </p>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/**
 * Polls `/api/v1/me` until the Svix `organization.created` /
 * `organizationMembership.created` webhooks have populated our DB and
 * `getTenantContext()` resolves cleanly. Returns true if the
 * membership is visible within the timeout, false otherwise. Does NOT
 * throw — the caller continues to /onboarding either way and the
 * dashboard's own polling handles eventual consistency.
 */
interface MeResponse {
  success: true;
  data: { memberId: string | null };
}

async function pollForClubMembership({
  timeoutMs,
  intervalMs,
}: {
  timeoutMs: number;
  intervalMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // `/api/v1/me` resolves a tenant context (200 with the envelope
      // carrying `memberId`) once the `organizationMembership.created`
      // webhook has written `club_members`. Before that lands, withAuth
      // surfaces NO_MEMBERSHIP (503) or NO_ORGANIZATION (400) — both
      // throw out of fetchJson and we keep polling.
      const res = await fetchJson<MeResponse>('/api/v1/me');
      if (res.data.memberId) {
        return true;
      }
    } catch {
      // Expected during the first ~1–3 seconds while Svix delivers and
      // the route handler writes the rows. Retry until deadline.
    }
    await sleep(intervalMs);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
