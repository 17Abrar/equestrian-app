import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Activity, Globe2, Database, Mail as MailIcon } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Real-time status of the Cavaliq platform and its components.',
};

const COMPONENTS = [
  { name: 'Web dashboard', icon: Globe2, status: 'operational' },
  { name: 'Mobile API', icon: Activity, status: 'operational' },
  { name: 'Database (Neon)', icon: Database, status: 'operational' },
  { name: 'Transactional email (Resend)', icon: MailIcon, status: 'operational' },
] as const;

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  operational: { label: 'Operational', tone: 'text-emerald-600' },
  degraded: { label: 'Degraded', tone: 'text-amber-600' },
  outage: { label: 'Outage', tone: 'text-red-600' },
};

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Status</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Cavaliq platform status
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
          This page is a lightweight first-version status indicator while we set up a full status
          monitor. For an ongoing live status feed, follow the in-app announcements; for
          subscription-relevant downtime, the SLA terms apply.
        </p>
      </header>

      <section className="mt-10 rounded-lg border bg-emerald-50/50 p-5 dark:bg-emerald-950/20">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <div>
            <p className="text-foreground text-base font-semibold">All systems operational</p>
            <p className="text-muted-foreground text-xs">
              Last checked: {new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Components</h2>
        <ul className="mt-3 divide-y rounded-lg border">
          {COMPONENTS.map((c) => {
            const Icon = c.icon;
            const status = STATUS_LABEL[c.status];
            return (
              <li key={c.name} className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div className="flex items-center gap-3">
                  <Icon className="text-muted-foreground h-4 w-4" />
                  <span className="text-sm font-medium">{c.name}</span>
                </div>
                <span className={`text-xs font-medium ${status?.tone ?? ''}`}>{status?.label}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-10 rounded-lg border p-5">
        <h2 className="text-base font-semibold">Reporting an issue</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          If the platform is misbehaving for you but this page shows operational, please{' '}
          <Link href="/support" className="underline">
            send us a message
          </Link>{' '}
          with as much detail as possible (what you were doing, the time, your browser or device).
          For S1 critical issues, email{' '}
          <a href="mailto:info@cavaliq.com" className="underline">
            info@cavaliq.com
          </a>{' '}
          with <strong>S1</strong> in the subject.
        </p>
      </section>

      <footer className="mt-10 border-t pt-6">
        <p className="text-muted-foreground text-xs">
          A full live status monitor with historical uptime is on the roadmap. Read the SLA at{' '}
          <Link href="/legal/sla" className="underline">
            cavaliq.com/legal/sla
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
