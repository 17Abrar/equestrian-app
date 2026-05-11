'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Users, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  createRiderSchema,
  type CreateRiderFormValues,
  type CreateRiderInput,
} from '@equestrian/shared/schemas';
import { useRiders, useCreateRider } from '@/hooks/use-riders';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';

import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';
import { DEFAULT_PAGE_SIZE } from '@equestrian/shared/constants';

function RiderListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface RidersListProps {
  /** Audit MED (2026-05-05 pass 2): server-side `riders:create` gate. */
  canCreate?: boolean;
}

// Audit LOW (2026-05-05 pass 2): replace the inline `as` cast with a
// real union type. Select offers exactly these values; storing them
// under the matching union narrows the call-site automatically.
const SKILL_LEVELS_FILTER = ['beginner', 'intermediate', 'advanced'] as const;
type SkillLevelFilter = (typeof SKILL_LEVELS_FILTER)[number] | undefined;

export function RidersList({ canCreate = true }: RidersListProps = {}) {
  const [search, setSearch] = useState('');
  // Debounce so each keystroke doesn't fire a fresh /riders query.
  const debouncedSearch = useDebouncedValue(search, 250);
  const [skillLevel, setSkillLevel] = useState<SkillLevelFilter>();
  const [page, setPage] = useState(1);
  // Audit F-20 (2026-05-07 r4): lift dialog open state so EmptyState CTA
  // (added below) can trigger the same Add Rider flow as the header button.
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useRiders({
    search: debouncedSearch || undefined,
    skillLevel,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Riders</h1>
          <p className="text-muted-foreground mt-1">Manage rider profiles and progress</p>
        </div>
        {canCreate && <AddRiderDialog open={addOpen} onOpenChange={setAddOpen} />}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search riders..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={skillLevel ?? 'all'}
          onValueChange={(v) => {
            setSkillLevel(
              v === 'all'
                ? undefined
                : SKILL_LEVELS_FILTER.includes(v as (typeof SKILL_LEVELS_FILTER)[number])
                  ? (v as (typeof SKILL_LEVELS_FILTER)[number])
                  : undefined,
            );
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

      {/* Content */}
      {isLoading && <RiderListSkeleton />}

      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load riders'}
          onRetry={() => refetch()}
        />
      )}

      {data && !data.data.length && (
        <EmptyState
          title="No riders yet"
          description="Riders will appear here once they join your club"
          action={canCreate ? { label: 'Add Rider', onClick: () => setAddOpen(true) } : undefined}
        />
      )}

      {data && data.data.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((rider) => (
              <Link key={rider.id} href={`/riders/${rider.id}`} className="block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
                        <Users className="text-muted-foreground h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">
                          {rider.displayName ?? 'Unnamed Rider'}
                        </h3>
                        <p className="text-muted-foreground truncate text-sm">
                          {rider.email ?? 'No email'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        variant="secondary"
                        className={SKILL_LEVEL_COLORS[rider.skillLevel] ?? ''}
                      >
                        {rider.skillLevel}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {rider.totalLessonsCompleted} lessons
                      </Badge>
                      {rider.weightKg && (
                        <Badge variant="outline" className="text-xs">
                          {rider.weightKg} kg
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
              <span className="text-muted-foreground text-sm">
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

function AddRiderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createRider = useCreateRider();

  const form = useForm<CreateRiderFormValues, unknown, CreateRiderInput>({
    resolver: zodResolver(createRiderSchema),
    defaultValues: {
      displayName: '',
      email: '',
      skillLevel: 'beginner',
    },
  });

  async function onSubmit(data: CreateRiderInput) {
    try {
      await createRider.mutateAsync(data);
      toast.success('Rider added');
      form.reset();
      onOpenChange(false);
    } catch (error) {
      reportMutationError('rider.create', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add rider');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Rider
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Rider</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="rider@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+971..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Birth</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="weightKg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (kg)</FormLabel>
                    <FormControl>
                      <NumberInput step="0.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="heightCm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Height (cm)</FormLabel>
                    <FormControl>
                      <NumberInput step="0.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="skillLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Skill Level</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? 'beginner'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" className="w-full" disabled={createRider.isPending}>
              {createRider.isPending ? 'Adding...' : 'Add Rider'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
