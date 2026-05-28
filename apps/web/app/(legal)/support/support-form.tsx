'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SUPPORT_CATEGORIES = [
  { value: 'general', label: 'General question' },
  { value: 'account', label: 'Account or sign-in' },
  { value: 'booking', label: 'Booking, refund, or payment' },
  { value: 'privacy', label: 'Privacy or data request' },
  { value: 'security', label: 'Security disclosure' },
  { value: 'feedback', label: 'Feedback or feature request' },
  { value: 'other', label: 'Something else' },
] as const;

const supportFormSchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(120),
  email: z.string().trim().email('Please enter a valid email address').max(254),
  category: z.enum([
    'general',
    'account',
    'booking',
    'privacy',
    'security',
    'feedback',
    'other',
  ]),
  message: z
    .string()
    .trim()
    .min(20, 'Please give us a little more detail (at least 20 characters)')
    .max(4000, 'Please keep your message under 4000 characters'),
});

type SupportFormValues = z.infer<typeof supportFormSchema>;

interface ApiEnvelope {
  success: boolean;
  error?: { code: string; message: string };
}

export function SupportForm() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset,
  } = useForm<SupportFormValues>({
    resolver: zodResolver(supportFormSchema),
    defaultValues: {
      name: '',
      email: '',
      category: 'general',
      message: '',
    },
  });

  const category = watch('category');

  const onSubmit = async (values: SupportFormValues) => {
    try {
      const res = await fetch('/api/v1/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope;
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message ?? 'Could not send your message');
      }
      setSubmitted(true);
      reset();
      toast.success("Message sent. We'll be in touch soon.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send your message');
    }
  };

  if (submitted) {
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center">
        <CheckCircle2 className="text-foreground mx-auto h-10 w-10" />
        <h3 className="mt-3 text-base font-semibold">Message sent</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Thanks &mdash; we&rsquo;ll reply to the email address you gave us.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setSubmitted(false)}
        >
          Send another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="support-name">Name</Label>
          <Input id="support-name" autoComplete="name" {...register('name')} className="mt-1.5" />
          {errors.name ? (
            <p className="text-destructive mt-1 text-xs">{errors.name.message}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="support-email">Email</Label>
          <Input
            id="support-email"
            type="email"
            autoComplete="email"
            {...register('email')}
            className="mt-1.5"
          />
          {errors.email ? (
            <p className="text-destructive mt-1 text-xs">{errors.email.message}</p>
          ) : null}
        </div>
      </div>

      <div>
        <Label htmlFor="support-category">Category</Label>
        <Select
          value={category}
          onValueChange={(value) =>
            setValue('category', value as SupportFormValues['category'], {
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger id="support-category" className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="support-message">Message</Label>
        <Textarea
          id="support-message"
          rows={6}
          placeholder="Tell us what's going on — links, screenshots paths, or steps to reproduce help a lot."
          {...register('message')}
          className="mt-1.5"
        />
        {errors.message ? (
          <p className="text-destructive mt-1 text-xs">{errors.message.message}</p>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        We&rsquo;ll use the details you provide only to respond to your message and improve the
        product. See our <a href="/legal/privacy" className="underline">privacy policy</a>.
      </p>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}
