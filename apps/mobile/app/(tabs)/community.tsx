import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@clerk/clerk-expo';
import Toast from 'react-native-toast-message';
import { useApiClient } from '@/lib/api';

// Audit P0-C (2026-05-26): the previous "Coming soon" card is now an
// actionable waitlist signup. The endpoint is public (signed-out users
// can also signal interest from a future marketing-page link), rate-
// limited per IP, and emails ops on every signup.

export default function CommunityScreen() {
  const api = useApiClient();
  const { user } = useUser();
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      Toast.show({ type: 'error', text1: 'Enter your email first' });
      return;
    }
    setSubmitting(true);
    try {
      // `api.post` swallows fetch-level failures into an `{ success: false }`
      // envelope, but it calls Clerk `getToken()` BEFORE its internal
      // try/catch — a Clerk session blip (token refresh failed,
      // network glitch during refresh) would otherwise reject the
      // promise and leave the button stuck on the spinner with no
      // toast feedback.
      const result = await api.post<{ received: true }>('/api/v1/community/notify-me', {
        email: trimmed,
        source: 'mobile',
      });
      if (result.success) {
        setSubmitted(true);
        Toast.show({
          type: 'success',
          text1: "You're on the list",
          text2: 'We’ll email you when Community ships.',
        });
      } else {
        Toast.show({
          type: 'error',
          text1: 'Couldn’t join the waitlist',
          text2: result.error.message,
        });
      }
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Couldn’t join the waitlist',
        text2: err instanceof Error ? err.message : 'Please try again',
      });
    } finally {
      setSubmitting(false);
    }
  }

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
              <Ionicons name="notifications-outline" size={28} color="#0d1f34" />
            </View>
            <Text className="mt-4 text-lg font-semibold text-gray-900">
              Community is on the way
            </Text>
            <Text className="mt-2 text-center text-sm text-gray-500">
              Photos, progress, and announcements from your stable, right here. Drop your
              email and we’ll let you know the moment it’s ready.
            </Text>
          </View>

          {submitted ? (
            <View className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-green-50 px-4 py-3">
              <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
              <Text className="text-sm font-medium text-green-800">
                You’re on the list at {email}
              </Text>
            </View>
          ) : (
            <View className="mt-5 gap-2">
              <TextInput
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
                placeholder="you@stable.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                editable={!submitting}
                accessibilityLabel="Email address"
              />
              <TouchableOpacity
                className="flex-row items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3"
                onPress={handleSubmit}
                disabled={submitting || !email}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Notify me</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
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

        <Text className="mx-6 mt-6 text-center text-xs text-gray-400">
          Until then, your stable’s announcements come via email.
        </Text>
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
