import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Data processing addendum',
  description:
    'Cavaliq Data Processing Addendum (DPA). Describes how Cavaliq processes personal data on behalf of clubs, with security commitments, sub-processing rules, and breach notification timelines.',
};

export default function DpaPage() {
  return (
    <LegalPage
      title="Data processing addendum (DPA)"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="When a Club uses Cavaliq, the Club is the data controller of its riders' and horses' data, and Cavaliq is the data processor. This addendum sets out the security, sub-processing, breach-notification, and transfer-mechanism obligations Cavaliq commits to."
    >
      <p>
        This Data Processing Addendum (the &ldquo;<strong>DPA</strong>&rdquo;) supplements the{' '}
        <Link href="/legal/terms">Terms of Service</Link> between Cavaliq and the Club. It governs
        the processing of personal data that the Club provides to Cavaliq, or that Cavaliq
        otherwise processes on the Club&rsquo;s behalf, in connection with the platform. In the
        event of a conflict between the Terms and this DPA on a privacy matter, this DPA controls.
      </p>
      <p>
        This DPA is designed to be compliant with UAE Federal Decree-Law No. 45 of 2021 (PDPL),
        the EU and UK GDPR (Article 28), the Saudi PDPL (Royal Decree M/19 of 2021), and
        equivalent GCC laws.
      </p>

      <h2 id="definitions">1. Definitions</h2>
      <ul>
        <li>
          <strong>Applicable Data Protection Law</strong> means any law applicable to the
          processing of personal data under this DPA, including UAE PDPL, GDPR, UK GDPR, Saudi
          PDPL, and equivalent laws of the countries where the Club operates.
        </li>
        <li>
          <strong>Personal Data</strong>, <strong>Processing</strong>,{' '}
          <strong>Controller</strong>, <strong>Processor</strong>, <strong>Data Subject</strong>,
          and <strong>Sub-processor</strong> have the meanings given in the Applicable Data
          Protection Law.
        </li>
        <li>
          <strong>Club Personal Data</strong> means Personal Data that the Club or its end-users
          provide to Cavaliq, or that Cavaliq processes on behalf of the Club.
        </li>
        <li>
          <strong>Security Incident</strong> means a breach of security leading to the accidental
          or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to,
          Club Personal Data.
        </li>
      </ul>

      <h2 id="roles">2. Roles</h2>
      <p>
        For all Club Personal Data:
      </p>
      <ul>
        <li>The Club is the Controller.</li>
        <li>Cavaliq is the Processor.</li>
      </ul>
      <p>
        Cavaliq will only process Club Personal Data in accordance with the Club&rsquo;s
        documented instructions, which are taken to be: (a) the Terms of Service; (b) this DPA;
        (c) any documented configuration of the platform that the Club applies; (d) any specific
        written instruction the Club gives. Cavaliq will inform the Club if, in its opinion, an
        instruction infringes Applicable Data Protection Law.
      </p>

      <h2 id="scope">3. Scope and purpose of processing</h2>
      <ul>
        <li>
          <strong>Subject matter:</strong> Provision of the Cavaliq platform.
        </li>
        <li>
          <strong>Duration:</strong> For the term of the Club&rsquo;s subscription, plus the
          export window and the retention period defined in the privacy policy.
        </li>
        <li>
          <strong>Nature:</strong> Hosting, storage, backup, transmission, retrieval, analysis,
          and deletion of Club Personal Data.
        </li>
        <li>
          <strong>Purpose:</strong> Enabling the Club to manage bookings, riders, horses, staff,
          payments, and communications.
        </li>
        <li>
          <strong>Categories of Data Subjects:</strong> The Club&rsquo;s staff, coaches, riders,
          parents and guardians, horse owners, and any other end-users the Club invites.
        </li>
        <li>
          <strong>Categories of Personal Data:</strong> Identity and contact data; account and
          authentication data; rider profile data; emergency-contact data; medical notes and
          allergies (sensitive); horse ownership and care data; booking and lesson history;
          payment-token and transaction-reference data; product-usage and audit data.
        </li>
      </ul>

      <h2 id="security">4. Security measures</h2>
      <p>
        Cavaliq will implement and maintain appropriate technical and organisational measures to
        protect Club Personal Data against the risks listed in Applicable Data Protection Law.
        These measures include:
      </p>
      <ul>
        <li>
          <strong>Encryption in transit:</strong> TLS 1.2 or higher on every external connection.
          HSTS enforced.
        </li>
        <li>
          <strong>Encryption at rest:</strong> Database storage encryption. Field-level encryption
          of designated sensitive fields (rider medical notes, horse veterinary diagnosis and
          treatment).
        </li>
        <li>
          <strong>Access control:</strong> Multi-factor authentication for staff with production
          access. Least-privilege role-based access inside Cavaliq. All access reviewed
          periodically.
        </li>
        <li>
          <strong>Tenant isolation:</strong> Application-layer tenant scoping enforced on every
          database query, with automated tests verifying that one Club cannot access another
          Club&rsquo;s data.
        </li>
        <li>
          <strong>Audit logging:</strong> Per-request audit log of who accessed or changed what.
          Logs retained for at least 12 months.
        </li>
        <li>
          <strong>Network:</strong> Strict outbound allow-list; Content Security Policy with
          nonce-based script-src; rate limiting on public endpoints.
        </li>
        <li>
          <strong>Vulnerability management:</strong> Automated dependency scanning, regular
          patching, and an internal review of security findings.
        </li>
        <li>
          <strong>Backups:</strong> Encrypted backups of the production database with a documented
          restore process.
        </li>
        <li>
          <strong>Personnel:</strong> Confidentiality obligations on all staff and contractors with
          access to Club Personal Data.
        </li>
      </ul>

      <h2 id="confidentiality">5. Confidentiality</h2>
      <p>
        Cavaliq ensures that anyone it authorises to process Club Personal Data is bound by
        appropriate confidentiality obligations.
      </p>

      <h2 id="sub-processors">6. Sub-processors</h2>
      <p>
        The Club provides general authorisation for Cavaliq to engage sub-processors, subject to
        the conditions in this section.
      </p>
      <ul>
        <li>
          Cavaliq publishes its current sub-processors on the{' '}
          <Link href="/legal/subprocessors">subprocessors page</Link>.
        </li>
        <li>
          Cavaliq will give the Club at least <strong>10 days&rsquo; notice</strong> before adding
          or replacing a sub-processor. Notice will be by email to the billing contact on file
          and by updating the subprocessors page.
        </li>
        <li>
          The Club can object to a new sub-processor on reasonable data protection grounds within
          the notice period. If the parties cannot agree on a way to address the objection, the
          Club may terminate its subscription at the end of the then-current billing period with a
          pro-rata refund of any prepaid fees covering the period after termination.
        </li>
        <li>
          Each sub-processor is bound by written terms that impose obligations equivalent to those
          in this DPA.
        </li>
      </ul>

      <h2 id="data-subject-requests">7. Data subject rights</h2>
      <p>
        Cavaliq will, taking into account the nature of the processing, provide reasonable
        assistance to the Club so the Club can respond to data subject requests under Applicable
        Data Protection Law. If Cavaliq receives a request directly from a data subject about Club
        Personal Data, Cavaliq will forward it to the Club rather than respond directly, unless it
        is legally required to act.
      </p>

      <h2 id="breach">8. Security incident notification</h2>
      <p>
        Cavaliq will notify the Club without undue delay, and in any event:
      </p>
      <ul>
        <li>
          <strong>within 72 hours</strong> of becoming aware of a Security Incident affecting Club
          Personal Data, where Applicable Data Protection Law requires the Club to notify a
          regulator within 72 hours; and
        </li>
        <li>
          <strong>without undue delay</strong> in all other cases.
        </li>
      </ul>
      <p>
        Each notification will include, to the extent known at the time:
      </p>
      <ul>
        <li>A description of the nature of the Security Incident and the categories and approximate number of Data Subjects and records concerned;</li>
        <li>The name and contact details of Cavaliq&rsquo;s point of contact;</li>
        <li>The likely consequences of the Security Incident;</li>
        <li>The measures Cavaliq has taken or proposes to take to address it.</li>
      </ul>
      <p>
        Cavaliq will follow up with additional information as the investigation develops. Cavaliq
        will also assist the Club, taking into account the nature of the processing, in carrying
        out any required notification to data subjects or supervisory authorities.
      </p>

      <h2 id="dpia">9. DPIAs and prior consultation</h2>
      <p>
        Cavaliq will provide reasonable assistance to the Club in carrying out any data protection
        impact assessment or prior consultation with a supervisory authority that the Club is
        required to perform in connection with the platform.
      </p>

      <h2 id="transfers">10. International transfers</h2>
      <p>
        The Club acknowledges that Cavaliq processes Club Personal Data outside the country of
        origin of the Data Subjects, including in the United States and at global Cloudflare edge
        locations (see the <Link href="/legal/subprocessors">subprocessors page</Link>). Cavaliq
        will rely on the following safeguards as applicable:
      </p>
      <ul>
        <li>EU Standard Contractual Clauses where transfers are made from the EEA or UK;</li>
        <li>The transfer mechanisms permitted under UAE PDPL and Saudi PDPL for transfers from those jurisdictions;</li>
        <li>Other lawful safeguards required by Applicable Data Protection Law.</li>
      </ul>

      <h2 id="audits">11. Audits</h2>
      <p>
        Cavaliq will make available to the Club all information reasonably necessary to demonstrate
        compliance with this DPA. On reasonable written notice, and no more than once per twelve
        months unless required by a regulator or following a Security Incident, the Club may audit
        Cavaliq&rsquo;s data protection practices. Audits will be conducted during normal business
        hours, will not unreasonably disrupt operations, and will respect the confidentiality of
        Cavaliq&rsquo;s other customers. Cavaliq may satisfy an audit request by providing third-
        party attestations or reports where available.
      </p>

      <h2 id="return-deletion">12. Return and deletion of data</h2>
      <p>
        On termination of the subscription, Cavaliq will make Club Personal Data available for
        export for 30 days. After that, Cavaliq will delete or anonymise Club Personal Data in
        accordance with the retention schedule in the{' '}
        <Link href="/legal/privacy">privacy policy</Link>, subject to any legal retention
        requirement (for example, payment records required by tax law).
      </p>

      <h2 id="liability-precedence">13. Liability and precedence</h2>
      <p>
        Each party&rsquo;s liability under this DPA is subject to the limitations and exclusions in
        the Terms of Service. In the event of a conflict between this DPA and the Terms on a
        privacy matter, this DPA controls.
      </p>
    </LegalPage>
  );
}
