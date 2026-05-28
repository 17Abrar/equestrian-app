import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'End-user terms',
  description:
    'Terms that apply to riders, parents, and horse owners when they use Cavaliq to book lessons and manage their riding.',
};

export default function EndUserTermsPage() {
  return (
    <LegalPage
      title="End-user terms"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="These are the terms that apply when you — a rider, parent, or horse owner — use Cavaliq to book lessons or manage a horse. They cover how booking works, what you need to know about risk, and how payments are handled by your club's payment provider, not by Cavaliq."
    >
      <p>
        These end-user terms (the &ldquo;<strong>Terms</strong>&rdquo;) apply to anyone who uses
        Cavaliq as a rider, parent, guardian, horse owner, or other end-user (&ldquo;
        <strong>you</strong>&rdquo;). They form a binding agreement between you and Cavaliq.
      </p>
      <p>
        If you book lessons or other services through a riding club, stable, or yard (the &ldquo;
        <strong>Club</strong>&rdquo;), <strong>your contract for those services is with the
        Club</strong>, not with Cavaliq. Cavaliq provides the software that the Club uses to manage
        bookings, payments, and rider information; Cavaliq is not your riding instructor and does
        not own or operate any horses, arenas, or facilities.
      </p>

      <h2 id="eligibility">1. Who can use Cavaliq</h2>
      <p>
        You can create your own Cavaliq account if you are <strong>16 or older</strong>. If you are
        under 16, a parent or guardian must create the account and manage your profile. We do not
        knowingly accept direct sign-ups from children under 13. If you become aware that a child
        has signed up directly, email{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> and we will remove the
        account.
      </p>
      <p>
        See the <Link href="/legal/children">children&rsquo;s data statement</Link> for the full
        position on minors.
      </p>

      <h2 id="account">2. Your account</h2>
      <p>
        You must give us accurate information when you sign up and keep it up to date. Don&rsquo;t
        share your password. Tell us as soon as you can if you think someone else has accessed your
        account.
      </p>
      <p>
        You can close your account at any time from the in-app settings or by emailing{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>.
      </p>

      <h2 id="booking">3. Booking lessons</h2>
      <p>
        When you book a lesson:
      </p>
      <ul>
        <li>The booking creates a contract <strong>between you and the Club</strong>.</li>
        <li>
          The Club&rsquo;s own pricing, cancellation, no-show, and refund rules apply. The Club is
          required to display them before you confirm a booking.
        </li>
        <li>
          You authorise the Club to charge the payment method you have selected for the lesson fee
          (and any cancellation fee that may apply under the Club&rsquo;s rules).
        </li>
        <li>
          A confirmation will be sent to you by email and shown in the app. If anything looks wrong,
          contact the Club immediately.
        </li>
      </ul>
      <p>
        Cavaliq&rsquo;s default cancellation framework is described in the{' '}
        <Link href="/legal/refunds">refund and cancellation policy</Link>. The Club can adopt a
        stricter or more generous policy, which will be the one you see and accept at checkout.
      </p>

      <h2 id="payments">4. Payments</h2>
      <p>
        Cavaliq is <strong>not a payment processor</strong>. When you pay for a lesson, the payment
        flows through the processor the Club has connected — Stripe, Ziina, or Network
        International (N-Genius). The processor receives your card or wallet details directly from
        your browser. Cavaliq receives only the tokens and references needed to record that the
        payment was successful.
      </p>
      <p>
        The Club is the merchant of record for the lesson. If you need an invoice, a receipt, or a
        refund, the Club handles it (Cavaliq can assist if there&rsquo;s a technical issue with the
        platform).
      </p>
      <p>
        Some payments may appear on your statement under the processor&rsquo;s name (for example,
        &ldquo;Ziina&rdquo;) rather than the Club&rsquo;s name. This is normal.
      </p>

      <h2 id="cancellation">5. Cancellation, no-shows, and refunds</h2>
      <p>
        Each Club sets its own cancellation policy within the framework on the{' '}
        <Link href="/legal/refunds">refund policy page</Link>. As a baseline:
      </p>
      <ul>
        <li>Cancellation more than 24 hours before the lesson: typically free.</li>
        <li>Cancellation between 12 and 24 hours before: typically 50% charge.</li>
        <li>Cancellation under 12 hours or no-show: typically full charge.</li>
        <li>
          If the Club cancels for a reason that&rsquo;s not your fault (weather, horse welfare,
          coach unavailable), you are entitled to a full refund or a free reschedule.
        </li>
      </ul>
      <p>
        These are defaults. The Club&rsquo;s actual policy is shown to you before you pay and is
        what governs your booking.
      </p>

      <h2 id="risk">6. Riding is inherently risky</h2>
      <p>
        Riding, handling horses, and being around horses involve risk of injury and, in rare cases,
        death. You acknowledge that:
      </p>
      <ul>
        <li>
          Horses are large, powerful animals whose behaviour cannot be fully predicted, even by
          experienced riders and trainers.
        </li>
        <li>
          You participate at your own risk and you must follow the Club&rsquo;s safety rules,
          including helmet and footwear requirements, and any instructions from coaches and staff.
        </li>
        <li>
          You are responsible for telling the Club about any medical condition, allergy, or other
          factor that affects your ability to ride safely.
        </li>
        <li>
          Cavaliq is a software platform. We do not assess your fitness to ride, the suitability of
          a horse, or the safety of any arena, facility, or coach. Those judgements are made by the
          Club.
        </li>
      </ul>
      <p>
        Nothing in this section limits any rights you may have under consumer protection law for
        death or personal injury caused by negligence.
      </p>

      <h2 id="content">7. Content you provide</h2>
      <p>
        You may upload photos, notes, or other content into your profile. You keep ownership of
        what you upload. You grant Cavaliq a worldwide, royalty-free, non-exclusive licence to host,
        store, and display that content as necessary to provide the service to you and to the Club.
      </p>
      <p>
        You must only upload content you have the right to upload. Do not upload anything illegal,
        defamatory, infringing, obscene, or otherwise contrary to the{' '}
        <Link href="/legal/acceptable-use">acceptable use policy</Link>.
      </p>

      <h2 id="suspension">8. Suspension and termination</h2>
      <p>
        We may suspend or terminate your account if you breach these Terms, the{' '}
        <Link href="/legal/acceptable-use">acceptable use policy</Link>, or any reasonable
        instruction we give you for safety, legal, or security reasons. The Club may also suspend
        or remove your access to its booking system for the same reasons or for unpaid balances.
      </p>
      <p>
        You can stop using Cavaliq at any time by closing your account. Closing your account does
        not cancel a booking that&rsquo;s already in progress with a Club — contact the Club to do
        that.
      </p>

      <h2 id="data">9. Your data</h2>
      <p>
        Our handling of your personal data is described in the{' '}
        <Link href="/legal/privacy">privacy policy</Link>. The Club is the controller of operational
        data about your rider profile, bookings, and horse care; Cavaliq is the processor for that
        data. Cavaliq is the controller of your account, sign-in, and billing data.
      </p>

      <h2 id="liability">10. Our responsibility to you</h2>
      <p>
        Cavaliq is provided to you free of charge as the end-user; the Club pays for our service.
        We aim to provide a reliable platform but we cannot guarantee the platform will be
        uninterrupted or error-free.
      </p>
      <p>
        To the maximum extent permitted by law, Cavaliq is not liable to you for:
      </p>
      <ul>
        <li>Anything that goes wrong in your relationship with the Club (refunds, conduct of staff, condition of horses or facilities, quality of teaching).</li>
        <li>Indirect or consequential loss.</li>
        <li>Loss or damage that could not reasonably have been expected at the time you accepted these Terms.</li>
      </ul>
      <p>
        Nothing in these Terms excludes or limits liability for death, personal injury caused by
        our negligence, fraud, or any other liability that cannot lawfully be limited.
      </p>

      <h2 id="changes">11. Changes</h2>
      <p>
        We may update these Terms. If a change is material, we will notify you in-product or by
        email before it takes effect. Continued use of Cavaliq after the change takes effect means
        you accept the new Terms.
      </p>

      <h2 id="contact">12. Contact and disputes</h2>
      <p>
        For account, technical, or privacy questions, contact us at{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. For issues about a lesson,
        refund, or conduct of staff or horses, contact your Club directly first; we will help if
        you cannot reach a resolution.
      </p>
      <p>
        These Terms are governed by the laws of the United Arab Emirates. Any dispute is subject
        to the exclusive jurisdiction of the courts of Dubai, except where you have a non-waivable
        right to bring proceedings in the courts of the country where you live.
      </p>
    </LegalPage>
  );
}
