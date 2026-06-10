import type { Metadata } from 'next';
import Link from 'next/link';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For club admins · Help centre',
  description:
    'Set up your stable on Cavaliq: staff, horses, arenas, lesson types, payments, and reporting.',
};

export default function ClubAdminHelpPage() {
  return (
    <HelpArticle
      title="Guide for club admins"
      description="Everything you need to set up your stable, manage staff, accept payments, and run reports."
    >
      <h2>1. Run the onboarding wizard</h2>
      <p>After signing up as a stable, you&rsquo;re taken through a five-step wizard:</p>
      <ol>
        <li>Club basics (timezone and currency).</li>
        <li>Arenas (add one or more; mark indoor and lighting).</li>
        <li>
          Lesson types (group, semi-private, private, with duration, capacity, and price). A
          one-click standard set is offered so you can start fast.
        </li>
        <li>Payments (connect Stripe, Ziina, or N-Genius, or skip and add later).</li>
        <li>Staff (invite coaches, grooms, managers; pick a role).</li>
      </ol>
      <p>
        You can come back and edit anything from <strong>Settings</strong>.
      </p>

      <h2>2. Connect a payment processor</h2>
      <p>
        Cavaliq is <em>not</em> a payment processor. Each stable connects its own account so the
        money lands in the stable&rsquo;s bank, not in a Cavaliq escrow. Connection lives in{' '}
        <strong>Settings → Payments</strong>. Most stables enable two: one for cards, one for the
        UAE Ziina wallet.
      </p>

      <h3>Stripe</h3>
      <p>Available globally. Best card processor for stables that take international cards.</p>
      <ol>
        <li>
          Sign in at{' '}
          <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">
            dashboard.stripe.com
          </a>
          .
        </li>
        <li>
          Go to{' '}
          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer">
            Developers → API keys
          </a>
          . Copy the <strong>Publishable key</strong> (<code>pk_live_…</code>) and{' '}
          <strong>Secret key</strong> (<code>sk_live_…</code>) — use the live versions for real
          payments, the test versions for sandbox testing. The two keys must be the same mode.
        </li>
        <li>
          Go to{' '}
          <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer">
            Developers → Webhooks → Add endpoint
          </a>
          . URL is <code>https://cavaliq.com/api/webhooks/stripe/&lt;your-club-id&gt;</code> —
          Cavaliq fills in the club id for you in Settings. Subscribe to{' '}
          <code>payment_intent.succeeded</code>, <code>payment_intent.payment_failed</code>,{' '}
          <code>payment_intent.canceled</code>, <code>charge.refunded</code>, and{' '}
          <code>charge.refund.updated</code>. Copy the signing secret (<code>whsec_…</code>) and
          paste it alongside the keys.
        </li>
      </ol>
      <p>
        Stripe&rsquo;s decline codes are documented at{' '}
        <a href="https://docs.stripe.com/declines/codes" target="_blank" rel="noopener noreferrer">
          docs.stripe.com/declines/codes
        </a>{' '}
        if you need to investigate a specific failure.
      </p>

      <h3>Ziina (UAE wallet + card)</h3>
      <p>
        UAE-focused. Riders without a Ziina account can still pay by card through the Ziina hosted
        page.
      </p>
      <ol>
        <li>
          Activate a business profile at{' '}
          <a href="https://ziina.com/business" target="_blank" rel="noopener noreferrer">
            ziina.com/business
          </a>{' '}
          if you don&rsquo;t already have one.
        </li>
        <li>
          In Ziina&rsquo;s dashboard, generate an API key (single string, no prefix needed). Paste
          it into Cavaliq.
        </li>
        <li>
          In Ziina&rsquo;s webhooks panel, add an endpoint pointing at{' '}
          <code>https://cavaliq.com/api/webhooks/ziina/&lt;your-club-id&gt;</code>. Subscribe to{' '}
          <code>payment_intent.status.updated</code> and <code>refund.status.updated</code>. Copy
          the webhook signing secret (Ziina shows it once) and paste it into Cavaliq.
        </li>
      </ol>
      <p>
        Ziina&rsquo;s API reference:{' '}
        <a
          href="https://docs.ziina.com/api-reference/payment-intent"
          target="_blank"
          rel="noopener noreferrer"
        >
          docs.ziina.com/api-reference/payment-intent
        </a>{' '}
        and{' '}
        <a
          href="https://docs.ziina.com/api-reference/refund"
          target="_blank"
          rel="noopener noreferrer"
        >
          /refund
        </a>
        . Getting-started guide:{' '}
        <a href="https://docs.ziina.com/getting-started" target="_blank" rel="noopener noreferrer">
          docs.ziina.com/getting-started
        </a>
        .
      </p>

      <h3>N-Genius (Network International)</h3>
      <p>
        UAE card processing. Good for cards that have trouble with international gateways. The
        connect form needs three pieces of info — get them from your N-Genius merchant portal.
      </p>
      <ol>
        <li>
          Sign in at{' '}
          <a href="https://portal.ngenius-payments.com" target="_blank" rel="noopener noreferrer">
            portal.ngenius-payments.com
          </a>
          .
        </li>
        <li>
          Settings → Integration → <strong>Service Accounts</strong>. Generate a new service account
          key. Paste it into Cavaliq as <strong>API key</strong> (no transformation — paste as-is).
        </li>
        <li>
          Settings → <strong>Organizational Hierarchy</strong>. Copy your{' '}
          <strong>Outlet reference</strong> (a short alphanumeric like <code>e1c4e7…</code>).
        </li>
        <li>
          Some merchant configurations also need a <strong>Realm name</strong> for identity exchange
          — N-Genius support can tell you whether yours does. Leave blank if your setup works
          without it; you&rsquo;ll get a clear error at connect time if it&rsquo;s required.
        </li>
        <li>
          Webhooks: in the merchant portal, configure a custom header (e.g.{' '}
          <code>X-Webhook-Token</code>) with a secret value of your choice. Point the webhook at{' '}
          <code>https://cavaliq.com/api/webhooks/n-genius</code> and paste the same header name +
          secret into Cavaliq. N-Genius doesn&rsquo;t HMAC-sign payloads — the shared header is how
          we authenticate.
        </li>
      </ol>
      <p>
        N-Genius docs:{' '}
        <a
          href="https://docs.ngenius-payments.com/reference/create-an-order-paypage"
          target="_blank"
          rel="noopener noreferrer"
        >
          Create an order
        </a>
        ,{' '}
        <a
          href="https://docs.ngenius-payments.com/reference/refund-a-capture-1"
          target="_blank"
          rel="noopener noreferrer"
        >
          Refund a capture
        </a>
        ,{' '}
        <a
          href="https://docs.ngenius-payments.com/reference/consuming-web-hooks"
          target="_blank"
          rel="noopener noreferrer"
        >
          Webhooks
        </a>
        .
      </p>

      <h2>3. Invite staff with the right role</h2>
      <p>Cavaliq has the following roles:</p>
      <ul>
        <li>
          <strong>Club admin:</strong> full access, including billing and settings.
        </li>
        <li>
          <strong>Club manager:</strong> day-to-day operations.
        </li>
        <li>
          <strong>Coach:</strong> own schedule, rider profiles, lesson notes.
        </li>
        <li>
          <strong>Horse owner:</strong> read-only on their own horses.
        </li>
        <li>
          <strong>Rider / parent:</strong> book and manage their lessons.
        </li>
        <li>
          <strong>Groom:</strong> horse care tasks and reminders.
        </li>
      </ul>
      <p>
        Give each staff member only the access they need. Remove access promptly when someone
        leaves.
      </p>

      <h2>4. Cancellation and refund rules</h2>
      <p>
        Default cancellation windows (24h / 12h / 0h) are in <strong>Settings → Bookings</strong>.
        You can tighten or loosen them per lesson type. The rules you set are shown to riders before
        they pay — see the <Link href="/legal/refunds">refund policy</Link> for the framework.
      </p>

      <h2>5. Horse profiles and care</h2>
      <p>
        Add each horse under <strong>Horses → Add horse</strong>. Fill in basics, weight limits, and
        skill match. Use the health tabs to log vet visits, vaccinations, farrier and dental
        appointments, feeding plans, and exercise sessions. Cavaliq sends reminders before each
        recurring care item is due.
      </p>

      <h2>6. Finance and reports</h2>
      <p>
        The <strong>Finances</strong> page shows the day&rsquo;s revenue across processors, with
        per-currency breakdowns. The <strong>Reports</strong> page exports rider rosters, lesson
        attendance, and payment summaries to CSV.
      </p>

      <h2>7. Communications</h2>
      <p>
        Use <strong>Emails</strong> to send announcements (e.g. arena closure, holiday hours). All
        emails go through our transactional email provider; unsubscribe links are added
        automatically for marketing-style emails.
      </p>

      <h2>8. Subscription and billing</h2>
      <p>
        Your Cavaliq subscription is in <strong>Settings → Billing</strong>. You can:
      </p>
      <ul>
        <li>Change plan (Starter / Growing / Professional).</li>
        <li>Switch to annual (two months free).</li>
        <li>Update payment method.</li>
        <li>
          Cancel — your access continues to the end of the period and the plan won&rsquo;t renew.
        </li>
      </ul>

      <h2>9. Data protection and compliance</h2>
      <p>
        When riders sign up to your stable, you become the data controller for their operational
        data. Read the <Link href="/legal/dpa">Data Processing Addendum</Link> to understand the
        commitments we&rsquo;ve made to you, and the{' '}
        <Link href="/legal/privacy">privacy policy</Link> for the wider posture.
      </p>

      <h2>10. Reference: the integrations Cavaliq runs on</h2>
      <p>
        These are the third-party services Cavaliq uses on your behalf — useful context if you ever
        need to debug a delivery, check a payment status, or rotate a credential.
      </p>
      <ul>
        <li>
          <strong>Authentication:</strong>{' '}
          <a href="https://clerk.com" target="_blank" rel="noopener noreferrer">
            Clerk
          </a>{' '}
          — sign-in, sessions, password reset, organization roles. Operator dashboard:{' '}
          <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer">
            dashboard.clerk.com
          </a>
          .
        </li>
        <li>
          <strong>Transactional email:</strong>{' '}
          <a href="https://resend.com" target="_blank" rel="noopener noreferrer">
            Resend
          </a>{' '}
          — booking confirmations, livery invoices, password reset. Operator dashboard:{' '}
          <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer">
            resend.com/domains
          </a>
          .
        </li>
        <li>
          <strong>Hosting + runtime:</strong>{' '}
          <a href="https://workers.cloudflare.com" target="_blank" rel="noopener noreferrer">
            Cloudflare Workers
          </a>{' '}
          (deployed via OpenNext for Next.js). Status:{' '}
          <a href="https://www.cloudflarestatus.com" target="_blank" rel="noopener noreferrer">
            cloudflarestatus.com
          </a>
          .
        </li>
        <li>
          <strong>Database:</strong>{' '}
          <a href="https://neon.com" target="_blank" rel="noopener noreferrer">
            Neon
          </a>{' '}
          (serverless Postgres). Status:{' '}
          <a href="https://neonstatus.com" target="_blank" rel="noopener noreferrer">
            neonstatus.com
          </a>
          .
        </li>
        <li>
          <strong>Rate limiting:</strong>{' '}
          <a href="https://upstash.com" target="_blank" rel="noopener noreferrer">
            Upstash Redis
          </a>{' '}
          — protects login + payment endpoints from brute force / abuse. Transparent to operators
          unless you see a rate-limit message in the UI.
        </li>
        <li>
          <strong>Error tracking:</strong>{' '}
          <a href="https://sentry.io" target="_blank" rel="noopener noreferrer">
            Sentry
          </a>{' '}
          — collects crash reports + error traces. PII is scrubbed before send (per our{' '}
          <Link href="/legal/privacy">privacy policy</Link>).
        </li>
        <li>
          <strong>File storage:</strong>{' '}
          <a href="https://developers.cloudflare.com/r2/" target="_blank" rel="noopener noreferrer">
            Cloudflare R2
          </a>{' '}
          — horse photos, club branding assets, uploaded documents. Files are scoped per-club; one
          club can never read another&rsquo;s uploads.
        </li>
      </ul>
      <p>
        Full list of subprocessors and the data each handles is in our{' '}
        <Link href="/legal/subprocessors">subprocessors page</Link>.
      </p>
    </HelpArticle>
  );
}
