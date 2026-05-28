import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How Cavaliq collects, uses, stores, shares, and protects personal data. UAE PDPL, GDPR, and Saudi PDPL compliant.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="We collect the data we need to run bookings, payments, and horse care at your club — nothing else. We never sell personal data. Medical notes about riders and horses are encrypted at rest. You can access, correct, or delete your data at any time by contacting info@cavaliq.com."
    >
      <h2 id="who-we-are">1. Who we are</h2>
      <p>
        Cavaliq is an equestrian club management platform operated under the brand &ldquo;Cavaliq&rdquo;
        from the United Arab Emirates. The operating legal entity is in the process of being
        registered; once registration is complete, the entity name, trade licence number, and
        registered office address will be published in this section. Until then, Cavaliq operates as
        an unincorporated business and the founder is the data controller of record.
      </p>
      <p>
        For the purposes of this policy:
      </p>
      <ul>
        <li>
          <strong>&ldquo;Cavaliq&rdquo;</strong>, <strong>&ldquo;we&rdquo;</strong>, <strong>&ldquo;us&rdquo;</strong>, or{' '}
          <strong>&ldquo;our&rdquo;</strong> means the entity described above.
        </li>
        <li>
          <strong>&ldquo;You&rdquo;</strong> means any individual whose personal data we process — a club
          staff member, coach, rider, parent, guardian, horse owner, or visitor to our website.
        </li>
        <li>
          <strong>&ldquo;Club&rdquo;</strong> means a riding stable or equestrian club that subscribes to
          Cavaliq and uses it to manage bookings, riders, horses, and payments.
        </li>
      </ul>

      <h2 id="controller-processor">2. Who controls your data</h2>
      <p>
        Cavaliq plays two different roles depending on the data:
      </p>
      <ul>
        <li>
          <strong>When you sign up directly on cavaliq.com</strong> (e.g. as a rider browsing
          stables, a club owner starting a trial, or a visitor to our marketing pages), Cavaliq is
          the <em>data controller</em> for your account, billing, and product-usage data.
        </li>
        <li>
          <strong>When a club uses Cavaliq to manage its riders, horses, bookings, and
          finances</strong>, the club is the data controller of that operational data. Cavaliq is
          the <em>data processor</em>, processing the data on the club&rsquo;s documented
          instructions. The relationship between Cavaliq and the club is governed by the{' '}
          <Link href="/legal/dpa">Data Processing Addendum</Link>.
        </li>
      </ul>
      <p>
        If you need to exercise data subject rights against operational data that a specific club
        manages (for example, asking your stable to delete its records about you), please contact
        that club directly. We will help facilitate the request.
      </p>

      <h2 id="what-we-collect">3. What we collect</h2>
      <p>
        We only collect the personal data we need for the purposes set out in section 4. Categories:
      </p>

      <h3>3.1 Account data</h3>
      <ul>
        <li>Name, email address, phone number (optional), profile photo (optional).</li>
        <li>
          Authentication identifiers from Clerk (our identity provider) — user ID, sign-in
          timestamps, IP address of the device used to sign in.
        </li>
        <li>Role within a club (e.g. admin, coach, rider, parent, owner, groom).</li>
      </ul>

      <h3>3.2 Booking and lesson data</h3>
      <ul>
        <li>Lesson types booked, dates, arenas, horses assigned, coaches assigned.</li>
        <li>Cancellation and no-show history.</li>
        <li>Notes coaches make about lessons (skill progression, observations).</li>
      </ul>

      <h3>3.3 Rider profile data</h3>
      <ul>
        <li>Date of birth, skill level, weight, height (when relevant to horse matching).</li>
        <li>Emergency contact name and phone number.</li>
        <li>
          <strong>Medical notes and allergies</strong> — only when the rider or their parent chooses
          to provide them, so coaches and staff can keep the rider safe. Encrypted at rest.
        </li>
        <li>For minors: parent or guardian name and contact details.</li>
      </ul>

      <h3>3.4 Horse profile and health data</h3>
      <ul>
        <li>Horse name, breed, age, sex, markings, weight limits, skill match.</li>
        <li>
          Veterinary records, vaccination dates, farrier visits, dental visits, medications, feed
          plans. The clinically sensitive parts are encrypted at rest.
        </li>
        <li>Owner contact information for ownership records.</li>
      </ul>

      <h3>3.5 Payment data</h3>
      <ul>
        <li>
          Amount, currency, payment method type, last 4 digits of the card (where the payment
          processor returns this), transaction reference.
        </li>
        <li>
          <strong>We never see or store full card numbers, CVV codes, or bank credentials.</strong>{' '}
          All card data is handled by Stripe, Ziina, or Network International (N-Genius) directly
          from your browser. We receive only tokens and references.
        </li>
        <li>Billing address and VAT details for invoicing the club&rsquo;s subscription.</li>
      </ul>

      <h3>3.6 Product-usage and technical data</h3>
      <ul>
        <li>
          Pages visited, features used, approximate location derived from IP, browser and device
          type, time zone, language preference.
        </li>
        <li>
          Crash reports and performance traces collected by Sentry to help us fix bugs. These
          exclude form values and authentication tokens.
        </li>
        <li>
          Audit log entries — who did what, when — so clubs can investigate disputes and so we can
          investigate security incidents.
        </li>
      </ul>

      <h2 id="why-we-process">4. Why we process your data (purposes and legal bases)</h2>
      <p>
        Under UAE PDPL (Federal Decree-Law No. 45 of 2021) and the GDPR (where it applies), we must
        identify a lawful basis for every processing activity. Our purposes and bases:
      </p>
      <ul>
        <li>
          <strong>To provide the service.</strong> Manage bookings, payments, horse care, and staff
          rotas. <em>Legal basis:</em> performance of the contract you (or your club) have with us.
        </li>
        <li>
          <strong>To keep riders and horses safe.</strong> Surface allergies, weight limits, and
          medical alerts to authorised staff. <em>Legal basis:</em> protection of vital interests
          and, for sensitive data, your explicit consent given when you completed the profile.
        </li>
        <li>
          <strong>To bill your club.</strong> Invoice subscriptions, send renewal reminders, handle
          refunds and chargebacks. <em>Legal basis:</em> performance of the contract.
        </li>
        <li>
          <strong>To comply with law.</strong> Tax records, anti-fraud screening, retention of
          payment records, response to lawful requests from regulators. <em>Legal basis:</em> legal
          obligation.
        </li>
        <li>
          <strong>To improve the product and keep it secure.</strong> Crash analytics, abuse
          detection, rate limiting. <em>Legal basis:</em> our legitimate interests in running a
          reliable, secure service, balanced against your interests.
        </li>
        <li>
          <strong>To communicate with you.</strong> Service announcements, security notices, and —
          if you opt in — product updates and marketing. <em>Legal basis:</em> performance of the
          contract for service messages; consent for marketing.
        </li>
      </ul>

      <h2 id="sensitive-data">5. Sensitive data</h2>
      <p>
        Two categories of data we process can be considered sensitive under most data protection
        laws:
      </p>
      <ul>
        <li>
          <strong>Rider medical notes and allergies.</strong> Provided voluntarily by the rider or
          their guardian. Stored encrypted at rest. Visible only to club staff with a role that
          needs to see them (admin, manager, coach). Never used for marketing, analytics, or any
          purpose other than rider safety.
        </li>
        <li>
          <strong>Horse veterinary and medication records.</strong> Strictly speaking these are
          animal-health records, not personal data — but they are treated with the same protections
          to maintain trust with owners and clubs.
        </li>
      </ul>
      <p>
        We rely on your <strong>explicit consent</strong> to process medical notes. You can withdraw
        consent at any time by deleting the data from your rider profile or by emailing{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. Withdrawal will not affect the
        lawfulness of processing carried out before withdrawal.
      </p>

      <h2 id="who-we-share-with">6. Who we share your data with</h2>
      <p>
        We share personal data only with the following categories of recipients, and only to the
        extent necessary for the purposes in section 4:
      </p>
      <ul>
        <li>
          <strong>Your club</strong> and its authorised staff. The club sees data about its own
          riders, horses, and staff in order to run its operations.
        </li>
        <li>
          <strong>Our subprocessors</strong> — listed publicly on the{' '}
          <Link href="/legal/subprocessors">subprocessors page</Link>. Each subprocessor is bound by
          written terms equivalent to those in our Data Processing Addendum.
        </li>
        <li>
          <strong>Payment processors</strong> that your club has connected — Stripe, Ziina, or
          Network International (N-Genius). Cavaliq is not a payment processor; the club&rsquo;s
          chosen processor receives card data directly from your browser, and Cavaliq is given only
          the tokens and references needed to reconcile transactions.
        </li>
        <li>
          <strong>Professional advisers</strong> (lawyers, auditors, accountants) under strict
          confidentiality, when their advice requires it.
        </li>
        <li>
          <strong>Regulators, courts, and law enforcement</strong>, where we are legally compelled
          and the request is valid under applicable law.
        </li>
        <li>
          <strong>An acquirer</strong>, if Cavaliq is sold, merged, or restructured. Any transfer
          would be subject to confidentiality and the protections in this policy.
        </li>
      </ul>
      <p>
        <strong>We do not sell personal data.</strong> We do not share personal data with
        advertising networks or data brokers.
      </p>

      <h2 id="international-transfers">7. International transfers</h2>
      <p>
        Cavaliq is operated from the United Arab Emirates, but the infrastructure that runs the
        service is global. The following transfers occur in normal operation:
      </p>
      <ul>
        <li>
          <strong>Database (Neon Postgres) — United States.</strong> Our primary database is hosted
          in a US region.
        </li>
        <li>
          <strong>Edge hosting and CDN (Cloudflare) — global edge.</strong> Your request is served
          from the nearest Cloudflare data centre; routing data may transit through multiple
          regions.
        </li>
        <li>
          <strong>Authentication (Clerk) — United States.</strong>
        </li>
        <li>
          <strong>Transactional email (Resend) — United States and EU.</strong>
        </li>
        <li>
          <strong>Error monitoring (Sentry) — United States or EU, depending on configuration.</strong>
        </li>
      </ul>
      <p>
        We rely on the following safeguards for these transfers:
      </p>
      <ul>
        <li>
          Contractual commitments equivalent to the EU Standard Contractual Clauses (SCCs) with
          each subprocessor.
        </li>
        <li>
          Technical measures: encryption in transit (TLS 1.2+) and at rest, application-level
          encryption for medical fields, strict access controls, and audit logging.
        </li>
        <li>
          Tenant-level data isolation enforced in the application layer, so one club&rsquo;s data is
          never returned to another club.
        </li>
      </ul>
      <p>
        If your jurisdiction requires a specific transfer mechanism (for example, prior approval
        from SDAIA for Saudi residents, or an adequacy mechanism for UAE PDPL), we will work with
        you and your club to put the appropriate safeguards in place.
      </p>

      <h2 id="retention">8. How long we keep your data</h2>
      <p>
        We retain personal data only for as long as we need it for the purposes set out in this
        policy, after which we delete or anonymise it. Typical retention:
      </p>
      <ul>
        <li>
          <strong>Account data</strong> — for the life of your account, plus 30 days after
          deletion (to allow recovery of accidentally deleted accounts).
        </li>
        <li>
          <strong>Booking history</strong> — 7 years, to support tax records, dispute resolution,
          and rider-progression reporting requested by the club.
        </li>
        <li>
          <strong>Payment records</strong> — 7 years, to comply with UAE Federal Tax Authority
          record-keeping rules and similar GCC requirements.
        </li>
        <li>
          <strong>Audit log</strong> — minimum 1 year, longer for incidents under investigation.
        </li>
        <li>
          <strong>Rider medical notes</strong> — deleted when the rider leaves the club or earlier
          if you ask us to remove them.
        </li>
        <li>
          <strong>Marketing-list subscriptions</strong> — until you unsubscribe, plus a short
          suppression-list retention to ensure we honour your opt-out.
        </li>
      </ul>
      <p>
        If you ask us to delete your data and we are legally required to retain certain records
        (e.g. tax invoices), we will isolate and minimise those records for the remaining retention
        period rather than continuing to process them.
      </p>

      <h2 id="your-rights">9. Your rights</h2>
      <p>
        Depending on where you live, you may have any of the following rights:
      </p>
      <ul>
        <li>
          <strong>Access</strong> — get a copy of the personal data we hold about you.
        </li>
        <li>
          <strong>Rectification</strong> — correct inaccurate or incomplete data.
        </li>
        <li>
          <strong>Erasure / deletion</strong> — ask us to delete data, subject to legal retention
          requirements.
        </li>
        <li>
          <strong>Restriction</strong> — ask us to limit processing while a dispute is resolved.
        </li>
        <li>
          <strong>Portability</strong> — receive your data in a structured, machine-readable
          format.
        </li>
        <li>
          <strong>Objection</strong> — object to processing carried out under our legitimate
          interests.
        </li>
        <li>
          <strong>Withdraw consent</strong> — for any processing based on consent, at any time.
        </li>
        <li>
          <strong>Lodge a complaint</strong> — with the UAE Data Office, the SDAIA in Saudi
          Arabia, your national supervisory authority in the EU/UK, or another competent regulator
          for your jurisdiction.
        </li>
      </ul>
      <p>
        To exercise any of these rights, email{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> or use the{' '}
        <Link href="/support">support page</Link>. We will verify your identity before fulfilling a
        request to make sure we&rsquo;re not handing your data to someone else. We aim to respond
        within 30 days; if a request is complex we may take longer and will tell you why.
      </p>

      <h2 id="children">10. Children</h2>
      <p>
        Many riders are minors. Cavaliq is built to handle this responsibly:
      </p>
      <ul>
        <li>
          We do not offer direct accounts to children under 16. A parent or guardian creates the
          account and manages the rider profile on the child&rsquo;s behalf.
        </li>
        <li>We do not knowingly collect personal data directly from a child under 13.</li>
        <li>
          We do not profile, target advertising at, or apply automated decision-making to minors.
        </li>
        <li>
          A parent or guardian can request access to, correction of, or deletion of their
          child&rsquo;s data at any time.
        </li>
      </ul>
      <p>
        See the dedicated <Link href="/legal/children">children&rsquo;s data statement</Link> for
        more.
      </p>

      <h2 id="security">11. Security</h2>
      <p>
        We protect your data with technical and organisational measures appropriate to the
        sensitivity of the data and the risk of harm. These include:
      </p>
      <ul>
        <li>TLS 1.2+ for all data in transit; HSTS enforced.</li>
        <li>Encryption at rest at the storage layer and field-level encryption for medical data.</li>
        <li>
          Role-based access control inside Cavaliq, with multi-factor authentication on Clerk-managed
          sign-in.
        </li>
        <li>
          Tenant isolation enforced in the application layer on every database query, so one
          club&rsquo;s data is never returned to another.
        </li>
        <li>Per-request audit logging.</li>
        <li>
          A documented incident response process with breach notification within statutory
          timeframes (72 hours under GDPR and Saudi PDPL; without undue delay under UAE PDPL).
        </li>
      </ul>
      <p>
        Read more on the <Link href="/legal/security">security overview</Link>.
      </p>

      <h2 id="cookies">12. Cookies</h2>
      <p>
        We use the smallest set of cookies needed to keep you signed in, deliver the service, and
        protect against abuse. Details, including how to manage cookies, are on the{' '}
        <Link href="/legal/cookies">cookie policy</Link>.
      </p>

      <h2 id="automated-decisions">13. Automated decision-making</h2>
      <p>
        Cavaliq does not make decisions about you that produce legal or similarly significant
        effects on you using purely automated means. The horse-matching feature offers suggestions
        to coaches; the coach makes the final call.
      </p>

      <h2 id="changes">14. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. When we do, we&rsquo;ll update the
        &ldquo;Last updated&rdquo; date at the top and, if the changes are significant, notify you
        by email or an in-product banner before they take effect.
      </p>

      <h2 id="contact">15. Contact</h2>
      <p>
        For any privacy question or to exercise your rights:
      </p>
      <ul>
        <li>
          Email: <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>
        </li>
        <li>
          Or use the <Link href="/support">support page</Link>.
        </li>
      </ul>
      <p>
        If you live in the UAE, you can complain to the UAE Data Office. If you live in Saudi
        Arabia, you can complain to the SDAIA. If you live in the EU or UK, you can complain to
        your national supervisory authority.
      </p>
    </LegalPage>
  );
}
