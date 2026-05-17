import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { captureMobileException } from '@/lib/sentry';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface DeleteResponseSuccess {
  success: true;
  data: { requested: boolean };
}
interface DeleteResponseError {
  success: false;
  error: { code: string; message: string };
}
type DeleteResponse = DeleteResponseSuccess | DeleteResponseError;

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { getToken, signOut } = useAuth();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit = confirm.trim().toUpperCase() === 'DELETE' && !submitting;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error('Not signed in');
      }
      const res = await fetch(`${API_BASE_URL}/api/v1/account/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          confirm: 'DELETE',
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as DeleteResponse | null;
      if (!res.ok || !body || !body.success) {
        const message =
          body && !body.success ? body.error.message : 'Could not submit the deletion request';
        throw new Error(message);
      }
      setDone(true);
    } catch (err) {
      captureMobileException(err, 'account_delete_request_failed', {});
      const message =
        err instanceof Error ? err.message : 'Could not submit the deletion request';
      Alert.alert('Something went wrong', message);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, getToken, reason]);

  const handleSignOutAfterDeletion = useCallback(() => {
    void signOut().finally(() => {
      Toast.show({
        type: 'success',
        text1: 'Signed out',
      });
      router.replace('/(auth)/sign-in');
    });
  }, [signOut, router]);

  if (done) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <View className="items-center pt-8">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <Ionicons name="checkmark" size={32} color="#059669" />
            </View>
            <Text className="mt-6 text-xl font-semibold text-gray-900">Request received</Text>
            <Text className="mt-3 text-center text-sm leading-relaxed text-gray-600">
              We&rsquo;ve received your account deletion request. We&rsquo;ll complete the deletion
              within 30 days, and we&rsquo;ve sent you a confirmation email.
            </Text>
            <Text className="mt-3 text-center text-xs leading-relaxed text-gray-500">
              Some records (e.g. payment invoices) may be retained for the period required by tax
              law. See the privacy policy for details.
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleSignOutAfterDeletion}
            activeOpacity={0.8}
            className="mt-10 rounded-xl bg-gray-900 py-4"
          >
            <Text className="text-center text-base font-semibold text-white">Sign out now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#171717" />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-semibold text-gray-900">Delete account</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <View className="rounded-xl bg-red-50 p-4">
          <View className="flex-row items-start gap-3">
            <Ionicons name="warning-outline" size={20} color="#dc2626" />
            <Text className="flex-1 text-sm leading-relaxed text-red-700">
              Deleting your account is permanent. Once processed, you won&rsquo;t be able to recover
              your bookings, profile, or other personal data.
            </Text>
          </View>
        </View>

        <Text className="mt-6 text-base font-semibold text-gray-900">What happens next</Text>
        <View className="mt-3 gap-2">
          <View className="flex-row gap-2">
            <Text className="text-gray-400">1.</Text>
            <Text className="flex-1 text-sm leading-relaxed text-gray-700">
              We confirm receipt by email straight away.
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Text className="text-gray-400">2.</Text>
            <Text className="flex-1 text-sm leading-relaxed text-gray-700">
              Our privacy team coordinates with your club to disentangle bookings, attached rider
              profiles, and ownership records.
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Text className="text-gray-400">3.</Text>
            <Text className="flex-1 text-sm leading-relaxed text-gray-700">
              We complete the deletion within 30 days. Some records (e.g. payment invoices) are
              kept for the period required by tax law — see the privacy policy.
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Text className="text-gray-400">4.</Text>
            <Text className="flex-1 text-sm leading-relaxed text-gray-700">
              You receive a final confirmation when deletion is complete.
            </Text>
          </View>
        </View>

        <Text className="mt-6 mb-2 text-sm font-medium text-gray-700">
          Reason (optional)
        </Text>
        <TextInput
          className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900"
          placeholder="Help us improve — what's prompting you to leave?"
          placeholderTextColor="#9ca3af"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={2000}
        />

        <Text className="mt-6 mb-2 text-sm font-medium text-gray-700">
          Type <Text className="font-bold text-red-600">DELETE</Text> to confirm
        </Text>
        <TextInput
          className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-base text-gray-900"
          placeholder="DELETE"
          placeholderTextColor="#9ca3af"
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <TouchableOpacity
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.8}
          className={`mt-8 rounded-xl py-4 ${
            canSubmit ? 'bg-red-600' : 'bg-gray-300'
          }`}
        >
          {submitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-center text-base font-semibold text-white">
              Delete my account
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          className="mt-3 py-3"
        >
          <Text className="text-center text-sm font-medium text-gray-600">Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
