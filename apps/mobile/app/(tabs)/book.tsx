import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useBookingSlots, useCreateBooking, useMe, type BookingSlot } from '@/hooks/use-bookings';
import { usePayBooking } from '@/hooks/use-booking-payment';
import { SlotListSkeleton } from '@/components/skeletons';

// ─── Helpers ──────────────────────────────────────────────────────────

function getWeekDates(weekOffset: number): { dates: Date[] } {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek + 1 + weekOffset * 7);

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    dates.push(d);
  }
  return { dates };
}

function toDateString(d: Date): string {
  // Local-timezone date — `d.toISOString()` returns UTC, so an early-
  // morning render in Dubai / Riyadh / KL sees yesterday's date as
  // "today" and greys out the legitimate day on the picker.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  return `${(price / 100).toFixed(2)} ${currency}`;
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
    <TouchableOpacity
      className={`rounded-2xl border p-4 ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : isFull
            ? 'border-gray-200 bg-gray-100 opacity-50'
            : 'border-gray-200 bg-white'
      }`}
      onPress={onSelect}
      disabled={isFull}
      activeOpacity={0.7}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900">
            {slot.lessonTypeName}
          </Text>
          <Text className="mt-1 text-sm text-gray-500">
            {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
          </Text>
          {slot.arenaName && (
            <Text className="mt-0.5 text-xs text-gray-400">{slot.arenaName}</Text>
          )}
          {slot.coachName && (
            <Text className="mt-0.5 text-xs text-gray-400">Coach: {slot.coachName}</Text>
          )}
        </View>
        <View className="items-end">
          <Text className="text-base font-semibold text-gray-900">
            {formatPrice(slot.lessonTypePrice, slot.lessonTypeCurrency)}
          </Text>
          <Text className={`mt-1 text-xs ${isFull ? 'font-medium text-red-500' : 'text-gray-400'}`}>
            {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
          </Text>
        </View>
      </View>
      {isSelected && (
        <View className="mt-2 rounded-full bg-blue-500 px-3 py-1 self-start">
          <Text className="text-xs font-medium text-white">Selected</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────

export default function BookScreen() {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(toDateString(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [step, setStep] = useState<'browse' | 'confirm'>('browse');

  const week = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const dateFrom = toDateString(week.dates[0]!);
  const dateTo = toDateString(week.dates[6]!);

  const { data: meData } = useMe();
  // Audit F-7 (2026-05-07 r5 PR Sigma): `useMe` is now typed
  // `ApiResponse<MeData>`, so `meData.data.memberId` is well-typed.
  const memberId = meData?.success ? meData.data.memberId : null;

  // Audit F-16 (2026-05-08 r6): destructure error/refetch so the booking
  // tab matches the home/horses screens — a network failure on this
  // critical-flow tab now surfaces as an explicit error + retry button
  // instead of "No slots available / Try a different date" prose.
  const {
    data: slotsData,
    isLoading,
    refetch: refetchSlots,
  } = useBookingSlots({ dateFrom, dateTo });
  const slotsErrorMessage =
    slotsData && !slotsData.success ? slotsData.error.message : null;
  const createBooking = useCreateBooking();
  const { pay, isPaying } = usePayBooking();

  // /api/v1/booking-slots is non-paginated; `slotsData.data` is already
  // typed as `BookingSlot[]` after narrowing.
  const slots: BookingSlot[] = useMemo(() => {
    if (!slotsData?.success) return [];
    return slotsData.data;
  }, [slotsData]);

  const slotsForDate = slots.filter((s) => s.date === selectedDate);

  const handleConfirmBooking = useCallback(async () => {
    if (!selectedSlot || !memberId) return;

    const result = await createBooking.mutateAsync({
      slotId: selectedSlot.id,
      riderMemberId: memberId,
      autoMatchHorse: true,
    });

    if (!result.success) {
      // Audit F-7 (2026-05-07 r5 PR Sigma): `result` is the discriminated
      // `ApiResponse<Booking>`; the error branch is fully typed so the
      // previous `as { error?: { message?: string } }` cast is gone.
      Alert.alert('Booking Failed', result.error.message);
      return;
    }

    const booking = result.data;

    // Audit F-55 (2026-05-08 Sigma-bis): success and warning paths use
    // non-blocking toasts. Terminal failures stay as `Alert.alert` so
    // the user has to dismiss them. The router.push runs immediately —
    // the toast surfaces on the destination screen rather than gating
    // navigation behind a tap.

    // Offline payment methods (cash, package credit, etc.) don't need the
    // hosted-checkout roundtrip — server returns `paid` or leaves it as
    // `pending` with a non-online method, either way we're done here.
    if (booking.paymentStatus === 'paid') {
      Toast.show({
        type: 'success',
        text1: 'Booking confirmed',
        text2: 'Your lesson has been booked.',
      });
      router.push('/(tabs)');
      return;
    }

    // Kick the rider through the hosted payment page. We don't block on the
    // webhook here — it'll land while the user is looking at their bookings
    // list, and the list auto-refreshes via the queryClient invalidation.
    const payResult = await pay(booking.id);

    if (payResult.ok) {
      Toast.show({
        type: 'success',
        text1: 'Booking confirmed',
        text2: "Thanks! We'll confirm the payment in a moment.",
      });
      router.push('/(tabs)');
    } else if (payResult.dismissed) {
      Toast.show({
        type: 'info',
        text1: 'Payment incomplete',
        text2: 'Your booking is reserved. Finish payment from the Home tab.',
        visibilityTime: 6000,
      });
      router.push('/(tabs)');
    } else {
      Alert.alert(
        'Payment Failed',
        payResult.errorMessage ?? "We couldn't start the payment flow. Try again from Home.",
      );
    }
  }, [selectedSlot, memberId, createBooking, pay, router]);

  // ─── Confirm Step ──────────────────────────────────────────────────

  if (step === 'confirm' && selectedSlot) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 120 }}>
          <TouchableOpacity onPress={() => setStep('browse')}>
            <Text className="text-base font-medium text-blue-600">← Back to slots</Text>
          </TouchableOpacity>

          <Text className="mt-6 text-2xl font-bold text-gray-900">Confirm Booking</Text>

          <View className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
            <Text className="text-lg font-semibold text-gray-900">
              {selectedSlot.lessonTypeName}
            </Text>
            <View className="mt-3 gap-2">
              <Text className="text-sm text-gray-500">
                📅  {new Date(`${selectedSlot.date}T00:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              <Text className="text-sm text-gray-500">
                🕐  {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
              </Text>
              {selectedSlot.arenaName && (
                <Text className="text-sm text-gray-500">📍  {selectedSlot.arenaName}</Text>
              )}
              {selectedSlot.coachName && (
                <Text className="text-sm text-gray-500">👤  Coach: {selectedSlot.coachName}</Text>
              )}
            </View>
            <View className="mt-4 border-t border-gray-100 pt-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-gray-500">Price</Text>
                <Text className="text-xl font-bold text-gray-900">
                  {formatPrice(selectedSlot.lessonTypePrice, selectedSlot.lessonTypeCurrency)}
                </Text>
              </View>
            </View>
          </View>

          <Text className="mt-4 text-center text-sm text-gray-400">
            A horse will be automatically matched to your skill level.
          </Text>
        </ScrollView>

        {/* Bottom action */}
        <View className="absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white px-6 pb-10 pt-4">
          <TouchableOpacity
            className={`rounded-2xl py-4 ${createBooking.isPending || isPaying ? 'bg-gray-400' : 'bg-gray-900'}`}
            onPress={handleConfirmBooking}
            disabled={createBooking.isPending || isPaying || !memberId}
            activeOpacity={0.8}
          >
            {createBooking.isPending || isPaying ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-center text-base font-semibold text-white">
                Confirm &amp; Pay
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Browse Step ───────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Header */}
        <View className="px-6 pt-4 pb-2">
          <Text className="text-2xl font-bold text-gray-900">Book a Lesson</Text>
          <Text className="mt-1 text-base text-gray-500">Choose a date and time</Text>
        </View>

        {/* Week navigation */}
        <View className="flex-row items-center justify-between px-6 py-3">
          <TouchableOpacity
            onPress={() => setWeekOffset((w) => w - 1)}
            disabled={weekOffset <= 0}
            className={weekOffset <= 0 ? 'opacity-30' : ''}
          >
            <Text className="text-2xl text-gray-600">‹</Text>
          </TouchableOpacity>
          <Text className="text-sm font-medium text-gray-600">
            {week.dates[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' – '}
            {week.dates[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
          <TouchableOpacity onPress={() => setWeekOffset((w) => w + 1)}>
            <Text className="text-2xl text-gray-600">›</Text>
          </TouchableOpacity>
        </View>

        {/* Date selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}
          className="py-2"
        >
          {week.dates.map((d) => {
            const dateStr = toDateString(d);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === toDateString(new Date());
            const isPast = d < new Date(toDateString(new Date()) + 'T00:00:00');
            const daySlots = slots.filter((s) => s.date === dateStr);

            return (
              <TouchableOpacity
                key={dateStr}
                onPress={() => {
                  setSelectedDate(dateStr);
                  setSelectedSlot(null);
                }}
                disabled={isPast}
                className={`items-center rounded-2xl border px-4 py-2.5 ${
                  isSelected
                    ? 'border-gray-900 bg-gray-900'
                    : isPast
                      ? 'border-gray-100 opacity-40'
                      : 'border-gray-200 bg-white'
                }`}
                style={{ minWidth: 64 }}
              >
                <Text className={`text-[10px] uppercase ${isSelected ? 'text-gray-400' : 'text-gray-400'}`}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </Text>
                <Text className={`text-lg font-bold ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                  {d.getDate()}
                </Text>
                {daySlots.length > 0 && (
                  <Text className={`text-[10px] ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                    {daySlots.length} slot{daySlots.length !== 1 ? 's' : ''}
                  </Text>
                )}
                {isToday && !isSelected && (
                  <View className="mt-0.5 h-1 w-1 rounded-full bg-blue-500" />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Slots */}
        <View className="px-6 pt-4">
          <Text className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Available on{' '}
            {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </Text>

          {/* Loading — audit F-31: SlotCard-shaped skeletons */}
          {isLoading && <SlotListSkeleton count={4} />}

          {/* Audit F-16 (2026-05-08 r6): explicit error state with retry,
              mirrors the home/horses tabs. Cellular connectivity on
              mobile is flakier than web — converts "the app's broken"
              support tickets into self-service recoveries. */}
          {!isLoading && slotsErrorMessage && (
            <View className="items-center gap-3 py-8">
              <Text className="text-base text-rose-500">Couldn't load slots</Text>
              <Text className="text-center text-sm text-gray-400">
                {slotsErrorMessage}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void refetchSlots();
                }}
                className="rounded-lg bg-gray-900 px-4 py-2"
              >
                <Text className="text-sm font-semibold text-white">Try again</Text>
              </Pressable>
            </View>
          )}

          {!isLoading && !slotsErrorMessage && slotsForDate.length === 0 && (
            <View className="items-center py-8">
              <Text className="text-base text-gray-400">No slots available</Text>
              <Text className="mt-1 text-sm text-gray-300">Try a different date</Text>
            </View>
          )}

          {!isLoading && slotsForDate.length > 0 && (
            <View className="gap-3">
              {slotsForDate.map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  isSelected={selectedSlot?.id === slot.id}
                  onSelect={() => setSelectedSlot(slot)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom action */}
      {selectedSlot && (
        <View className="absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-white px-6 pb-10 pt-4">
          <TouchableOpacity
            className="rounded-2xl bg-gray-900 py-4"
            onPress={() => setStep('confirm')}
            activeOpacity={0.8}
          >
            <Text className="text-center text-base font-semibold text-white">
              Continue with {selectedSlot.lessonTypeName}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
