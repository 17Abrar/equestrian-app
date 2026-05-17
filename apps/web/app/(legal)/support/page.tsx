import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Clock, Globe } from 'lucide-react';
import { SupportForm } from './support-form';

export const metadata: Metadata = {
  title: 'Support',
  description: "Get help from the Cavaliq team. Email us or send a message through the form below.",
};

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Support</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">How can we help?</h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
          Send us a message below, or email{' '}
          <a href="mailto:info@cavaliq.com" className="text-foreground underline">
            info@cavaliq.com
          </a>{' '}
          directly. Typical first response within one business day; security disclosures within
          two.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="text-xl font-semibold">Send us a message</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Fill in the form and we&rsquo;ll reply to the email you provide.
          </p>
          <div className="mt-6">
            <SupportForm />
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <Mail className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Email us directly</p>
                <a
                  href="mailto:info@cavaliq.com"
                  className="text-muted-foreground hover:text-foreground mt-0.5 block text-sm underline"
                >
                  info@cavaliq.com
                </a>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  One inbox for support, privacy, security, and legal — we&rsquo;ll triage
                  internally and route it to the right person.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold">Response times</h3>
            <ul className="text-muted-foreground mt-3 space-y-2 text-xs">
              <li className="flex gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Critical (platform unreachable): within 1 hour, 24×7.</span>
              </li>
              <li className="flex gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>General questions: within 1 business day.</span>
              </li>
              <li className="flex gap-2">
                <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Business hours: 9am–6pm GST, Sun–Thu.</span>
              </li>
            </ul>
            <p className="text-muted-foreground mt-3 text-xs">
              See the <Link href="/legal/sla" className="underline">SLA</Link> for full details.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
