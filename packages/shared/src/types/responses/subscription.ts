/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated platform-subscription
 * DTOs. Source projection: `packages/db/src/queries/platform-billing.ts`.
 *
 * NOTE: this is the per-club platform-billing subscription (Cavaliq billing
 * the club for SaaS access), distinct from the club's per-rider booking
 * payments. The shared envelope `SubscriptionStatus` enum (`trialing` |
 * `active` | `past_due` | `cancelled`) maps to `SubscriptionPlatformStatus`
 * here. Invoice status uses a different lifecycle than the per-club Invoice
 * (`pending`/`paid`/`overdue`/`cancelled` rather than the InvoiceStatus
 * `draft`/`sent`/`paid`/`overdue`/`void`), so we declare it inline.
 */

export type SubscriptionTier = 'trial' | 'starter' | 'growing' | 'professional';
export type SubscriptionPlatformStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type SubscriptionInvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface SubscriptionInvoice {
  id: string;
  invoiceNumber: string;
  tier: SubscriptionTier;
  amountMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: SubscriptionInvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  payLink: string | null;
  createdAt: string;
}

export interface OutstandingInvoice {
  id: string;
  invoiceNumber: string;
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  status: SubscriptionInvoiceStatus;
  payLink: string | null;
  tier: SubscriptionTier;
  periodStart: string;
  periodEnd: string;
}

export interface SubscriptionSummary {
  tier: SubscriptionTier;
  status: SubscriptionPlatformStatus;
  trialEndsAt: string | null;
  currentTierPriceMinor: number;
  currency: string;
  outstanding: OutstandingInvoice[];
  history: SubscriptionInvoice[];
}
