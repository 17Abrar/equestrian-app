import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/shared/legal-page';

export const metadata: Metadata = {
  title: 'Cookie policy',
  description: 'Cookies and similar technologies that Cavaliq uses, and how to manage them.',
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie policy"
      effectiveDate="17 May 2026"
      lastUpdated="17 May 2026"
      summary="We only set cookies that are strictly necessary to keep you signed in, deliver the service, and protect against abuse. We do not use advertising cookies. You can manage cookies through your browser at any time."
    >
      <p>
        This page explains the cookies and similar technologies (localStorage, sessionStorage,
        secure storage on mobile) that Cavaliq sets when you use cavaliq.com, app.cavaliq.com, or
        the Cavaliq mobile app, and how you can manage them.
      </p>

      <h2 id="what-is-a-cookie">1. What is a cookie</h2>
      <p>
        A cookie is a small text file that a website saves on your device. Cookies let the site
        remember things like whether you are signed in. Similar technologies include localStorage
        and sessionStorage on the web, and SecureStore on mobile.
      </p>

      <h2 id="what-we-use">2. What Cavaliq uses cookies for</h2>
      <p>
        We categorise the cookies we set as <strong>strictly necessary</strong>. That means we
        cannot deliver the service to you without them. We do not use cookies for advertising or
        for cross-site tracking, and we do not share cookie data with advertising networks.
      </p>

      <h3>Authentication and session cookies</h3>
      <p>
        Set by our identity provider, Clerk, when you sign in. They keep you signed in across
        pages and protect against session hijacking.
      </p>
      <ul>
        <li>
          <strong>Names:</strong> <code>__session</code>, <code>__clerk_db_jwt</code>,{' '}
          <code>__client_uat</code> and similar Clerk-prefixed cookies.
        </li>
        <li>
          <strong>Provider:</strong> Clerk.com
        </li>
        <li>
          <strong>Lifetime:</strong> Session and up to 7 days for refresh tokens, depending on the
          configuration.
        </li>
      </ul>

      <h3>Security and abuse-prevention cookies</h3>
      <p>
        Set by Cloudflare to identify a bad bot, mitigate a DDoS attack, or maintain a
        connection&rsquo;s rate limit.
      </p>
      <ul>
        <li>
          <strong>Names:</strong> <code>__cf_bm</code> and other Cloudflare cookies.
        </li>
        <li>
          <strong>Provider:</strong> Cloudflare
        </li>
        <li>
          <strong>Lifetime:</strong> 30 minutes to a few hours.
        </li>
      </ul>

      <h3>Preference cookies</h3>
      <p>
        We use <code>localStorage</code> and a small number of first-party cookies to remember your
        choices, like which club you last viewed, whether you have dismissed an in-product banner,
        and your language preference. These are not used for tracking.
      </p>

      <h3>Error monitoring</h3>
      <p>
        Sentry collects performance traces and error reports. It does not use cookies but it may
        attach a randomly generated session ID to a crash report so we can join related events.
        Form values, passwords, and tokens are stripped before being sent to Sentry.
      </p>

      <h2 id="no-marketing">3. What we don&rsquo;t do</h2>
      <p>
        Cavaliq does not currently use:
      </p>
      <ul>
        <li>Advertising cookies or marketing pixels.</li>
        <li>Cross-site behavioural tracking.</li>
        <li>Third-party analytics that profile individuals.</li>
        <li>Social-media tracking widgets.</li>
      </ul>
      <p>
        If we ever introduce optional analytics or marketing technology, we will update this page
        and ask for your consent before setting any non-essential cookie on devices in regions
        where consent is required (such as the EU, UK, and other applicable jurisdictions).
      </p>

      <h2 id="manage">4. How to manage cookies</h2>
      <p>
        Most browsers let you view, delete, and block cookies through the privacy settings. You can
        also clear localStorage and sessionStorage from the same place. On mobile you can sign out
        to clear the secure-store tokens. Blocking strictly necessary cookies may prevent you from
        signing in or from using the platform at all.
      </p>
      <p>
        Helpful links:
      </p>
      <ul>
        <li>
          <a href="https://support.google.com/chrome/answer/95647" rel="noreferrer">
            Cookies in Chrome
          </a>
        </li>
        <li>
          <a href="https://support.apple.com/en-us/HT201265" rel="noreferrer">
            Cookies in Safari (iOS)
          </a>
        </li>
        <li>
          <a
            href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer"
            rel="noreferrer"
          >
            Cookies in Firefox
          </a>
        </li>
      </ul>

      <h2 id="contact">5. Contact</h2>
      <p>
        Questions about cookies or this policy? Write to{' '}
        <a href="mailto:info@cavaliq.com">info@cavaliq.com</a> or see the{' '}
        <Link href="/legal/privacy">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
