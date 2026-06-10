'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { createBookingSlotSchema, type CreateBookingSlotInput } from '@equestrian/shared/schemas';
import { getTodayDateString, getTodayLocalDateString } from '@equestrian/shared/utils';
import { useClubSettings } from '@/hooks/use-settings';
import { useLessonTypes, useCreateBookingSlot } from '@/hooks/use-bookings';
import { useArenas } from '@/hooks/use-bookings';
import { useCoachMembers } from '@/hooks/use-staff';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type z } from 'zod';
import { reportMutationError } from '@/components/shared/report-mutation-error';

type SlotFormValues = z.input<typeof createBookingSlotSchema>;

// Audit F-66 (2026-05-07 r5): optional controlled open/onOpenChange so
// the calendar's empty-state CTA can drive the same dialog the header
// trigger uses. Uncontrolled callers keep the original behaviour.
interface CreateSingleSlotDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateSingleSlotDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: CreateSingleSlotDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    controlledOnOpenChange?.(next);
  };
  const createSlot = useCreateBookingSlot();
  const lessonTypesQuery = useLessonTypes();
  const arenasQuery = useArenas();
  const coachesQuery = useCoachMembers();
  const settingsQuery = useClubSettings();

  const lessonTypes = lessonTypesQuery.data?.data ?? [];
  const arenas = arenasQuery.data?.data ?? [];
  const coaches = coachesQuery.data?.data ?? [];

  // Audit pass-5 MED-3 (2026-05-21) + codex follow-up: the booking-slot
  // server validates against the CLUB's timezone via
  // `isDateInPast(data.date, clubTimezone)`. The first MED-3 fix used
  // browser-local time, but when admin tz differs from club tz (e.g.
  // a US-Pacific admin managing a Dubai club at 23:00 PT — still
  // yesterday by the browser but today in Dubai) the default landed on
  // a date the server rejects as past. Pull the club's stored tz from
  // settings; fall back to browser-local during the first render before
  // settings have loaded (matches the pre-codex behavior in that
  // window, but settings is cached after the first dashboard navigation
  // so the fallback is effectively unreachable in practice).
  const clubTimezone = settingsQuery.data?.data.timezone;
  const todayInClub = clubTimezone ? getTodayDateString(clubTimezone) : getTodayLocalDateString();

  const form = useForm<SlotFormValues, unknown, CreateBookingSlotInput>({
    resolver: zodResolver(createBookingSlotSchema),
    defaultValues: {
      startTime: '09:00',
      endTime: '10:00',
      maxRiders: 6,
      date: todayInClub,
    },
  });

  // Audit pass-5 MED-3 (2026-05-21) + codex v2 follow-up: RHF freezes
  // `defaultValues` on first render. If `useClubSettings` is still
  // loading at that moment, the form initializes with the browser-
  // local fallback and never picks up the club's actual tz when it
  // arrives — which is exactly the scenario the fix was meant to
  // close. Sync the date field once `clubTimezone` resolves, but only
  // when the user hasn't already touched the field (`dirtyFields.date`
  // is unset). `shouldDirty: false` keeps RHF's dirty-state honest so
  // a subsequent `form.reset()` after submit still works.
  useEffect(() => {
    if (clubTimezone && !form.formState.dirtyFields.date) {
      form.setValue('date', getTodayDateString(clubTimezone), {
        shouldDirty: false,
        shouldValidate: false,
        shouldTouch: false,
      });
    }
  }, [clubTimezone, form]);

  async function onSubmit(data: CreateBookingSlotInput) {
    try {
      await createSlot.mutateAsync(data);
      toast.success('Slot created');
      form.reset();
      setOpen(false);
    } catch (err) {
      reportMutationError('slots.single.create', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create slot');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Single Slot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Single Slot</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="lessonTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lesson Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select lesson type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {lessonTypes.map((lt) => (
                        <SelectItem key={lt.id} value={lt.id}>
                          {lt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start *</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End *</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxRiders"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Riders *</FormLabel>
                    <FormControl>
                      <NumberInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="arenaId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Arena</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Any arena" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {arenas.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="coachMemberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Coach</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Any coach" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {coaches.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.displayName ?? c.email ?? 'Unnamed'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
