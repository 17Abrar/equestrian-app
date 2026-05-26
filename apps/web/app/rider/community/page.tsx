import { NotifyMeCard } from '@/components/community/notify-me-card';

export default function RiderCommunityPage() {
  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="text-muted-foreground">Connect with fellow riders at your club</p>
      </div>
      {/* Audit P0-C (2026-05-26): replaced the static "Coming soon" card
          with an actionable waitlist signup. Email pre-fills from the
          signed-in Clerk user. NotifyMeCard is a client component, so
          this page is no longer a Server Component — acceptable trade
          for the live form. */}
      <NotifyMeCard source="web_rider" variant="rider" />
    </div>
  );
}
