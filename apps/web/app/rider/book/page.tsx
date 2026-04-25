'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Check,
  Ticket,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBookingSlots, useCreateBooking, type BookingSlot } from '@/hooks/use-bookings';
import { formatMoney } from '@equestrian/shared/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';

// ─── Helpers ──────────────────────────────────────────────────────────

function getWeekDates(weekOffset: number): { start: Date; end: Date; dates: Date[] } {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7; // Convert Sunday from 0 to 7 (ISO weekday)
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek + 1 + weekOffset * 7); // Monday

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    dates.push(d);
  }

  return {
    start: dates[0]!,
    end: dates[6]!,
    dates,
  };
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timeStr: string): string {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatPrice(price: number, currency: string): string {
  return formatMoney(price, currency);
}

// ─── Slot Card ────────────────────────────────────────────────────────

interface SlotCardProps {
  slot: BookingSlot;
  isSelected: boolean;
  onSelect: () => void;
}

function SlotCard({ slot, isSelected, onSelect }: SlotCardProps) {
  const isFull = slot.currentRiders >= slot.maxRiders;
  const spotsLeft = slot.maxRiders - slot.currentRiders;

  return (
    <Card
      className={`cursor-pointer transition-all ${
        isSelected
          ? 'ring-2 ring-primary border-primary'
          : isFull
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:shadow-md hover:border-primary/50'
      }`}
      onClick={() => !isFull && onSelect()}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{slot.lessonTypeName}</p>
              <Badge
                variant="secondary"
                style={{ backgroundColor: slot.lessonTypeColor ? `${slot.lessonTypeColor}20` : undefined, color: slot.lessonTypeColor ?? undefined }}
              >
                {slot.lessonTypeType}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
              </span>
              {slot.arenaName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {slot.arenaName}
                </span>
              )}
              {slot.coachName && (
                <span className="text-xs">Coach: {slot.coachName}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span className="font-semibold">
              {formatPrice(slot.lessonTypePrice, slot.lessonTypeCurrency)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {isFull ? (
                <span className="text-destructive font-medium">Full</span>
              ) : (
                <span>{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</span>
              )}
            </span>
          </div>
        </div>

        {isSelected && (
          <div className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
            <Check className="h-3 w-3" />
            Selected
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function RiderBookPage() {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(toDateString(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');
  const [couponValidating, setCouponValidating] = useState(false);
  const [step, setStep] = useState<'browse' | 'confirm'>('browse');

  // Guest booking — booker signs up a non-member guest on the same slot.
  // A rider can book themselves once AND bring guests; each guest identified
  // uniquely by email per slot (DB partial unique index enforces it).
  const [bookingForGuest, setBookingForGuest] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestSkillLevel, setGuestSkillLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');

  const week = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const { data: user } = useCurrentUser();
  const memberId = user?.data?.memberId;

  const { data: slotsData, isLoading, isError, error, refetch } = useBookingSlots({
    dateFrom: toDateString(week.start),
    dateTo: toDateString(week.end),
  });

  const createBooking = useCreateBooking();

  const handleApplyCoupon = useCallback(async () => {
    if (!couponCode.trim() || !selectedSlot || !memberId) return;
    setCouponError('');
    setCouponDiscount(0);
    setCouponValidating(true);
    try {
      const res = await fetch('/api/v1/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode.trim(),
          amount: selectedSlot.lessonTypePrice,
          riderMemberId: memberId,
        }),
      });
      const json = await res.json() as { data?: { valid?: boolean; discount?: number; error?: string } };
      if (json.data?.valid && json.data.discount) {
        setCouponDiscount(json.data.discount);
        toast.success(`Discount applied: ${formatMoney(json.data.discount, selectedSlot.lessonTypeCurrency)}`);
      } else {
        setCouponError(json.data?.error ?? 'Invalid code');
      }
    } catch {
      setCouponError('Failed to validate code');
    } finally {
      setCouponValidating(false);
    }
  }, [couponCode, selectedSlot, memberId]);

  const slots = slotsData?.data ?? [];

  // Group slots by date, filter to selected date
  const slotsForDate = slots.filter((s) => s.date === selectedDate);

  function resetBookingState() {
    setStep('browse');
    setCouponCode('');
    setCouponDiscount(0);
    setCouponError('');
    setBookingForGuest(false);
    setGuestName('');
    setGuestEmail('');
    setGuestPhone('');
    setGuestSkillLevel('beginner');
  }

  function handleConfirmBooking() {
    if (!selectedSlot || !memberId) return;

    if (bookingForGuest) {
      if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
        toast.error('Please fill in the guest name, email, and phone.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) {
        toast.error('Please enter a valid guest email address.');
        return;
      }
    }

    const payload = {
      slotId: selectedSlot.id,
      riderMemberId: memberId,
      autoMatchHorse: !bookingForGuest, // Guest bookings skip auto-match
      ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
      ...(bookingForGuest
        ? {
            guest: {
              name: guestName.trim(),
              email: guestEmail.trim(),
              phone: guestPhone.trim(),
              skillLevel: guestSkillLevel,
            },
          }
        : {}),
    };

    createBooking.mutate(payload, {
      onSuccess: () => {
        toast.success(
          bookingForGuest
            ? `Guest booked — ${guestName.trim()} will receive lesson details.`
            : 'Booking confirmed! Check your email for details.',
        );
        resetBookingState();
        router.push('/rider');
      },
      onError: (err) => {
        toast.error(err.message || 'Failed to create booking. Please try again.');
      },
    });
  }

  // ─── Confirm Step ──────────────────────────────────────────────────

  if (step === 'confirm' && selectedSlot) {
    return (
      <div className="mx-auto max-w-lg space-y-6 pb-20 sm:pb-0">
        <Button variant="ghost" size="sm" onClick={resetBookingState}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to slots
        </Button>

        <h1 className="text-2xl font-bold">Confirm Booking</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{selectedSlot.lessonTypeName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {formatDate(new Date(`${selectedSlot.date}T00:00:00`))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
            </div>
            {selectedSlot.arenaName && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {selectedSlot.arenaName}
              </div>
            )}
            {selectedSlot.coachName && (
              <div className="text-sm">
                Coach: <span className="font-medium">{selectedSlot.coachName}</span>
              </div>
            )}
            <div className="border-t pt-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className={`text-lg font-semibold ${couponDiscount > 0 ? 'line-through text-muted-foreground text-base' : ''}`}>
                  {formatPrice(selectedSlot.lessonTypePrice, selectedSlot.lessonTypeCurrency)}
                </span>
              </div>
              {couponDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-green-600">After discount</span>
                  <span className="text-lg font-semibold text-green-600">
                    {formatPrice(selectedSlot.lessonTypePrice - couponDiscount, selectedSlot.lessonTypeCurrency)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Coupon code */}
        <div className="space-y-2">
          <label htmlFor="coupon" className="text-sm font-medium">
            Promo Code (optional)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="coupon"
                placeholder="Enter promo code"
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value);
                  setCouponDiscount(0);
                  setCouponError('');
                }}
                className="pl-9 font-mono uppercase"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!couponCode.trim() || couponValidating}
              onClick={handleApplyCoupon}
            >
              {couponValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </Button>
          </div>
          {couponError && <p className="text-sm text-destructive">{couponError}</p>}
          {couponDiscount > 0 && (
            <p className="text-sm text-green-600">
              Discount: −{formatMoney(couponDiscount, selectedSlot.lessonTypeCurrency)}
            </p>
          )}
        </div>

        {/* Guest booking — bring someone who isn't a club member */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="guest-toggle">Booking this for a guest?</Label>
              <p className="text-xs text-muted-foreground">
                Bring someone who isn&apos;t a member yet. We&apos;ll create the booking in
                their name. You can book yourself once AND bring guests on the same slot.
              </p>
            </div>
            <Switch
              id="guest-toggle"
              checked={bookingForGuest}
              onCheckedChange={setBookingForGuest}
            />
          </div>

          {bookingForGuest && (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="guest-name" className="text-xs">
                  Guest name *
                </Label>
                <Input
                  id="guest-name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="guest-email" className="text-xs">
                    Guest email *
                  </Label>
                  <Input
                    id="guest-email"
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="guest@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="guest-phone" className="text-xs">
                    Guest phone *
                  </Label>
                  <Input
                    id="guest-phone"
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+971 50 123 4567"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guest-skill" className="text-xs">
                  Guest skill level *
                </Label>
                <Select
                  value={guestSkillLevel}
                  onValueChange={(v) =>
                    setGuestSkillLevel(v as 'beginner' | 'intermediate' | 'advanced')
                  }
                >
                  <SelectTrigger id="guest-skill">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                A horse will be assigned manually by the stable after booking.
              </p>
            </div>
          )}
        </div>

        {/* Horse matching info for self-bookings */}
        {!bookingForGuest && (
          <p className="text-sm text-muted-foreground">
            A horse will be automatically matched to your skill level and preferences.
          </p>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleConfirmBooking}
          disabled={createBooking.isPending || !memberId}
        >
          {createBooking.isPending ? 'Booking...' : 'Confirm Booking'}
        </Button>
      </div>
    );
  }

  // ─── Browse Step ───────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to home">
          <Link href="/rider">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Book a Lesson</h1>
          <p className="text-muted-foreground">Choose a date and time slot</p>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setWeekOffset((w) => w - 1)}
          disabled={weekOffset <= 0}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {formatDate(week.start)} – {formatDate(week.end)}
        </span>
        <Button variant="outline" size="icon" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Date selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {week.dates.map((d) => {
          const dateStr = toDateString(d);
          const isToday = dateStr === toDateString(new Date());
          const isSelected = dateStr === selectedDate;
          const daySlots = slots.filter((s) => s.date === dateStr);
          const isPast = d < new Date(toDateString(new Date()) + 'T00:00:00');

          return (
            <button
              key={dateStr}
              onClick={() => {
                setSelectedDate(dateStr);
                setSelectedSlot(null);
              }}
              disabled={isPast}
              className={`flex min-w-[4.5rem] flex-col items-center rounded-xl border px-3 py-2 text-sm transition-colors ${
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isPast
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:border-primary/50'
              }`}
            >
              <span className="text-[10px] uppercase">
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span className="text-lg font-bold">{d.getDate()}</span>
              {daySlots.length > 0 && (
                <span className={`text-[10px] ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                  {daySlots.length} slot{daySlots.length !== 1 ? 's' : ''}
                </span>
              )}
              {isToday && !isSelected && (
                <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* Slots for selected date */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Available on {formatDate(new Date(`${selectedDate}T00:00:00`))}
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Skeleton className="mb-2 h-5 w-32" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : slotsForDate.length === 0 ? (
          <EmptyState
            title="No slots available"
            description="Try a different date or check back later."
          />
        ) : (
          <div className="space-y-3">
            {slotsForDate.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                isSelected={selectedSlot?.id === slot.id}
                onSelect={() => setSelectedSlot(slot)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Continue button */}
      {selectedSlot && (
        <div className="sticky bottom-20 sm:bottom-0 z-40 bg-background pt-4 pb-4 border-t -mx-4 px-4 sm:mx-0 sm:px-0 sm:border-0 sm:bg-transparent">
          <Button className="w-full" size="lg" onClick={() => setStep('confirm')}>
            Continue with {selectedSlot.lessonTypeName}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
