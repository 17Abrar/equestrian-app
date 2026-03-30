'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Send, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="audiences">Audiences</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="mt-6">
          <ComposeTab />
        </TabsContent>

        <TabsContent value="sent" className="mt-6">
          <PlaceholderTab
            title="Sent Emails"
            description="View history of all sent emails with delivery and open tracking."
            icon={Mail}
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <PlaceholderTab
            title="Email Templates"
            description="Create and manage reusable email templates for common communications."
            icon={Mail}
          />
        </TabsContent>

        <TabsContent value="audiences" className="mt-6">
          <PlaceholderTab
            title="Audiences"
            description="Create rider segments based on skill level, activity, packages, and more."
            icon={Mail}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlaceholderTab({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Mail }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">This feature is coming soon.</p>
      </CardContent>
    </Card>
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
