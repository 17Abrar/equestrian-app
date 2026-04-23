'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Plus, Search } from 'lucide-react';
import { useHorses } from '@/hooks/use-horses';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { PendingApprovalCard } from './pending-approval-card';
import { HORSE_STATUS_COLORS } from '@/lib/ui-constants';

type Tab = 'active' | 'pending';

function HorseListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="mb-3 h-32 w-full rounded-lg" />
            <Skeleton className="mb-2 h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Cheap badge fetch — one row of pagination.total, no data rendered. 30s
// staleTime keeps it fresh without chatter; it also auto-invalidates via
// the shared `['horses']` key after approve/decline mutations.
function usePendingCount() {
  return useHorses({ ownershipStatus: 'pending', page: 1, pageSize: 1 });
}

export function HorsesList() {
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [skillLevel, setSkillLevel] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const pendingBadge = usePendingCount();
  const pendingCount = pendingBadge.data?.pagination.total ?? 0;

  const { data, isLoading, isError, error, refetch } = useHorses({
    search: search || undefined,
    status: status as 'available' | 'resting' | undefined,
    skillLevel: skillLevel as 'beginner' | 'intermediate' | 'advanced' | undefined,
    ownershipStatus: tab === 'pending' ? 'pending' : 'active',
    page,
    pageSize: 25,
  });

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
    // Clear operational-status filter when jumping to pending — it's
    // orthogonal and would yield confusing empty results.
    if (next === 'pending') setStatus(undefined);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Horses</h1>
          <p className="mt-1 text-muted-foreground">Manage your stable&apos;s horses</p>
        </div>
        <Button asChild>
          <Link href="/horses/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Horse
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => switchTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            Pending approvals
            {pendingCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 bg-amber-100 text-amber-800 hover:bg-amber-100"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters — only show on Active tab */}
      {tab === 'active' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search horses..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={status ?? 'all'}
            onValueChange={(v) => {
              setStatus(v === 'all' ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="resting">Resting</SelectItem>
              <SelectItem value="injured">Injured</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
              <SelectItem value="off_site">Off Site</SelectItem>
              <SelectItem value="sold">Sold</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={skillLevel ?? 'all'}
            onValueChange={(v) => {
              setSkillLevel(v === 'all' ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Skill Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {isLoading && <HorseListSkeleton />}

      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load horses'}
          onRetry={() => refetch()}
        />
      )}

      {data && !data.data.length && tab === 'active' && (
        <EmptyState
          title="No horses yet"
          description="Add your first horse to get started"
          action={{ label: 'Add Horse', href: '/horses/new' }}
        />
      )}

      {data && !data.data.length && tab === 'pending' && (
        <EmptyState
          title="No pending registrations"
          description="When a rider registers a horse they own, it'll show up here for you to review."
        />
      )}

      {data && data.data.length > 0 && tab === 'pending' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.data.map((horse) => (
            <PendingApprovalCard key={horse.id} horse={horse} />
          ))}
        </div>
      )}

      {data && data.data.length > 0 && tab === 'active' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((horse) => (
              <Link
                key={horse.id}
                href={`/horses/${horse.id}`}
                className="block"
              >
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="relative mb-3 flex h-32 items-center justify-center rounded-lg bg-muted overflow-hidden">
                      {horse.primaryPhotoUrl ? (
                        <Image
                          src={horse.primaryPhotoUrl}
                          alt={horse.name}
                          fill
                          className="rounded-lg object-cover"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                      ) : (
                        <span className="text-4xl text-muted-foreground">🐴</span>
                      )}
                    </div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold">{horse.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {horse.breed ?? 'Unknown breed'}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={HORSE_STATUS_COLORS[horse.status] ?? ''}
                      >
                        {horse.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Badge variant="outline" className="text-xs">
                        {horse.skillLevel}
                      </Badge>
                      {horse.weightLimitKg && (
                        <Badge variant="outline" className="text-xs">
                          Max {horse.weightLimitKg}kg
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {data.pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
