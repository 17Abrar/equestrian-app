'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PaymentsPanel } from './payments-panel';

const CALLBACK_MESSAGES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  connected: { tone: 'success', text: 'Payment provider connected successfully.' },
  denied: { tone: 'error', text: 'Connection was declined on the provider side.' },
  invalid_state: {
    tone: 'error',
    text: 'Session expired during connection. Please try connecting again.',
  },
  club_mismatch: {
    tone: 'error',
    text: 'You switched clubs during the connection flow. Start again from the correct club.',
  },
  forbidden: { tone: 'error', text: 'You do not have permission to connect payment providers.' },
  not_authenticated: {
    tone: 'error',
    text: 'Your session expired. Sign in again and retry.',
  },
  missing_parameters: {
    tone: 'error',
    text: 'The provider did not return the expected parameters.',
  },
  exchange_failed: {
    tone: 'error',
    text: 'The provider rejected the authorization code. Try again.',
  },
};

export function PaymentsSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notifiedRef = useRef(false);

  // Surface callback results from the OAuth redirect once, then clear the
  // query params so a refresh doesn't re-fire the toast.
  useEffect(() => {
    if (notifiedRef.current) return;
    const status = searchParams.get('status');
    const error = searchParams.get('error');
    if (!status && !error) return;

    notifiedRef.current = true;

    const key = status ?? error ?? 'unknown';
    const msg = CALLBACK_MESSAGES[key];
    if (msg) {
      if (msg.tone === 'success') {
        toast.success(msg.text);
      } else {
        toast.error(msg.text);
      }
    } else {
      toast.error(`Connection failed: ${key}`);
    }

    // Strip the query params without a reload.
    router.replace('/settings/payments', { scroll: false });
  }, [searchParams, router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <p className="mt-1 text-muted-foreground">
          Connect a payment processor so riders can pay online. Only one provider is active at
          a time — new bookings route through the active one.
        </p>
      </div>

      <PaymentsPanel />

      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Which provider should I pick?</p>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed">
          <li>
            <span className="font-medium">Stripe</span> — widest card support, Apple Pay/Google
            Pay out of the box, strong fraud tooling. Best if you accept international riders.
          </li>
          <li>
            <span className="font-medium">N-Genius</span> — UAE-native, works with Mada and
            local bank cards. Best if most of your riders pay in AED with local cards.
          </li>
          <li>
            <span className="font-medium">Ziina</span> — fast onboarding, low-friction Ziina
            wallet and card payments for UAE customers.
          </li>
        </ul>
      </div>
    </div>
  );
}
