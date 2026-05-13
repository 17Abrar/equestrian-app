import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
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
    ): Promise<{ ok: boolean; dismissed?: boolean; errorMessage?: string }> => {
      setIsPaying(true);
      setError(null);

      try {
        const res = (await api.post<HostedPaymentResponse['data']>(
          `/api/v1/bookings/${bookingId}/payment`,
          { mode: 'hosted' },
        )) as HostedPaymentResponse | ApiError;

        if (!res.success) {
          setError(res.error.message);
          return { ok: false, errorMessage: res.error.message };
        }

        // Open the hosted payment page. `openAuthSessionAsync` handles the
        // round-trip: iOS uses SFSafariViewController / ASWebAuthenticationSession,
        // Android uses Chrome Custom Tabs. The call resolves when the page
        // either redirects back to `returnUrl` or the user dismisses it.
        const result = await WebBrowser.openAuthSessionAsync(
          res.data.paymentUrl,
          // The server passes a return URL inside `success/cancel/failure`,
          // so we don't pre-declare one here — the browser closes on its own.
          null,
        );

        // Refresh so the home screen / booking detail reflect the new status
        // as soon as the webhook lands.
        await queryClient.invalidateQueries({ queryKey: ['myBookings'] });
        await queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
        await queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });

        if (result.type === 'dismiss' || result.type === 'cancel') {
          return { ok: false, dismissed: true };
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
