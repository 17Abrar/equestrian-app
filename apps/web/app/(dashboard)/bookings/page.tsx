import { BookingsList } from '@/components/bookings/bookings-list';
import { getTenantContext } from '@/lib/tenant';
import { hasPermission } from '@/lib/permissions';

export default async function BookingsPage() {
  // Audit MED (2026-05-05 pass 2): the AddBookingDialog button is gated
  // server-side here. The previous shape mounted it unconditionally and
  // a coach (who holds `bookings:read` + `bookings:update_own` but not
  // `bookings:create`) saw the button → click → 403 from the API. The
  // server is authoritative; the UI now reads the same gate.
  const ctx = await getTenantContext();
  const canCreate = hasPermission(ctx.orgRole, 'bookings:create');
  return <BookingsList canCreate={canCreate} />;
}
