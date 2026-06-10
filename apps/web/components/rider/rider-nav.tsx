'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserButton } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { canCreateBookings } from '@/lib/permissions-shared';
import {
  Home,
  CalendarPlus,
  CalendarCheck,
  TrendingUp,
  User,
  Compass,
  Rabbit,
  Receipt,
  MessageCircle,
  MoreHorizontal,
  ChevronDown,
  Building2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';
import { fetchJson } from '@/lib/fetch-json';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// "Stables" is the rider-facing term for /discover — riders think in stables,
// the admin side uses "club" to match the DB schema.
//
// Desktop renders every item; mobile bottom-nav shows the first 5 plus a
// chevron-less "More" entry that opens the rest. This keeps the bottom-
// bar legible at narrow widths even with 9 destinations.
//
// Audit P1 (2026-05-26): Invoices and Community were previously
// unreachable from RiderNav — Invoices was only linked from a per-horse
// "Receipt" button on /rider/horses, and Community was fully orphan-routed.
const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/rider', icon: Home },
  { label: 'Book', href: '/rider/book', icon: CalendarPlus },
  { label: 'Bookings', href: '/rider/bookings', icon: CalendarCheck },
  { label: 'Stables', href: '/discover', icon: Compass },
  { label: 'Horses', href: '/rider/horses', icon: Rabbit },
  { label: 'Invoices', href: '/rider/invoices', icon: Receipt },
  { label: 'Progress', href: '/rider/progress', icon: TrendingUp },
  { label: 'Community', href: '/rider/community', icon: MessageCircle },
  { label: 'Profile', href: '/rider/profile', icon: User },
];

const MOBILE_PRIMARY_COUNT = 5;

export function RiderNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/rider') return pathname === '/rider';
    return pathname.startsWith(href);
  }

  // Audit FE (2026-06-07): horse owners (and any role without bookings:create)
  // don't see the "Book" tab. They can read their own bookings/horses but can't
  // create a booking, so the tab would dead-end on a 403 at confirm.
  const { data: me } = useCurrentUser();
  const role = me?.data?.role ?? null;
  const canBook = !role || canCreateBookings(role);
  const navItems = canBook ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.href !== '/rider/book');

  return (
    <header className="bg-card sticky top-0 z-50 border-b">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/rider" aria-label="Cavaliq home">
            <CavaliqLogo height={28} priority />
          </Link>
          <span className="bg-border hidden h-6 w-px sm:block" aria-hidden="true" />
          <ActiveStableSwitcher />
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Rider navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <UserButton
          appearance={{
            elements: {
              userButtonTrigger: 'rounded-full',
            },
          }}
        />
      </div>

      {/* Mobile bottom nav: first 5 primary items + a "More" dropdown
          for the rest. 9 items in a single bottom bar gets cramped on
          a 375px viewport (~40px per slot), so we overflow Invoices /
          Progress / Community / Profile into a sheet. */}
      <nav
        className="bg-card fixed inset-x-0 bottom-0 z-50 border-t sm:hidden"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around py-2">
          {navItems.slice(0, MOBILE_PRIMARY_COUNT).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors',
                isActive(item.href) ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
          <MobileMoreMenu items={navItems.slice(MOBILE_PRIMARY_COUNT)} />
        </div>
      </nav>
    </header>
  );
}

/**
 * "More" trigger in the mobile bottom-nav. Opens a dropdown listing
 * the overflow items (Invoices / Progress / Community / Profile). The
 * trigger styles itself as active when one of the overflow routes is
 * the current page, mirroring the single-link active treatment of the
 * primary items.
 */
function MobileMoreMenu({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const overflowItems = items;
  const activeOverflow = overflowItems.some((i) =>
    i.href === '/rider' ? pathname === '/rider' : pathname.startsWith(i.href),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More navigation"
        className={cn(
          'flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors',
          activeOverflow ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-48">
        {overflowItems.map((item) => {
          const isCurrent =
            item.href === '/rider' ? pathname === '/rider' : pathname.startsWith(item.href);
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className="flex items-center gap-2"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                <span>{item.label}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shows the current active stable + lets the rider switch between any stable
 * they're a member of. Gated by Clerk org: if the user has an active Clerk
 * org (admin path), the Clerk UserButton's org switcher handles it — we
 * don't render this component in that case.
 *
 * The switch writes a cookie that getTenantContext reads on subsequent
 * requests. We then invalidate all queries and soft-navigate so data reloads
 * under the new tenant without a hard page reload.
 */
function ActiveStableSwitcher() {
  const { data, isLoading } = useCurrentUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-8 w-40" />;
  }

  const user = data?.data;
  if (!user?.activeClub) return null;

  const memberships = user.memberships ?? [];
  const activeClubId = user.activeClub.id;

  // Single-membership riders: show the name as a passive indicator (no
  // dropdown affordance) — there's nowhere to switch to.
  if (memberships.length <= 1) {
    return (
      <div
        className="text-muted-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-sm"
        aria-label={`Booking from ${user.activeClub.name}`}
      >
        <Building2 className="h-4 w-4" aria-hidden="true" />
        <span className="text-foreground max-w-[12rem] truncate font-medium">
          {user.activeClub.name}
        </span>
      </div>
    );
  }

  async function switchTo(clubId: string) {
    if (clubId === activeClubId) return;
    setSwitching(true);
    try {
      await fetchJson('/api/v1/me/active-club', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId }),
      });
      // Throw away every cached query since all data was tenant-scoped to
      // the previous club. Refresh to re-run server components (rider
      // layout's tenant check, home page's data loads).
      queryClient.clear();
      toast.success('Switched stable');
      router.refresh();
    } catch (err) {
      reportMutationError('rider.switch_stable', err);
      toast.error(err instanceof Error ? err.message : 'Failed to switch');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={switching}
        className="hover:bg-accent focus:ring-ring flex items-center gap-1.5 rounded-md px-2 py-1 text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
        aria-label={`Booking from ${user.activeClub.name} — click to switch`}
      >
        <Building2 className="text-muted-foreground h-4 w-4" aria-hidden="true" />
        <span className="max-w-[12rem] truncate font-medium">{user.activeClub.name}</span>
        <ChevronDown className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Booking from
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.clubId}
            onSelect={() => switchTo(m.clubId)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{m.clubName}</span>
            {m.clubId === activeClubId && (
              <Check className="text-primary h-4 w-4" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
