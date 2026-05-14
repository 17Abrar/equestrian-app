import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Audit 2026-05-13 (P1): default dashboard-segment loading state. Previously
 * only `bookings/`, `horses/`, and `riders/` had per-route `loading.tsx`
 * files; navigating to any other dashboard route (finances, calendar,
 * competitions, owners, staff, arenas, settings, emails, community,
 * reports, …) showed a blank dashboard chrome while `getTenantContext()`
 * + the route's data fetch resolved (typical 200-500ms on Cloudflare
 * Workers). Per-route `loading.tsx` still takes precedence for routes
 * that ship content-shape skeletons; this is the catch-all.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
