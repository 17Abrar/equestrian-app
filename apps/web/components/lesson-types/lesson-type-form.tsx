'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useState } from 'react';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { createLessonTypeSchema, type CreateLessonTypeFormValues, type CreateLessonTypeInput } from '@equestrian/shared/schemas';
import { DEFAULT_LESSON_TYPES } from '@equestrian/shared/types';
import { formatMoney } from '@equestrian/shared/utils';
import { useLessonTypes, useCreateLessonType, useUpdateLessonType, useDeleteLessonType, type LessonType } from '@/hooks/use-bookings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Edit form takes price in major units (AED) for the human-readable input;
// the submit handler converts back to minor units. `refine` on min/max
// enforces business rules (positive duration, maxRiders >= minRiders) so
// clearing a field can't submit `NaN`. Audit C-8.
const editLessonTypeFormSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255),
    durationMinutes: z.number().int().min(15, 'Min 15 minutes'),
    price: z.number().min(0, 'Price cannot be negative'),
    maxRiders: z.number().int().min(1, 'At least 1 rider'),
    minRiders: z.number().int().min(1, 'At least 1 rider'),
    color: z.string().min(4).max(7),
  })
  .refine((d) => d.maxRiders >= d.minRiders, {
    message: 'Max riders must be ≥ min riders',
    path: ['maxRiders'],
  });
type EditLessonTypeFormValues = z.infer<typeof editLessonTypeFormSchema>;

// ─── Lesson Type Form Dialog (Create) ─────────────────────────────────

interface LessonTypeFormDialogProps {
  onSuccess?: () => void;
}

export function LessonTypeFormDialog({ onSuccess }: LessonTypeFormDialogProps) {
  const [open, setOpen] = useState(false);
  const createLessonType = useCreateLessonType();

  const form = useForm<CreateLessonTypeFormValues, unknown, CreateLessonTypeInput>({
    resolver: zodResolver(createLessonTypeSchema),
    defaultValues: {
      name: '',
      type: '',
      durationMinutes: 60,
      price: 0,
      currency: 'AED',
      maxRiders: 6,
      minRiders: 1,
      color: '#3b82f6',
    },
  });

  function selectSuggestion(suggestion: string) {
    const slug = suggestion.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    form.setValue('type', slug);
    form.setValue('name', suggestion);
  }

  async function onSubmit(data: CreateLessonTypeInput) {
    try {
      await createLessonType.mutateAsync({ ...data, price: Math.round(data.price * 100) });
      toast.success('Lesson type created');
      form.reset();
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      reportMutationError('lesson_type.create', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create lesson type');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add Lesson Type</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Lesson Type</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Quick start:</p>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_LESSON_TYPES.map((s) => (
                  <Badge key={s} variant="outline" className="cursor-pointer hover:bg-accent text-xs" onClick={() => selectSuggestion(s)}>{s}</Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="e.g. Group Lesson" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Type ID *</FormLabel><FormControl><Input placeholder="e.g. group" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="durationMinutes" render={({ field }) => (
                <FormItem><FormLabel>Duration (min)</FormLabel><FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="color" render={({ field }) => (
                <FormItem><FormLabel>Color</FormLabel><FormControl><Input type="color" className="h-10 w-full" {...field} value={field.value ?? '#3b82f6'} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="maxRiders" render={({ field }) => (
                <FormItem><FormLabel>Max Riders</FormLabel><FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="minRiders" render={({ field }) => (
                <FormItem><FormLabel>Min Riders</FormLabel><FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <Button type="submit" className="w-full" disabled={createLessonType.isPending}>
              {createLessonType.isPending ? 'Creating...' : 'Create Lesson Type'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lesson Types List (with edit/delete) ──────────────────────────────

export function LessonTypesList() {
  const { data, isLoading, isError, error, refetch } = useLessonTypes();
  const deleteLessonType = useDeleteLessonType();

  if (isLoading) return <Skeleton className="h-32" />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} onRetry={() => refetch()} />;

  const lessonTypes = data?.data ?? [];

  async function handleDelete(id: string) {
    try {
      await deleteLessonType.mutateAsync(id);
      toast.success('Lesson type removed');
    } catch (err) {
      reportMutationError('lesson_type.delete', err, { lessonTypeId: id });
      toast.error('Failed to remove lesson type');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Lesson Types</CardTitle>
        <LessonTypeFormDialog />
      </CardHeader>
      <CardContent>
        {lessonTypes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No lesson types yet. Create one to start scheduling.</p>
        ) : (
          <div className="space-y-2">
            {lessonTypes.map((lt) => (
              <div key={lt.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 rounded" style={{ backgroundColor: lt.color ?? '#6366f1' }} />
                  <div>
                    <p className="font-medium">{lt.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {lt.durationMinutes} min · {formatMoney(lt.price, lt.currency)} · {lt.maxRiders} riders max
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <EditLessonTypeDialog lessonType={lt} />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${lt.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {lt.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This will deactivate the lesson type. Existing bookings won't be affected.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(lt.id)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditLessonTypeDialog({ lessonType }: { lessonType: LessonType }) {
  const [open, setOpen] = useState(false);
  const updateLessonType = useUpdateLessonType(lessonType.id);

  const form = useForm<EditLessonTypeFormValues>({
    resolver: zodResolver(editLessonTypeFormSchema),
    defaultValues: {
      name: lessonType.name,
      durationMinutes: lessonType.durationMinutes,
      price: lessonType.price / 100, // Convert from fils to AED for display
      maxRiders: lessonType.maxRiders,
      minRiders: lessonType.minRiders,
      color: lessonType.color ?? '#3b82f6',
    },
  });

  async function onSubmit(data: EditLessonTypeFormValues) {
    try {
      const payload: Partial<CreateLessonTypeInput> = {
        ...data,
        price: Math.round(data.price * 100),
      };
      await updateLessonType.mutateAsync(payload);
      toast.success('Lesson type updated');
      setOpen(false);
    } catch (err) {
      reportMutationError('lesson_type.update', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${lessonType.name}`}>
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {lessonType.name}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="durationMinutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration (min)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="color" render={({ field }) => (
                <FormItem><FormLabel>Color</FormLabel><FormControl><Input type="color" className="h-10" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="maxRiders" render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Riders</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="minRiders" render={({ field }) => (
                <FormItem>
                  <FormLabel>Min Riders</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <Button type="submit" className="w-full" disabled={updateLessonType.isPending}>
              {updateLessonType.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
