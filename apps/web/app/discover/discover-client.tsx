'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, ArrowRight, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface PublicClub {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  shortDescription: string | null;
  description: string | null;
  joinPolicy: 'open' | 'approval' | 'invite_only';
  brandPrimaryColor: string | null;
}

interface DiscoverResponse {
  success: true;
  data: PublicClub[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function DiscoverClient() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the search input so we aren't hitting the API per keystroke.
  useMemo(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery<DiscoverResponse>({
    queryKey: ['discover', debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '24' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`/api/v1/discover/clubs?${params}`);
      if (!res.ok) throw new Error('Failed to load clubs');
      return res.json();
    },
  });

  const clubs = data?.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Compass className="h-5 w-5" />
            <span>Cavaliq</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/sign-up">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="border-b bg-gradient-to-b from-background to-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Find a riding club.
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            Browse equestrian clubs, see what they offer, and join the ones that fit you.
            Ride at multiple clubs — your progress follows you.
          </p>

          <div className="mt-6 max-w-xl">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by club name or city..."
                className="h-11 pl-10 text-base"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search clubs"
              />
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Couldn&apos;t load clubs right now.</p>
              <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : clubs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <h2 className="text-lg font-semibold">No clubs yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Check back soon — more clubs are joining every week.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {data?.pagination.total} {data?.pagination.total === 1 ? 'club' : 'clubs'} available
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clubs.map((club) => (
                <ClubCard key={club.id} club={club} />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground sm:px-6">
          Run your own club on Cavaliq.{' '}
          <Link href="/sign-up" className="text-foreground underline-offset-4 hover:underline">
            Start your club →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function ClubCard({ club }: { club: PublicClub }) {
  const accent = club.brandPrimaryColor ?? '#6366f1';

  return (
    <Link
      href={`/c/${club.slug}`}
      className="group overflow-hidden rounded-xl border bg-card transition-all hover:shadow-lg"
    >
      <div
        className="relative h-32 w-full overflow-hidden"
        style={{
          backgroundColor: accent,
          backgroundImage: club.coverPhotoUrl ? `url(${club.coverPhotoUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {club.logoUrl && (
          <div className="absolute bottom-2 left-2 h-12 w-12 overflow-hidden rounded-lg border-2 border-background bg-background shadow-sm">
            <Image
              src={club.logoUrl}
              alt={`${club.name} logo`}
              width={48}
              height={48}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-base font-semibold">{club.name}</h3>
          {club.joinPolicy === 'open' && (
            <Badge className="shrink-0 text-xs" style={{ backgroundColor: accent }}>
              Open
            </Badge>
          )}
          {club.joinPolicy === 'approval' && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Approval
            </Badge>
          )}
        </div>
        {(club.city || club.country) && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {[club.city, club.country].filter(Boolean).join(', ')}
          </p>
        )}
        {(club.shortDescription || club.description) && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {club.shortDescription ?? club.description}
          </p>
        )}
        <div className="flex items-center pt-1 text-sm font-medium text-foreground">
          <span>View club</span>
          <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
