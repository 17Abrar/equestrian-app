'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Trash2, Users, Pencil } from 'lucide-react';
import { STALE_TIME_BURST } from '@equestrian/shared/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';

// ─── Types ────────────────────────────────────────────────────────────

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface AudienceFilters {
  skillLevel?: SkillLevel;
  activeWithinDays?: number;
  minBookings?: number;
}

export interface Audience {
  id: string;
  name: string;
  description: string | null;
  filters: AudienceFilters;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success: true;
  data: T;
}

// ─── Tab root ─────────────────────────────────────────────────────────

export function AudiencesTab() {
  // Audit F-20 (2026-05-07 r4): lift create-dialog open state so EmptyState
  // CTA shares the same flow as the header trigger.
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audiences'],
    queryFn: () => fetchJson<ApiEnvelope<Audience[]>>('/api/v1/emails/audiences'),
  });

  // Audit F-28 (2026-05-06): content-shape skeleton — audiences
  // render as a card grid; mirror that shape so the loading view
  // doesn't layout-shift when rows arrive.
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load audiences'}
        onRetry={() => refetch()}
      />
    );
  }

  const audiences = data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Audiences</CardTitle>
            <CardDescription>
              Named rider segments — reuse them to target specific groups in your emails.
            </CardDescription>
          </div>
          <AudienceFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
        </CardHeader>
        <CardContent>
          {audiences.length === 0 ? (
            <EmptyState
              title="No audiences yet"
              description="Create a segment to target riders by skill, activity, or custom filters."
              action={{ label: 'New Audience', onClick: () => setCreateOpen(true) }}
            />
          ) : (
            <div className="space-y-2">
              {audiences.map((a) => (
                <AudienceRow key={a.id} audience={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AudienceRow({ audience }: { audience: Audience }) {
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () =>
      fetchJson<ApiEnvelope<{ id: string }>>(`/api/v1/emails/audiences/${audience.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success(`"${audience.name}" deleted`);
      void qc.invalidateQueries({ queryKey: ['audiences'] });
    },
    onError: (err) => {
      reportMutationError('audience.delete', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    },
  });

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{audience.name}</p>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Users className="h-3 w-3" />
            {audience.memberCount ?? 0} riders
          </Badge>
          {audience.filters.skillLevel && (
            <Badge variant="outline" className="text-xs capitalize">
              {audience.filters.skillLevel}
            </Badge>
          )}
          {typeof audience.filters.activeWithinDays === 'number' && (
            <Badge variant="outline" className="text-xs">
              Active in {audience.filters.activeWithinDays}d
            </Badge>
          )}
          {typeof audience.filters.minBookings === 'number' && (
            <Badge variant="outline" className="text-xs">
              ≥{audience.filters.minBookings} bookings
            </Badge>
          )}
        </div>
        {audience.description && (
          <p className="mt-1 text-sm text-muted-foreground">{audience.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <AudienceFormDialog mode="edit" audience={audience} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Delete ${audience.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{audience.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                The segment is removed but its members are untouched. You can always recreate it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Create / Edit dialog ─────────────────────────────────────────────

interface AudienceFormDialogProps {
  mode: 'create' | 'edit';
  audience?: Audience;
  // Audit F-20 (2026-05-07 r4): optional controlled open state so EmptyState
  // CTA can drive the create flow alongside the header trigger.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Audit MED (2026-05-05 pass 2): converted from `useState` + ad-hoc
// `if (!name.trim()) toast.error(...)` validation to RHF + Zod, matching
// CLAUDE.md's project-wide form rule. Filters stay in `useState` because
// they're a complex nested editor with their own builder UI; their
// validation is structural (the FiltersEditor only emits valid shapes)
// rather than user-input-from-strings.
const audienceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be 120 characters or fewer'),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or fewer')
    .optional()
    .or(z.literal('')),
});

type AudienceFormValues = z.infer<typeof audienceFormSchema>;

function AudienceFormDialog({
  mode,
  audience,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AudienceFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOnOpenChange) controlledOnOpenChange(next);
    else setInternalOpen(next);
  };
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AudienceFilters>(audience?.filters ?? {});

  const form = useForm<AudienceFormValues>({
    resolver: zodResolver(audienceFormSchema),
    defaultValues: {
      name: audience?.name ?? '',
      description: audience?.description ?? '',
    },
  });

  // Edit mode: re-seed when the source audience changes (different row
  // selected from the list, or a parallel mutation refreshed the cache).
  useEffect(() => {
    if (mode === 'edit' && audience) {
      form.reset({ name: audience.name, description: audience.description ?? '' });
      setFilters(audience.filters ?? {});
    }
  }, [audience, mode, form]);

  const saveMut = useMutation({
    mutationFn: async (values: AudienceFormValues) => {
      const body = JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        filters,
      });
      if (mode === 'create') {
        return fetchJson<ApiEnvelope<Audience>>('/api/v1/emails/audiences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      }
      return fetchJson<ApiEnvelope<Audience>>(`/api/v1/emails/audiences/${audience!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Audience created' : 'Audience updated');
      void qc.invalidateQueries({ queryKey: ['audiences'] });
      setOpen(false);
    },
    onError: (err) => {
      reportMutationError('audience.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save audience');
    },
  });

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o && mode === 'create') {
      form.reset({ name: '', description: '' });
      setFilters({});
    }
  }

  function onSubmit(values: AudienceFormValues) {
    saveMut.mutate(values);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {mode === 'create' ? (
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New Audience
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Edit ${audience!.name}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Audience' : `Edit ${audience!.name}`}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-1.5">
            <Label htmlFor="audience-name">Name *</Label>
            <Input
              id="audience-name"
              placeholder="e.g. Active Beginners"
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audience-description">Description</Label>
            <Textarea
              id="audience-description"
              rows={2}
              placeholder="Short note to remember what this segment is for"
              {...form.register('description')}
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <FiltersEditor filters={filters} onChange={setFilters} />

          <LivePreview filters={filters} />

          <DialogFooter>
            <Button type="submit" disabled={saveMut.isPending}>
              {saveMut.isPending
                ? 'Saving...'
                : mode === 'create'
                  ? 'Create audience'
                  : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter builder ───────────────────────────────────────────────────

interface FiltersEditorProps {
  filters: AudienceFilters;
  onChange: (f: AudienceFilters) => void;
}

function FiltersEditor({ filters, onChange }: FiltersEditorProps) {
  function update<K extends keyof AudienceFilters>(key: K, value: AudienceFilters[K] | undefined) {
    const next = { ...filters };
    if (value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Filters (all must match)</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Skill level</Label>
          <Select
            value={filters.skillLevel ?? 'any'}
            onValueChange={(v) =>
              update('skillLevel', v === 'any' ? undefined : (v as SkillLevel))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Active within (days)</Label>
          <Input
            type="number"
            min={1}
            placeholder="e.g. 30"
            value={filters.activeWithinDays ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              update('activeWithinDays', v ? Number(v) : undefined);
            }}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Minimum bookings</Label>
          <Input
            type="number"
            min={1}
            placeholder="e.g. 5"
            value={filters.minBookings ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              update('minBookings', v ? Number(v) : undefined);
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Live preview count ───────────────────────────────────────────────

function LivePreview({ filters }: { filters: AudienceFilters }) {
  // Debounce by key so rapid typing doesn't spam the preview endpoint.
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const { data, isFetching } = useQuery({
    queryKey: ['audiences', 'preview', key],
    queryFn: () =>
      fetchJson<ApiEnvelope<{ count: number }>>('/api/v1/emails/audiences/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      }),
    staleTime: STALE_TIME_BURST,
  });

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      <Users className="h-4 w-4 text-muted-foreground" />
      <span>
        {isFetching ? (
          <span className="text-muted-foreground">Calculating…</span>
        ) : (
          <>
            <span className="font-medium">{data?.data.count ?? 0}</span>{' '}
            <span className="text-muted-foreground">riders match</span>
          </>
        )}
      </span>
    </div>
  );
}
