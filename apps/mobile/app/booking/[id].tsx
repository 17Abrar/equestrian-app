import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useBooking, useCancelBooking } from '@/hooks/use-bookings';
import { usePayBooking } from '@/hooks/use-booking-payment';
import { StatusIcon } from '@/components/bookings/status-icon';
import { BookingDetailSkeleton } from '@/components/skeletons';

const OFFLINE_METHODS = new Set(['cash', 'card_in_person', 'bank_transfer', 'package_credit']);

function formatTime(timeStr: string): string {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatLongDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatPrice(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

export default function BookingDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const bookingId = typeof params.id === 'string' ? params.id : null;
  const returningFromPayment = params.from === 'payment';

  const query = useBooking(bookingId);
  const booking = query.data?.success ? query.data.data : null;
  const errorMessage = query.data && !query.data.success ? query.data.error.message : null;

  // Mirror web's polling pattern (apps/web/.../[bookingId]/page.tsx:50-74) —
  // start time stored in a ref so the 2-minute ceiling holds across renders;
  // depend on `query.refetch` (stable identity), not `query` itself.
  //
  // Audit 2026-05-13 (P1): when the 2-minute ceiling fires the ref was never
  // reset to null, so any subsequent re-render that re-ran the effect saw a
  // non-null ref + elapsed > 120s and instantly cleared the new interval —
  // polling was permanently disabled for that mount. Reset to null on
  // ceiling, and surface a `manualPollTrigger` state that the rider can flip
  // by tapping "Check again" once the auto-poll gives up. A manual flip
  // increments a token consumed by the effect so we resume polling.
  const shouldPoll =
    !!booking &&
    booking.paymentStatus === 'pending' &&
    !OFFLINE_METHODS.has(booking.paymentMethod ?? '');
  const pollStartedAtRef = useRef<number | null>(null);
  const [manualPollToken, setManualPollToken] = useState(0);
  const [pollCeilingReached, setPollCeilingReached] = useState(false);
  const refetch = query.refetch;
  useEffect(() => {
    if (!shouldPoll) {
      pollStartedAtRef.current = null;
      setPollCeilingReached(false);
      return;
    }
    if (pollStartedAtRef.current == null) {
      pollStartedAtRef.current = Date.now();
      setPollCeilingReached(false);
    }
    const interval = setInterval(() => {
      const startedAt = pollStartedAtRef.current;
      if (startedAt != null && Date.now() - startedAt > 120_000) {
        clearInterval(interval);
        pollStartedAtRef.current = null;
        setPollCeilingReached(true);
        return;
      }
      void refetch();
    }, 3000);
    return () => clearInterval(interval);
    // `manualPollToken` is included so the rider's "Check again" tap
    // re-arms the effect from a clean state.
  }, [shouldPoll, refetch, manualPollToken]);

  const { pay, isPaying } = usePayBooking();
  const cancelBooking = useCancelBooking();

  const handlePay = useCallback(async () => {
    if (!booking) return;
    const result = await pay(booking.id);
    if (result.ok) {
      Toast.show({ type: 'success', text1: 'Payment received' });
      void refetch();
      return;
    }
    // 2026-05-16: distinguish "rider hit Cancel on the PayPage" from a real
    // failure. Mirrors the web banner copy. The hook detects this via the
    // `payment=cancelled` flag N-Genius now echoes back on `cancelUrl`.
    if (result.cancelled) {
      Toast.show({
        type: 'info',
        text1: 'Payment cancelled',
        text2: 'Your slot is still reserved — tap Pay now to try again.',
      });
      void refetch();
      return;
    }
    if (!result.dismissed) {
      Alert.alert('Payment Failed', result.errorMessage ?? "We couldn't start the payment flow.");
    }
  }, [booking, pay, refetch]);

  const handleCancel = useCallback(() => {
    if (!booking) return;
    const runCancel = async () => {
      const res = await cancelBooking.mutateAsync({
        bookingId: booking.id,
        reason: 'Cancelled by rider',
      });
      if (!res.success) {
        Alert.alert('Could not cancel', res.error.message);
        return;
      }
      Toast.show({ type: 'success', text1: 'Booking cancelled' });
      router.back();
    };
    Alert.alert(
      'Cancel booking?',
      'You will lose this lesson slot. Late-cancellation fees may apply.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: () => {
            void runCancel();
          },
        },
      ],
    );
  }, [booking, cancelBooking, router]);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <Header onBack={() => router.back()} />
        <BookingDetailSkeleton />
      </SafeAreaView>
    );
  }

  if (errorMessage || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <Header onBack={() => router.back()} />
        <View className="mx-6 mt-12 items-center rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
          <Text className="text-lg font-semibold text-red-700">
            {errorMessage ? "Couldn't load booking" : 'Booking not found'}
          </Text>
          {errorMessage && (
            <Text className="mt-1 text-center text-sm text-red-500">{errorMessage}</Text>
          )}
          <TouchableOpacity
            className="mt-4 rounded-xl bg-red-600 px-6 py-2.5"
            onPress={() => query.refetch()}
            activeOpacity={0.8}
          >
            <Text className="font-semibold text-white">Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const showPayButton =
    booking.paymentStatus === 'pending' && !OFFLINE_METHODS.has(booking.paymentMethod ?? '');
  const canCancel = booking.status === 'confirmed' || booking.status === 'pending';

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <Header onBack={() => router.back()} status={booking.status} />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="px-6 pt-2">
          <Text className="text-2xl font-bold text-gray-900">{booking.lessonTypeName}</Text>
          <Text className="mt-1 font-mono text-xs text-gray-400">{booking.id.slice(0, 8)}</Text>
        </View>

        <View className="mt-4 px-6">
          <PaymentBanner
            paymentStatus={booking.paymentStatus}
            paymentMethod={booking.paymentMethod}
            bookingStatus={booking.status}
            isPolling={shouldPoll}
            returningFromPayment={returningFromPayment}
          />
          {/*
            Audit 2026-05-13 (P1): once the 2-min auto-poll gives up, the
            rider needs a way to re-trigger the status check manually. Show
            a "Check again" button only when the ceiling has been hit AND
            the payment is still pending.
          */}
          {pollCeilingReached && shouldPoll && (
            <Pressable
              onPress={() => {
                setManualPollToken((n) => n + 1);
                void refetch();
              }}
              accessibilityRole="button"
              className="mt-3 items-center rounded-xl border border-gray-200 py-3"
            >
              <Text className="text-sm font-medium text-gray-700">
                Still waiting for payment? Check again
              </Text>
            </Pressable>
          )}
        </View>

        <View className="mx-6 mt-4 gap-3 rounded-2xl border border-gray-200 bg-white p-5">
          <DetailRow icon="calendar-outline" text={formatLongDate(booking.slotDate)} />
          <DetailRow
            icon="time-outline"
            text={`${formatTime(booking.slotStartTime)} – ${formatTime(booking.slotEndTime)}`}
          />
          {booking.arenaName && <DetailRow icon="location-outline" text={booking.arenaName} />}
          {booking.horseName && (
            <DetailRow icon="paw-outline" text={`Horse: ${booking.horseName}`} />
          )}
          <View className="mt-1 flex-row items-center justify-between border-t border-gray-100 pt-3">
            <Text className="text-sm text-gray-500">Amount</Text>
            <Text className="text-lg font-bold text-gray-900">
              {booking.amount != null
                ? formatPrice(booking.amount, booking.currency)
                : formatPrice(booking.lessonTypePrice, booking.lessonTypeCurrency)}
            </Text>
          </View>
        </View>
      </ScrollView>

      {(showPayButton || canCancel) && (
        <View className="absolute bottom-0 left-0 right-0 gap-2 border-t border-gray-200 bg-white px-6 pb-10 pt-4">
          {showPayButton && (
            <TouchableOpacity
              onPress={handlePay}
              disabled={isPaying}
              activeOpacity={0.85}
              className={`rounded-2xl py-4 ${isPaying ? 'bg-gray-400' : 'bg-gray-900'}`}
            >
              <Text className="text-center text-base font-semibold text-white">
                {isPaying ? 'Opening payment…' : 'Pay now'}
              </Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <Pressable
              onPress={handleCancel}
              disabled={cancelBooking.isPending}
              accessibilityRole="button"
              className="items-center rounded-2xl border border-gray-200 py-4"
            >
              <Text className="text-base font-medium text-red-600">
                {cancelBooking.isPending ? 'Cancelling…' : 'Cancel booking'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function Header({
  onBack,
  status,
}: {
  onBack: () => void;
  status?: 'confirmed' | 'pending' | 'completed' | 'cancelled' | 'no_show';
}) {
  return (
    <View className="flex-row items-center justify-between px-6 py-3">
      <TouchableOpacity onPress={onBack} accessibilityLabel="Back" hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color="#171717" />
      </TouchableOpacity>
      {status && (
        <View className="flex-row items-center gap-1.5">
          <StatusIcon status={status} size={18} />
          <Text className="text-xs font-medium capitalize text-gray-500">
            {status.replace('_', ' ')}
          </Text>
        </View>
      )}
    </View>
  );
}

function DetailRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={16} color="#9ca3af" />
      <Text className="text-sm text-gray-700">{text}</Text>
    </View>
  );
}

interface PaymentBannerProps {
  paymentStatus: 'pending' | 'paid' | 'partial' | 'refunded' | 'failed' | 'overdue';
  paymentMethod: string | null;
  bookingStatus: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  isPolling: boolean;
  returningFromPayment: boolean;
}

function PaymentBanner({
  paymentStatus,
  paymentMethod,
  bookingStatus,
  isPolling,
  returningFromPayment,
}: PaymentBannerProps) {
  const banner = useMemo(() => {
    if (bookingStatus === 'cancelled') {
      return {
        tone: 'muted' as const,
        title: 'Booking cancelled',
        body: 'This booking has been cancelled. Contact your stable if you think this is wrong.',
      };
    }
    if (paymentStatus === 'paid') {
      return {
        tone: 'success' as const,
        title: 'Payment received',
        body: "You're all set. See you at the stable.",
      };
    }
    if (paymentStatus === 'refunded') {
      return {
        tone: 'muted' as const,
        title: 'Payment refunded',
        body: 'Your payment for this booking was refunded.',
      };
    }
    if (paymentStatus === 'partial') {
      return {
        tone: 'muted' as const,
        title: 'Partial refund issued',
        body: 'Part of your payment was refunded. Contact your stable for details.',
      };
    }
    if (paymentStatus === 'failed') {
      return {
        tone: 'error' as const,
        title: 'Payment failed',
        body: "The last payment attempt didn't go through. Try again from the bottom of the screen.",
      };
    }
    if (paymentStatus === 'overdue') {
      return {
        tone: 'error' as const,
        title: 'Payment overdue',
        body: 'This booking is past its payment deadline. Pay now to keep your slot.',
      };
    }
    if (OFFLINE_METHODS.has(paymentMethod ?? '')) {
      return {
        tone: 'muted' as const,
        title: 'Pay at the stable',
        body: "You'll settle up on arrival. See you there.",
      };
    }
    if (returningFromPayment) {
      return {
        tone: 'info' as const,
        title: 'Confirming your payment…',
        body: "We're waiting for the processor to confirm. This page will update automatically.",
      };
    }
    return {
      tone: 'warn' as const,
      title: 'Payment needed',
      body: isPolling
        ? 'Your booking is reserved. Checking payment status…'
        : 'Your booking is reserved. Tap "Pay now" below to confirm.',
    };
  }, [bookingStatus, paymentStatus, paymentMethod, isPolling, returningFromPayment]);

  const toneClass = {
    success: 'border-emerald-200 bg-emerald-50',
    warn: 'border-amber-200 bg-amber-50',
    error: 'border-red-200 bg-red-50',
    info: 'border-blue-200 bg-blue-50',
    muted: 'border-gray-200 bg-gray-50',
  }[banner.tone];

  const titleClass = {
    success: 'text-emerald-800',
    warn: 'text-amber-800',
    error: 'text-red-800',
    info: 'text-blue-800',
    muted: 'text-gray-800',
  }[banner.tone];

  return (
    <View className={`rounded-2xl border p-4 ${toneClass}`}>
      <Text className={`text-sm font-semibold ${titleClass}`}>{banner.title}</Text>
      <Text className="mt-1 text-sm text-gray-700">{banner.body}</Text>
    </View>
  );
}
