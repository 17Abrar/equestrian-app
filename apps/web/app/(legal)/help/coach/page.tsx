import type { Metadata } from 'next';
import { HelpArticle } from '@/components/shared/help-article';

export const metadata: Metadata = {
  title: 'For coaches · Help centre',
  description: 'View your schedule, take attendance, and record lesson notes in Cavaliq.',
};

export default function CoachHelpPage() {
  return (
    <HelpArticle
      title="Guide for coaches"
      description="Stay on top of your schedule, see who&rsquo;s booked in, and record progress notes after each lesson."
    >
      <h2>1. Your daily schedule</h2>
      <p>
        Open the <strong>Calendar</strong> page to see today&rsquo;s lessons across all arenas. Use
        the filter to see only your own lessons. Each event shows the rider, the horse, the lesson
        type, and any special notes.
      </p>

      <h2>2. Rider profiles before each lesson</h2>
      <p>
        Tap a booking to see the rider&rsquo;s profile. Pay attention to:
      </p>
      <ul>
        <li>Skill level and recent progress.</li>
        <li>Allergies and medical notes — these are surfaced at the top of the profile.</li>
        <li>Past lessons and any open coaching feedback.</li>
      </ul>

      <h2>3. Horse matching</h2>
      <p>
        Cavaliq suggests horses that match the rider&rsquo;s height, weight, and skill level. The
        suggestions are based on the horse profiles in the stable. You always make the final call —
        if you want to override a suggestion, do.
      </p>

      <h2>4. Taking attendance and recording notes</h2>
      <p>
        After the lesson, mark the rider as attended, no-show, or late. Add a coaching note — what
        you worked on, what to do next, any safety observations. Notes are kept on the rider&rsquo;s
        profile.
      </p>

      <h2>5. Reporting an issue</h2>
      <p>
        If a horse seems off, a rider mentions a health issue, or anything safety-related comes up,
        flag it from the booking detail screen. The flag goes to the stable&rsquo;s admin and the
        horse&rsquo;s owner.
      </p>

      <h2>6. Your own profile</h2>
      <p>
        Keep your bio and qualifications up to date from <strong>Profile</strong>. This is what
        shows on the stable&rsquo;s public coach list.
      </p>
    </HelpArticle>
  );
}
