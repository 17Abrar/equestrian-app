'use client';

import { useState } from 'react';
import { Clock, X, Pencil, Users, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LESSON_TYPE_COLORS } from '@/lib/ui-constants';
import { getCapacityInfo, CAPACITY_BADGE_CLASSES, CAPACITY_DOT_CLASSES } from '@/lib/capacity';
import { useUpdateBookingSlot, useCancelBookingSlot, type BookingSlot } from '@/hooks/use-bookings';
import { reportMutationError } from '@/components/shared/report-mutation-error';

function getSlotColor(lessonType: string): string {
  return LESSON_TYPE_COLORS[lessonType] ?? '#6366f1';
}

interface CalendarSlotCardProps {
  slot: BookingSlot;
  compact?: boolean;
}

export function CalendarSlotCard({ slot, compact = false }: CalendarSlotCardProps) {
  const bgColor = slot.lessonTypeColor ?? getSlotColor(slot.lessonTypeType);
  const capacity = getCapacityInfo(slot.currentRiders, slot.maxRiders);

  if (compact) {
    return (
      <div
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white truncate"
        style={{ backgroundColor: bgColor, opacity: capacity.isFull ? 0.5 : 1 }}
        title={`${slot.lessonTypeName} ${slot.startTime.slice(0, 5)} — ${capacity.label}`}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${CAPACITY_DOT_CLASSES[capacity.color]}`} />
        {slot.lessonTypeName}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md p-2 text-white text-xs text-left cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          style={{ backgroundColor: bgColor, opacity: capacity.isFull ? 0.6 : 1 }}
          aria-label={`${slot.lessonTypeName} at ${slot.startTime.slice(0, 5)} - ${slot.endTime.slice(0, 5)}, ${capacity.label}`}
        >
          <p className="font-semibold truncate">{slot.lessonTypeName}</p>
          <p className="flex items-center gap-1 opacity-90">
            <Clock className="h-3 w-3" />
            {slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="opacity-75">{slot.arenaName ?? 'TBD'}</span>
            <Badge
              variant="secondary"
              className={`h-5 text-[10px] ${
                capacity.isFull
                  ? 'bg-red-500/80 text-white'
                  : capacity.color === 'orange'
                    ? 'bg-orange-400/80 text-white'
                    : capacity.color === 'yellow'
                      ? 'bg-yellow-400/80 text-white'
                      : 'bg-white/20 text-white'
              }`}
            >
              {capacity.isFull ? 'FULL' : `${capacity.spotsLeft} left`}
            </Badge>
          </div>
          {slot.coachName && (
            <p className="mt-0.5 truncate opacity-75">{slot.coachName}</p>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <SlotActions slot={slot} />
      </PopoverContent>
    </Popover>
  );
}

function SlotActions({ slot }: { slot: BookingSlot }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelSlot = useCancelBookingSlot();

  const capacity = getCapacityInfo(slot.currentRiders, slot.maxRiders);

  async function handleCancel() {
    try {
      await cancelSlot.mutateAsync({ slotId: slot.id, reason: cancelReason || undefined });
      toast.success('Slot cancelled');
      setCancelOpen(false);
    } catch (err) {
      reportMutationError('slot.cancel', err, { slotId: slot.id });
      toast.error('Failed to cancel slot');
    }
  }

  return (
    <div>
      {/* Slot details */}
      <div className="border-b p-3">
        <p className="font-semibold">{slot.lessonTypeName}</p>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {slot.date} · {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
          </p>
          {slot.arenaName && (
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {slot.arenaName}
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <Badge className={`text-xs ${CAPACITY_BADGE_CLASSES[capacity.color]}`}>{capacity.label}</Badge>
          </p>
          {slot.coachName && <p>Coach: {slot.coachName}</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 p-2">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-2 h-4 w-4" />
          Reschedule
        </Button>
        <Button variant="ghost" size="sm" className="justify-start text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
          <X className="mr-2 h-4 w-4" />
          Cancel Slot
        </Button>
      </div>

      {/* Cancel dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this slot?</AlertDialogTitle>
            <AlertDialogDescription>
              {slot.lessonTypeName} on {slot.date} at {slot.startTime.slice(0, 5)}.
              {slot.currentRiders > 0 && ` ${slot.currentRiders} rider(s) are booked.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Reason for cancellation (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Slot</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancel Slot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit/Reschedule dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reschedule Slot</DialogTitle></DialogHeader>
          <RescheduleForm slot={slot} onSuccess={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RescheduleForm({ slot, onSuccess }: { slot: BookingSlot; onSuccess: () => void }) {
  const [date, setDate] = useState(slot.date);
  const [startTime, setStartTime] = useState(slot.startTime);
  const [endTime, setEndTime] = useState(slot.endTime);
  const updateSlot = useUpdateBookingSlot(slot.id);

  async function handleSave() {
    try {
      await updateSlot.mutateAsync({ date, startTime, endTime });
      toast.success('Slot rescheduled');
      onSuccess();
    } catch (err) {
      reportMutationError('slot.reschedule', err, { slotId: slot.id });
      toast.error(err instanceof Error ? err.message : 'Failed to reschedule');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          {slot.lessonTypeName} · {slot.currentRiders} rider(s) booked
        </p>
      </div>
      <div>
        <label className="text-sm font-medium">Date</label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">Start Time</label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium">End Time</label>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1" />
        </div>
      </div>
      <Button onClick={handleSave} className="w-full" disabled={updateSlot.isPending}>
        {updateSlot.isPending ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}
