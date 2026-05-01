import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useUser, useOrganization } from '@clerk/clerk-expo';
import { useCallback } from 'react';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut]);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Rider';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials = (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '');

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-gray-900">Profile</Text>

        {/* Avatar + Name */}
        <View className="mt-6 items-center">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-gray-900">
            <Text className="text-2xl font-bold text-white">
              {initials.toUpperCase() || '?'}
            </Text>
          </View>
          <Text className="mt-3 text-xl font-semibold text-gray-900">{fullName}</Text>
          <Text className="mt-1 text-sm text-gray-500">{email}</Text>
          {organization && (
            <View className="mt-2 rounded-full bg-blue-100 px-3 py-1">
              <Text className="text-xs font-medium text-blue-700">{organization.name}</Text>
            </View>
          )}
        </View>

        {/* Info rows */}
        <View className="mt-8 rounded-2xl border border-gray-200 bg-white">
          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3.5">
            <Text className="text-sm text-gray-500">Name</Text>
            <Text className="text-sm font-medium text-gray-900">{fullName}</Text>
          </View>
          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3.5">
            <Text className="text-sm text-gray-500">Email</Text>
            <Text className="text-sm font-medium text-gray-900">{email}</Text>
          </View>
          {organization && (
            <View className="flex-row items-center justify-between px-4 py-3.5">
              <Text className="text-sm text-gray-500">Club</Text>
              <Text className="text-sm font-medium text-gray-900">{organization.name}</Text>
            </View>
          )}
        </View>

        {/* Sign out */}
        <TouchableOpacity
          className="mt-8 rounded-2xl border border-red-200 bg-red-50 py-4"
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text className="text-center text-base font-semibold text-red-600">Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
