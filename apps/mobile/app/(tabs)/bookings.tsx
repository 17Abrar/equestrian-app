import { useMemo, useState, useCallback } from 'react';
import { ScrollView, Text, View, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMyBookings, type Booking } from '@/hooks/use-bookings';
import { BookingRow } from '@/components/bookings/booking-row';
import { DayStrip } from '@/components/bookings/day-strip';
import { TabStrip } from '@/components/bookings/tab-strip';
import { Fab } from '@/components/bookings/fab';
import { BookingRowListSkeleton } from '@/components/skeletons';

type TabKey = 'upcoming' | 'recent' | 'agenda';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'recent', label: 'Recent' },
  { key: 'agenda', label: 'Agenda' },
];

function toDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentWeekDates(): string[] {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateString(d);
  });
}

function compareByDateAsc(a: Booking, b: Booking): number {
  const c = a.slotDate.localeCompare(b.slotDate);
  return c !== 0 ? c : a.slotStartTime.localeCompare(b.slotStartTime);
}

function compareByDateDesc(a: Booking, b: Booking): number {
  const c = b.slotDate.localeCompare(a.slotDate);
  return c !== 0 ? c : b.slotStartTime.localeCompare(a.slotStartTime);
}

export default function BookingsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('upcoming');
  const today = useMemo(() => toDateString(new Date()), []);
  const [agendaDate, setAgendaDate] = useState(today);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useMyBookings();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // The api-client wraps every response in `{ success, data } | { success, error }`;
  // we split here so the UI knows when to show the error block.
  const errorMessage = data && !data.success ? data.error.message : null;

  const allBookings = useMemo<Booking[]>(() => {
    if (!data || !data.success) return [];
    return data.data;
  }, [data]);

  const upcoming = useMemo(
    () =>
      allBookings
        .filter(
          (b) => (b.status === 'confirmed' || b.status === 'pending') && b.slotDate >= today,
        )
        .sort(compareByDateAsc),
    [allBookings, today],
  );

  const recent = useMemo(
    () =>
      allBookings
        .filter(
          (b) =>
            b.status === 'completed' ||
            b.status === 'cancelled' ||
            b.status === 'no_show' ||
            b.slotDate < today,
        )
        .sort(compareByDateDesc),
    [allBookings, today],
  );

  const weekDates = useMemo(() => getCurrentWeekDates(), []);

  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of allBookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      counts[b.slotDate] = (counts[b.slotDate] ?? 0) + 1;
    }
    return counts;
  }, [allBookings]);

  const agendaItems = useMemo(
    () => allBookings.filter((b) => b.slotDate === agendaDate).sort(compareByDateAsc),
    [allBookings, agendaDate],
  );

  function openBooking(bookingId: string) {
    router.push(`/booking/${bookingId}`);
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="px-6 pb-2 pt-4">
        <Text className="text-2xl font-bold text-gray-900">My Bookings</Text>
        <Text className="mt-1 text-base text-gray-500">
          Your lessons across this stable
        </Text>
      </View>

      <View className="px-6 pt-2">
        <TabStrip tabs={TABS} active={tab} onChange={setTab} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isLoading && <BookingRowListSkeleton count={4} />}

        {!isLoading && errorMessage && (
          <View className="mx-6 items-center rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
            <Text className="text-lg font-semibold text-red-700">
              Couldn&apos;t load bookings
            </Text>
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

        {!isLoading && !errorMessage && tab === 'upcoming' && (
          upcoming.length === 0 ? (
            <EmptyTab
              title="No upcoming lessons"
              description="Tap + to book your next ride."
            />
          ) : (
            <View className="gap-3 px-6">
              {upcoming.map((b) => (
                <BookingRow key={b.id} booking={b} onPress={() => openBooking(b.id)} />
              ))}
            </View>
          )
        )}

        {!isLoading && !errorMessage && tab === 'recent' && (
          recent.length === 0 ? (
            <EmptyTab
              title="Nothing in your history yet"
              description="Past lessons will appear here once you've ridden."
            />
          ) : (
            <View className="gap-3 px-6">
              {recent.map((b) => (
                <BookingRow key={b.id} booking={b} onPress={() => openBooking(b.id)} />
              ))}
            </View>
          )
        )}

        {!isLoading && !errorMessage && tab === 'agenda' && (
          <View>
            <View className="px-6 pb-2">
              <Text className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {new Date(`${agendaDate}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </View>
            <DayStrip
              dates={weekDates}
              selected={agendaDate}
              onSelect={setAgendaDate}
              counts={slotCounts}
            />
            {agendaItems.length === 0 ? (
              <EmptyTab
                title="Nothing scheduled"
                description={new Date(`${agendaDate}T00:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                }) + " — you're free this day."}
              />
            ) : (
              <View className="mt-2 gap-3 px-6">
                {agendaItems.map((b) => (
                  <BookingRow key={b.id} booking={b} onPress={() => openBooking(b.id)} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Fab
        onPress={() => router.push('/(tabs)/book')}
        accessibilityLabel="Book a lesson"
      />
    </SafeAreaView>
  );
}

function EmptyTab({ title, description }: { title: string; description: string }) {
  return (
    <View className="mx-6 items-center rounded-2xl border border-gray-200 bg-white px-6 py-12">
      <Text className="text-lg font-semibold text-gray-700">{title}</Text>
      <Text className="mt-1 text-center text-sm text-gray-400">{description}</Text>
    </View>
  );
}
