import type { Metadata } from 'next';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Acceptable use policy',
  description: 'Rules for using Cavaliq responsibly, safely, and lawfully.',
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable use policy"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="Use Cavaliq legally and respectfully. Don't try to break it, don't use it to harm others, don't put illegal or unsafe content in it. Breach of this policy can result in suspension or termination."
    >
      <p>
        This Acceptable Use Policy (the &ldquo;<strong>AUP</strong>&rdquo;) applies to everyone who
        uses Cavaliq — club staff, riders, parents, owners, and visitors. It supplements the{' '}
        <a href="/legal/terms">Terms of Service</a> and the{' '}
        <a href="/legal/terms/end-user">end-user terms</a> and may be updated from time to time.
      </p>

      <h2 id="prohibited-content">1. Prohibited content</h2>
      <p>
        Don&rsquo;t use Cavaliq to host, send, or display content that:
      </p>
      <ul>
        <li>
          Is unlawful, defamatory, obscene, sexually explicit, hateful, harassing, or threatens
          violence;
        </li>
        <li>
          Infringes someone else&rsquo;s intellectual-property or privacy rights (including
          uploading photos of someone without their consent);
        </li>
        <li>
          Promotes self-harm, animal cruelty, or unsafe handling of horses;
        </li>
        <li>
          Contains malware, viruses, trackers, or any other code designed to disrupt the platform
          or harm a user&rsquo;s device.
        </li>
      </ul>

      <h2 id="prohibited-conduct">2. Prohibited conduct</h2>
      <p>
        Don&rsquo;t:
      </p>
      <ul>
        <li>
          Try to access an account, club, or piece of data that you are not authorised to access.
        </li>
        <li>
          Scrape, crawl, or extract data from the platform other than through the documented API
          using your own credentials.
        </li>
        <li>
          Reverse-engineer, decompile, or attempt to derive the source code of the platform,
          except to the extent permitted by applicable law.
        </li>
        <li>
          Probe, scan, or test the vulnerability of the platform without our written permission.
          (Responsible disclosure is welcome — see our{' '}
          <a href="/.well-known/security.txt">security.txt</a> file.)
        </li>
        <li>
          Use the platform to send spam or unsolicited marketing.
        </li>
        <li>
          Interfere with another user&rsquo;s use of the platform — for example, by overloading the
          API, holding open many sessions, or sending malformed requests.
        </li>
        <li>
          Resell or rebrand Cavaliq as your own product without a written reseller agreement.
        </li>
        <li>
          Use the platform in any way that would violate applicable law in your country or the
          United Arab Emirates.
        </li>
      </ul>

      <h2 id="club-staff">3. Additional rules for Club staff</h2>
      <p>
        If you have admin or manager access to a Club&rsquo;s Cavaliq account, you must:
      </p>
      <ul>
        <li>Only access rider data you need to do your job.</li>
        <li>
          Keep your credentials secret and use a strong password and multi-factor authentication
          where available.
        </li>
        <li>
          Never share a login. Add each staff member as their own user with the right role and
          permissions.
        </li>
        <li>
          Make sure any third party you give access to (e.g. an external accountant) has signed a
          confidentiality agreement and that you remove their access when they no longer need it.
        </li>
        <li>
          Use rider medical notes only for safety reasons — never for marketing, gossip, or any
          other purpose.
        </li>
      </ul>

      <h2 id="reporting">4. Reporting abuse</h2>
      <p>
        If you see content or conduct on Cavaliq that breaches this AUP, please report it. Email{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> with the details (URLs,
        screenshots, account names where relevant). For security vulnerabilities specifically,
        please follow the disclosure process at{' '}
        <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
      </p>

      <h2 id="enforcement">5. Enforcement</h2>
      <p>
        Depending on the seriousness of the breach, we may:
      </p>
      <ul>
        <li>Warn the user or Club;</li>
        <li>Remove offending content;</li>
        <li>Suspend the account temporarily;</li>
        <li>Terminate the account or the Club&rsquo;s subscription;</li>
        <li>Refer the matter to law enforcement.</li>
      </ul>
      <p>
        We will try to give notice and time to fix the issue, but in cases of immediate or serious
        harm we may act without notice.
      </p>
    </LegalPage>
  );
}
