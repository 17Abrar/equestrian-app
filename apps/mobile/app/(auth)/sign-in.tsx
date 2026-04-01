import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    if (!isLoaded || !signIn) return;

    setError('');
    setLoading(true);

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
      } else {
        setError('Sign in could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: Array<{ longMessage?: string; message?: string }> };
      const message = clerkError.errors?.[0]?.longMessage
        ?? clerkError.errors?.[0]?.message
        ?? 'Failed to sign in. Please check your credentials.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, setActive, email, password]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          {/* Header */}
          <View className="mb-10">
            <Text className="text-3xl font-bold text-gray-900">Welcome back</Text>
            <Text className="mt-2 text-base text-gray-500">
              Sign in to your account
            </Text>
          </View>

          {/* Form */}
          <View className="gap-4">
            <View>
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Email</Text>
              <TextInput
                className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-base text-gray-900"
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />
            </View>

            <View>
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Password</Text>
              <TextInput
                className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-base text-gray-900"
                placeholder="Enter your password"
                placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                textContentType="password"
              />
            </View>

            {error ? (
              <View className="rounded-lg bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              className={`mt-2 rounded-xl py-4 ${loading ? 'bg-gray-400' : 'bg-gray-900'}`}
              onPress={handleSignIn}
              disabled={loading || !email.trim() || !password}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center text-base font-semibold text-white">
                  Sign In
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View className="mt-8 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-500">Don&apos;t have an account?</Text>
            <Link href="/(auth)/sign-up" asChild>
              <TouchableOpacity>
                <Text className="text-sm font-semibold text-gray-900">Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
