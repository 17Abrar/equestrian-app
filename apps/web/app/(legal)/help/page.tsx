import type { Metadata } from 'next';
import Link from 'next/link';
import {
  User,
  Heart,
  Users,
  GraduationCap,
  Building2,
  Wrench,
  HelpCircle,
  MessageSquare,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Help centre',
  description: 'Guides, articles, and answers to common questions about Cavaliq.',
};

const ROLE_GUIDES = [
  {
    href: '/help/rider',
    title: 'For riders',
    description: 'Find a stable, book lessons, manage your profile and progress.',
    icon: User,
  },
  {
    href: '/help/parent',
    title: 'For parents & guardians',
    description: 'Manage a child rider, set medical notes, pay safely.',
    icon: Heart,
  },
  {
    href: '/help/owner',
    title: 'For horse owners',
    description: 'Track your horse&rsquo;s care, vaccinations, and ownership records.',
    icon: Users,
  },
  {
    href: '/help/coach',
    title: 'For coaches',
    description: 'View your schedule, take attendance, record lesson notes.',
    icon: GraduationCap,
  },
  {
    href: '/help/club-admin',
    title: 'For club admins',
    description: 'Set up the club, manage staff, connect payments, run reports.',
    icon: Building2,
  },
  {
    href: '/help/groom',
    title: 'For grooms',
    description: 'Daily tasks, horse care reminders, exercise rotation.',
    icon: Wrench,
  },
] as const;

const FAQ = [
  {
    q: 'How do I sign up?',
    a: 'Go to cavaliq.com and click Sign up. Riders pick "Join as a rider"; clubs pick "Start your stable" and run through the onboarding wizard.',
  },
  {
    q: 'How are payments handled?',
    a: 'Each club connects its own payment account (Stripe, Ziina, or N-Genius). When you pay for a lesson, your card details go straight to the processor — Cavaliq never sees the full card number.',
  },
  {
    q: 'How do I cancel a lesson?',
    a: 'Open the booking in the app and tap Cancel. The cancellation fee (if any) depends on how much notice you give and the club’s policy, which is shown on the booking confirmation.',
  },
  {
    q: 'Can I delete my account?',
    a: 'Yes. In the mobile app, go to Profile → About → Delete account. On the web, contact info@cavaliq.com. We delete account data within 30 days, subject to records we are legally required to keep (e.g. tax invoices).',
  },
  {
    q: 'What if I forget my password?',
    a: 'Use the "Forgot password?" link on the sign-in page. Cavaliq uses Clerk for authentication, so the reset email comes from Clerk.',
  },
  {
    q: 'Where is my data stored?',
    a: 'Our primary database is hosted in the United States (Neon Postgres). Edge hosting is global (Cloudflare). See the subprocessors page for the full list.',
  },
] as const;

export default function HelpIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
          Help centre
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          How can we help?
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
          Guides and answers, organised by role. Can&rsquo;t find what you&rsquo;re looking for?{' '}
          <Link href="/support" className="underline">
            Contact support
          </Link>{' '}
          and we&rsquo;ll get back to you.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Guides by role</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_GUIDES.map((g) => {
            const Icon = g.icon;
            return (
              <li key={g.href}>
                <Link
                  href={g.href}
                  className="hover:bg-muted/30 group flex h-full gap-4 rounded-lg border p-4 transition-colors"
                >
                  <Icon className="text-muted-foreground group-hover:text-foreground mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <h3 className="text-foreground text-sm font-semibold">{g.title}</h3>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {g.description}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Frequently asked questions</h2>
        <dl className="mt-4 divide-y rounded-lg border">
          {FAQ.map((item) => (
            <div key={item.q} className="px-4 py-4 sm:px-5">
              <dt className="flex items-start gap-2 text-sm font-semibold">
                <HelpCircle className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                {item.q}
              </dt>
              <dd className="text-muted-foreground mt-2 pl-6 text-sm leading-relaxed">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-muted/30 mt-12 rounded-lg border p-6">
        <div className="flex items-start gap-4">
          <MessageSquare className="text-muted-foreground h-6 w-6 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">Still need help?</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Reach out to{' '}
              <a href="mailto:info@cavaliq.com" className="text-foreground underline">
                info@cavaliq.com
              </a>{' '}
              or visit the{' '}
              <Link href="/support" className="text-foreground underline">
                support page
              </Link>{' '}
              to send us a message. Typical first response within one business day.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
