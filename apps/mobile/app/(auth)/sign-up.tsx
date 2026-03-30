import { View, Text } from 'react-native';

export default function SignUpScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-2xl font-bold">Sign Up</Text>
      <Text className="mt-2 text-center text-gray-500">
        Create your equestrian account
      </Text>
    </View>
  );
}
