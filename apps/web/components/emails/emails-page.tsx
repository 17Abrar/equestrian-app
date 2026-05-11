'use client';

import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AudiencesTab } from '@/components/emails/audiences-tab';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';

interface SendEmailResult {
  data: { id: string | null; message: string };
}

function sendEmail(data: { to: string; subject: string; body: string }) {
  return fetchJson<SendEmailResult>('/api/v1/emails/send', {
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
// project-wide form pattern (every other create-dialog uses zodResolver
// — settings, horses, riders, staff, owners, bookings, lesson-types,
// arenas, competitions, expenses, coupons, all onboarding sub-steps).
// CLAUDE.md mandates RHF+Zod for all forms.
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

type ComposeEmailValues = z.infer<typeof composeEmailSchema>;

function ComposeTab() {
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
    <Card>
      <CardHeader>
        <CardTitle>Compose Email</CardTitle>
        <CardDescription>Send an email to a rider, owner, or staff member</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            {isSubmitting ? 'Sending...' : 'Send Email'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
