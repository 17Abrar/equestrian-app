import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { useMyBookings, type Booking } from '@/hooks/use-bookings';
import { BookingListSkeleton } from '@/components/skeletons';
import { useMemo, useState, useCallback } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(timeStr: string): string {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function _formatPrice(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-700' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  completed: { bg: 'bg-green-100', text: 'text-green-700' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700' },
  no_show: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

// ─── Booking Card ─────────────────────────────────────────────────────

function BookingCard({ booking, isNext }: { booking: Booking; isNext?: boolean }) {
  const colors = STATUS_COLORS[booking.status] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };

  return (
    <View
      className={`rounded-2xl border p-4 ${isNext ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}
    >
      {isNext && (
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600">
          Next Lesson
        </Text>
      )}
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900">{booking.lessonTypeName}</Text>
          <Text className="mt-1 text-sm text-gray-500">
            {formatDate(booking.slotDate)} at {formatTime(booking.slotStartTime)}
          </Text>
          {booking.arenaName && (
            <Text className="mt-0.5 text-sm text-gray-400">{booking.arenaName}</Text>
          )}
          {booking.horseName && (
            <Text className="mt-0.5 text-sm text-gray-400">Horse: {booking.horseName}</Text>
          )}
        </View>
        <View className={`rounded-full px-2.5 py-1 ${colors.bg}`}>
          <Text className={`text-xs font-medium ${colors.text}`}>
            {booking.status.replace('_', ' ')}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { data, isLoading, refetch } = useMyBookings();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // The API client wraps every response into `{ success, data } | { success, error }`
  // so react-query never sees a rejection — we must split success/error ourselves.
  const errorMessage = data && !data.success ? data.error.message : null;

  // Audit F-7 (2026-05-07 r5 PR Sigma): with `useMyBookings` now returning
  // `PaginatedApiResponse<Booking>`, narrowing on `data.success` already
  // gives us `data.data: Booking[]`. No re-cast needed.
  const bookings = useMemo<Booking[]>(() => {
    if (!data || !data.success) return [];
    return data.data;
  }, [data]);

  const upcomingBookings = useMemo(() => {
    // Audit pass-4 (2026-05-10): `Date.toISOString()` returns the UTC date,
    // so a 02:00 local-time render in Dubai (UTC+4) sees yesterday-UTC
    // and silently misclassifies yesterday-local bookings as "upcoming"
    // (and today-local as past). Same fix as `book.tsx:35-43`'s
    // `toDateString` from pass 1; this consumer was missed.
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;
    return bookings
      .filter((b) => (b.status === 'confirmed' || b.status === 'pending') && b.slotDate >= today)
      .sort((a, b) => {
        const dateCompare = a.slotDate.localeCompare(b.slotDate);
        if (dateCompare !== 0) return dateCompare;
        return a.slotStartTime.localeCompare(b.slotStartTime);
      });
  }, [bookings]);

  const nextBooking = upcomingBookings[0] ?? null;
  const firstName = user?.firstName ?? 'Rider';

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View className="px-6 pb-2 pt-4">
          <Text className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {firstName}
          </Text>
          <Text className="mt-1 text-base text-gray-500">
            {upcomingBookings.length > 0
              ? `You have ${upcomingBookings.length} upcoming lesson${upcomingBookings.length !== 1 ? 's' : ''}`
              : 'No upcoming lessons'}
          </Text>
        </View>

        {/* Quick Actions */}
        <View className="flex-row gap-3 px-6 py-4">
          <TouchableOpacity
            className="flex-1 items-center rounded-2xl bg-gray-900 py-4"
            onPress={() => router.push('/(tabs)/book')}
            activeOpacity={0.8}
          >
            <Text className="text-base font-semibold text-white">Book a Lesson</Text>
          </TouchableOpacity>
        </View>

        {/* Loading — audit F-31: BookingCard-shaped skeletons */}
        {isLoading && (
          <View className="pt-2">
            <BookingListSkeleton count={3} />
          </View>
        )}

        {/* Error */}
        {!isLoading && errorMessage && (
          <View className="mx-6 items-center rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
            <Text className="text-lg font-semibold text-red-700">Couldn&apos;t load bookings</Text>
            <Text className="mt-1 text-center text-sm text-red-500">{errorMessage}</Text>
            <TouchableOpacity
              className="mt-4 rounded-xl bg-red-600 px-6 py-2.5"
              onPress={() => refetch()}
              activeOpacity={0.8}
            >
              <Text className="font-semibold text-white">Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Next Lesson */}
        {!isLoading && !errorMessage && nextBooking && (
          <View className="px-6 pb-2">
            <BookingCard booking={nextBooking} isNext />
          </View>
        )}

        {/* Upcoming List */}
        {!isLoading && !errorMessage && upcomingBookings.length > 1 && (
          <View className="px-6 pt-4">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Upcoming
            </Text>
            <View className="gap-3">
              {upcomingBookings.slice(1).map((booking) => (
                <BookingCard key={booking.id} booking={booking} />
              ))}
            </View>
          </View>
        )}

        {/* Empty State */}
        {!isLoading && !errorMessage && upcomingBookings.length === 0 && (
          <View className="items-center px-6 py-12">
            <Text className="text-lg font-semibold text-gray-700">No upcoming lessons</Text>
            <Text className="mt-1 text-center text-sm text-gray-400">
              Book your first lesson to get started
            </Text>
            <TouchableOpacity
              className="mt-6 rounded-xl bg-gray-900 px-8 py-3"
              onPress={() => router.push('/(tabs)/book')}
              activeOpacity={0.8}
            >
              <Text className="font-semibold text-white">Browse Available Slots</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
