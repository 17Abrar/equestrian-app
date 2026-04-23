'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import {
  Home,
  CalendarPlus,
  TrendingUp,
  Users,
  User,
  Compass,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// "Stables" is the rider-facing term for /discover — riders think in stables,
// the admin side uses "club" to match the DB schema.
const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/rider', icon: Home },
  { label: 'Book', href: '/rider/book', icon: CalendarPlus },
  { label: 'Stables', href: '/discover', icon: Compass },
  { label: 'Progress', href: '/rider/progress', icon: TrendingUp },
  { label: 'Community', href: '/rider/community', icon: Users },
  { label: 'Profile', href: '/rider/profile', icon: User },
];

export function RiderNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/rider') return pathname === '/rider';
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-card">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/rider" className="text-lg font-bold">
          Cavaliq
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Rider navigation">
          {NAV_ITEMS.map((item) => (
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

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t bg-card sm:hidden"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around py-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors',
                isActive(item.href)
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
