/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated payment-account DTOs.
 * Source projection: `packages/db/src/queries/payment-accounts.ts`.
 */

export type PaymentProviderName = 'stripe' | 'n_genius' | 'ziina';
export type PaymentAccountStatus = 'pending' | 'connected' | 'disabled' | 'error';

export interface PaymentAccount {
  id: string;
  clubId: string;
  provider: PaymentProviderName;
  status: PaymentAccountStatus;
  isActive: boolean;
  externalAccountId: string | null;
  metadata: unknown;
  lastError: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `BookingPaymentResult` is the shape returned by
 * `POST /api/v1/bookings/[id]/payment`. The `flow` discriminator splits the
 * union: Stripe carries an inline `clientSecret` + per-club `publishableKey`;
 * N-Genius and Ziina carry a hosted-checkout `paymentUrl`.
 */
export type BookingPaymentResult =
  | {
      bookingId: string;
      provider: PaymentProviderName;
      providerPaymentId: string;
      flow: 'inline';
      clientSecret: string;
      publishableKey: string;
      status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';
    }
  | {
      bookingId: string;
      provider: PaymentProviderName;
      providerPaymentId: string;
      flow: 'redirect';
      paymentUrl: string;
      status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';
    };
