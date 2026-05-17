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
      <p>
        After signing up as a stable, you&rsquo;re taken through a five-step wizard:
      </p>
      <ol>
        <li>Club basics (name, city, branding).</li>
        <li>Arenas (one or more, with capacity per slot).</li>
        <li>Lesson types (group, private, hack — with default pricing and duration).</li>
        <li>Staff (invite coaches, grooms, managers; pick a role).</li>
        <li>Payments (connect Stripe, Ziina, or N-Genius — or skip and add later).</li>
      </ol>
      <p>
        You can come back and edit anything from <strong>Settings</strong>.
      </p>

      <h2>2. Connect a payment processor</h2>
      <p>
        Cavaliq is <em>not</em> a payment processor. Each stable connects its own account so the
        money lands in the stable&rsquo;s bank, not in a Cavaliq escrow.
      </p>
      <ul>
        <li>
          <strong>Stripe:</strong> use your own publishable and secret keys. Available globally.
        </li>
        <li>
          <strong>Ziina:</strong> UAE wallet. Riders without a Ziina account can still pay by card
          through the Ziina hosted page.
        </li>
        <li>
          <strong>N-Genius (Network International):</strong> UAE card processing. Good for cards
          that don&rsquo;t work well with international gateways.
        </li>
      </ul>
      <p>
        Most stables enable two: one for cards and one for Ziina wallet payments. Connection lives
        in <strong>Settings → Payments</strong>.
      </p>

      <h2>3. Invite staff with the right role</h2>
      <p>
        Cavaliq has the following roles:
      </p>
      <ul>
        <li><strong>Club admin:</strong> full access, including billing and settings.</li>
        <li><strong>Club manager:</strong> day-to-day operations.</li>
        <li><strong>Coach:</strong> own schedule, rider profiles, lesson notes.</li>
        <li><strong>Horse owner:</strong> read-only on their own horses.</li>
        <li><strong>Rider / parent:</strong> book and manage their lessons.</li>
        <li><strong>Groom:</strong> horse care tasks and reminders.</li>
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
        Add each horse under <strong>Horses → Add horse</strong>. Fill in basics, weight limits,
        and skill match. Use the health tabs to log vet visits, vaccinations, farrier and dental
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
        <li>Cancel — your access continues to the end of the period and the plan won&rsquo;t renew.</li>
      </ul>

      <h2>9. Data protection and compliance</h2>
      <p>
        When riders sign up to your stable, you become the data controller for their operational
        data. Read the <Link href="/legal/dpa">Data Processing Addendum</Link> to understand the
        commitments we&rsquo;ve made to you, and the{' '}
        <Link href="/legal/privacy">privacy policy</Link> for the wider posture.
      </p>
    </HelpArticle>
  );
}
