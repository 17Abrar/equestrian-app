'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, Dumbbell } from 'lucide-react';
import { createExerciseScheduleSchema, type CreateExerciseScheduleFormValues, type CreateExerciseScheduleInput } from '@equestrian/shared/schemas';
import { useExerciseSchedules, useCreateExerciseSchedule, useDeleteExerciseSchedule } from '@/hooks/use-horse-health';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INTENSITY_COLORS: Record<string, string> = {
  light: 'bg-green-100 text-green-800',
  moderate: 'bg-yellow-100 text-yellow-800',
  intense: 'bg-red-100 text-red-800',
};

interface ExerciseTabProps {
  horseId: string;
}

export function ExerciseTab({ horseId }: ExerciseTabProps) {
  const { data, isLoading, isError, error, refetch } = useExerciseSchedules(horseId);
  const deleteSchedule = useDeleteExerciseSchedule(horseId);

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load exercise schedules'} onRetry={() => refetch()} />;

  const schedules = data?.data ?? [];

  // Group by day
  const byDay = new Map<number, typeof schedules>();
  for (const s of schedules) {
    if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
    byDay.get(s.dayOfWeek)!.push(s);
  }

  async function handleDelete(scheduleId: string) {
    try {
      await deleteSchedule.mutateAsync(scheduleId);
      toast.success('Exercise removed');
    } catch {
      toast.error('Failed to remove exercise');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Exercise Schedule</CardTitle>
        </div>
        <AddExerciseDialog horseId={horseId} />
      </CardHeader>
      <CardContent>
        {schedules.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No exercise schedule yet. Add exercises above.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {DAYS.map((day, i) => {
              const daySchedules = byDay.get(i) ?? [];
              return (
                <div key={i} className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-semibold">{day}</p>
                  {daySchedules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Rest day</p>
                  ) : (
                    <div className="space-y-2">
                      {daySchedules.map((s) => (
                        <div key={s.id} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{s.exerciseType}</p>
                            <div className="flex items-center gap-1">
                              {s.durationMinutes && <span className="text-xs text-muted-foreground">{s.durationMinutes} min</span>}
                              {s.intensity && <Badge className={`text-[10px] ${INTENSITY_COLORS[s.intensity] ?? ''}`}>{s.intensity}</Badge>}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(s.id)} aria-label="Remove">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddExerciseDialog({ horseId }: { horseId: string }) {
  const [open, setOpen] = useState(false);
  const createSchedule = useCreateExerciseSchedule(horseId);

  const form = useForm<CreateExerciseScheduleFormValues, unknown, CreateExerciseScheduleInput>({
    resolver: zodResolver(createExerciseScheduleSchema),
    defaultValues: { dayOfWeek: 1, exerciseType: '' },
  });

  async function onSubmit(data: CreateExerciseScheduleInput) {
    try {
      await createSchedule.mutateAsync(data);
      toast.success('Exercise added');
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add exercise');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Exercise</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Exercise</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
              <FormItem>
                <FormLabel>Day *</FormLabel>
                <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="exerciseType" render={({ field }) => (
              <FormItem><FormLabel>Type *</FormLabel><FormControl><Input placeholder="e.g. Flatwork, Jumping, Lunging, Hacking" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="durationMinutes" render={({ field }) => (
                <FormItem><FormLabel>Duration (min)</FormLabel><FormControl><Input type="number" placeholder="e.g. 45" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="intensity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Intensity</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="intense">Intense</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createSchedule.isPending}>
              {createSchedule.isPending ? 'Adding...' : 'Add Exercise'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
