'use client';

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
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
} from 'lucide-react';

const NAV_ITEMS = [
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
] as const;

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <span className="text-lg font-bold">Equestrian</span>
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
        {NAV_ITEMS.map((item) => (
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
            {item.label}
          </Link>
        ))}
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
