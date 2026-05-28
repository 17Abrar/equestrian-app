import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Refund & cancellation policy',
  description:
    'Default cancellation windows, no-show rules, and refund timing for bookings made through Cavaliq.',
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund & cancellation policy"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="Bookings are between you and the Club. Each Club sets its own cancellation rules within the framework on this page, and the Club's own policy is shown to you before you pay. Refunds are typically returned within 5–10 business days to the original payment method."
    >
      <p>
        This page describes the default cancellation framework that applies to bookings made
        through Cavaliq. Each Club can configure its own cancellation rules within this framework;
        when the rules differ, the Club&rsquo;s own policy &mdash; <strong>which is shown to you on
        the booking page before you pay</strong> &mdash; is what governs your booking. If anything
        in this page conflicts with the policy you accepted at checkout, the policy you accepted
        controls.
      </p>

      <h2 id="cancelling">1. Cancelling a lesson you booked</h2>
      <p>
        You can cancel a booking from the booking detail screen in the Cavaliq app or by contacting
        the Club. The charge depends on how much notice you give before the start time of the
        lesson:
      </p>
      <ul>
        <li>
          <strong>More than 24 hours before the lesson:</strong> the lesson is cancelled and no
          cancellation fee is charged. Any payment already taken is refunded in full.
        </li>
        <li>
          <strong>Between 12 and 24 hours before the lesson:</strong> 50% of the lesson fee is
          retained as a cancellation fee. The remaining 50% is refunded.
        </li>
        <li>
          <strong>Less than 12 hours before the lesson, or a no-show:</strong> 100% of the lesson
          fee is retained. No refund.
        </li>
      </ul>
      <p>
        Clubs can be stricter or more generous than this default. The exact windows for your
        booking are always shown on the booking confirmation.
      </p>

      <h2 id="club-cancels">2. When the Club cancels</h2>
      <p>
        Sometimes the Club has to cancel a lesson at short notice — bad weather, an injured horse,
        a coach off sick, or a safety issue with an arena. When the Club cancels:
      </p>
      <ul>
        <li>You always get a full refund or a free reschedule, your choice.</li>
        <li>No cancellation fee applies to you.</li>
        <li>
          The Club will tell you as soon as it can and Cavaliq will send a notification through the
          app and by email.
        </li>
      </ul>

      <h2 id="refund-timing">3. How long refunds take</h2>
      <p>
        Refunds are returned to the original payment method. The Club triggers the refund from its
        Cavaliq dashboard; the payment processor then returns the funds. Typical timing:
      </p>
      <ul>
        <li>
          <strong>Card refunds (Stripe, N-Genius):</strong> 5–10 business days, sometimes faster.
          The exact timing depends on the issuing bank.
        </li>
        <li>
          <strong>Ziina refunds:</strong> typically 1–3 business days for Ziina-to-Ziina, 5–10
          business days for refunds back to a card via Ziina.
        </li>
      </ul>
      <p>
        If you don&rsquo;t see the refund after 10 business days, contact the Club first; the Club
        can confirm whether the refund was issued and share the reference. If you still need help,
        write to <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>.
      </p>

      <h2 id="late-arrival">4. Late arrival</h2>
      <p>
        If you arrive after a lesson has started, the Club will usually run the remaining time and
        charge the full fee. If you arrive so late that the lesson cannot reasonably go ahead,
        that&rsquo;s a no-show under the rules above.
      </p>

      <h2 id="subscription">5. Cavaliq subscription refunds (for Clubs)</h2>
      <p>
        Cavaliq&rsquo;s own subscription fees (Starter / Growing / Professional) are payable in
        advance. We do not refund the unused portion of a subscription period when a Club cancels
        for convenience — you can keep using the service through to the end of the period and the
        plan will not renew. We may make exceptions for genuine billing errors. See the{' '}
        <Link href="/legal/terms">Terms of Service</Link> for the full position.
      </p>

      <h2 id="disputes">6. Chargebacks and disputes</h2>
      <p>
        If you have a problem with a booking, please contact the Club first; most issues can be
        resolved directly. Filing a chargeback with your card issuer for a charge you authorised
        and received the service for may result in the Club suspending your account and recovering
        the disputed amount and any fees through other means.
      </p>

      <h2 id="prices-vat">7. Prices and VAT</h2>
      <p>
        Prices shown to riders include VAT where the Club is VAT-registered, in line with UAE
        Federal Tax Authority rules. Prices for Cavaliq&rsquo;s own subscriptions to Clubs are
        shown both excluding and including VAT on the billing page.
      </p>

      <h2 id="contact">8. Contact</h2>
      <p>
        Refund questions about a specific lesson: contact the Club.
      </p>
      <p>
        Questions about this policy or a problem with the platform itself: write to{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>.
      </p>
    </LegalPage>
  );
}
