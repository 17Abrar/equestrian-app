import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CommunityScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold">Community</Text>
        <Text className="mt-1 text-gray-500">Connect with the equestrian community</Text>
      </View>
    </SafeAreaView>
  );
}
