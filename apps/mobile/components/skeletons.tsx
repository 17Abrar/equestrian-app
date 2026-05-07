import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * Audit F-31 (2026-05-07 r5 PR Sigma): mobile skeletons replacing the bare
 * `<ActivityIndicator size="large" color="#374151" />` loading state on the
 * three data-fetching tab screens (home/horses/book). The shape mirrors the
 * BookingCard / HorseCard / SlotCard layout so content doesn't jump in
 * beneath the heading when the query resolves.
 *
 * Shimmer animation uses `react-native-reanimated` (already a dep). The
 * shimmer is opacity-pulsed (0.4 → 1 → 0.4) rather than a translated gradient
 * — the latter requires a linear-gradient package we don't ship. This stays
 * dependency-free and renders identically on iOS / Android.
 */

interface ShimmerBoxProps {
  className: string;
  style?: object;
}

export function ShimmerBox({ className, style }: ShimmerBoxProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View className={className} style={[animatedStyle, style]} />;
}

/**
 * Skeleton matching the `BookingCard` shape in `apps/mobile/app/(tabs)/index.tsx`:
 * a rounded card with a title line, subtitle line, secondary line, and a
 * status pill on the right.
 */
export function BookingCardSkeleton() {
  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 gap-2">
          <ShimmerBox className="h-4 w-3/4 rounded bg-gray-200" />
          <ShimmerBox className="h-3 w-1/2 rounded bg-gray-200" />
          <ShimmerBox className="h-3 w-2/5 rounded bg-gray-200" />
        </View>
        <ShimmerBox className="h-6 w-20 rounded-full bg-gray-200" />
      </View>
    </View>
  );
}

export function BookingListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View className="gap-3 px-6">
      {Array.from({ length: count }).map((_, i) => (
        <BookingCardSkeleton key={i} />
      ))}
    </View>
  );
}

/**
 * Skeleton matching the `HorseCard` shape in `apps/mobile/app/(tabs)/horses.tsx`:
 * a rounded card with a 64x64 photo placeholder, two text lines, and two
 * status pills.
 */
export function HorseCardSkeleton() {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
      <ShimmerBox className="h-16 w-16 rounded-xl bg-gray-200" />
      <View className="flex-1 gap-2">
        <ShimmerBox className="h-4 w-2/3 rounded bg-gray-200" />
        <ShimmerBox className="h-3 w-1/2 rounded bg-gray-200" />
        <View className="flex-row gap-2">
          <ShimmerBox className="h-5 w-16 rounded-full bg-gray-200" />
          <ShimmerBox className="h-5 w-20 rounded-full bg-gray-200" />
        </View>
      </View>
    </View>
  );
}

export function HorseListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-3 px-6">
      {Array.from({ length: count }).map((_, i) => (
        <HorseCardSkeleton key={i} />
      ))}
    </View>
  );
}

/**
 * Skeleton matching the `SlotCard` shape in `apps/mobile/app/(tabs)/book.tsx`:
 * a rounded card with a title, subtitle, secondary line, and a price
 * column on the right.
 */
export function SlotCardSkeleton() {
  return (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 gap-2">
          <ShimmerBox className="h-4 w-2/3 rounded bg-gray-200" />
          <ShimmerBox className="h-3 w-1/2 rounded bg-gray-200" />
          <ShimmerBox className="h-3 w-1/3 rounded bg-gray-200" />
        </View>
        <View className="items-end gap-2">
          <ShimmerBox className="h-4 w-16 rounded bg-gray-200" />
          <ShimmerBox className="h-3 w-20 rounded bg-gray-200" />
        </View>
      </View>
    </View>
  );
}

export function SlotListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SlotCardSkeleton key={i} />
      ))}
    </View>
  );
}
