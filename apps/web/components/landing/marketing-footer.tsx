import Link from 'next/link';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';

interface FooterLink {
  label: string;
  href: string;
}

const PRODUCT_LINKS: FooterLink[] = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Discover stables', href: '/discover' },
];

const SUPPORT_LINKS: FooterLink[] = [
  { label: 'Help center', href: '/help' },
  { label: 'Contact support', href: '/support' },
  { label: 'Status', href: '/status' },
];

const LEGAL_LINKS: FooterLink[] = [
  { label: 'Terms (stables)', href: '/legal/terms' },
  { label: 'Terms (riders)', href: '/legal/terms/end-user' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Acceptable use', href: '/legal' },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" aria-label="Cavaliq home" className="inline-block">
              <CavaliqLogo height={28} />
            </Link>
            <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-relaxed">
              Equestrian club management software built for the GCC.
            </p>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Support" links={SUPPORT_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="text-muted-foreground mt-12 flex flex-col items-start justify-between gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center">
          <p>© {year} Cavaliq. All rights reserved.</p>
          <p>
            Need to sign in? <Link href="/sign-in" className="hover:text-foreground underline-offset-4 hover:underline">Riders</Link>
            {' · '}
            <Link href="/sign-in?as=stable" className="hover:text-foreground underline-offset-4 hover:underline">Stables</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-4 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
