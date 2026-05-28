import Link from 'next/link';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

const FOOTER_GROUPS = [
  {
    heading: 'Product',
    links: [
      { label: 'Find a stable', href: '/discover' },
      { label: 'Start a stable', href: '/sign-up?as=stable' },
      { label: 'Help centre', href: '/help' },
      { label: 'Contact support', href: '/support' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', href: '/legal/privacy' },
      { label: 'Terms of service', href: '/legal/terms' },
      { label: 'End-user terms', href: '/legal/terms/end-user' },
      { label: 'Refund policy', href: '/legal/refunds' },
      { label: 'Cookie policy', href: '/legal/cookies' },
      { label: 'Acceptable use', href: '/legal/acceptable-use' },
    ],
  },
  {
    heading: 'Trust',
    links: [
      { label: 'Data processing addendum', href: '/legal/dpa' },
      { label: 'Subprocessors', href: '/legal/subprocessors' },
      { label: 'Service level agreement', href: '/legal/sla' },
      { label: 'Security', href: '/legal/security' },
      { label: "Children's data", href: '/legal/children' },
      { label: 'Status', href: '/status' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <CavaliqLogo height={28} />
            <p className="text-muted-foreground max-w-xs text-sm">
              Equestrian club management for the GCC. Bookings, horses, riders, staff, and payments
              in one place.
            </p>
          </div>
          {FOOTER_GROUPS.map((group) => (
            <div key={group.heading}>
              <h3 className="text-foreground text-sm font-semibold">{group.heading}</h3>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            © {new Date().getFullYear()} Cavaliq. All rights reserved.
          </p>
          <p className="text-muted-foreground text-xs">
            Operating entity registration pending — see{' '}
            <Link href="/legal/privacy" className="hover:text-foreground underline">
              Privacy policy
            </Link>{' '}
            for current details.
          </p>
        </div>
      </div>
    </footer>
  );
}
