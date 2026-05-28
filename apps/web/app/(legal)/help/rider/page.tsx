import type { Metadata } from 'next';
import Link from 'next/link';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For riders · Help centre',
  description: 'Find a stable, book lessons, manage your profile and progress in Cavaliq.',
};

export default function RiderHelpPage() {
  return (
    <HelpArticle
      title="Guide for riders"
      description="Everything you need to find a stable, book lessons, and keep track of your progress."
    >
      <h2>1. Sign up and find a stable</h2>
      <p>
        Go to <Link href="/sign-up">cavaliq.com/sign-up</Link> and create your account. You can sign
        up with email, Google, or Apple. After signing up, you&rsquo;ll be taken to the discover
        page where you can browse stables in your area.
      </p>
      <p>
        Use the search to filter by city. Tap a stable card to see its profile — facilities,
        coaches, pricing, and lesson types. When you&rsquo;ve found one you like, tap{' '}
        <strong>Join stable</strong>.
      </p>
      <p>
        Some stables auto-accept new riders, others review the request first. You&rsquo;ll get an
        email and an in-app notification when you&rsquo;re in.
      </p>

      <h2>2. Complete your rider profile</h2>
      <p>
        Once you&rsquo;ve joined a stable, fill in your rider profile. The stable&rsquo;s coaches use
        this information to match you to the right horse and lesson:
      </p>
      <ul>
        <li><strong>Skill level:</strong> beginner, novice, intermediate, advanced, competition.</li>
        <li><strong>Height and weight:</strong> used to match a horse that&rsquo;s a safe fit.</li>
        <li><strong>Allergies and medical notes:</strong> only visible to authorised staff. Encrypted at rest.</li>
        <li><strong>Emergency contact:</strong> a person we can reach if something goes wrong at the yard.</li>
      </ul>

      <h2>3. Book a lesson</h2>
      <p>
        Tap <strong>Book</strong> on the bottom bar. Pick a lesson type, then a date and time slot.
        If the stable offers different coaches or arenas, you&rsquo;ll see those choices too.
      </p>
      <p>
        On the confirmation page you&rsquo;ll see the total price, the stable&rsquo;s cancellation
        policy, and any coupon you have. Tap <strong>Pay & confirm</strong> to be redirected to the
        stable&rsquo;s payment processor — Stripe, Ziina, or Network International — where you enter
        your card details. Cavaliq never sees your card details.
      </p>
      <p>
        Once payment is successful you&rsquo;ll return to the app with a confirmation, and a receipt
        will be emailed to you.
      </p>

      <h2>4. Manage your bookings</h2>
      <p>
        Open the <strong>Bookings</strong> tab to see upcoming and past lessons. Tap a booking to:
      </p>
      <ul>
        <li>See the lesson details (time, arena, coach, horse).</li>
        <li>Cancel the booking, subject to the stable&rsquo;s cancellation rules.</li>
        <li>See the refund or charge that will apply if you cancel now.</li>
      </ul>

      <h2>5. Cancellation rules</h2>
      <p>
        The cancellation rules are set by the stable and shown to you on the booking page before you
        pay. As a default:
      </p>
      <ul>
        <li>More than 24 hours before: free cancellation, full refund.</li>
        <li>12–24 hours before: 50% charge.</li>
        <li>Under 12 hours, or no-show: full charge.</li>
      </ul>
      <p>
        If the stable cancels (bad weather, coach off sick, horse welfare), you always get a full
        refund or a free reschedule. See the{' '}
        <Link href="/legal/refunds">refund policy</Link> for the full picture.
      </p>

      <h2>6. Your profile and progress</h2>
      <p>
        The <strong>Profile</strong> tab shows your account details, your stable, and your overall
        progress. The progress section pulls coach notes and lesson history into a simple summary.
      </p>

      <h2>7. Delete your account</h2>
      <p>
        From the mobile app, go to <strong>Profile → About → Delete account</strong>. We delete
        your account data within 30 days, except for records we&rsquo;re legally required to keep.
        See the <Link href="/legal/privacy">privacy policy</Link>.
      </p>
    </HelpArticle>
  );
}
