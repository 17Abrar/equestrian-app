'use client';

import { useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useMutation } from '@tanstack/react-query';
import { Bell, Check, Camera, Trophy, HelpCircle, CalendarRange } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';

interface NotifyMeCardProps {
  /** Where the signup is coming from — included in the ops email so triage can prioritize. */
  source: 'web_admin' | 'web_rider';
  /** Heading copy varies slightly between admin (demo-mode framing) and rider (anticipation). */
  variant: 'admin' | 'rider';
}

interface NotifyMeResponse {
  success: true;
  data: { received: true };
}

const PLANNED_FEATURES = [
  { icon: Camera, label: 'Share lesson photos' },
  { icon: Trophy, label: 'Track progress together' },
  { icon: HelpCircle, label: 'Ask and answer rider questions' },
  { icon: CalendarRange, label: 'Coordinate rides and events' },
] as const;

export function NotifyMeCard({ source, variant }: NotifyMeCardProps) {
  const { user } = useUser();
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress ?? '');
  const [submitted, setSubmitted] = useState(false);

  const signup = useMutation({
    mutationFn: (payload: { email: string; source: typeof source }) =>
      fetchJson<NotifyMeResponse>('/api/v1/community/notify-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setSubmitted(true);
      toast.success("You're on the list. We'll email you when it ships.");
    },
    onError: (err) => {
      // `reportMutationError` only sends to Sentry/console — the user
      // also needs to see the failure (429 from rate limit, validation
      // error, network blip). Without this, the form silently returns
      // to its idle state and the user has no idea whether they were
      // added.
      reportMutationError('community.notify_me', err);
      toast.error(err instanceof Error ? err.message : "Couldn't join the waitlist");
    },
  });

  const heading =
    variant === 'admin' ? 'Community is coming this quarter' : 'Community is on the way';
  const body =
    variant === 'admin'
      ? 'A built-in community surface for your stable — photos, progress, and announcements your riders see in-app. Drop your email and we’ll let you know when it goes live.'
      : 'Photos, progress, and announcements from your stable, right here. Drop your email and we’ll let you know the moment it’s ready.';

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-10 sm:py-12">
          <div className="mx-auto max-w-xl text-center">
            <div className="bg-accent mx-auto flex h-14 w-14 items-center justify-center rounded-full">
              <Bell className="text-muted-foreground h-6 w-6" aria-hidden />
            </div>
            <h2 className="mt-5 text-xl font-semibold">{heading}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>

            {submitted ? (
              <div className="bg-muted/50 mt-6 flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm">
                <Check className="h-4 w-4 text-green-600" aria-hidden />
                <span>
                  You’re on the list at <strong>{email}</strong>
                </span>
              </div>
            ) : (
              <form
                className="mt-6 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email) return;
                  signup.mutate({ email, source });
                }}
              >
                <Input
                  type="email"
                  required
                  inputMode="email"
                  placeholder="you@stable.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={signup.isPending}
                  aria-label="Email address"
                  className="flex-1"
                />
                <Button type="submit" disabled={signup.isPending || !email}>
                  {signup.isPending ? 'Saving…' : 'Notify me'}
                </Button>
              </form>
            )}

            <p className="text-muted-foreground mt-4 text-xs">
              Until then, your stable’s announcements come via email.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            What’s planned
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {PLANNED_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <Icon className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
                <span className="text-sm">{label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
