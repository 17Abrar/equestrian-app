'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Calendar, MapPin, Users, Trophy, Clock, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createCompetitionClassSchema,
  createCompetitionEntrySchema,
  createCompetitionResultSchema,
  type CreateCompetitionClassInput,
  type CreateCompetitionEntryInput,
  type CreateCompetitionResultInput,
} from '@equestrian/shared/schemas';
import type { z } from 'zod';
import { toMinorUnits, formatMoney, formatDate } from '@equestrian/shared/utils';
import {
  useCompetition,
  useCompetitionClasses,
  useCompetitionEntries,
  useCompetitionResults,
  useDeleteCompetition,
  useCreateCompetitionClass,
  useCreateCompetitionEntry,
  useCreateCompetitionResult,
  type CompetitionClass,
  type CompetitionEntry,
} from '@/hooks/use-competitions';
import { useRiders } from '@/hooks/use-riders';
import { useHorses } from '@/hooks/use-horses';
import { COMPETITION_STATUS_COLORS, COMPETITION_ENTRY_STATUS_COLORS } from '@/lib/ui-constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { useRouter } from 'next/navigation';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';

interface CompetitionDetailProps {
  competitionId: string;
}

// Audit F-5 (2026-05-07 r5): expanded the competition detail skeleton
// to match the real layout — page title row + 4 info cards + tabs row +
// 3 class-row placeholders inside the tab content. The previous
// `h-8` / `h-24` / `h-64` rectangles read as "still fetching the page".
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="h-5 w-5 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-9 w-72" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// Skeleton for the classes-tab inner list. Matches the same row shape
// as ClassRow (name + discipline/level meta on left, fee on right).
function ClassesListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Skeleton for the entries / results tabs — 5/6 col table.
function CompetitionTableSkeleton({
  rows = 4,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {Array.from({ length: cols }).map((_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-3 w-16" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRow key={i}>
            {Array.from({ length: cols }).map((__, j) => (
              <TableCell key={j}>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CompetitionDetail({ competitionId }: CompetitionDetailProps) {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useCompetition(competitionId);
  const classesQuery = useCompetitionClasses(competitionId);
  const deleteCompetition = useDeleteCompetition();

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  // Audit F-29 (2026-05-07 r5): lift the AddClassForm dialog open state
  // up so the EmptyState CTA can drive the same dialog the header
  // button does.
  const [addClassOpen, setAddClassOpen] = useState(false);

  if (isLoading) return <DetailSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load competition'}
        onRetry={() => refetch()}
      />
    );
  }

  const competition = data?.data;
  if (!competition) {
    return <ErrorState message="Competition not found" />;
  }

  const classes = classesQuery.data?.data ?? [];

  async function handleDelete() {
    try {
      await deleteCompetition.mutateAsync(competitionId);
      toast.success('Competition archived');
      router.push('/competitions');
    } catch (err) {
      reportMutationError('competition.delete', err, { competitionId });
      toast.error('Failed to delete competition');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Back to competitions">
            <Link href="/competitions">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{competition.name}</h1>
              <Badge className={COMPETITION_STATUS_COLORS[competition.status] ?? ''}>
                {competition.status.replace('_', ' ')}
              </Badge>
            </div>
            {competition.description && (
              <p className="mt-1 text-muted-foreground">{competition.description}</p>
            )}
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {competition.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will archive the competition. It can be restored later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Info cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Dates</p>
              <p className="font-medium">
                {competition.startDate}
                {competition.endDate !== competition.startDate && ` – ${competition.endDate}`}
              </p>
            </div>
          </CardContent>
        </Card>
        {competition.location && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">{competition.location}</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Trophy className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Classes</p>
              <p className="font-medium">{classes.length}</p>
            </div>
          </CardContent>
        </Card>
        {competition.entryFee !== null && competition.entryFee > 0 && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Entry Fee</p>
                <p className="font-medium">
                  {formatMoney(competition.entryFee, competition.currency)}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Classes & Entries */}
      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="entries" disabled={!selectedClassId}>
            Entries {selectedClassId ? '' : '(select a class)'}
          </TabsTrigger>
          <TabsTrigger value="results" disabled={!selectedClassId}>
            Results {selectedClassId ? '' : '(select a class)'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="classes" className="mt-4">
          <div className="mb-4 flex justify-end">
            <AddClassForm
              competitionId={competitionId}
              currency={competition.currency}
              open={addClassOpen}
              onOpenChange={setAddClassOpen}
            />
          </div>

          {classesQuery.isLoading && <ClassesListSkeleton />}

          {classesQuery.isError && (
            <ErrorState
              message="Failed to load classes"
              onRetry={() => classesQuery.refetch()}
            />
          )}

          {!classesQuery.isLoading && !classesQuery.isError && classes.length === 0 && (
            <EmptyState
              title="No classes yet"
              description="Add competition classes (e.g., Novice Show Jumping 80cm)"
              action={{ label: 'Add Class', onClick: () => setAddClassOpen(true) }}
            />
          )}

          {classes.length > 0 && (
            <div className="space-y-2">
              {classes.map((cls) => (
                <ClassRow
                  key={cls.id}
                  cls={cls}
                  isSelected={selectedClassId === cls.id}
                  onSelect={() => setSelectedClassId(cls.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="entries" className="mt-4">
          {selectedClassId && (
            <EntriesSection competitionId={competitionId} classId={selectedClassId} />
          )}
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          {selectedClassId && (
            <ResultsSection competitionId={competitionId} classId={selectedClassId} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClassRow({
  cls,
  isSelected,
  onSelect,
}: {
  cls: CompetitionClass;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-accent'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{cls.name}</p>
          <div className="mt-1 flex gap-2 text-sm text-muted-foreground">
            {cls.discipline && <span>{cls.discipline}</span>}
            {cls.level && <span>{cls.level}</span>}
          </div>
        </div>
        <div className="text-right text-sm">
          {cls.maxEntries && (
            <p className="text-muted-foreground">Max {cls.maxEntries} entries</p>
          )}
          {cls.entryFee !== null && cls.entryFee > 0 && (
            <p className="font-medium">
              {formatMoney(cls.entryFee, cls.currency)}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function EntriesSection({ competitionId, classId }: { competitionId: string; classId: string }) {
  // Audit F-20 (2026-05-07 r4): lift dialog open state for EmptyState CTA.
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useCompetitionEntries(competitionId, classId);

  if (isLoading) return <CompetitionTableSkeleton cols={5} />;
  if (isError) return <ErrorState message="Failed to load entries" onRetry={() => refetch()} />;

  const entries = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddEntryForm
          competitionId={competitionId}
          classId={classId}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          description="Add entries manually or riders can register through the app."
          action={{ label: 'Add Entry', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rider</TableHead>
          <TableHead>Horse</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead>Registered</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="font-medium">{entry.riderName ?? 'Unknown'}</TableCell>
            <TableCell>{entry.horseName ?? 'TBD'}</TableCell>
            <TableCell>
              <Badge className={COMPETITION_ENTRY_STATUS_COLORS[entry.status] ?? ''}>
                {entry.status}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{entry.paymentStatus}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(entry.registeredAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
      )}
    </div>
  );
}

function ResultsSection({ competitionId, classId }: { competitionId: string; classId: string }) {
  // Audit F-20 (2026-05-07 r4): lift dialog open state for EmptyState CTA.
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useCompetitionResults(competitionId, classId);
  const entriesQuery = useCompetitionEntries(competitionId, classId);

  if (isLoading) return <CompetitionTableSkeleton cols={6} />;
  if (isError) return <ErrorState message="Failed to load results" onRetry={() => refetch()} />;

  const results = data?.data ?? [];
  const entries = entriesQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddResultForm
          competitionId={competitionId}
          classId={classId}
          entries={entries}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      </div>

      {results.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Add results after the competition."
          action={{ label: 'Add Result', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <Table>
          <TableHeader>
        <TableRow>
          <TableHead className="w-16">Place</TableHead>
          <TableHead>Rider</TableHead>
          <TableHead>Horse</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Faults</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((result) => (
          <TableRow key={result.id}>
            <TableCell className="font-bold">
              {result.placing ? `#${result.placing}` : '—'}
            </TableCell>
            <TableCell className="font-medium">{result.riderName ?? 'Unknown'}</TableCell>
            <TableCell>{result.horseName ?? '—'}</TableCell>
            <TableCell>
              {result.timeSeconds ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {Number(result.timeSeconds).toFixed(2)}s
                </span>
              ) : '—'}
            </TableCell>
            <TableCell>{result.faults > 0 ? result.faults : '0'}</TableCell>
            <TableCell className="max-w-[200px] truncate text-muted-foreground">
              {result.notes ?? '—'}
            </TableCell>
          </TableRow>
        ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Add Class Form ──────────────────────────────────────────────────

type AddClassFormValues = z.input<typeof createCompetitionClassSchema>;

function AddClassForm({
  competitionId,
  currency,
  open,
  onOpenChange,
}: {
  competitionId: string;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createClass = useCreateCompetitionClass(competitionId);
  const form = useForm<AddClassFormValues, unknown, CreateCompetitionClassInput>({
    resolver: zodResolver(createCompetitionClassSchema),
    defaultValues: { name: '', discipline: '', level: '', sortOrder: 0 },
  });

  async function onSubmit(data: CreateCompetitionClassInput) {
    try {
      // Audit AI-25 — typed onSubmit; entryFee in minor units, no `as number` cast.
      const apiData: Parameters<typeof createClass.mutateAsync>[0] = {
        ...data,
        entryFee: data.entryFee != null ? toMinorUnits(data.entryFee, currency) : undefined,
      };
      await createClass.mutateAsync(apiData);
      toast.success('Class added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('competition.class.create', err, { competitionId });
      toast.error(err instanceof Error ? err.message : 'Failed to add class');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Class</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Competition Class</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Class Name *</FormLabel><FormControl><Input placeholder="e.g. Novice Show Jumping 80cm" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="discipline" render={({ field }) => (
                <FormItem><FormLabel>Discipline</FormLabel><FormControl><Input placeholder="e.g. Show Jumping" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="level" render={({ field }) => (
                <FormItem><FormLabel>Level</FormLabel><FormControl><Input placeholder="e.g. 80cm" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="maxEntries" render={({ field }) => (
                <FormItem><FormLabel>Max Entries</FormLabel><FormControl><NumberInput placeholder="Unlimited" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="entryFee" render={({ field }) => (
                <FormItem><FormLabel>Entry Fee</FormLabel><FormControl><NumberInput placeholder="e.g. 150" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <Button type="submit" className="w-full" disabled={createClass.isPending}>
              {createClass.isPending ? 'Adding...' : 'Add Class'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Entry Form ──────────────────────────────────────────────────

function AddEntryForm({
  competitionId,
  classId,
  open,
  onOpenChange,
}: {
  competitionId: string;
  classId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createEntry = useCreateCompetitionEntry(competitionId, classId);
  const { data: ridersData } = useRiders({ page: 1, pageSize: MAX_PAGE_SIZE });
  const { data: horsesData } = useHorses({ page: 1, pageSize: MAX_PAGE_SIZE });

  const riders = ridersData?.data ?? [];
  const horsesList = horsesData?.data ?? [];
  const form = useForm<
    z.input<typeof createCompetitionEntrySchema>,
    unknown,
    CreateCompetitionEntryInput
  >({
    resolver: zodResolver(createCompetitionEntrySchema),
    defaultValues: { riderMemberId: '' },
  });

  async function onSubmit(data: CreateCompetitionEntryInput) {
    try {
      // Audit AI-25 — typed onSubmit. `amount` is intentionally absent
      // from this form — the server stamps the entry fee from
      // competitionClasses.entryFee on create (price-injection guard).
      await createEntry.mutateAsync(data);
      toast.success('Entry added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('competition.entry.create', err, { competitionId });
      toast.error(err instanceof Error ? err.message : 'Failed to add entry');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Entry</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Competition Entry</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="riderMemberId" render={({ field }) => (
              <FormItem>
                <FormLabel>Rider *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select rider" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {riders.map((r) => (
                      <SelectItem key={r.memberId} value={r.memberId}>{r.displayName ?? r.email ?? 'Unnamed'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="horseId" render={({ field }) => (
              <FormItem>
                <FormLabel>Horse (optional)</FormLabel>
                <Select onValueChange={(v) => field.onChange(v === '__none__' ? undefined : v)} value={field.value ?? '__none__'}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Auto-assign or select" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">No horse selected</SelectItem>
                    {horsesList.map((h) => (
                      <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createEntry.isPending}>
              {createEntry.isPending ? 'Registering...' : 'Register Entry'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Result Form ─────────────────────────────────────────────────

function AddResultForm({
  competitionId,
  classId,
  entries,
  open,
  onOpenChange,
}: {
  competitionId: string;
  classId: string;
  entries: CompetitionEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createResult = useCreateCompetitionResult(competitionId, classId);
  const form = useForm<
    z.input<typeof createCompetitionResultSchema>,
    unknown,
    CreateCompetitionResultInput
  >({
    resolver: zodResolver(createCompetitionResultSchema),
    defaultValues: { entryId: '', faults: 0 },
  });

  async function onSubmit(data: CreateCompetitionResultInput) {
    try {
      // Audit AI-25 — typed onSubmit; no Record<string, unknown> cast.
      await createResult.mutateAsync(data);
      toast.success('Result added');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      reportMutationError('competition.result.create', err, { competitionId });
      toast.error(err instanceof Error ? err.message : 'Failed to add result');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Result</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Result</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="entryId" render={({ field }) => (
              <FormItem>
                <FormLabel>Entry *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select entry" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {entries.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.riderName ?? 'Unknown'}{e.horseName ? ` on ${e.horseName}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="placing" render={({ field }) => (
                <FormItem><FormLabel>Placing</FormLabel><FormControl><NumberInput placeholder="#" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="timeSeconds" render={({ field }) => (
                <FormItem><FormLabel>Time (sec)</FormLabel><FormControl><NumberInput step="0.01" placeholder="e.g. 45.23" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="faults" render={({ field }) => (
                <FormItem><FormLabel>Faults</FormLabel><FormControl><NumberInput {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea placeholder="Optional notes..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createResult.isPending}>
              {createResult.isPending ? 'Saving...' : 'Save Result'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
