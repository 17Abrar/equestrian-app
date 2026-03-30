import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function BookScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold">Book</Text>
        <Text className="mt-1 text-gray-500">Book a lesson or ride</Text>
      </View>
    </SafeAreaView>
  );
}
