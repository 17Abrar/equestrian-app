import { NotifyMeCard } from '@/components/community/notify-me-card';

export default function CommunityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Community</h1>
        <p className="text-muted-foreground mt-1">Connect with riders and club members</p>
      </div>
      {/* Audit P0-C (2026-05-26): the previous "Coming soon" stub created
          a credibility gap when a prospect demos the dashboard. The
          NotifyMeCard turns the surface into an actionable waitlist
          signal — admins can demo what's planned and signed-in users
          can register interest. */}
      <NotifyMeCard source="web_admin" variant="admin" />
    </div>
  );
}
