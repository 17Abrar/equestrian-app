import type { Metadata } from 'next';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For horse owners · Help centre',
  description: 'Track your horse&rsquo;s care, vaccinations, and ownership records on Cavaliq.',
};

export default function OwnerHelpPage() {
  return (
    <HelpArticle
      title="Guide for horse owners"
      description="See your horse&rsquo;s care record, get reminders for vaccinations and farrier visits, and stay in the loop on health."
    >
      <h2>1. Get added to the stable</h2>
      <p>
        If your horse is on livery at a stable using Cavaliq, the stable&rsquo;s admin invites you
        to the platform. You&rsquo;ll get an email with a sign-up link.
      </p>

      <h2>2. View your horse&rsquo;s profile</h2>
      <p>
        Once signed in, open <strong>Horses → My horses</strong>. Each horse profile has:
      </p>
      <ul>
        <li><strong>Basics:</strong> name, breed, age, markings, weight, height.</li>
        <li><strong>Health:</strong> vet visits, diagnoses, treatments.</li>
        <li><strong>Vaccinations:</strong> dates done and next due dates.</li>
        <li><strong>Farrier:</strong> shoeing history.</li>
        <li><strong>Feeding:</strong> the current plan.</li>
        <li><strong>Exercise:</strong> who&rsquo;s ridden the horse and when.</li>
        <li><strong>Documents:</strong> passport, registration, insurance.</li>
      </ul>

      <h2>3. Reminders</h2>
      <p>
        Cavaliq sends reminders ahead of:
      </p>
      <ul>
        <li>Vaccination due dates.</li>
        <li>Farrier and dental check-ups.</li>
        <li>Insurance renewal.</li>
        <li>Medication end dates.</li>
      </ul>
      <p>
        Reminders go to the stable&rsquo;s staff first; you also receive an email summary so you
        can plan around your horse&rsquo;s schedule.
      </p>

      <h2>4. Read-only by default</h2>
      <p>
        As an owner you can <em>view</em> all records related to your horse. The stable&rsquo;s
        staff are the ones who add or update entries (vet visits, treatments). If you spot something
        that looks wrong, message the stable directly.
      </p>

      <h2>5. Selling or transferring a horse</h2>
      <p>
        Notify the stable. They&rsquo;ll update the ownership record on the horse profile. Records
        from your time as the owner are retained as part of the horse&rsquo;s history.
      </p>
    </HelpArticle>
  );
}
