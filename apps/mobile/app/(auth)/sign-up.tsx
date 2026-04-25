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
import { useSignUp } from '@clerk/clerk-expo';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CavaliqLogo } from '../../components/cavaliq-logo';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Verification step
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState('');

  const handleSignUp = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    setError('');
    setLoading(true);

    try {
      await signUp.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: unknown) {
      const clerkError = err as { errors?: Array<{ longMessage?: string; message?: string }> };
      const message = clerkError.errors?.[0]?.longMessage
        ?? clerkError.errors?.[0]?.message
        ?? 'Failed to create account. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp, firstName, lastName, email, password]);

  const handleVerify = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    setError('');
    setLoading(true);

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });

      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
      } else {
        setError('Verification could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: Array<{ longMessage?: string; message?: string }> };
      const message = clerkError.errors?.[0]?.longMessage
        ?? clerkError.errors?.[0]?.message
        ?? 'Invalid verification code.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp, setActive, code]);

  if (pendingVerification) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center px-6">
          <View className="mb-10">
            <Text className="text-3xl font-bold text-gray-900">Check your email</Text>
            <Text className="mt-2 text-base text-gray-500">
              We sent a verification code to {email}
            </Text>
          </View>

          <View className="gap-4">
            <View>
              <Text className="mb-1.5 text-sm font-medium text-gray-700">
                Verification Code
              </Text>
              <TextInput
                className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-center text-xl tracking-widest text-gray-900"
                placeholder="000000"
                placeholderTextColor="#9ca3af"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            {error ? (
              <View className="rounded-lg bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              className={`mt-2 rounded-xl py-4 ${loading ? 'bg-gray-400' : 'bg-gray-900'}`}
              onPress={handleVerify}
              disabled={loading || code.length < 6}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center text-base font-semibold text-white">
                  Verify Email
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <View className="mb-10">
            <CavaliqLogo height={36} style={{ marginBottom: 24 }} />
            <Text className="text-3xl font-bold text-gray-900">Create account</Text>
            <Text className="mt-2 text-base text-gray-500">
              Join your stable on Cavaliq
            </Text>
          </View>

          <View className="gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Text className="mb-1.5 text-sm font-medium text-gray-700">First Name</Text>
                <TextInput
                  className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-base text-gray-900"
                  placeholder="First"
                  placeholderTextColor="#9ca3af"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoComplete="given-name"
                  textContentType="givenName"
                />
              </View>
              <View className="flex-1">
                <Text className="mb-1.5 text-sm font-medium text-gray-700">Last Name</Text>
                <TextInput
                  className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-base text-gray-900"
                  placeholder="Last"
                  placeholderTextColor="#9ca3af"
                  value={lastName}
                  onChangeText={setLastName}
                  autoComplete="family-name"
                  textContentType="familyName"
                />
              </View>
            </View>

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
                placeholder="Create a password"
                placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </View>

            {error ? (
              <View className="rounded-lg bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              className={`mt-2 rounded-xl py-4 ${loading ? 'bg-gray-400' : 'bg-gray-900'}`}
              onPress={handleSignUp}
              disabled={loading || !email.trim() || !password || !firstName.trim()}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center text-base font-semibold text-white">
                  Create Account
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="mt-8 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-500">Already have an account?</Text>
            <Link href="/(auth)/sign-in" asChild>
              <TouchableOpacity>
                <Text className="text-sm font-semibold text-gray-900">Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
