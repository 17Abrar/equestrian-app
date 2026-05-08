import { redirect } from 'next/navigation';
import { BookingsList } from '@/components/bookings/bookings-list';
import { getTenantContext, TenantError } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function BookingsPage() {
  // Audit MED (2026-05-05 pass 2): the AddBookingDialog button is gated
  // server-side here. The previous shape mounted it unconditionally and
  // a coach (who holds `bookings:read` + `bookings:update_own` but not
  // `bookings:create`) saw the button → click → 403 from the API. The
  // server is authoritative; the UI now reads the same gate.
  //
  // Audit F-54 (2026-05-08 r6): catch the Clerk-webhook-race
  // `NO_MEMBERSHIP` throw and redirect to /onboarding instead of
  // bubbling to the dashboard error boundary. Same surface
  // `withAuth` API middleware already handles via 503 — Server
  // Components don't go through that path. Other dashboard `page.tsx`
  // files can adopt this pattern incrementally; this is the most-
  // hit page and the cited callsite in the audit.
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (err) {
    if (err instanceof TenantError && err.code === 'NO_MEMBERSHIP') {
      redirect('/onboarding');
    }
    throw err;
  }
  const canCreate = hasPermission(ctx.orgRole, 'bookings:create');
  return <BookingsList canCreate={canCreate} />;
}
