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
  title: 'Equestrian Club Management',
  description: 'Manage your equestrian club — bookings, horses, riders, and more.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ClerkProvider dynamic>
          <Providers>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
