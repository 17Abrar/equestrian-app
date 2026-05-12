import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function CommunityScreen() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        <View className="px-6 pb-2 pt-4">
          <Text className="text-2xl font-bold text-gray-900">Community</Text>
          <Text className="mt-1 text-base text-gray-500">
            Connect with riders across your stable
          </Text>
        </View>

        <View className="mx-6 mt-8 rounded-2xl border border-gray-200 bg-white p-6">
          <View className="items-center">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="chatbubbles-outline" size={28} color="#6b7280" />
            </View>
            <Text className="mt-4 text-lg font-semibold text-gray-900">Coming soon</Text>
            <Text className="mt-2 text-center text-sm text-gray-500">
              Share rides, photos, and tips with other riders at your stable. We&apos;re building
              this with your stable&apos;s feedback — watch this space.
            </Text>
          </View>
        </View>

        <View className="mx-6 mt-4 rounded-2xl bg-gray-100/60 p-4">
          <Text className="text-xs font-medium uppercase tracking-wide text-gray-400">
            What&apos;s planned
          </Text>
          <View className="mt-2 gap-2">
            <FeatureRow icon="camera-outline" label="Share lesson photos" />
            <FeatureRow icon="trophy-outline" label="Track progress together" />
            <FeatureRow icon="help-circle-outline" label="Ask and answer rider questions" />
            <FeatureRow icon="calendar-outline" label="Coordinate rides and events" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureRow({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <Ionicons name={icon} size={18} color="#6b7280" />
      <Text className="text-sm text-gray-700">{label}</Text>
    </View>
  );
}
