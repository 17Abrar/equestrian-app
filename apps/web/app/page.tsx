import type { Metadata } from 'next';
import { MarketingHeader } from '@/components/landing/marketing-header';
import { Hero } from '@/components/landing/hero';
import { SocialProof } from '@/components/landing/social-proof';
import { FeaturesGrid } from '@/components/landing/features-grid';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Faq } from '@/components/landing/faq';
import { CtaBand } from '@/components/landing/cta-band';
import { MarketingFooter } from '@/components/landing/marketing-footer';

export const metadata: Metadata = {
  title: 'Cavaliq — Equestrian Club Management Software',
  description:
    'Run your equestrian stable from one place. Bookings, horses, riders, staff, and payments — built for the GCC. 14-day free trial.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Cavaliq — Equestrian Club Management Software',
    description:
      'Run your equestrian stable from one place. Bookings, horses, riders, staff, and payments — built for the GCC.',
    url: '/',
  },
};

export default function LandingPage() {
  return (
    <div className="bg-background min-h-screen">
      <MarketingHeader />
      <main>
        <Hero />
        <SocialProof />
        <FeaturesGrid />
        <HowItWorks />
        <Faq />
        <CtaBand />
      </main>
      <MarketingFooter />
    </div>
  );
}
