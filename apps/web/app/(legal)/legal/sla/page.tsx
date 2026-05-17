import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Service level agreement',
  description: 'Uptime commitment, exclusions, support response targets, and service credits for Cavaliq.',
};

export default function SlaPage() {
  return (
    <LegalPage
      title="Service level agreement (SLA)"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="Cavaliq targets 99.9% monthly uptime, with service credits if we fall short. Support response times depend on the severity of the issue. The detail and exclusions are below."
    >
      <p>
        This Service Level Agreement (the &ldquo;<strong>SLA</strong>&rdquo;) is part of the{' '}
        <Link href="/legal/terms">Terms of Service</Link> and applies to all paid subscriptions to
        Cavaliq. Live status is published at <Link href="/status">cavaliq.com/status</Link>.
      </p>

      <h2 id="uptime">1. Uptime commitment</h2>
      <p>
        Cavaliq will use commercially reasonable efforts to make the platform available with a
        monthly uptime percentage of at least:
      </p>
      <ul>
        <li>
          <strong>99.9%</strong> measured over each calendar month, excluding Excluded Downtime
          (defined below).
        </li>
      </ul>
      <p>
        Monthly uptime percentage is calculated as:
      </p>
      <p>
        <code>
          (Total Minutes In Month − Excluded Minutes − Downtime) ÷ (Total Minutes In Month −
          Excluded Minutes) × 100
        </code>
      </p>

      <h2 id="downtime">2. What counts as downtime</h2>
      <p>
        &ldquo;Downtime&rdquo; means a period of two or more consecutive minutes during which the
        production platform is materially unavailable to a Club&rsquo;s authorised users in such a
        way that the core flows — sign-in, viewing the calendar, creating a booking, taking a
        payment via the connected processor — cannot be completed.
      </p>
      <p>
        Downtime does <em>not</em> include:
      </p>
      <ul>
        <li>
          Scheduled maintenance announced at least 24 hours in advance on the status page (Cavaliq
          aims to schedule maintenance outside GCC business hours);
        </li>
        <li>Emergency maintenance to respond to a security threat;</li>
        <li>
          Issues caused by something outside Cavaliq&rsquo;s reasonable control: a third-party
          internet outage, an action by a regulator, an act of war or natural disaster, or a
          general internet attack;
        </li>
        <li>
          Issues caused by a third-party service the Club has chosen to connect — for example, an
          outage at the Club&rsquo;s payment processor or the Club&rsquo;s own email server;
        </li>
        <li>Issues caused by the Club or its users (e.g. misconfigured permissions, deleted data);</li>
        <li>
          Issues affecting only a feature in beta or labelled as &ldquo;preview&rdquo; or
          &ldquo;experimental.&rdquo;
        </li>
      </ul>

      <h2 id="credits">3. Service credits</h2>
      <p>
        If Cavaliq fails to meet the uptime commitment in a calendar month, the affected Club is
        eligible to claim a service credit, applied to a future invoice:
      </p>
      <ul>
        <li>
          <strong>Monthly uptime ≥ 99.0% and &lt; 99.9%:</strong> 10% credit of the monthly fee for
          the affected month.
        </li>
        <li>
          <strong>Monthly uptime ≥ 95.0% and &lt; 99.0%:</strong> 25% credit of the monthly fee for
          the affected month.
        </li>
        <li>
          <strong>Monthly uptime &lt; 95.0%:</strong> 50% credit of the monthly fee for the affected
          month.
        </li>
      </ul>
      <p>
        Service credits are the Club&rsquo;s sole and exclusive remedy for failure to meet the
        uptime commitment. To claim, email{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> within 30 days of the end of
        the affected month with the impacted dates and times. Credits are not paid out in cash, are
        not transferable, and cannot exceed 100% of the affected month&rsquo;s fee.
      </p>

      <h2 id="support">4. Support response targets</h2>
      <p>
        Support is available via email at{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> and via the in-product help
        link. Response targets are best-effort and do not give rise to service credits.
      </p>
      <table className="my-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-3 pr-4 font-semibold">Severity</th>
            <th className="py-3 pr-4 font-semibold">Description</th>
            <th className="py-3 font-semibold">First response target</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b align-top">
            <td className="py-3 pr-4 font-medium">S1 — Critical</td>
            <td className="text-muted-foreground py-3 pr-4">
              Production platform unavailable, payments failing for all riders, security incident.
            </td>
            <td className="text-muted-foreground py-3">Within 1 hour, 24×7.</td>
          </tr>
          <tr className="border-b align-top">
            <td className="py-3 pr-4 font-medium">S2 — High</td>
            <td className="text-muted-foreground py-3 pr-4">
              A core feature is broken for most users; a workaround is not available.
            </td>
            <td className="text-muted-foreground py-3">Within 4 business hours.</td>
          </tr>
          <tr className="border-b align-top">
            <td className="py-3 pr-4 font-medium">S3 — Standard</td>
            <td className="text-muted-foreground py-3 pr-4">
              A feature is partially broken or there is a usable workaround.
            </td>
            <td className="text-muted-foreground py-3">Within 1 business day.</td>
          </tr>
          <tr className="align-top">
            <td className="py-3 pr-4 font-medium">S4 — Question</td>
            <td className="text-muted-foreground py-3 pr-4">How-to question, feature request.</td>
            <td className="text-muted-foreground py-3">Within 2 business days.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Business hours are 9am–6pm GST, Sunday–Thursday, excluding UAE public holidays.
      </p>

      <h2 id="changes">5. Changes</h2>
      <p>
        We may update this SLA. If a change reduces the uptime commitment or removes a service
        credit tier, we will notify Clubs at least 30 days in advance and the change will only take
        effect at the next renewal.
      </p>
    </LegalPage>
  );
}
