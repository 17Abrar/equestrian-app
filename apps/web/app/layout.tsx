import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ClerkProvider
          dynamic
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
