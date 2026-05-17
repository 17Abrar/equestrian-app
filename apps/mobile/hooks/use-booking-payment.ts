import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useApiClient } from '@/lib/api';

interface HostedPaymentResponse {
  success: true;
  data: {
    bookingId: string;
    provider: 'stripe' | 'n_genius' | 'ziina';
    providerPaymentId: string;
    flow: 'redirect';
    paymentUrl: string;
    status: string;
  };
}

interface ApiError {
  success: false;
  error: { code: string; message: string };
}

/**
 * Mobile payment flow. Asks the server for a hosted-checkout URL (mode=hosted),
 * opens the provider's payment page in the in-app browser, and refreshes the
 * booking cache when the user comes back.
 *
 * Works for all three providers because:
 *   - Stripe: `createHostedCheckout` returns a Checkout Session URL
 *   - N-Genius: `createPayment` already returns a hosted payment page URL
 *   - Ziina: `createPayment` already returns a `redirect_url`
 */
export function usePayBooking() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = useCallback(
    async (
      bookingId: string,
    ): Promise<{
      ok: boolean;
      dismissed?: boolean;
      cancelled?: boolean;
      errorMessage?: string;
    }> => {
      setIsPaying(true);
      setError(null);

      try {
        // Build a `cavaliq://` deep link the provider will redirect to once
        // payment completes. iOS `ASWebAuthenticationSession` and Android
        // Chrome Custom Tabs both close the in-app browser automatically
        // when the system intercepts a matching custom-scheme URL — without
        // this, the WebBrowser session never resolves and the rider is
        // stranded on the provider's "thank you" page with no way back to
        // the app. The path under the scheme is informational only; we
        // route the user to the booking detail screen after dismissal.
        const redirectUrl = Linking.createURL(`/payment-callback/${bookingId}`);

        const res = (await api.post<HostedPaymentResponse['data']>(
          `/api/v1/bookings/${bookingId}/payment`,
          { mode: 'hosted', returnUrl: redirectUrl },
        )) as HostedPaymentResponse | ApiError;

        if (!res.success) {
          setError(res.error.message);
          return { ok: false, errorMessage: res.error.message };
        }

        // Open the hosted payment page. `openAuthSessionAsync` handles the
        // round-trip: iOS uses SFSafariViewController / ASWebAuthenticationSession,
        // Android uses Chrome Custom Tabs. Passing `redirectUrl` lets the
        // OS recognise the provider's post-payment redirect as the closing
        // signal — the call resolves with `type:'success'` and the in-app
        // browser dismisses automatically.
        const result = await WebBrowser.openAuthSessionAsync(res.data.paymentUrl, redirectUrl);

        // Refresh so the home screen / booking detail reflect the new status
        // as soon as the webhook lands.
        await queryClient.invalidateQueries({ queryKey: ['myBookings'] });
        await queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });

        if (result.type === 'dismiss' || result.type === 'cancel') {
          return { ok: false, dismissed: true };
        }

        // 2026-05-16: N-Genius's `cancelUrl` now appends `payment=cancelled`
        // (see apps/web/lib/payments/n-genius.ts). When the rider hit Cancel
        // on the PayPage the OS still resolves the session as `type:'success'`
        // (because the redirect did happen — just to the cancelUrl, not the
        // success URL). Without parsing the redirect URL we couldn't tell
        // the two apart, so a true cancel surfaced as "Payment received".
        // Parse the resolved URL for the `payment=cancelled` flag and
        // bubble it back as a distinct state so the caller can show
        // a "Payment cancelled — try again" toast instead of celebrating.
        if (result.type === 'success' && typeof result.url === 'string') {
          try {
            const parsed = new URL(result.url);
            if (parsed.searchParams.get('payment') === 'cancelled') {
              return { ok: false, cancelled: true };
            }
          } catch {
            // Custom-scheme parse failure: fall through to the success
            // path. The webhook (when it arrives) is still authoritative
            // for the booking's paymentStatus.
          }
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Payment failed';
        setError(message);
        return { ok: false, errorMessage: message };
      } finally {
        setIsPaying(false);
      }
    },
    [api, queryClient],
  );

  return { pay, isPaying, error };
}
