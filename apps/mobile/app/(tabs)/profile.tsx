import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useUser, useOrganization } from '@clerk/clerk-expo';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

// Hardcoded to production cavaliq.com because: (a) legal pages live there,
// not on the API host in dev where EXPO_PUBLIC_API_URL points to localhost
// (which an in-app browser on a device or simulator can't reach), and (b)
// expo-web-browser would otherwise open localhost from a release build if
// the env var were misconfigured. Override only if you need to point at a
// staging marketing site.
const LEGAL_BASE_URL =
  process.env.EXPO_PUBLIC_LEGAL_BASE_URL?.replace(/\/$/, '') ?? 'https://cavaliq.com';

interface RowProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  trailing?: string;
  destructive?: boolean;
  isLast?: boolean;
}

function Row({ label, icon, onPress, trailing, destructive, isLast }: RowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`flex-row items-center justify-between px-4 py-3.5 ${
        isLast ? '' : 'border-b border-gray-100'
      }`}
    >
      <View className="flex-row items-center gap-3">
        <Ionicons
          name={icon}
          size={18}
          color={destructive ? '#dc2626' : '#6b7280'}
        />
        <Text
          className={`text-sm font-medium ${destructive ? 'text-red-600' : 'text-gray-900'}`}
        >
          {label}
        </Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        {trailing ? <Text className="text-xs text-gray-500">{trailing}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();
  const router = useRouter();

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

  const openLegal = useCallback((path: string) => {
    void WebBrowser.openBrowserAsync(`${LEGAL_BASE_URL}${path}`);
  }, []);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Rider';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials = (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '');

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 }}
      >
        <Text className="text-2xl font-bold text-gray-900">Profile</Text>

        {/* Avatar + Name */}
        <View className="mt-6 items-center">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-gray-900">
            <Text className="text-2xl font-bold text-white">{initials.toUpperCase() || '?'}</Text>
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
        <Text className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Account
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3.5">
            <Text className="text-sm text-gray-500">Name</Text>
            <Text className="text-sm font-medium text-gray-900">{fullName}</Text>
          </View>
          <View
            className={`flex-row items-center justify-between px-4 py-3.5 ${organization ? 'border-b border-gray-100' : ''}`}
          >
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

        {/* Help & Support */}
        <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Help & support
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <Row
            label="Help centre"
            icon="help-circle-outline"
            onPress={() => openLegal('/help')}
          />
          <Row
            label="Contact support"
            icon="mail-outline"
            onPress={() => openLegal('/support')}
          />
          <Row
            label="Status"
            icon="pulse-outline"
            onPress={() => openLegal('/status')}
            isLast
          />
        </View>

        {/* Legal & About */}
        <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          About
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <Row
            label="About Cavaliq"
            icon="information-circle-outline"
            onPress={() => router.push('/about')}
          />
          <Row
            label="Privacy policy"
            icon="shield-checkmark-outline"
            onPress={() => openLegal('/legal/privacy')}
          />
          <Row
            label="Terms of service"
            icon="document-text-outline"
            onPress={() => openLegal('/legal/terms/end-user')}
          />
          <Row
            label="Cookies"
            icon="ellipse-outline"
            onPress={() => openLegal('/legal/cookies')}
          />
          <Row
            label="Refund policy"
            icon="receipt-outline"
            onPress={() => openLegal('/legal/refunds')}
            isLast
          />
        </View>

        {/* Account actions */}
        <Text className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Account actions
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <Row
            label="Delete account"
            icon="trash-outline"
            onPress={() => router.push('/delete-account')}
            destructive
            isLast
          />
        </View>

        {/* Sign out */}
        <TouchableOpacity
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 py-4"
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text className="text-center text-base font-semibold text-red-600">Sign Out</Text>
        </TouchableOpacity>

        <Text className="mt-6 text-center text-xs text-gray-400">
          Cavaliq · v1.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
