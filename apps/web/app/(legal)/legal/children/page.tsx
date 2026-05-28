import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: "Children's data statement",
  description:
    "How Cavaliq handles personal data about minors, and the special protections we apply to junior riders.",
};

export default function ChildrenPage() {
  return (
    <LegalPage
      title="Children's data statement"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="Many riders are children. A parent or guardian creates and manages the account; the child does not sign up directly. We don't profile children, don't market to them, and don't apply automated decision-making to them."
    >
      <p>
        Many of the riders who book lessons through Cavaliq are children — sometimes very young.
        We&rsquo;ve built the platform around that reality, with a deliberately conservative
        approach to minors&rsquo; data. This page explains the principles we follow; the legal
        detail is in the <Link href="/legal/privacy">privacy policy</Link>.
      </p>

      <h2 id="age-thresholds">1. Age thresholds we follow</h2>
      <ul>
        <li>
          <strong>Under 13:</strong> we do not knowingly accept any direct sign-up. If we learn that
          a child under 13 has a direct account, we will remove it. A parent or guardian can
          register on the child&rsquo;s behalf and add the child as a rider on the parent&rsquo;s
          account.
        </li>
        <li>
          <strong>13 to 16:</strong> a parent or guardian creates and manages the account. The
          child does not have direct sign-in access of their own.
        </li>
        <li>
          <strong>16 and older:</strong> can create and manage their own account, with parental
          oversight available where requested.
        </li>
      </ul>

      <h2 id="parent-control">2. The parent is in control</h2>
      <p>
        When a parent or guardian creates the account:
      </p>
      <ul>
        <li>
          They are the contractual end-user under the{' '}
          <Link href="/legal/terms/end-user">end-user terms</Link>.
        </li>
        <li>They book and pay for lessons on the child&rsquo;s behalf.</li>
        <li>They consent to and manage the child&rsquo;s rider profile, including any medical notes.</li>
        <li>
          They can update, correct, or delete the child&rsquo;s data at any time from the in-app
          profile or by emailing <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>.
        </li>
      </ul>

      <h2 id="what-we-dont-do">3. What we don&rsquo;t do with children&rsquo;s data</h2>
      <ul>
        <li>We don&rsquo;t use children&rsquo;s data for marketing.</li>
        <li>We don&rsquo;t build behavioural profiles of children.</li>
        <li>We don&rsquo;t share children&rsquo;s data with advertising or analytics networks.</li>
        <li>
          We don&rsquo;t apply automated decision-making to children. Horse-matching suggestions
          are offered to coaches; the coach makes the final call.
        </li>
      </ul>

      <h2 id="sensitive">4. Medical notes about a child</h2>
      <p>
        A parent may choose to add medical notes (allergies, asthma, conditions, etc.) to a
        child&rsquo;s rider profile so that the club&rsquo;s coaches and staff can keep the child
        safe. These notes:
      </p>
      <ul>
        <li>Are encrypted at rest;</li>
        <li>Are visible only to authorised club staff with a role that needs to see them;</li>
        <li>Are never used for any purpose other than rider safety;</li>
        <li>Can be edited or deleted by the parent at any time.</li>
      </ul>

      <h2 id="club-responsibility">5. The club&rsquo;s responsibility</h2>
      <p>
        The club is the data controller of children&rsquo;s rider data once it&rsquo;s in the
        platform. The club is responsible for:
      </p>
      <ul>
        <li>Only collecting the data it actually needs;</li>
        <li>Limiting staff access to those who need it for the child&rsquo;s safety;</li>
        <li>Acting promptly on parental requests for access, correction, or deletion;</li>
        <li>Notifying the parent (and Cavaliq) of any data incident.</li>
      </ul>
      <p>
        Cavaliq provides the tools (role-based access, audit logging, encryption) and the contract
        (<Link href="/legal/dpa">DPA</Link>) to support the club in meeting these obligations.
      </p>

      <h2 id="contact">6. Contact</h2>
      <p>
        If you are a parent or guardian and you want to access, correct, or delete data about your
        child, write to <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. We will
        verify that you are the parent or guardian before fulfilling the request.
      </p>
    </LegalPage>
  );
}
