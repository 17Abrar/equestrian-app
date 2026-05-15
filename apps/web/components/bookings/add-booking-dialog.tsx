'use client';

import { useState } from 'react';
import { useForm, useWatch, type DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { getCapacityInfo } from '@/lib/capacity';
import { useLessonTypes, useBookingSlots, useCreateBooking } from '@/hooks/use-bookings';
import { useRiders } from '@/hooks/use-riders';
import { useHorses } from '@/hooks/use-horses';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@equestrian/shared/utils';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import type { ApiSuccessResponse } from '@equestrian/shared/types';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';

// Audit F-6: convert from 8 separate `useState` calls to a single
// react-hook-form + Zod-validated form, matching the project's RHF
// convention used in every other create/edit dialog. Coupon discount
// + error stay as transient mutation-state because they're derived
// from a separate `/coupons/validate` call, not from the form's
// inputs. `lessonTypeId` and `date` are scaffolding fields that drive
// the slot-list query but never get submitted — they're part of the
// schema so RHF can watch them and reset the slot+coupon state when
// they change, without falling back to ad-hoc useState/setValue calls.
const PAYMENT_METHODS = [
  'cash',
  'card',
  'card_in_person',
  'bank_transfer',
  'package_credit',
] as const;

const formSchema = z
  .object({
    lessonTypeId: z.string().uuid('Pick a lesson type'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    slotId: z.string().uuid('Pick a slot'),
    riderMemberId: z.string().uuid('Pick a rider'),
    // `'__none__'` is the auto-match sentinel — translated to
    // `horseId: undefined` at submit. Keeps the Select component happy
    // (it can't bind to an empty string).
    horseId: z.string().min(1, 'Required'),
    paymentMethod: z.enum(PAYMENT_METHODS, {
      errorMap: () => ({ message: 'Pick a payment method' }),
    }),
    couponCode: z.string().max(50).optional(),
  })
  .strict();

type FormValues = z.infer<typeof formSchema>;

// Audit F-20 (2026-05-07 r4): allow caller to drive the dialog open state
// (e.g. from an EmptyState CTA). Falls back to internal state when no props
// are passed so existing call sites keep working.
interface AddBookingDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddBookingDialog(props: AddBookingDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (props.onOpenChange) props.onOpenChange(next);
    else setInternalOpen(next);
  };
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');
  const [couponValidating, setCouponValidating] = useState(false);

  // Audit F-56 (2026-05-07 r4): use RHF's `DefaultValues<T>` helper
  // instead of the prior `as Partial<FormValues> as FormValues` chain.
  // `DefaultValues<T>` intentionally allows partial defaults — the Zod
  // schema makes `paymentMethod` required, but we want the form to
  // start with no selection so the submit-time validation message
  // fires. One single cast, scoped to RHF's exact contract.
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lessonTypeId: '',
      date: '',
      slotId: '',
      riderMemberId: '',
      horseId: '__none__',
      couponCode: '',
    } as DefaultValues<FormValues>,
  });

  // Watch fields that drive cascading queries / state resets.
  const lessonTypeId = useWatch({ control: form.control, name: 'lessonTypeId' });
  const date = useWatch({ control: form.control, name: 'date' });
  const slotId = useWatch({ control: form.control, name: 'slotId' });
  const riderMemberId = useWatch({ control: form.control, name: 'riderMemberId' });
  const couponCode = useWatch({ control: form.control, name: 'couponCode' });

  const lessonTypesQuery = useLessonTypes();
  const slotsQuery = useBookingSlots({
    date: date || undefined,
    lessonTypeId: lessonTypeId || undefined,
  });
  const ridersQuery = useRiders({ page: 1, pageSize: MAX_PAGE_SIZE });
  const horsesQuery = useHorses({ page: 1, pageSize: MAX_PAGE_SIZE });
  const createBooking = useCreateBooking();

  const lessonTypes = lessonTypesQuery.data?.data ?? [];
  const slots = slotsQuery.data?.data ?? [];
  const riders = ridersQuery.data?.data ?? [];
  const horses = horsesQuery.data?.data ?? [];

  const selectedSlot = slots.find((s) => s.id === slotId);

  // Audit F-20: clearing coupon state any time the priced slot changes
  // (lesson type / date / slot id). Centralised here so every reset
  // path uses the same logic instead of ad-hoc inline calls scattered
  // through onValueChange handlers.
  function clearCouponState() {
    setCouponDiscount(0);
    setCouponError('');
    form.setValue('couponCode', '');
  }

  function reset() {
    form.reset();
    setCouponDiscount(0);
    setCouponError('');
    setCouponValidating(false);
  }

  async function applyCoupon() {
    if (!couponCode || !selectedSlot) return;
    setCouponError('');
    setCouponDiscount(0);
    setCouponValidating(true);
    try {
      const res = await fetchJson<
        ApiSuccessResponse<{ valid: boolean; discount: number; error?: string }>
      >('/api/v1/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode,
          slotId: selectedSlot.id,
          riderMemberId,
        }),
      });
      if (res.data.valid) {
        setCouponDiscount(res.data.discount);
        toast.success(
          `Discount applied: ${formatMoney(res.data.discount, selectedSlot.lessonTypeCurrency)}`,
        );
      } else {
        setCouponError(res.data.error ?? 'Invalid code');
      }
    } catch (err) {
      reportMutationError('coupon.validate', err, { code: couponCode, riderMemberId });
      setCouponError(err instanceof Error ? err.message : 'Failed to validate code');
    } finally {
      setCouponValidating(false);
    }
  }

  async function onSubmit(values: FormValues) {
    try {
      await createBooking.mutateAsync({
        slotId: values.slotId,
        riderMemberId: values.riderMemberId,
        horseId: values.horseId === '__none__' ? undefined : values.horseId,
        paymentMethod: values.paymentMethod,
        couponCode: values.couponCode || undefined,
        autoMatchHorse: values.horseId === '__none__',
      });
      toast.success('Booking created');
      reset();
      setOpen(false);
    } catch (error) {
      reportMutationError('booking.create', error, {
        slotId: values.slotId,
        riderMemberId: values.riderMemberId,
      });
      toast.error(error instanceof Error ? error.message : 'Failed to create booking');
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Booking
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        // Don't close the sheet when the admin clicks outside the panel —
        // wizard data is in flight and accidental dismissal loses progress.
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b">
          <SheetTitle>Create Manual Booking</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Step 1: Lesson Type */}
              <FormField
                control={form.control}
                name="lessonTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>1. Lesson Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue('slotId', '');
                        clearCouponState();
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select lesson type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {lessonTypes.map((lt) => (
                          <SelectItem key={lt.id} value={lt.id}>
                            {lt.name} — {formatMoney(lt.price, lt.currency)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Step 2: Date */}
              {lessonTypeId && (
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>2. Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e.target.value);
                            form.setValue('slotId', '');
                            clearCouponState();
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 3: Time Slot */}
              {date && (
                <FormField
                  control={form.control}
                  name="slotId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>3. Time Slot</FormLabel>
                      {slotsQuery.isLoading ? (
                        <Skeleton className="h-10" />
                      ) : slots.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          No slots available for this date and lesson type.
                        </p>
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={(v) => {
                            field.onChange(v);
                            clearCouponState();
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select time slot" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {slots.map((slot) => {
                              // Shared with calendar + rider/book — see audit E-6.
                              const cap = getCapacityInfo(slot.currentRiders, slot.maxRiders);
                              return (
                                <SelectItem key={slot.id} value={slot.id} disabled={cap.isFull}>
                                  {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)} (
                                  {slot.currentRiders}/{slot.maxRiders} riders)
                                  {slot.arenaName ? ` • ${slot.arenaName}` : ''}
                                  {cap.isFull ? ' — FULL' : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 4: Rider */}
              {slotId && (
                <FormField
                  control={form.control}
                  name="riderMemberId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>4. Rider</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select rider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {riders.map((r) => (
                            <SelectItem key={r.memberId} value={r.memberId}>
                              {r.displayName ?? r.email ?? 'Unnamed'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 5: Horse (optional) */}
              {riderMemberId && (
                <FormField
                  control={form.control}
                  name="horseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>5. Horse (optional, auto-matches if empty)</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Auto-match horse" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">Auto-match</SelectItem>
                          {horses
                            .filter((h) => h.status === 'available')
                            .map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 6: Payment Method */}
              {riderMemberId && (
                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>6. Payment Method</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select payment method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="card_in_person">Card (in person)</SelectItem>
                          <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                          <SelectItem value="package_credit">Package Credit</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Step 7: Promo Code */}
              {riderMemberId && selectedSlot && (
                <div>
                  <Label htmlFor="coupon-code">7. Promo Code (optional)</Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="coupon-code"
                      placeholder="e.g. SUMMER25"
                      className="font-mono uppercase"
                      {...form.register('couponCode', {
                        onChange: () => {
                          // Editing the code clears any previously-applied
                          // discount — user must re-click Apply.
                          setCouponDiscount(0);
                          setCouponError('');
                        },
                      })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!couponCode || couponValidating}
                      onClick={() => {
                        void applyCoupon();
                      }}
                    >
                      {couponValidating ? 'Applying…' : 'Apply'}
                    </Button>
                  </div>
                  {couponError && <p className="text-destructive mt-1 text-sm">{couponError}</p>}
                  {couponDiscount > 0 && (
                    <p className="mt-1 text-sm text-green-600">
                      Discount: −{formatMoney(couponDiscount, selectedSlot.lessonTypeCurrency)}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Sticky bottom: summary + submit. Stays visible while the field
                stack scrolls inside the sheet, mirroring the rider funnel's
                bottom-action language. */}
            <div className="bg-background space-y-3 border-t p-4">
              {selectedSlot && riderMemberId && (
                <div className="bg-muted/50 rounded-lg border p-3">
                  <p className="text-sm font-medium">Booking Summary</p>
                  <div className="text-muted-foreground mt-2 space-y-1 text-sm">
                    <p>{selectedSlot.lessonTypeName}</p>
                    <p>
                      {selectedSlot.date} at {selectedSlot.startTime.slice(0, 5)} –{' '}
                      {selectedSlot.endTime.slice(0, 5)}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className={couponDiscount > 0 ? 'line-through' : ''}>
                        {formatMoney(selectedSlot.lessonTypePrice, selectedSlot.lessonTypeCurrency)}
                      </p>
                      {couponDiscount > 0 && (
                        <p className="font-semibold text-green-600">
                          {formatMoney(
                            selectedSlot.lessonTypePrice - couponDiscount,
                            selectedSlot.lessonTypeCurrency,
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={
                  createBooking.isPending || couponValidating || form.formState.isSubmitting
                }
              >
                {createBooking.isPending ? 'Creating...' : 'Create Booking'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
