import type { Metadata } from 'next';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For grooms · Help centre',
  description: 'Daily horse care tasks, reminders, and exercise rotation in Cavaliq.',
};

export default function GroomHelpPage() {
  return (
    <HelpArticle
      title="Guide for grooms"
      description="Your daily checklist, horse care reminders, and a quick way to log what you&rsquo;ve done."
    >
      <h2>1. Today&rsquo;s tasks</h2>
      <p>
        Open the home page when you arrive at the yard. The task list shows what needs doing today,
        per horse: feeding, mucking out, exercise, medication, turnout, and any one-off jobs the
        stable admin has assigned.
      </p>

      <h2>2. Mark tasks done</h2>
      <p>
        Tap each task to mark it complete. If something can&rsquo;t be done — a horse is lame, feed
        is out — leave a quick note so the next shift knows.
      </p>

      <h2>3. Horse care reminders</h2>
      <p>
        Cavaliq surfaces reminders for:
      </p>
      <ul>
        <li>Medication doses (with the exact time window).</li>
        <li>Pre-vaccination notices.</li>
        <li>Farrier and dental appointments.</li>
      </ul>

      <h2>4. Exercise rotation</h2>
      <p>
        If your stable uses exercise rotation, the <strong>Exercise</strong> tab tells you which
        horses haven&rsquo;t been ridden today and need movement. Log a short session when you take
        a horse out.
      </p>

      <h2>5. Flagging an issue</h2>
      <p>
        If a horse looks off — lameness, off feed, behavioural change — flag it from the horse
        profile. The flag goes straight to the admin and the horse&rsquo;s owner.
      </p>
    </HelpArticle>
  );
}
