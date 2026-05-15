import { useEffect, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface TabStripProps<T extends string> {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}

interface TabLayout {
  x: number;
  width: number;
}

export function TabStrip<T extends string>({ tabs, active, onChange }: TabStripProps<T>) {
  const [layouts, setLayouts] = useState<Record<string, TabLayout>>({});
  const translateX = useSharedValue(0);
  const width = useSharedValue(0);

  useEffect(() => {
    const layout = layouts[active];
    if (!layout) return;
    translateX.value = withTiming(layout.x, { duration: 220, easing: Easing.out(Easing.cubic) });
    width.value = withTiming(layout.width, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, layouts, translateX, width]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: width.value,
  }));

  return (
    <View className="border-b border-gray-200">
      <View className="flex-row">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => onChange(tab.key)}
              onLayout={(e: LayoutChangeEvent) => {
                const { x, width: w } = e.nativeEvent.layout;
                setLayouts((prev) =>
                  prev[tab.key]?.x === x && prev[tab.key]?.width === w
                    ? prev
                    : { ...prev, [tab.key]: { x, width: w } },
                );
              }}
              className="flex-1 items-center py-3"
            >
              <Text
                className={`text-sm ${isActive ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Animated.View className="absolute bottom-0 h-0.5 bg-gray-900" style={indicatorStyle} />
    </View>
  );
}
