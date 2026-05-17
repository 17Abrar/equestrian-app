import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Security overview',
  description: 'How Cavaliq protects your data: encryption, access control, tenant isolation, and incident response.',
};

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security overview"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="We protect your data with TLS everywhere, field-level encryption for medical data, application-layer tenant isolation, multi-factor sign-in, per-request audit logging, and a documented incident response process. We never see card numbers."
    >
      <p>
        Security is foundational to running a club platform that holds medical notes, payment
        records, and operational data about minors. This page is a plain-English summary of the
        technical and organisational measures we use to protect that data. The same measures are
        committed contractually in our <Link href="/legal/dpa">Data Processing Addendum</Link>.
      </p>

      <h2 id="data-in-transit">1. Data in transit</h2>
      <ul>
        <li>All connections use TLS 1.2 or higher.</li>
        <li>HSTS is enforced on cavaliq.com.</li>
        <li>
          Strict Content Security Policy with per-request nonces on every HTML response, plus
          <code> strict-dynamic</code> on modern browsers.
        </li>
        <li>
          Same-origin, allow-list-only CORS policy for cross-site API calls. Webhooks are signature-
          verified.
        </li>
      </ul>

      <h2 id="data-at-rest">2. Data at rest</h2>
      <ul>
        <li>The production database is encrypted at rest by Neon.</li>
        <li>
          Sensitive medical fields (rider medical notes; horse veterinary diagnosis and treatment)
          are additionally encrypted at the application layer before they reach the database, so a
          read on the storage layer alone returns ciphertext.
        </li>
        <li>Backups are encrypted with the same standard.</li>
      </ul>

      <h2 id="auth">3. Authentication and access</h2>
      <ul>
        <li>
          Sign-in is handled by Clerk, our identity provider. Clerk supports multi-factor
          authentication, social sign-in, and short-lived session tokens with rotation.
        </li>
        <li>
          Inside the platform, every action is gated by a role-based permission check. Roles are
          documented in the platform Settings &gt; Members section.
        </li>
        <li>
          Cavaliq staff who need production access use unique accounts protected by multi-factor
          authentication. Access is logged and reviewed periodically.
        </li>
      </ul>

      <h2 id="tenant-isolation">4. Tenant isolation</h2>
      <p>
        Cavaliq is a multi-tenant platform: many Clubs share the same database for cost and
        performance reasons. Tenant isolation is enforced in the application layer: every database
        query carries the current Club&rsquo;s identifier as a scope, and our test suite verifies
        that one Club cannot read another Club&rsquo;s data.
      </p>

      <h2 id="audit-logging">5. Audit logging</h2>
      <p>
        Every request that mutates Club Data — and most read operations on sensitive data — is
        recorded in an audit log with the actor, action, resource, time, and request ID. Logs are
        retained for at least 12 months and longer for incidents under investigation. They are
        also the &ldquo;audit trail of last resort&rdquo; in the event of a dispute or
        investigation.
      </p>

      <h2 id="payments">6. Payments and PCI scope</h2>
      <p>
        Cavaliq never sees full card numbers. Card data flows directly from the rider&rsquo;s
        browser to the Club&rsquo;s connected payment processor (Stripe, Ziina, or N-Genius). We
        receive only tokens and references. Our scope under PCI-DSS is SAQ-A.
      </p>

      <h2 id="network-and-infra">7. Network and infrastructure</h2>
      <ul>
        <li>The application runs on Cloudflare Workers, with strict outbound allow-listing.</li>
        <li>
          Rate limiting and bot protection are applied at the edge. Rules are tuned to absorb
          common abuse patterns without affecting legitimate traffic.
        </li>
        <li>The database is on Neon, with point-in-time recovery and routine restore drills.</li>
        <li>Object storage uses Cloudflare R2 with private-by-default buckets and signed URLs for upload and download.</li>
      </ul>

      <h2 id="people">8. People and process</h2>
      <ul>
        <li>All staff and contractors are bound by written confidentiality obligations.</li>
        <li>We use the principle of least privilege when granting access to production systems.</li>
        <li>Access is reviewed periodically and revoked when no longer needed.</li>
        <li>Dependency vulnerabilities are scanned automatically and triaged on a documented cadence.</li>
      </ul>

      <h2 id="incident-response">9. Incident response</h2>
      <p>
        Cavaliq has a documented incident response process. On detecting an incident we:
      </p>
      <ol>
        <li>Triage and contain the issue;</li>
        <li>Investigate the root cause and the scope of any data affected;</li>
        <li>Remediate;</li>
        <li>Notify affected Clubs without undue delay, and within 72 hours when applicable law requires;</li>
        <li>Run a post-incident review and publish a written summary to affected Clubs.</li>
      </ol>
      <p>
        Read the breach-notification commitments in section 8 of the{' '}
        <Link href="/legal/dpa">DPA</Link>.
      </p>

      <h2 id="responsible-disclosure">10. Responsible disclosure</h2>
      <p>
        If you believe you&rsquo;ve found a security issue with Cavaliq, please report it to{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. We commit to:
      </p>
      <ul>
        <li>Acknowledging your report within 2 business days;</li>
        <li>Working with you to understand and fix the issue;</li>
        <li>
          Not pursuing legal action against good-faith researchers who follow the guidelines in our{' '}
          <a href="/.well-known/security.txt">security.txt</a> file.
        </li>
      </ul>

      <h2 id="compliance">11. Compliance roadmap</h2>
      <p>
        Cavaliq is designed to meet UAE PDPL, GDPR, and Saudi PDPL operational requirements today.
        Formal third-party attestations (SOC 2 Type I, then Type II; ISO 27001) are on our roadmap
        as we scale.
      </p>
    </LegalPage>
  );
}
