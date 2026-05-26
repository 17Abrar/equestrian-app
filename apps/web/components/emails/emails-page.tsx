'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Send, Users, AtSign } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AudiencesTab } from '@/components/emails/audiences-tab';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import { type ApiSuccessResponse, type PaginatedApiResponse } from '@equestrian/shared/types';

interface SendEmailResult {
  data: { id: string | null; message: string };
}

interface BroadcastQueuedResponse {
  queued: number;
  noEmail: number;
  capSkipped: number;
  duplicateSkipped: number;
  total: number;
  audienceId: string;
  audienceName: string;
}

interface AudienceListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  filters: Record<string, unknown> | null;
}

function sendEmail(data: { to: string; subject: string; body: string }) {
  return fetchJson<SendEmailResult>('/api/v1/emails/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function broadcastEmail(data: { audienceId: string; subject: string; body: string }) {
  return fetchJson<ApiSuccessResponse<BroadcastQueuedResponse>>('/api/v1/emails/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function EmailsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Emails</h1>
        <p className="text-muted-foreground mt-1">
          Send emails to riders and manage communications
        </p>
      </div>

      <Tabs defaultValue="compose">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="audiences">Audiences</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="mt-6">
          <ComposeTab />
        </TabsContent>

        <TabsContent value="audiences" className="mt-6">
          <AudiencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Audit MED (2026-05-05 pass 2): converted from `useState` + ad-hoc
// `if (!to || !subject || !body)` validation to RHF + Zod, matching the
// project-wide form pattern.
const composeEmailSchema = z.object({
  to: z.string().email('Please enter a valid email address'),
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(255, 'Subject must be 255 characters or fewer'),
  body: z
    .string()
    .trim()
    .min(1, 'Body is required')
    .max(50_000, 'Body must be 50,000 characters or fewer'),
});

const broadcastSchema = z.object({
  audienceId: z.string().min(1, 'Pick an audience'),
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(255, 'Subject must be 255 characters or fewer'),
  body: z
    .string()
    .trim()
    .min(1, 'Body is required')
    .max(20_000, 'Body must be 20,000 characters or fewer'),
});

type ComposeEmailValues = z.infer<typeof composeEmailSchema>;
type BroadcastValues = z.infer<typeof broadcastSchema>;

function ComposeTab() {
  // Audit P0-B (2026-05-26): Compose now supports two modes — single
  // recipient (existing) and audience broadcast (new). The mode toggle
  // is local to this tab; we don't persist it because re-opening the
  // page should default to the safer single-recipient form.
  const [mode, setMode] = useState<'single' | 'audience'>('single');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compose email</CardTitle>
        <CardDescription>
          Send to a single address or broadcast to an audience of riders.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'audience')}>
          <TabsList className="grid w-full grid-cols-2 sm:w-[420px]">
            <TabsTrigger value="single">
              <AtSign className="mr-2 h-4 w-4" />
              Single recipient
            </TabsTrigger>
            <TabsTrigger value="audience">
              <Users className="mr-2 h-4 w-4" />
              Audience
            </TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="mt-4">
            <SingleRecipientForm />
          </TabsContent>
          <TabsContent value="audience" className="mt-4">
            <BroadcastForm />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SingleRecipientForm() {
  const form = useForm<ComposeEmailValues>({
    resolver: zodResolver(composeEmailSchema),
    defaultValues: { to: '', subject: '', body: '' },
  });

  async function onSubmit(values: ComposeEmailValues) {
    try {
      await sendEmail(values);
      toast.success('Email sent successfully');
      form.reset();
    } catch (err) {
      reportMutationError('email.send', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send email');
    }
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div>
        <label className="text-sm font-medium">To *</label>
        <Input
          type="email"
          placeholder="rider@example.com"
          className="mt-1"
          {...form.register('to')}
        />
        {form.formState.errors.to && (
          <p className="text-destructive mt-1 text-xs">{form.formState.errors.to.message}</p>
        )}
      </div>
      <div>
        <label className="text-sm font-medium">Subject *</label>
        <Input placeholder="Email subject..." className="mt-1" {...form.register('subject')} />
        {form.formState.errors.subject && (
          <p className="text-destructive mt-1 text-xs">
            {form.formState.errors.subject.message}
          </p>
        )}
      </div>
      <div>
        <label className="text-sm font-medium">Body *</label>
        <Textarea
          placeholder="Write your email..."
          rows={10}
          className="mt-1"
          {...form.register('body')}
        />
        {form.formState.errors.body && (
          <p className="text-destructive mt-1 text-xs">{form.formState.errors.body.message}</p>
        )}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        <Send className="mr-2 h-4 w-4" />
        {isSubmitting ? 'Sending...' : 'Send email'}
      </Button>
    </form>
  );
}

function BroadcastForm() {
  const form = useForm<BroadcastValues>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: { audienceId: '', subject: '', body: '' },
  });
  const [confirming, setConfirming] = useState<BroadcastValues | null>(null);
  const [sending, setSending] = useState(false);

  const audiencesQuery = useQuery({
    // Key MUST be `['audiences', ...]` so the audiences-tab's existing
    // mutation invalidations (create / update / delete all call
    // `invalidateQueries({queryKey: ['audiences']})`) cascade into the
    // picker via React Query's prefix-match. Otherwise a freshly-
    // created audience wouldn't appear here until the stale-time
    // expired, and a deleted one would linger.
    queryKey: ['audiences', 'broadcast-picker'],
    // `paginationSchema.pageSize` is capped at MAX_PAGE_SIZE=50.
    // Requesting >50 returns 400 and the picker silently shows
    // "No audiences yet" — caught by codex on the first review pass.
    // Clubs with >50 audiences would need to scroll the Audiences tab
    // and remember the name; acceptable trade for MVP.
    queryFn: () =>
      fetchJson<PaginatedApiResponse<AudienceListItem>>('/api/v1/emails/audiences?pageSize=50'),
  });

  // `fetchJson` THROWS on non-2xx, so a real 403/500/network error
  // sets `isError`, not a `{success: false}` envelope. Surface that
  // path separately so users see a recovery action instead of the
  // "create an audience first" empty state — caught by codex.
  const audiences = audiencesQuery.data && audiencesQuery.data.success
    ? audiencesQuery.data.data
    : [];
  const audienceFetchError = audiencesQuery.isError
    ? audiencesQuery.error instanceof Error
      ? audiencesQuery.error.message
      : 'Network error'
    : audiencesQuery.data && !audiencesQuery.data.success
      ? audiencesQuery.data.error.message
      : null;

  const selectedAudienceId = form.watch('audienceId');
  const selectedAudience = audiences.find((a) => a.id === selectedAudienceId);

  function onSubmit(values: BroadcastValues) {
    setConfirming(values);
  }

  async function actuallySend() {
    if (!confirming) return;
    setSending(true);
    try {
      const result = await broadcastEmail(confirming);
      const { queued, noEmail, capSkipped, duplicateSkipped } = result.data;
      // Broadcast is async (see api/v1/emails/broadcast/route.ts) — the
      // server queues the sends via Next.js `after()` and returns
      // immediately. The toast reflects the queue state, not delivery
      // outcomes. The async path emits a structured `email_broadcast_complete`
      // logger event with the final tally; the audit log only captures
      // the broadcast START row (the after() callback runs outside the
      // request's AsyncLocalStorage so ctx.audit isn't reachable).
      const parts: string[] = [`Queued ${queued} email${queued === 1 ? '' : 's'}`];
      if (noEmail > 0) parts.push(`${noEmail} skipped (no email)`);
      if (duplicateSkipped > 0) parts.push(`${duplicateSkipped} deduped`);
      if (capSkipped > 0) parts.push(`${capSkipped} skipped (daily cap)`);
      toast.success(parts.join(' · '), {
        description: 'Delivery results land in the worker logs.',
      });
      form.reset();
      setConfirming(null);
    } catch (err) {
      reportMutationError('email.broadcast', err);
      toast.error(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setSending(false);
    }
  }

  if (audiencesQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading audiences…</p>;
  }

  if (audienceFetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm">
        <p className="font-medium text-red-800">Couldn’t load audiences</p>
        <p className="mt-1 text-red-700">{audienceFetchError}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => audiencesQuery.refetch()}
          disabled={audiencesQuery.isFetching}
        >
          {audiencesQuery.isFetching ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    );
  }

  if (audiences.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <Users className="text-muted-foreground mx-auto h-6 w-6" aria-hidden />
        <p className="mt-2 text-sm font-medium">No audiences yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Create an audience on the Audiences tab first, then come back to broadcast.
        </p>
      </div>
    );
  }

  return (
    <>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div>
          <label className="text-sm font-medium">Audience *</label>
          <Select
            value={selectedAudienceId || undefined}
            onValueChange={(v) => form.setValue('audienceId', v, { shouldValidate: true })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Pick an audience…" />
            </SelectTrigger>
            <SelectContent>
              {audiences.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.memberCount} rider{a.memberCount === 1 ? '' : 's'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.audienceId && (
            <p className="text-destructive mt-1 text-xs">
              {form.formState.errors.audienceId.message}
            </p>
          )}
          {selectedAudience && (
            <p className="text-muted-foreground mt-1 text-xs">
              {selectedAudience.memberCount === 0
                ? 'No riders match this audience right now.'
                : selectedAudience.memberCount > 100
                  ? `Audience matches ${selectedAudience.memberCount} riders — broadcasts cap at 50 unique recipients. Narrow the filters or split the audience.`
                  : selectedAudience.memberCount > 50
                    ? `Audience matches ${selectedAudience.memberCount} riders. Broadcasts cap at 50 unique sendable recipients — riders without an email or sharing an address are excluded automatically, so this may still fit.`
                    : `Will send to up to ${selectedAudience.memberCount} rider${selectedAudience.memberCount === 1 ? '' : 's'} (riders without an email or sharing an address are excluded).`}
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">Subject *</label>
          <Input placeholder="Email subject..." className="mt-1" {...form.register('subject')} />
          {form.formState.errors.subject && (
            <p className="text-destructive mt-1 text-xs">
              {form.formState.errors.subject.message}
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium">Body *</label>
          <Textarea
            placeholder="Write your message..."
            rows={10}
            className="mt-1"
            {...form.register('body')}
          />
          {form.formState.errors.body && (
            <p className="text-destructive mt-1 text-xs">
              {form.formState.errors.body.message}
            </p>
          )}
          <p className="text-muted-foreground mt-1 text-xs">
            Plain text only — formatting and links render as written. Suppressed addresses are
            skipped automatically.
          </p>
        </div>

        <Button
          type="submit"
          disabled={
            sending ||
            !selectedAudience ||
            selectedAudience.memberCount === 0 ||
            // Match the server's hard ceiling exactly. Server resolves
            // up to 2× cap + 1 (= 101 rows) and rejects at ≥101; the
            // UI mirrors that threshold so the boundary case of an
            // exactly-100-member audience that dedupes to ≤50 stays
            // submit-able. codex P2 (2026-05-26).
            selectedAudience.memberCount > 100
          }
        >
          <Send className="mr-2 h-4 w-4" />
          {sending ? 'Sending…' : 'Review broadcast'}
        </Button>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              This will queue an email to {selectedAudience?.memberCount ?? 0} rider
              {selectedAudience?.memberCount === 1 ? '' : 's'} in
              <strong> {selectedAudience?.name}</strong> with subject{' '}
              <strong>“{confirming?.subject}”</strong>. Sends run in the background;
              delivery results land in the worker logs. There’s no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={actuallySend} disabled={sending}>
              {sending ? 'Sending…' : 'Send now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
