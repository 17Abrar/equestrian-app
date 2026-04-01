'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';
import { createRecurringSlotsSchema, type CreateRecurringSlotsFormValues, type CreateRecurringSlotsInput } from '@equestrian/shared/schemas';
import { useLessonTypes, useCreateRecurringSlots } from '@/hooks/use-bookings';
import { useArenas } from '@/hooks/use-bookings';
import { useCoachMembers } from '@/hooks/use-staff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export function CreateRecurringSlotsDialog() {
  const [open, setOpen] = useState(false);
  const createSlots = useCreateRecurringSlots();
  const lessonTypesQuery = useLessonTypes();
  const arenasQuery = useArenas();
  const coachesQuery = useCoachMembers();

  const lessonTypes = lessonTypesQuery.data?.data ?? [];
  const arenas = arenasQuery.data?.data ?? [];
  const coaches = coachesQuery.data?.data ?? [];

  const form = useForm<CreateRecurringSlotsFormValues, unknown, CreateRecurringSlotsInput>({
    resolver: zodResolver(createRecurringSlotsSchema),
    defaultValues: {
      startTime: '09:00',
      endTime: '10:00',
      maxRiders: 6,
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      dateFrom: '',
      dateTo: '',
    },
  });

  const selectedDays = form.watch('daysOfWeek') ?? [];

  async function onSubmit(data: CreateRecurringSlotsInput) {
    try {
      const result = await createSlots.mutateAsync(data);
      const count = (result as { data?: { created?: number } }).data?.created ?? 0;
      toast.success(`${count} slots created`);
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create slots');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarPlus className="mr-2 h-4 w-4" />
          Create Recurring Slots
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Recurring Slots</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="lessonTypeId" render={({ field }) => (
              <FormItem>
                <FormLabel>Lesson Type *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select lesson type" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {lessonTypes.map((lt) => (
                      <SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="arenaId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Arena</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Any arena" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {arenas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="coachMemberId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Coach</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Any coach" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {coaches.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.displayName ?? c.email ?? 'Unnamed'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem><FormLabel>Start Time *</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem><FormLabel>End Time *</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="maxRiders" render={({ field }) => (
                <FormItem><FormLabel>Max Riders *</FormLabel><FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <FormField
              control={form.control}
              name="daysOfWeek"
              render={() => (
                <FormItem>
                  <FormLabel>Days of Week *</FormLabel>
                  <div className="flex gap-2">
                    {DAYS.map((day) => {
                      const isChecked = selectedDays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => {
                            const current = form.getValues('daysOfWeek') ?? [];
                            if (isChecked) {
                              form.setValue('daysOfWeek', current.filter((d) => d !== day.value));
                            } else {
                              form.setValue('daysOfWeek', [...current, day.value]);
                            }
                          }}
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                            isChecked
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="dateFrom" render={({ field }) => (
                <FormItem><FormLabel>From Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="dateTo" render={({ field }) => (
                <FormItem><FormLabel>To Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <Button type="submit" className="w-full" disabled={createSlots.isPending}>
              {createSlots.isPending ? 'Creating...' : 'Create Slots'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
