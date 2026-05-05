import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://cavaliq.com'),
  title: {
    default: 'Cavaliq — Equestrian Club Management',
    template: '%s · Cavaliq',
  },
  description:
    'Run your equestrian club from one place — bookings, horses, riders, staff, and payments. Built for the GCC.',
  applicationName: 'Cavaliq',
  openGraph: {
    type: 'website',
    siteName: 'Cavaliq',
    title: 'Cavaliq — Equestrian Club Management',
    description:
      'Run your equestrian club from one place — bookings, horses, riders, staff, and payments.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cavaliq — Equestrian Club Management',
    description:
      'Run your equestrian club from one place — bookings, horses, riders, staff, and payments.',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // audit F-3 (2026-05-05) — read the per-request CSP nonce that
  // middleware.ts set on the `x-nonce` request header. Forwarded to
  // ClerkProvider so Clerk's injected scripts carry the nonce, which
  // satisfies the `script-src 'nonce-XXX' 'strict-dynamic'` directive
  // in modern browsers.
  //
  // `dynamic` on ClerkProvider is required by Clerk for nonce
  // propagation: their server-side init reads the nonce off the
  // request and bakes it into the `<script>` tags they emit; without
  // dynamic rendering, the per-request value would be cached.
  //
  // `await headers()` opts the entire app into dynamic rendering. With
  // OpenNext on Cloudflare we don't pre-render HTML anyway, so this is
  // a no-op for runtime cost. If we ever move to a host that does
  // static optimisation, audit this carefully — nonce-based CSP is
  // incompatible with PPR / static shells.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ClerkProvider
          dynamic
          nonce={nonce}
          appearance={{
            layout: {
              logoImageUrl: '/brand/cavaliq-logo-trimmed.png',
              logoLinkUrl: '/',
            },
            variables: {
              colorPrimary: '#0d1f34',
            },
          }}
        >
          <Providers>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
