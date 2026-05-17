import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Cookie, Shield, BookOpen, Users, Server, Baby, Receipt } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Legal',
  description: "Cavaliq's legal documents, policies, and trust resources.",
};

const SECTIONS = [
  {
    heading: 'For everyone',
    items: [
      {
        title: 'Privacy policy',
        href: '/legal/privacy',
        description: 'How we collect, use, store, and share personal data.',
        icon: Shield,
      },
      {
        title: 'Cookie policy',
        href: '/legal/cookies',
        description: 'Cookies we set, why we set them, and how to manage them.',
        icon: Cookie,
      },
      {
        title: 'Acceptable use policy',
        href: '/legal/acceptable-use',
        description: 'What you can and cannot do with the platform.',
        icon: BookOpen,
      },
      {
        title: "Children's data statement",
        href: '/legal/children',
        description: 'How we handle data about junior riders.',
        icon: Baby,
      },
    ],
  },
  {
    heading: 'For clubs (B2B)',
    items: [
      {
        title: 'Terms of service',
        href: '/legal/terms',
        description: 'Master subscription agreement for clubs using Cavaliq.',
        icon: FileText,
      },
      {
        title: 'Data processing addendum',
        href: '/legal/dpa',
        description: 'Roles, processing scope, and security commitments.',
        icon: Server,
      },
      {
        title: 'Subprocessors',
        href: '/legal/subprocessors',
        description: 'The third-party services we use to deliver Cavaliq.',
        icon: Users,
      },
      {
        title: 'Service level agreement',
        href: '/legal/sla',
        description: 'Uptime commitment and support response targets.',
        icon: Server,
      },
    ],
  },
  {
    heading: 'For riders and parents',
    items: [
      {
        title: 'End-user terms',
        href: '/legal/terms/end-user',
        description: 'Terms that apply when you book through the platform.',
        icon: FileText,
      },
      {
        title: 'Refund & cancellation policy',
        href: '/legal/refunds',
        description: 'Cancellation windows, no-shows, and refund timing.',
        icon: Receipt,
      },
    ],
  },
] as const;

export default function LegalIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="border-b pb-8">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Legal</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Cavaliq legal & trust
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
          Everything in one place: privacy, terms, security, refund rules, and the contracts that
          govern how we work with clubs and riders. Have a specific question?{' '}
          <Link href="/support" className="underline">
            Contact support
          </Link>
          .
        </p>
      </header>

      <div className="mt-10 space-y-12">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-semibold">{section.heading}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="hover:bg-muted/30 group flex gap-4 rounded-lg border p-4 transition-colors"
                    >
                      <Icon className="text-muted-foreground group-hover:text-foreground mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <h3 className="text-foreground text-sm font-semibold">{item.title}</h3>
                        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="mt-16 border-t pt-8">
        <h2 className="text-base font-semibold">Contact</h2>
        <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed">
          For privacy questions, security disclosures, legal notices, or general support, email{' '}
          <a href="mailto:info@cavaliq.com" className="text-foreground underline">
            info@cavaliq.com
          </a>{' '}
          and we&rsquo;ll route it to the right person.
        </p>
      </footer>
    </div>
  );
}
