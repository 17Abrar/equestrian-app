import type { Metadata } from 'next';
import Link from 'next/link';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For parents & guardians · Help centre',
  description: 'How to manage your child rider on Cavaliq, including safety notes and payments.',
};

export default function ParentHelpPage() {
  return (
    <HelpArticle
      title="Guide for parents & guardians"
      description="Set up your child&rsquo;s rider profile, manage safety notes, pay for lessons, and stay in control of their data."
    >
      <h2>1. Create your own account first</h2>
      <p>
        Cavaliq is designed so the parent or guardian holds the account and the child is added as a
        rider on it. Sign up at <Link href="/sign-up">cavaliq.com/sign-up</Link> with your own
        details.
      </p>

      <h2>2. Add your child as a rider</h2>
      <p>
        After joining a stable, open <strong>Profile → Riders</strong> and add a rider. Enter the
        child&rsquo;s name, date of birth, skill level, height, and weight. You can also add a
        photo.
      </p>
      <p>
        Children under 16 do not have direct sign-in access of their own. Children under 13 cannot
        have a direct account at all — read more in the{' '}
        <Link href="/legal/children">children&rsquo;s data statement</Link>.
      </p>

      <h2>3. Medical notes and allergies</h2>
      <p>
        Adding medical notes is optional but strongly recommended for safety. You might want to
        include:
      </p>
      <ul>
        <li>Asthma or other respiratory conditions.</li>
        <li>Allergies and EpiPen instructions.</li>
        <li>Recent injuries or surgeries that affect riding.</li>
        <li>Anything the coach or first-aider should know in an emergency.</li>
      </ul>
      <p>
        These notes are encrypted at rest and only visible to authorised staff. They&rsquo;re never
        used for marketing or analytics.
      </p>

      <h2>4. Emergency contact</h2>
      <p>
        Add a second emergency contact in addition to yourself. The stable will use the first
        reachable contact in an emergency.
      </p>

      <h2>5. Booking and paying</h2>
      <p>
        Bookings are made from your account, on behalf of your child. When you pay, your card
        details go straight to the stable&rsquo;s payment processor — Cavaliq never sees them. A
        receipt is emailed to you.
      </p>

      <h2>6. Managing your child&rsquo;s data</h2>
      <p>
        You can edit, export, or delete your child&rsquo;s data at any time:
      </p>
      <ul>
        <li>From the app: <strong>Profile → Riders → [child] → Edit / Delete</strong>.</li>
        <li>
          For a full export or a deletion request, write to{' '}
          <a href="mailto:info@cavaliq.com">info@cavaliq.com</a>. We&rsquo;ll verify you are
          the parent or guardian before fulfilling the request.
        </li>
      </ul>

      <h2>7. When your child turns 16</h2>
      <p>
        At 16 your child can request their own Cavaliq account. We&rsquo;ll help transition the
        rider profile when they do.
      </p>
    </HelpArticle>
  );
}
