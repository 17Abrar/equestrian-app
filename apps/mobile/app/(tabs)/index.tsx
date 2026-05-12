import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { useMyBookings, type Booking } from '@/hooks/use-bookings';
import { BookingRow } from '@/components/bookings/booking-row';
import { BookingRowListSkeleton } from '@/components/skeletons';
import { useMemo, useState, useCallback } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function toDateString(d: Date): string {
  // Local-timezone date — `d.toISOString()` returns UTC, so a 02:00 local-time
  // render in Dubai (UTC+4) sees yesterday-UTC and silently misclassifies
  // yesterday-local bookings as "upcoming" (and today-local as past). Audit
  // pass-4 (2026-05-10) — same `toDateString` shape used in book.tsx.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

  // The api-client wraps every response into `{ success, data } | { success, error }`
  // so react-query never sees a rejection — split success/error ourselves.
  const errorMessage = data && !data.success ? data.error.message : null;

  // Audit F-7 (2026-05-07 r5 PR Sigma): with `useMyBookings` returning
  // `PaginatedApiResponse<Booking>`, narrowing on `data.success` already
  // gives us `data.data: Booking[]`. No re-cast needed.
  const bookings = useMemo<Booking[]>(() => {
    if (!data || !data.success) return [];
    return data.data;
  }, [data]);

  const upcomingBookings = useMemo(() => {
    const today = toDateString(new Date());
    return bookings
      .filter((b) => (b.status === 'confirmed' || b.status === 'pending') && b.slotDate >= today)
      .sort((a, b) => {
        const dateCompare = a.slotDate.localeCompare(b.slotDate);
        if (dateCompare !== 0) return dateCompare;
        return a.slotStartTime.localeCompare(b.slotStartTime);
      });
  }, [bookings]);

  const firstName = user?.firstName ?? 'Rider';

  function openBooking(bookingId: string) {
    router.push(`/booking/${bookingId}`);
  }

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

        {isLoading && (
          <View className="pt-2">
            <BookingRowListSkeleton count={3} />
          </View>
        )}

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

        {!isLoading && !errorMessage && upcomingBookings.length > 0 && (
          <View className="px-6 pt-2">
            <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Next up
            </Text>
            <View className="gap-3">
              {upcomingBookings.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  onPress={() => openBooking(booking.id)}
                />
              ))}
            </View>
          </View>
        )}

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
