'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Calendar, MapPin, Users } from 'lucide-react';
import { useCompetitions, type Competition } from '@/hooks/use-competitions';
import { COMPETITION_STATUS_COLORS } from '@/lib/ui-constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';

function CompetitionsListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="mb-2 h-5 w-3/4" />
            <Skeleton className="mb-3 h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function CompetitionsList() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useCompetitions({
    status: statusFilter as 'draft' | 'published' | 'in_progress' | 'completed' | 'cancelled' | undefined,
    page,
    pageSize: 25,
  });

  if (isLoading) return <CompetitionsListSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load competitions'}
        onRetry={() => refetch()}
      />
    );
  }

  const competitions = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Competitions</h1>
          <p className="mt-1 text-muted-foreground">Manage events, entries, and results</p>
        </div>
        <Button asChild>
          <Link href="/competitions/new">
            <Plus className="mr-2 h-4 w-4" />
            New Competition
          </Link>
        </Button>
      </div>

      {/* Status tabs */}
      <Tabs value={statusFilter ?? 'all'} onValueChange={(v) => { setStatusFilter(v === 'all' ? undefined : v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Competition cards */}
      {competitions.length === 0 && (
        <EmptyState
          title="No competitions yet"
          description="Create your first competition to get started."
          action={{ label: 'New Competition', href: '/competitions/new' }}
        />
      )}

      {competitions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {competitions.map((comp) => (
            <CompetitionCard key={comp.id} competition={comp} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pagination.totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function CompetitionCard({ competition }: { competition: Competition }) {
  return (
    <Link href={`/competitions/${competition.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold">{competition.name}</h3>
            <Badge className={COMPETITION_STATUS_COLORS[competition.status] ?? ''}>
              {competition.status.replace('_', ' ')}
            </Badge>
          </div>

          <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>
                {competition.startDate}
                {competition.endDate !== competition.startDate && ` – ${competition.endDate}`}
              </span>
            </div>
            {competition.location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                <span className="truncate">{competition.location}</span>
              </div>
            )}
            {competition.maxParticipants && (
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                <span>Max {competition.maxParticipants} participants</span>
              </div>
            )}
          </div>

          {competition.disciplines && competition.disciplines.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {competition.disciplines.map((d) => (
                <Badge key={d} variant="outline" className="text-xs">
                  {d}
                </Badge>
              ))}
            </div>
          )}

          {competition.entryFee !== null && competition.entryFee > 0 && (
            <p className="mt-3 text-sm font-medium">
              Entry: {(competition.entryFee / 100).toFixed(2)} {competition.currency}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
