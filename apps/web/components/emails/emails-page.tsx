'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AudiencesTab } from '@/components/emails/audiences-tab';
import { reportMutationError } from '@/components/shared/report-mutation-error';

async function sendEmail(data: { to: string; subject: string; body: string }) {
  const res = await fetch('/api/v1/emails/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(result.error?.message ?? 'Failed to send email');
  }
  return result;
}

export function EmailsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Emails</h1>
        <p className="mt-1 text-muted-foreground">Send emails to riders and manage communications</p>
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

function ComposeTab() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!to || !subject || !body) {
      toast.error('Please fill in all fields');
      return;
    }

    setSending(true);
    try {
      await sendEmail({ to, subject, body });
      toast.success('Email sent successfully');
      setTo('');
      setSubject('');
      setBody('');
    } catch (err) {
      reportMutationError('email.send', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compose Email</CardTitle>
        <CardDescription>Send an email to a rider, owner, or staff member</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">To *</label>
          <Input
            type="email"
            placeholder="rider@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Subject *</label>
          <Input
            placeholder="Email subject..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Body *</label>
          <Textarea
            placeholder="Write your email..."
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button onClick={handleSend} disabled={sending || !to || !subject || !body}>
          <Send className="mr-2 h-4 w-4" />
          {sending ? 'Sending...' : 'Send Email'}
        </Button>
      </CardContent>
    </Card>
  );
}
