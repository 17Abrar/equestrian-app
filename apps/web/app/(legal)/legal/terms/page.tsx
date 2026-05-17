import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'Master subscription agreement for clubs and stables using Cavaliq. Covers subscriptions, fees, data, and termination.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="These are the terms that apply when your club subscribes to Cavaliq. They cover what we provide, how billing works, who owns what, and how the relationship can end. If you're a rider or parent booking lessons, the terms that apply to you are the end-user terms instead."
    >
      <p>
        These Terms of Service (the &ldquo;<strong>Terms</strong>&rdquo;) form a binding agreement
        between Cavaliq (&ldquo;<strong>Cavaliq</strong>&rdquo;, &ldquo;<strong>we</strong>&rdquo;,
        &ldquo;<strong>us</strong>&rdquo;) and the riding stable, equestrian club, livery yard, or
        other organisation that has subscribed to the platform (the &ldquo;
        <strong>Club</strong>&rdquo;, &ldquo;<strong>you</strong>&rdquo;).
      </p>
      <p>
        These Terms apply to all subscriptions to Cavaliq and to all use of the platform by the
        Club and the Club&rsquo;s authorised users. If you are using Cavaliq as a rider, parent, or
        horse owner who books through a Club, the{' '}
        <Link href="/legal/terms/end-user">end-user terms</Link> apply to you instead.
      </p>

      <h2 id="acceptance">1. Acceptance and authority</h2>
      <p>
        By creating an account on behalf of a Club, by accepting an order form, or by continuing to
        use Cavaliq after these Terms are in effect, the Club accepts these Terms. The individual
        accepting confirms they have authority to bind the Club. If you don&rsquo;t have that
        authority, do not accept these Terms or use the platform.
      </p>

      <h2 id="service">2. The service</h2>
      <p>
        Cavaliq is a multi-tenant software-as-a-service platform that helps a riding club run its
        operations: bookings, rider profiles, horse profiles and care, staff rotas, finance, and
        communications. The exact features available depend on the Club&rsquo;s subscription tier.
      </p>
      <p>
        We will use commercially reasonable efforts to keep the platform available and to improve
        it over time. Specific uptime commitments and support response targets are in our{' '}
        <Link href="/legal/sla">service level agreement</Link>.
      </p>

      <h2 id="subscription">3. Subscriptions, trial, and renewal</h2>
      <p>
        Cavaliq is sold on a subscription basis. The plans currently offered are:
      </p>
      <ul>
        <li>
          <strong>Starter</strong> — AED 300 per month.
        </li>
        <li>
          <strong>Growing</strong> — AED 800 per month.
        </li>
        <li>
          <strong>Professional</strong> — AED 2,000 per month.
        </li>
      </ul>
      <p>
        All plans include unlimited riders. Prices are exclusive of VAT (5% in the UAE), which is
        added on the invoice. Annual subscriptions receive two months free.
      </p>
      <p>
        New Clubs may receive a <strong>14-day free trial</strong>. No card is charged during the
        trial. When the trial ends, the Club must choose a plan and provide a valid payment method
        to continue using paid features.
      </p>
      <p>
        Paid subscriptions <strong>renew automatically</strong> at the end of each billing period
        until cancelled. The Club can cancel at any time from the in-product billing page; the
        cancellation takes effect at the end of the then-current period and the subscription will
        not renew. We will email a renewal reminder before any annual renewal.
      </p>
      <p>
        We may change the prices and feature mix from time to time. If we change a price, we will
        give at least 30 days&rsquo; notice and the new price will only apply from the start of the
        next billing period.
      </p>

      <h2 id="fees">4. Fees, taxes, and payment</h2>
      <p>
        The Club pays Cavaliq the subscription fee for its chosen plan, plus any applicable VAT and
        other taxes. Payment is taken automatically on the renewal date using the payment method on
        file.
      </p>
      <p>
        If a payment fails, we will retry and notify the Club&rsquo;s billing contact. If the
        invoice remains unpaid after a reasonable cure period, we may suspend access to the
        platform. Data is retained during suspension but read/write features are disabled until the
        balance is settled.
      </p>
      <p>
        Cavaliq is not the merchant of record for any payment the Club takes from its riders.
        Riders pay the Club through the payment processor the Club has connected (Stripe, Ziina, or
        Network International). Cavaliq earns no transaction-based fee on those rider payments
        beyond the subscription fee.
      </p>

      <h2 id="account">5. Account, users, and security</h2>
      <p>
        The Club is responsible for the activity of all users it adds to the platform. It must:
      </p>
      <ul>
        <li>Keep credentials confidential and require strong, unique passwords.</li>
        <li>Enable multi-factor authentication where available.</li>
        <li>
          Remove user access promptly when a staff member leaves or no longer needs access.
        </li>
        <li>Use Cavaliq&rsquo;s role system to give each user only the permissions they need.</li>
        <li>
          Notify us promptly at <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> on
          learning of any unauthorised use of the account.
        </li>
      </ul>

      <h2 id="data">6. Club data and ownership</h2>
      <p>
        <strong>The Club owns its data.</strong> &ldquo;Club Data&rdquo; means all data the Club or
        its users upload, enter, or generate through the platform — rider profiles, horse records,
        booking history, photos, notes, etc.
      </p>
      <p>
        The Club grants Cavaliq a worldwide, non-exclusive licence to host, copy, transmit, display,
        process, and back up Club Data <em>only</em> as needed to provide the service, to comply
        with law, and to develop and improve the platform in aggregate and anonymised form (no
        Cavaliq feature is trained on or fine-tuned on a specific Club&rsquo;s identifiable data
        without separate consent).
      </p>
      <p>
        On termination, the Club can export Club Data for 30 days. After that, we will delete Club
        Data in accordance with the retention rules in the{' '}
        <Link href="/legal/privacy">privacy policy</Link>, subject to any legal hold.
      </p>
      <p>
        Where Cavaliq processes personal data on behalf of the Club, the{' '}
        <Link href="/legal/dpa">Data Processing Addendum</Link> applies and is incorporated into
        these Terms by reference. In the event of a conflict between these Terms and the DPA on
        privacy matters, the DPA controls.
      </p>

      <h2 id="ip">7. Intellectual property</h2>
      <p>
        Cavaliq retains all rights, title, and interest in the platform — the software, design,
        documentation, content, trademarks, and know-how. The Club is granted a non-exclusive,
        non-transferable right to access and use the platform for its internal business operations
        during the subscription term.
      </p>
      <p>
        Feedback the Club sends us about the product (suggestions, ideas, bug reports) may be used
        by us to improve the platform without payment or attribution, but we will never use the
        Club&rsquo;s confidential information for that purpose.
      </p>

      <h2 id="acceptable-use">8. Acceptable use</h2>
      <p>
        The Club, its users, and anyone acting on its behalf must comply with the{' '}
        <Link href="/legal/acceptable-use">Acceptable Use Policy</Link>. We may suspend or
        terminate access for material or repeated breaches.
      </p>

      <h2 id="confidentiality">9. Confidentiality</h2>
      <p>
        Each party may receive information from the other that is marked or reasonably understood
        to be confidential. Each party will protect the other&rsquo;s confidential information with
        the same standard of care it uses for its own (at least a reasonable standard), use it only
        for the purposes of these Terms, and not disclose it except to its employees and advisers
        on a need-to-know basis under confidentiality obligations.
      </p>
      <p>
        Confidentiality does not apply to information that is public, that the receiving party
        already had, that a third party rightfully made available, or that the receiving party is
        required to disclose by law (with prompt notice where lawful).
      </p>

      <h2 id="warranties">10. Warranties</h2>
      <p>
        Each party warrants that it has the right and authority to enter into these Terms and to
        perform its obligations under them.
      </p>
      <p>
        Cavaliq warrants that the platform will materially conform to its published documentation
        and that it will provide the platform with reasonable skill and care.
      </p>
      <p>
        Otherwise, the platform is provided <strong>&ldquo;as is&rdquo;</strong> and{' '}
        <strong>&ldquo;as available&rdquo;</strong>. To the maximum extent permitted by law, we
        disclaim all other warranties, express or implied, including merchantability, fitness for a
        particular purpose, and non-infringement.
      </p>

      <h2 id="indemnity">11. Indemnities</h2>
      <p>
        <strong>By Cavaliq.</strong> We will defend the Club from any third-party claim alleging
        that the platform itself infringes a third party&rsquo;s intellectual property rights, and
        will pay damages finally awarded against the Club by a court, provided the Club gives us
        prompt notice and reasonable cooperation. This obligation does not apply where the claim
        arises from Club Data, the Club&rsquo;s combination of the platform with other software, or
        the Club&rsquo;s breach of these Terms.
      </p>
      <p>
        <strong>By the Club.</strong> The Club will defend Cavaliq from any third-party claim
        arising out of Club Data, the Club&rsquo;s breach of these Terms, or the Club&rsquo;s use of
        the platform in a way that violates law.
      </p>

      <h2 id="liability">12. Liability</h2>
      <p>
        To the maximum extent permitted by law, neither party will be liable to the other for:
      </p>
      <ul>
        <li>indirect, incidental, consequential, special, or punitive damages;</li>
        <li>loss of profits, revenue, business, goodwill, or anticipated savings;</li>
        <li>loss or corruption of data (other than to the extent caused by our breach of the DPA).</li>
      </ul>
      <p>
        Each party&rsquo;s total aggregate liability arising out of or in connection with these
        Terms is capped at the fees paid or payable by the Club in the 12 months immediately
        preceding the event giving rise to the claim.
      </p>
      <p>
        Nothing in these Terms limits liability for death, personal injury caused by negligence,
        fraud or fraudulent misrepresentation, or any other liability that cannot be excluded under
        applicable law.
      </p>

      <h2 id="term">13. Term and termination</h2>
      <p>
        These Terms continue for as long as the Club has an active subscription. Either party may
        terminate:
      </p>
      <ul>
        <li>For convenience, by not renewing at the end of the then-current billing period.</li>
        <li>
          For cause, if the other party materially breaches these Terms and fails to cure within 30
          days of written notice.
        </li>
        <li>
          Immediately, if the other party becomes insolvent, is wound up, or enters into an
          arrangement with its creditors.
        </li>
      </ul>
      <p>
        On termination, we will provide a 30-day export window for Club Data. After 30 days, Club
        Data will be deleted per the retention schedule in the{' '}
        <Link href="/legal/privacy">privacy policy</Link>.
      </p>
      <p>
        Sections that by their nature should survive termination (data ownership, IP, indemnity,
        liability, governing law, confidentiality) will survive.
      </p>

      <h2 id="changes">14. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will post the updated Terms here and, if
        the change is material, notify the Club at least 30 days before it takes effect. Continued
        use of the platform after the effective date constitutes acceptance.
      </p>

      <h2 id="general">15. General</h2>
      <ul>
        <li>
          <strong>Entire agreement.</strong> These Terms (together with any order form, the DPA, and
          the policies referenced) are the entire agreement between the parties on this subject,
          superseding any prior communications.
        </li>
        <li>
          <strong>Severability.</strong> If any provision is held unenforceable, it will be modified
          to the minimum extent needed to make it enforceable and the rest will continue in effect.
        </li>
        <li>
          <strong>Assignment.</strong> Neither party may assign these Terms without the
          other&rsquo;s consent, except that either party may assign on a change of control to an
          entity that is not a competitor.
        </li>
        <li>
          <strong>Force majeure.</strong> Neither party is liable for a failure to perform due to
          events beyond its reasonable control (including widespread internet outages, government
          actions, and natural disasters).
        </li>
        <li>
          <strong>Notices.</strong> Notices to Cavaliq go to{' '}
          <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. Notices to the Club go to the
          billing contact on file.
        </li>
        <li>
          <strong>Governing law.</strong> These Terms are governed by the laws of the United Arab
          Emirates. The courts of Dubai have exclusive jurisdiction over any dispute, except that
          either party may apply to any court for urgent equitable relief.
        </li>
      </ul>
    </LegalPage>
  );
}
