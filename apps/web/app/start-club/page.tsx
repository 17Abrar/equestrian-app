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
 * `NO_ORGANIZATION`.
 *
 * Flow:
 *   1. Create a Clerk organization client-side (Clerk SDK).
 *   2. `setActive` so the next server request carries the new orgId.
 *   3. POST /api/v1/clubs/bootstrap — server INSERTs the `clubs` and
 *      `club_members` rows synchronously via Clerk's Backend API. By
 *      the time this resolves, `getTenantContext()` for this user is
 *      guaranteed to succeed.
 *   4. Navigate to /onboarding.
 *
 * The earlier shape of this page polled `/api/v1/me` for up to 30s
 * waiting on the `organization.created` / `organizationMembership.created`
 * Svix webhooks to land, then navigated to /onboarding regardless. The
 * /onboarding layout would then throw `NO_MEMBERSHIP` for the unlucky
 * subset of users where the webhook hadn't been delivered in time —
 * surfacing in Sentry as `TenantError: Your account is being set up`
 * unhandled exceptions. The synchronous bootstrap eliminates the race;
 * the Svix webhook remains as redundancy / drift-correction.
 */

const createClubSchema = z.object({
  name: z
    .string()
    .min(2, 'Club name must be at least 2 characters')
    .max(80, 'Club name must be at most 80 characters'),
});

type CreateClubInput = z.input<typeof createClubSchema>;
type CreateClubOutput = z.output<typeof createClubSchema>;

interface BootstrapResponse {
  success: true;
  data: { clubId: string; memberId: string; slug: string };
}

export default function StartClubPage() {
  const router = useRouter();
  const { isLoaded: userLoaded } = useUser();
  const { isLoaded: orgsLoaded, createOrganization, setActive } = useOrganizationList();
  const [stage, setStage] = useState<'idle' | 'creating' | 'syncing'>('idle');
  // Tracks a Clerk org that was successfully created in a previous submit
  // whose bootstrap call subsequently failed. On retry we skip
  // `createOrganization` to avoid orphan-org / duplicate-club drift —
  // we only need to re-run the bootstrap step. Cleared on success
  // (component unmounts after `router.push`) and on the rare case the
  // user navigates away.
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);

  const form = useForm<CreateClubInput, unknown, CreateClubOutput>({
    resolver: zodResolver(createClubSchema),
    defaultValues: { name: '' },
  });

  async function onSubmit(data: CreateClubOutput) {
    if (!createOrganization || !setActive) {
      toast.error('Sign-in is still loading — please try again in a moment.');
      return;
    }

    try {
      // First attempt: create the Clerk org + activate it. Subsequent
      // attempts (after a bootstrap failure) reuse the orgId — calling
      // `createOrganization` a second time would create an additional
      // Clerk org under the same user and we'd end up with two clubs
      // for one user action, or an orphaned Clerk org once the eventual
      // Svix webhook lands and writes a `clubs` row for it.
      if (!pendingOrgId) {
        setStage('creating');
        const org = await createOrganization({ name: data.name });
        await setActive({ organization: org.id });
        setPendingOrgId(org.id);
      }

      setStage('syncing');
      // Synchronously create the `clubs` + `club_members` rows server-
      // side. Replaces the 30s poll-for-webhook loop with a single
      // round-trip that returns only after the rows are committed.
      await fetchJson<BootstrapResponse>('/api/v1/clubs/bootstrap', { method: 'POST' });

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
                          // Locked once the Clerk org has been created — the
                          // retry only finishes the bootstrap step, so the
                          // name is fixed at that point.
                          disabled={submitting || !ready || !!pendingOrgId}
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
                  {stage === 'idle' && pendingOrgId && (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Retry setup
                    </>
                  )}
                  {stage === 'idle' && !pendingOrgId && (
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

