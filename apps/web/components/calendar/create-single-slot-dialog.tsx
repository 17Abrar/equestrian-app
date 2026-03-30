'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { createBookingSlotSchema, type CreateBookingSlotInput } from '@equestrian/shared/schemas';
import { useLessonTypes, useCreateBookingSlot } from '@/hooks/use-bookings';
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
import { type z } from 'zod';

type SlotFormValues = z.input<typeof createBookingSlotSchema>;

export function CreateSingleSlotDialog() {
  const [open, setOpen] = useState(false);
  const createSlot = useCreateBookingSlot();
  const lessonTypesQuery = useLessonTypes();
  const arenasQuery = useArenas();
  const coachesQuery = useCoachMembers();

  const lessonTypes = lessonTypesQuery.data?.data ?? [];
  const arenas = arenasQuery.data?.data ?? [];
  const coaches = coachesQuery.data?.data ?? [];

  const form = useForm<SlotFormValues, unknown, CreateBookingSlotInput>({
    resolver: zodResolver(createBookingSlotSchema),
    defaultValues: {
      startTime: '09:00',
      endTime: '10:00',
      maxRiders: 6,
      date: new Date().toISOString().split('T')[0],
    },
  });

  async function onSubmit(data: CreateBookingSlotInput) {
    try {
      await createSlot.mutateAsync(data);
      toast.success('Slot created');
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create slot');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-2 h-4 w-4" />Add Single Slot</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Single Slot</DialogTitle></DialogHeader>
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
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem><FormLabel>Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem><FormLabel>Start *</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem><FormLabel>End *</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="maxRiders" render={({ field }) => (
                <FormItem><FormLabel>Max Riders *</FormLabel><FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            <Button type="submit" className="w-full" disabled={createSlot.isPending}>
              {createSlot.isPending ? 'Creating...' : 'Create Slot'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
