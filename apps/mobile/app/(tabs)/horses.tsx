import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useHorses, type Horse } from '@/hooks/use-horses';
import { HorseListSkeleton } from '@/components/skeletons';

// Map the `horse_status` enum to a display tone + label. Kept in sync with
// packages/db/src/schema/enums.ts `horseStatusEnum`.
const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  available: { bg: 'bg-green-100', text: 'text-green-800', label: 'Available' },
  resting: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Resting' },
  injured: { bg: 'bg-red-100', text: 'text-red-800', label: 'Injured' },
  retired: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Retired' },
  off_site: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Off-site' },
  sold: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Sold' },
};

export default function HorsesScreen() {
  const { data, isLoading, refetch } = useHorses();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // API client returns the discriminated union — split success/error for UI.
  const errorMessage = data && !data.success ? data.error.message : null;

  // Audit F-7 (2026-05-07 r5 PR Sigma): `useHorses` now returns
  // `PaginatedApiResponse<Horse>`. Narrowing on `data.success` is
  // sufficient — the cast to `Horse[]` is gone.
  const horses = useMemo<Horse[]>(() => {
    if (!data || !data.success) return [];
    return data.data;
  }, [data]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="px-6 pb-2 pt-4">
          <Text className="text-2xl font-bold text-gray-900">Horses</Text>
          <Text className="mt-1 text-base text-gray-500">
            {horses.length > 0 ? `${horses.length} in the stable` : 'Your stable roster'}
          </Text>
        </View>

        {/* Loading — audit F-31: HorseCard-shaped skeletons */}
        {isLoading && (
          <View className="pt-2">
            <HorseListSkeleton count={4} />
          </View>
        )}

        {!isLoading && errorMessage && (
          <View className="mx-6 items-center rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
            <Text className="text-lg font-semibold text-red-700">Couldn&apos;t load horses</Text>
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

        {!isLoading && !errorMessage && horses.length === 0 && (
          <View className="items-center px-6 py-12">
            <Ionicons name="paw-outline" size={40} color="#9ca3af" />
            <Text className="mt-3 text-lg font-semibold text-gray-700">No horses yet</Text>
            <Text className="mt-1 text-center text-sm text-gray-400">
              Once your stable adds horses, you&apos;ll see them listed here.
            </Text>
          </View>
        )}

        {!isLoading && !errorMessage && horses.length > 0 && (
          <View className="px-6 pt-2">
            <View className="gap-3">
              {horses.map((horse) => (
                <HorseCard key={horse.id} horse={horse} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Card ────────────────────────────────────────────────────────────

function HorseCard({ horse }: { horse: Horse }) {
  const statusStyle = STATUS_STYLE[horse.status] ?? {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: horse.status,
  };

  const subtitle = [horse.breed, horse.color].filter(Boolean).join(' · ');

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
      <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
        {horse.primaryPhotoUrl ? (
          <Image
            source={{ uri: horse.primaryPhotoUrl }}
            style={{ width: 64, height: 64 }}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <Ionicons name="paw" size={24} color="#9ca3af" />
        )}
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          {/* Audit F-4 (2026-05-08 r6 PR Alpha-2): list route's projection
              omits `barnName` (only the detail GET returns it). The previous
              mobile-local `Horse` type lied about the wire shape and the
              ternary on `horse.barnName` was permanently dead. */}
          <Text className="text-base font-semibold text-gray-900">{horse.name}</Text>
        </View>
        {subtitle.length > 0 && <Text className="mt-0.5 text-sm text-gray-500">{subtitle}</Text>}
        <View className="mt-1.5 flex-row items-center gap-2">
          <View className={`rounded-full px-2 py-0.5 ${statusStyle.bg}`}>
            <Text className={`text-[11px] font-medium ${statusStyle.text}`}>
              {statusStyle.label}
            </Text>
          </View>
          <View className="rounded-full bg-gray-100 px-2 py-0.5">
            <Text className="text-[11px] font-medium text-gray-700">{horse.skillLevel}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
