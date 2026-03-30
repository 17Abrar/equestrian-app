import { View, Text } from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';

export default function SignInScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-2xl font-bold">Sign In</Text>
      <Text className="mt-2 text-center text-gray-500">
        Sign in to your equestrian account
      </Text>
    </View>
  );
}
