import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useCallback } from 'react';
import { CavaliqLogo } from '../components/cavaliq-logo';

const LEGAL_BASE_URL =
  process.env.EXPO_PUBLIC_LEGAL_BASE_URL?.replace(/\/$/, '') ?? 'https://cavaliq.com';

interface LinkRowProps {
  label: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isLast?: boolean;
}

function LinkRow({ label, description, icon, onPress, isLast }: LinkRowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`px-4 py-3.5 ${isLast ? '' : 'border-b border-gray-100'}`}
    >
      <View className="flex-row items-center gap-3">
        <Ionicons name={icon} size={18} color="#6b7280" />
        <View className="flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-gray-900">{label}</Text>
            <Ionicons name="open-outline" size={14} color="#9ca3af" />
          </View>
          {description ? (
            <Text className="mt-0.5 text-xs text-gray-500">{description}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function AboutScreen() {
  const router = useRouter();

  const open = useCallback((path: string) => {
    void WebBrowser.openBrowserAsync(`${LEGAL_BASE_URL}${path}`);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#171717" />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-semibold text-gray-900">About Cavaliq</Text>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 }}
      >
        <View className="items-center pb-8">
          <CavaliqLogo height={36} />
          <Text className="mt-4 text-base text-gray-600">Equestrian club management</Text>
          <Text className="mt-1 text-xs text-gray-400">Version 1.0 · Build 1</Text>
        </View>

        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Legal
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <LinkRow
            label="Privacy policy"
            description="How we collect, use, and protect your data"
            icon="shield-checkmark-outline"
            onPress={() => open('/legal/privacy')}
          />
          <LinkRow
            label="Terms of service"
            description="Terms for clubs subscribing to Cavaliq"
            icon="document-text-outline"
            onPress={() => open('/legal/terms')}
          />
          <LinkRow
            label="End-user terms"
            description="Terms for riders, parents, and owners"
            icon="document-text-outline"
            onPress={() => open('/legal/terms/end-user')}
          />
          <LinkRow
            label="Refund & cancellation"
            description="Default cancellation windows and refunds"
            icon="receipt-outline"
            onPress={() => open('/legal/refunds')}
          />
          <LinkRow
            label="Cookie policy"
            description="The strictly-necessary cookies we use"
            icon="ellipse-outline"
            onPress={() => open('/legal/cookies')}
          />
          <LinkRow
            label="Acceptable use"
            description="Rules for using Cavaliq responsibly"
            icon="hand-left-outline"
            onPress={() => open('/legal/acceptable-use')}
            isLast
          />
        </View>

        <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Trust & security
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <LinkRow
            label="Security overview"
            description="How we keep your data safe"
            icon="lock-closed-outline"
            onPress={() => open('/legal/security')}
          />
          <LinkRow
            label="Data processing addendum"
            description="For clubs — our processor commitments"
            icon="server-outline"
            onPress={() => open('/legal/dpa')}
          />
          <LinkRow
            label="Subprocessors"
            description="The services we use to deliver Cavaliq"
            icon="people-outline"
            onPress={() => open('/legal/subprocessors')}
          />
          <LinkRow
            label="Children's data statement"
            description="How we handle data about minors"
            icon="happy-outline"
            onPress={() => open('/legal/children')}
            isLast
          />
        </View>

        <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Help & contact
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <LinkRow
            label="Help centre"
            icon="help-circle-outline"
            onPress={() => open('/help')}
          />
          <LinkRow
            label="Contact support"
            icon="mail-outline"
            onPress={() => open('/support')}
          />
          <LinkRow
            label="Service status"
            icon="pulse-outline"
            onPress={() => open('/status')}
            isLast
          />
        </View>

        <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Your data
        </Text>
        <View className="rounded-2xl border border-gray-200 bg-white">
          <TouchableOpacity
            onPress={() => router.push('/delete-account')}
            activeOpacity={0.7}
            className="px-4 py-3.5"
          >
            <View className="flex-row items-center gap-3">
              <Ionicons name="trash-outline" size={18} color="#dc2626" />
              <View className="flex-1">
                <Text className="text-sm font-medium text-red-600">Delete account</Text>
                <Text className="mt-0.5 text-xs text-gray-500">
                  Request deletion of your account and personal data
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </View>
          </TouchableOpacity>
        </View>

        <View className="mt-8 items-center">
          <Text className="text-xs text-gray-400">
            © {new Date().getFullYear()} Cavaliq. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
