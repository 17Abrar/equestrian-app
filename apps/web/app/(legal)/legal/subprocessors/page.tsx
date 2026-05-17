import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Subprocessors',
  description:
    'The third-party services Cavaliq uses to deliver the platform, what they process, and where.',
};

interface Subprocessor {
  name: string;
  service: string;
  dataCategories: string;
  location: string;
  transferMechanism: string;
  url: string;
}

const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'Clerk',
    service: 'Identity and authentication',
    dataCategories: 'Account identifiers, email, sign-in timestamps, IP address',
    location: 'United States',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://clerk.com',
  },
  {
    name: 'Neon (Postgres)',
    service: 'Primary application database',
    dataCategories:
      'All Club Personal Data not handled by a payment processor — accounts, bookings, riders, horses (medical fields encrypted at rest)',
    location: 'United States (region selectable; current production: US-East)',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs; encryption at rest',
    url: 'https://neon.tech',
  },
  {
    name: 'Cloudflare',
    service: 'Edge hosting, CDN, DDoS protection, Workers runtime, R2 object storage',
    dataCategories: 'Request metadata, IP address, browser fingerprint; uploaded files in R2',
    location: 'Global edge — request served from nearest data centre',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://cloudflare.com',
  },
  {
    name: 'Resend',
    service: 'Transactional email delivery',
    dataCategories: 'Recipient email, name, email content (booking confirmations, receipts, alerts)',
    location: 'United States and EU',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://resend.com',
  },
  {
    name: 'Sentry',
    service: 'Error monitoring and performance tracing',
    dataCategories:
      'Crash stack traces, performance traces, sanitised request metadata. Form values, tokens, and passwords are stripped before send.',
    location: 'United States (us.sentry.io)',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://sentry.io',
  },
  {
    name: 'Stripe',
    service: 'Payment processing for clubs that connect Stripe',
    dataCategories:
      'Card data flows directly from the rider browser to Stripe. Cavaliq receives only tokens and references. Stripe also processes its own card-network data for fraud and compliance.',
    location: 'United States, EU',
    transferMechanism: "Stripe's published cross-border transfer safeguards (SCCs)",
    url: 'https://stripe.com',
  },
  {
    name: 'Ziina',
    service: 'Payment processing for clubs that connect Ziina',
    dataCategories: 'Payment tokens, transaction references',
    location: 'United Arab Emirates',
    transferMechanism: 'Domestic processing within the UAE',
    url: 'https://ziina.com',
  },
  {
    name: 'Network International (N-Genius)',
    service: 'Card payment processing for clubs that connect N-Genius',
    dataCategories: 'Payment tokens, transaction references',
    location: 'United Arab Emirates',
    transferMechanism: 'Domestic processing within the UAE',
    url: 'https://www.network.ae',
  },
  {
    name: 'Ably',
    service: 'Real-time messaging for in-app updates',
    dataCategories: 'Channel identifiers, IP address, ephemeral message payloads',
    location: 'EU and US data centres',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://ably.com',
  },
  {
    name: 'Upstash',
    service: 'Rate limiting and ephemeral cache (Redis)',
    dataCategories: 'IP address, request fingerprint, short-lived counters',
    location: 'Global low-latency replicas',
    transferMechanism: 'Contractual safeguards equivalent to EU SCCs',
    url: 'https://upstash.com',
  },
] as const;

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Subprocessors"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="These are the third-party services Cavaliq uses to deliver the platform. Each is bound by written terms equivalent to those in our Data Processing Addendum. We give clubs 10 days' notice before adding a new subprocessor."
    >
      <p>
        Cavaliq engages the following subprocessors to deliver the platform. Each entity processes
        the categories of data described below on our behalf, under written contractual terms
        equivalent to those in our <Link href="/legal/dpa">Data Processing Addendum</Link>.
      </p>
      <p>
        We&rsquo;ll give Clubs at least 10 days&rsquo; notice before adding or replacing a
        subprocessor by emailing the billing contact and updating this page. Clubs can object on
        reasonable data protection grounds — see section 6 of the DPA.
      </p>

      <h2 id="list">Current subprocessors</h2>
      <div className="not-prose overflow-x-auto">
        <table className="my-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-3 pr-4 font-semibold">Provider</th>
              <th className="py-3 pr-4 font-semibold">Service</th>
              <th className="py-3 pr-4 font-semibold">Data categories</th>
              <th className="py-3 pr-4 font-semibold">Location</th>
              <th className="py-3 font-semibold">Transfer mechanism</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((sp) => (
              <tr key={sp.name} className="border-b align-top last:border-0">
                <td className="py-3 pr-4 font-medium">
                  <a
                    href={sp.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground underline"
                  >
                    {sp.name}
                  </a>
                </td>
                <td className="text-muted-foreground py-3 pr-4">{sp.service}</td>
                <td className="text-muted-foreground py-3 pr-4">{sp.dataCategories}</td>
                <td className="text-muted-foreground py-3 pr-4">{sp.location}</td>
                <td className="text-muted-foreground py-3">{sp.transferMechanism}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="dual-role">A note on payment processors</h2>
      <p>
        Stripe, Ziina, and Network International are listed here for transparency, but their role
        differs from a typical subprocessor. When a rider pays for a lesson, the card or wallet
        data flows directly from the rider&rsquo;s browser to the processor — Cavaliq never sees
        the card details. The processor acts as a separate, independent controller of the
        cardholder&rsquo;s payment data under its own terms. Cavaliq only receives the tokens and
        references needed to record the transaction.
      </p>

      <h2 id="subscribe">Subscribe to changes</h2>
      <p>
        If you want to be notified of every change to this list (in addition to the in-product
        notice to your Club&rsquo;s billing contact), email{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> and we&rsquo;ll add you to a
        change-notification list.
      </p>
    </LegalPage>
  );
}
