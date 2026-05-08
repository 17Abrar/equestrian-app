'use client';

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { CavaliqLogo } from '@/components/brand/cavaliq-logo';
import { type UserRole } from '@equestrian/shared/types';
import { useHorses } from '@/hooks/use-horses';
import { Badge } from '@/components/ui/badge';
// audit P-1 (2026-05-05) — read from the no-guard module. `@/lib/permissions`
// is `'server-only'` and would crash the client bundle if imported here.
import { hasPermission } from '@/lib/permissions-shared';
import {
  LayoutDashboard,
  Calendar,
  BookOpen,
  PawPrint,
  Users,
  UserCog,
  Crown,
  DollarSign,
  Mail,
  Map,
  BarChart3,
  Settings,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Calendar', href: '/calendar', icon: Calendar },
  { label: 'Bookings', href: '/bookings', icon: BookOpen },
  { label: 'Horses', href: '/horses', icon: PawPrint },
  { label: 'Riders', href: '/riders', icon: Users },
  { label: 'Staff', href: '/staff', icon: UserCog },
  { label: 'Owners', href: '/owners', icon: Crown },
  { label: 'Finances', href: '/finances', icon: DollarSign },
  { label: 'Emails', href: '/emails', icon: Mail },
  { label: 'Competitions', href: '/competitions', icon: Trophy },
  { label: 'Arenas', href: '/arenas', icon: Map },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

/** Which nav items each role can see in the admin dashboard */
const NAV_BY_ROLE: Record<string, string[]> = {
  club_admin: ALL_NAV_ITEMS.map((item) => item.href),
  club_manager: ['/', '/calendar', '/bookings', '/horses', '/riders', '/staff', '/owners', '/finances', '/emails', '/competitions', '/arenas', '/reports', '/settings'],
  coach: ['/', '/calendar', '/bookings', '/horses', '/riders', '/competitions'],
  horse_owner: ['/', '/horses', '/bookings', '/competitions'],
  groom: ['/', '/horses', '/calendar'],
  veterinarian: ['/', '/horses'],
  rider: [],
  parent: [],
};

function getNavItemsForRole(role: UserRole): NavItem[] {
  const allowedHrefs = NAV_BY_ROLE[role] ?? [];
  return ALL_NAV_ITEMS.filter((item) => allowedHrefs.includes(item.href));
}

interface SidebarProps {
  role: UserRole;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const navItems = getNavItemsForRole(role);

  // Only admins/managers can action pending registrations, so only they see the
  // badge. Gated by permission to avoid an unnecessary fetch for coach/groom/vet.
  const canReviewHorses = hasPermission(role, 'horses:update');
  const pendingHorsesQuery = useHorses(
    canReviewHorses ? { ownershipStatus: 'pending', page: 1, pageSize: 1 } : {},
  );
  const pendingHorsesCount = canReviewHorses
    ? pendingHorsesQuery.data?.pagination.total ?? 0
    : 0;
  // Audit F-52 (2026-05-08 r6): distinguish "query failed" from "no
  // pending horses." Without this, an admin would never know there
  // are pending horses if the count fetch errored — silently
  // identical to the zero-pending case. Render a `?` indicator instead
  // of a number so the admin sees that something failed.
  const pendingHorsesError = canReviewHorses && pendingHorsesQuery.isError;

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  function badgeFor(href: string): { count: number; error: boolean } {
    if (href === '/horses' && pendingHorsesError) return { count: 0, error: true };
    if (href === '/horses' && pendingHorsesCount > 0)
      return { count: pendingHorsesCount, error: false };
    return { count: 0, error: false };
  }

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" aria-label="Cavaliq home">
          <CavaliqLogo height={28} priority />
        </Link>
      </div>

      <div className="border-b px-4 py-3">
        <OrganizationSwitcher
          hidePersonal
          appearance={{
            elements: {
              rootBox: 'w-full',
              organizationSwitcherTrigger: 'w-full justify-between',
            },
          }}
        />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main navigation">
        {navItems.map((item) => {
          const badge = badgeFor(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {badge.count > 0 && (
                <Badge
                  variant="secondary"
                  className="h-5 bg-amber-100 px-1.5 text-[11px] text-amber-800 hover:bg-amber-100"
                >
                  {badge.count}
                </Badge>
              )}
              {badge.count === 0 && badge.error && (
                <Badge
                  variant="secondary"
                  className="h-5 bg-muted px-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                  title="Pending count failed to load"
                  aria-label="Pending count unavailable"
                >
                  ?
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <UserButton
          showName
          appearance={{
            elements: {
              rootBox: 'w-full',
              userButtonTrigger: 'w-full justify-start',
            },
          }}
        />
      </div>
    </aside>
  );
}
