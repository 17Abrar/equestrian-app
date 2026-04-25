'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useLessonTypes, useBookingSlots, useCreateBooking } from '@/hooks/use-bookings';
import { useRiders } from '@/hooks/use-riders';
import { useHorses } from '@/hooks/use-horses';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@equestrian/shared/utils';
import { reportMutationError } from '@/components/shared/report-mutation-error';

export function AddBookingDialog() {
  const [open, setOpen] = useState(false);
  const [lessonTypeId, setLessonTypeId] = useState('');
  const [date, setDate] = useState('');
  const [slotId, setSlotId] = useState('');
  const [riderMemberId, setRiderMemberId] = useState('');
  const [horseId, setHorseId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');

  const lessonTypesQuery = useLessonTypes();
  const slotsQuery = useBookingSlots({
    date: date || undefined,
    lessonTypeId: lessonTypeId || undefined,
  });
  const ridersQuery = useRiders({ page: 1, pageSize: 100 });
  const horsesQuery = useHorses({ page: 1, pageSize: 100 });
  const createBooking = useCreateBooking();

  const lessonTypes = lessonTypesQuery.data?.data ?? [];
  const slots = slotsQuery.data?.data ?? [];
  const riders = ridersQuery.data?.data ?? [];
  const horses = horsesQuery.data?.data ?? [];

  const selectedSlot = slots.find((s) => s.id === slotId);

  function reset() {
    setLessonTypeId('');
    setDate('');
    setSlotId('');
    setRiderMemberId('');
    setHorseId('');
    setPaymentMethod('');
    setCouponCode('');
    setCouponDiscount(0);
    setCouponError('');
  }

  async function handleSubmit() {
    if (!slotId || !riderMemberId) {
      toast.error('Please select a slot and rider');
      return;
    }

    try {
      await createBooking.mutateAsync({
        slotId,
        riderMemberId,
        horseId: horseId || undefined,
        paymentMethod: (paymentMethod || undefined) as 'card' | 'cash' | undefined,
        couponCode: couponCode || undefined,
        autoMatchHorse: !horseId,
      });
      toast.success('Booking created');
      reset();
      setOpen(false);
    } catch (error) {
      reportMutationError('booking.create', error, { slotId, riderMemberId });
      toast.error(error instanceof Error ? error.message : 'Failed to create booking');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Booking
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Manual Booking</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Step 1: Lesson Type */}
          <div>
            <label className="text-sm font-medium">1. Lesson Type</label>
            <Select value={lessonTypeId} onValueChange={(v) => { setLessonTypeId(v); setSlotId(''); }}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select lesson type" />
              </SelectTrigger>
              <SelectContent>
                {lessonTypes.map((lt) => (
                  <SelectItem key={lt.id} value={lt.id}>
                    {lt.name} — {formatMoney(lt.price, lt.currency)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 2: Date */}
          {lessonTypeId && (
            <div>
              <label className="text-sm font-medium">2. Date</label>
              <Input
                type="date"
                className="mt-1"
                value={date}
                onChange={(e) => { setDate(e.target.value); setSlotId(''); }}
              />
            </div>
          )}

          {/* Step 3: Time Slot */}
          {date && (
            <div>
              <label className="text-sm font-medium">3. Time Slot</label>
              {slotsQuery.isLoading ? (
                <Skeleton className="mt-1 h-10" />
              ) : slots.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No slots available for this date and lesson type.</p>
              ) : (
                <Select value={slotId} onValueChange={setSlotId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select time slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {slots.map((slot) => (
                      <SelectItem key={slot.id} value={slot.id} disabled={slot.currentRiders >= slot.maxRiders}>
                        {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
                        {' '}({slot.currentRiders}/{slot.maxRiders} riders)
                        {slot.arenaName ? ` • ${slot.arenaName}` : ''}
                        {slot.currentRiders >= slot.maxRiders ? ' — FULL' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Step 4: Rider */}
          {slotId && (
            <div>
              <label className="text-sm font-medium">4. Rider</label>
              <Select value={riderMemberId} onValueChange={setRiderMemberId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select rider" />
                </SelectTrigger>
                <SelectContent>
                  {riders.map((r) => (
                    <SelectItem key={r.memberId} value={r.memberId}>
                      {r.displayName ?? r.email ?? 'Unnamed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Step 5: Horse (optional) */}
          {riderMemberId && (
            <div>
              <label className="text-sm font-medium">5. Horse (optional, auto-matches if empty)</label>
              <Select value={horseId || '__none__'} onValueChange={(v) => setHorseId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Auto-match horse" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Auto-match</SelectItem>
                  {horses.filter((h) => h.status === 'available').map((h) => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Step 6: Payment Method */}
          {riderMemberId && (
            <div>
              <label className="text-sm font-medium">6. Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="card_in_person">Card (in person)</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="package_credit">Package Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Step 7: Promo Code */}
          {riderMemberId && selectedSlot && (
            <div>
              <label className="text-sm font-medium">7. Promo Code (optional)</label>
              <div className="mt-1 flex gap-2">
                <Input
                  placeholder="e.g. SUMMER25"
                  className="font-mono uppercase"
                  value={couponCode}
                  onChange={(e) => { setCouponCode(e.target.value); setCouponDiscount(0); setCouponError(''); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!couponCode}
                  onClick={async () => {
                    setCouponError('');
                    setCouponDiscount(0);
                    try {
                      const res = await fetch('/api/v1/coupons/validate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          code: couponCode,
                          amount: selectedSlot.lessonTypePrice,
                          riderMemberId,
                        }),
                      });
                      const json = await res.json();
                      if (json.data?.valid) {
                        setCouponDiscount(json.data.discount);
                        toast.success(`Discount applied: ${formatMoney(json.data.discount, selectedSlot.lessonTypeCurrency)}`);
                      } else {
                        setCouponError(json.data?.error ?? 'Invalid code');
                      }
                    } catch {
                      setCouponError('Failed to validate code');
                    }
                  }}
                >
                  Apply
                </Button>
              </div>
              {couponError && <p className="mt-1 text-sm text-destructive">{couponError}</p>}
              {couponDiscount > 0 && (
                <p className="mt-1 text-sm text-green-600">
                  Discount: −{formatMoney(couponDiscount, selectedSlot.lessonTypeCurrency)}
                </p>
              )}
            </div>
          )}

          {/* Summary */}
          {selectedSlot && riderMemberId && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm font-medium">Booking Summary</p>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <p>{selectedSlot.lessonTypeName}</p>
                <p>{selectedSlot.date} at {selectedSlot.startTime.slice(0, 5)} – {selectedSlot.endTime.slice(0, 5)}</p>
                <div className="flex items-center gap-2">
                  <p className={couponDiscount > 0 ? 'line-through' : ''}>
                    {formatMoney(selectedSlot.lessonTypePrice, selectedSlot.lessonTypeCurrency)}
                  </p>
                  {couponDiscount > 0 && (
                    <p className="font-semibold text-green-600">
                      {formatMoney(selectedSlot.lessonTypePrice - couponDiscount, selectedSlot.lessonTypeCurrency)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <Button
            className="w-full"
            disabled={!slotId || !riderMemberId || createBooking.isPending}
            onClick={handleSubmit}
          >
            {createBooking.isPending ? 'Creating...' : 'Create Booking'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
