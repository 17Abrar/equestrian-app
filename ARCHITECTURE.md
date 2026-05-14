# System Architecture — Equestrian Club Management Platform

This document defines HOW the system is built. Every architectural decision here is final. Do not deviate without explicit approval.

---

## SYSTEM OVERVIEW

```
                                USERS
                    ┌───────────┴───────────┐
                    │                       │
              Mobile App                Web Dashboard
           (React Native/Expo)         (Next.js 15)
                    │                       │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │    CLOUDFLARE EDGE     │
                    │  WAF + DDoS + Rate     │
                    │  Limiting + TLS 1.3    │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  CLOUDFLARE WORKERS    │
                    │  Auth verification     │
                    │  Tenant resolution     │
                    │  Rate limiting         │
                    │  File access control   │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  NEXT.JS API ROUTES    │
                    │  Business logic        │
                    │  Zod validation        │
                    │  RBAC enforcement      │
                    └─┬───┬───┬───┬───┬─────┘
                      │   │   │   │   │
              ┌───────┘   │   │   │   └───────┐
              ▼           ▼   │   ▼           ▼
           [NEON]     [CLERK] │ [R2]       [ABLY]
          Postgres     Auth   │ Storage   Real-time
       (app-layer tenant
         scoping only)        │
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
            [STRIPE/ZIINA/      [RESEND]
              N-GENIUS]          Email
           Per-club direct
              keys
```

---

## TECH STACK — Exact Versions and Packages

### Monorepo

- Package manager: pnpm (faster than npm, strict dependency resolution)
- Monorepo tool: Turborepo
- Node.js: v20 LTS (minimum)

### Web App (apps/web)

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "typescript": "^5.5",

    "@clerk/nextjs": "latest",
    "@clerk/themes": "latest",

    "tailwindcss": "^4",
    "@tailwindcss/typography": "latest",

    "@tanstack/react-query": "^5",
    "@tanstack/react-table": "^8",
    "react-hook-form": "^7",
    "@hookform/resolvers": "latest",

    "zod": "^3",
    "date-fns": "^3",
    "recharts": "^2",
    "@dnd-kit/core": "^6",
    "@dnd-kit/sortable": "^8",
    "sonner": "^1",
    "lucide-react": "latest",

    "drizzle-orm": "latest",
    "@neondatabase/serverless": "latest",

    "stripe": "latest",
    "resend": "latest",
    "@react-email/components": "latest",

    "ably": "^2"
  }
}
```

### Mobile App (apps/mobile)

```json
{
  "dependencies": {
    "expo": "~52",
    "expo-router": "~4",
    "react-native": "~0.76",
    "react": "^19",

    "nativewind": "^4",
    "tailwindcss": "^4",

    "@clerk/clerk-expo": "latest",

    "react-native-reanimated": "~3",
    "react-native-gesture-handler": "~2",
    "react-native-safe-area-context": "^4",
    "react-native-screens": "~4",

    "@tanstack/react-query": "^5",
    "react-hook-form": "^7",
    "@hookform/resolvers": "latest",
    "zod": "^3",

    "expo-notifications": "latest",
    "expo-secure-store": "latest",
    "expo-image": "latest",
    "expo-document-picker": "latest",
    "expo-file-system": "latest",
    "expo-calendar": "latest",
    "react-native-mmkv": "^3",

    "date-fns": "^3",
    "ably": "^2"
  }
}
```

### Shared Package (packages/shared)

```json
{
  "dependencies": {
    "zod": "^3",
    "date-fns": "^3"
  }
}
```

### Database Package (packages/db)

```json
{
  "dependencies": {
    "drizzle-orm": "latest",
    "@neondatabase/serverless": "latest",
    "drizzle-kit": "latest"
  }
}
```

---

## AUTHENTICATION FLOW

### Web App (Next.js + Clerk)

```
1. User visits dashboard
2. Clerk middleware checks for valid session
3. If no session → redirect to /sign-in
4. If session exists → extract userId and orgId (club)
5. orgId determines which club's data the user sees
6. orgRole determines what the user can do
7. Every API route repeats steps 4-6 (never trust client-side auth)
```

### Clerk Middleware Configuration

```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)', // Webhooks are public (they verify signatures internally)
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});
```

### Mobile App (Expo + Clerk)

```
1. App launches
2. Check for stored session token (SecureStore)
3. If no token → show sign-in screen
4. If token exists → validate with Clerk
5. On success → load user's organizations (stables)
6. User selects a stable (or default to last used)
7. All API calls include: Authorization header (Bearer token) + X-Organization-Id header
```

### Organization (Multi-Stable) Architecture

```typescript
// A user can belong to multiple organizations (stables)
// Each organization has its own roles

// When making API calls:
const headers = {
  Authorization: `Bearer ${sessionToken}`,
  'X-Organization-Id': selectedClubId, // Which stable's data to access
};

// On the server:
const { userId, orgId, orgRole } = await auth();
// orgId = the club they're currently viewing
// orgRole = their role at THAT club (could be rider at one, owner at another)
```

---

## MULTI-TENANCY ARCHITECTURE

### Tenant Resolution Flow

```
Request arrives
    │
    ▼
Clerk middleware extracts orgId from session
    │
    ▼
withAuth helper resolves the active club_id (from Clerk org, or active-club cookie fallback)
    │
    ▼
Every Drizzle query in the handler filters by .where(eq(table.clubId, clubId))
    │
    ▼
Application code is the SOLE enforcement layer — no DB-level safety net
```

### Tenant Isolation Model (Application-Only)

Postgres Row-Level Security was dropped in migrations `0011_drop_rls.sql` and `0023_drop_rls_for_added_tables.sql`. The `app.current_club_id` session variable is no longer set; no `tenant_isolation` policies exist. This was an intentional design choice — RLS added query-rewrite overhead on Neon's pooler and obscured slow queries during the launch period. Application-layer scoping is the documented invariant and is exercised by `packages/db/src/test/tenant-isolation.test.ts`.

**Every Drizzle query MUST include the tenant filter.** Forgetting it is a critical security bug; there is no second line of defense.

```typescript
// EVERY query function follows this pattern
export async function getHorses(clubId: string) {
  return db.query.horses.findMany({
    where: and(
      eq(horses.clubId, clubId),
      isNull(horses.deletedAt), // Soft delete filter
    ),
    orderBy: [asc(horses.name)],
  });
}

// NEVER do this:
export async function getHorses() {
  return db.query.horses.findMany(); // NO! No club filter = data leak
}
```

### Tenant Context Helper

```typescript
// lib/tenant.ts
import { auth } from '@clerk/nextjs/server';
import { db } from '@/packages/db';
import { sql } from 'drizzle-orm';

export async function withTenantContext<T>(fn: (clubId: string) => Promise<T>): Promise<T> {
  const { orgId } = await auth();

  if (!orgId) {
    throw new Error('No organization context. User must belong to a club.');
  }

  // No RLS context to set — application-layer scoping is the sole enforcement.
  // The fn body MUST include .where(eq(table.clubId, orgId)) on every query.
  return fn(orgId);
}

// Usage in API routes:
export async function GET() {
  return withTenantContext(async (clubId) => {
    const horses = await getHorses(clubId);
    return NextResponse.json({ success: true, data: horses });
  });
}
```

---

## PAYMENT INTEGRATION PATTERNS

Cavaliq is NOT a Stripe Connect platform. Each club pastes its own provider credentials into the settings form and we encrypt them into `club_payment_accounts.encrypted_credentials`. Charges land in the club's own merchant balance directly — there is no platform `STRIPE_CLIENT_ID`, no OAuth, no `application_fee_amount`, no `stripeAccount` SDK header, and no platform cut on transactions. Revenue comes from subscription tiers (Starter / Growing / Professional), not per-booking fees. (Pivot recorded 2026-05-04.)

Three providers are wired today, behind a common adapter contract:

- `stripe` — global card payments. Credentials: `sk_…`, `pk_…`, optional `whsec_…`.
- `ziina` — UAE wallet/card aggregator. Credentials: API key + webhook signing secret.
- `n_genius` — Network International hosted-page UAE acquirer. Credentials: API key + outlet reference.

Each adapter implements `PaymentProviderAdapter` (`apps/web/lib/payments/types.ts`): `createPayment`, `getPaymentStatus`, `refundPayment`, `verifyWebhook`, plus a `connect` step that validates pasted credentials before they're encrypted and stored. The registry (`apps/web/lib/payments/registry.ts`) picks the active adapter at runtime by the club's saved provider preference.

### Direct-key Stripe adapter (simplified)

```typescript
// apps/web/lib/payments/stripe.ts
import Stripe from 'stripe';
import { decryptCredentials } from '@/lib/payments/credentials';

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  // Per-club credentials, decrypted on demand
  const creds = await decryptCredentials(input.clubId, 'stripe');
  const stripe = new Stripe(creds.secretKey, { apiVersion: '2025-08-27.basil' });

  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amountMinorUnits,
      currency: input.currency,
      // NO application_fee_amount, NO transfer_data — direct-keys model
      metadata: { bookingId: input.bookingId, clubId: input.clubId },
    },
    {
      // Idempotency key stable per-booking; see ziina-operation-id.ts for the
      // deterministic-uuid pattern used to convert this to Ziina's UUID shape.
      idempotencyKey: `booking_${input.bookingId}`,
    },
  );

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: creds.publishableKey, // returned to the client so Stripe Elements mounts the right account
    status: mapStripeStatus(intent.status),
  };
}
```

### Per-club webhook delivery

Each club configures `https://cavaliq.com/api/webhooks/<provider>/<clubId>` in their own provider dashboard. The `[clubId]` path segment lets the receiver look up the right per-club webhook signing secret and verify the signature before any state mutation. Signature verification uses `timingSafeEqual` across all three adapters; failures return 401 with no body to avoid leaking which clubs have webhooks configured.

Key invariants enforced on every webhook handler (see `apps/web/lib/payments/webhook-helpers.ts`):

1. **Signature verify before body parse** — no payload is trusted prior to verification.
2. **Idempotency via `webhook_events`** — `claimWebhookEvent(provider, eventId, bodyHash)` performs an INSERT-ON-CONFLICT-DO-NOTHING claim; duplicate deliveries no-op.
3. **Cumulative-refund computation under `FOR UPDATE`** — provider events carry cumulative refund totals (Stripe) or single deltas (Ziina/N-Genius); the helper reconciles both shapes against the ledger with a bounded retry loop, escalating to `webhook_permanently_failed` on exhaustion.
4. **Currency-mismatch hard fail** — if the event's currency disagrees with the booking row, the handler refuses to apply the delta and logs `webhook_currency_mismatch`.

### Tested events

The Stripe handler listens for: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `payment_intent.canceled`. Subscription-billing events (`invoice.payment_succeeded`, `customer.subscription.deleted`) flow through a separate platform-side surface (`/api/webhooks/ziina-platform` and the Ziina manual-pay-link reconciler), not the per-club Stripe receiver — platform billing for Cavaliq itself runs on Ziina, not Stripe.

### Connect credentials (one-time setup)

Each club opens **Settings → Payments**, pastes their secret key / publishable key / webhook signing secret into a form, and we validate the credentials by calling `stripe.accounts.retrieve()` (or the provider equivalent) before encrypting and storing them. The pasted keys never round-trip back to the client — only the publishable key is returned at payment-init time. See `apps/web/app/api/v1/payments/stripe/connect/route.ts`.

### Coupon/Promo Code Validation

```typescript
// lib/coupons.ts
export async function validateCoupon(params: {
  code: string;
  clubId: string;
  riderId: string;
  bookingType: string;
  amount: number;
}): Promise<{ valid: boolean; discount: number; error?: string }> {
  const coupon = await db.query.coupons.findFirst({
    where: and(eq(coupons.code, params.code.toUpperCase()), eq(coupons.clubId, params.clubId)),
  });

  if (!coupon) {
    return { valid: false, discount: 0, error: 'Invalid promo code' };
  }

  // Check status
  if (coupon.status !== 'active') {
    return { valid: false, discount: 0, error: 'This promo code is no longer active' };
  }

  // Check expiry
  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return { valid: false, discount: 0, error: 'This promo code has expired' };
  }

  // Check start date
  if (coupon.startsAt && new Date() < coupon.startsAt) {
    return { valid: false, discount: 0, error: 'This promo code is not yet active' };
  }

  // Check total usage limit
  if (coupon.maxUses && coupon.usageCount >= coupon.maxUses) {
    return { valid: false, discount: 0, error: 'This promo code has reached its maximum uses' };
  }

  // Check per-rider usage limit
  if (coupon.maxUsesPerRider) {
    const riderUsageCount = await db.query.couponUsages.findMany({
      where: and(eq(couponUsages.couponId, coupon.id), eq(couponUsages.riderId, params.riderId)),
    });
    if (riderUsageCount.length >= coupon.maxUsesPerRider) {
      return { valid: false, discount: 0, error: 'You have already used this promo code' };
    }
  }

  // Check first-time rider restriction
  if (coupon.firstTimeOnly) {
    const existingBookings = await db.query.bookings.findMany({
      where: and(
        eq(bookings.riderId, params.riderId),
        eq(bookings.clubId, params.clubId),
        eq(bookings.status, 'completed'),
      ),
      limit: 1,
    });
    if (existingBookings.length > 0) {
      return { valid: false, discount: 0, error: 'This promo code is for first-time riders only' };
    }
  }

  // Check booking type restriction
  if (coupon.applicableTypes && !coupon.applicableTypes.includes(params.bookingType)) {
    return {
      valid: false,
      discount: 0,
      error: `This promo code is not valid for ${params.bookingType}`,
    };
  }

  // Check minimum spend
  if (coupon.minimumAmount && params.amount < coupon.minimumAmount) {
    return {
      valid: false,
      discount: 0,
      error: `Minimum spend of ${coupon.minimumAmount} required`,
    };
  }

  // Calculate discount
  let discount: number;
  if (coupon.discountType === 'percentage') {
    discount = Math.round(params.amount * (coupon.discountValue / 100));
    if (coupon.maxDiscount) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = coupon.discountValue;
  }

  // Discount cannot exceed order total
  discount = Math.min(discount, params.amount);

  return { valid: true, discount };
}
```

---

## SMART HORSE MATCHING ALGORITHM

This is a core differentiator. Implement it correctly.

```typescript
// lib/horse-matching.ts

interface MatchInput {
  rider: {
    skillLevel: 'beginner' | 'intermediate' | 'advanced';
    weight: number; // kg
    height: number; // cm
    age: number;
    id: string;
  };
  clubId: string;
  lessonType: string;
  dateTime: Date;
}

interface MatchResult {
  horse: Horse;
  score: number; // 0-100
  reasons: string[]; // Why this horse was recommended
  warnings: string[]; // Any concerns
}

export async function matchHorsesToRider(input: MatchInput): Promise<MatchResult[]> {
  // 1. Get all available horses for this club
  const availableHorses = await getAvailableHorses(input.clubId, input.dateTime);

  // 2. Filter out ineligible horses
  const eligible = availableHorses.filter((horse) => {
    // Horse must be available (not resting, injured, retired, sold)
    if (horse.status !== 'available') return false;

    // Horse must not be already booked at this time
    if (horse.bookedSlots.includes(input.dateTime.toISOString())) return false;

    // Horse must not have exceeded daily workload limit
    if (horse.lessonsToday >= horse.maxLessonsPerDay) return false;

    // Rider must not exceed horse's weight limit
    if (input.rider.weight > horse.weightLimit) return false;

    // Rider must meet horse's minimum age requirement
    if (input.rider.age < horse.minRiderAge) return false;

    return true;
  });

  // 3. Score each eligible horse
  const scored = eligible.map((horse) => {
    let score = 50; // Base score
    const reasons: string[] = [];
    const warnings: string[] = [];

    // Skill level match (most important factor: +/- 30 points)
    if (horse.skillLevel === input.rider.skillLevel) {
      score += 30;
      reasons.push(`Skill level match: ${horse.skillLevel}`);
    } else if (
      (horse.skillLevel === 'beginner' && input.rider.skillLevel === 'intermediate') ||
      (horse.skillLevel === 'intermediate' && input.rider.skillLevel === 'advanced')
    ) {
      score += 15;
      reasons.push('Suitable for rider progression');
    } else if (horse.skillLevel === 'advanced' && input.rider.skillLevel === 'beginner') {
      score -= 20;
      warnings.push('Horse may be too advanced for this rider');
    }

    // Weight comfort margin (+/- 15 points)
    const weightMargin = horse.weightLimit - input.rider.weight;
    if (weightMargin > 20) {
      score += 15;
      reasons.push('Comfortable weight margin');
    } else if (weightMargin > 10) {
      score += 5;
    } else if (weightMargin <= 5) {
      score -= 10;
      warnings.push('Rider weight is close to horse limit');
    }

    // Workload today (+/- 10 points)
    const workloadRatio = horse.lessonsToday / horse.maxLessonsPerDay;
    if (workloadRatio === 0) {
      score += 10;
      reasons.push('Horse is fresh today');
    } else if (workloadRatio > 0.7) {
      score -= 10;
      warnings.push('Horse has had a busy day');
    }

    // Temperament match for lesson type (+/- 10 points)
    if (input.lessonType === 'group' && horse.temperament.includes('calm')) {
      score += 10;
      reasons.push('Calm temperament, great for group lessons');
    }
    if (input.lessonType === 'desert_ride' && horse.temperament.includes('bombproof')) {
      score += 10;
      reasons.push('Bombproof temperament, ideal for outdoor rides');
    }

    // Past pairing success (+/- 15 points)
    const pastPairings = horse.pairingHistory.filter((p) => p.riderId === input.rider.id);
    if (pastPairings.length > 0) {
      const avgRating = pastPairings.reduce((sum, p) => sum + p.rating, 0) / pastPairings.length;
      if (avgRating >= 4) {
        score += 15;
        reasons.push(`Rider has ridden ${horse.name} before with great results`);
      } else if (avgRating >= 3) {
        score += 5;
        reasons.push(`Rider has ridden ${horse.name} before`);
      } else if (avgRating < 2) {
        score -= 15;
        warnings.push('Previous pairing had issues');
      }
    }

    // Clamp score between 0-100
    score = Math.max(0, Math.min(100, score));

    return { horse, score, reasons, warnings };
  });

  // 4. Sort by score (highest first) and return top 3
  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
```

This algorithm MUST have unit tests covering:

- Exact skill level match
- Weight at limit, over limit, well under limit
- Horse at max workload
- Positive and negative past pairings
- Different temperament/lesson type combinations
- No eligible horses (should return empty array, not crash)

---

## REAL-TIME INTEGRATION (Ably)

### Channel Structure

```
club:{clubId}:calendar          — Calendar updates (booking created/modified/cancelled)
club:{clubId}:bookings          — Booking status changes
club:{clubId}:horses            — Horse status changes (available/resting/injured)
club:{clubId}:notifications     — General notifications for club staff
user:{userId}:notifications     — Personal notifications for a specific user
club:{clubId}:chat:{channelId}  — Club community chat channels
```

### Publishing Events

```typescript
// lib/realtime.ts
import Ably from 'ably';

const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

export async function publishEvent(channel: string, event: string, data: unknown) {
  const ch = ably.channels.get(channel);
  await ch.publish(event, data);
}

// Usage after creating a booking:
await publishEvent(`club:${clubId}:calendar`, 'booking:created', {
  bookingId,
  slotId,
  riderId,
  horseId,
  coachId,
});
```

### Subscribing (Client-Side)

```typescript
// hooks/use-realtime.ts
import Ably from 'ably';
import { useEffect } from 'react';

export function useCalendarUpdates(clubId: string, onUpdate: (data: any) => void) {
  useEffect(() => {
    const ably = new Ably.Realtime({ authUrl: '/api/ably-token' });
    const channel = ably.channels.get(`club:${clubId}:calendar`);

    channel.subscribe('booking:created', (message) => onUpdate(message.data));
    channel.subscribe('booking:cancelled', (message) => onUpdate(message.data));
    channel.subscribe('booking:updated', (message) => onUpdate(message.data));

    return () => {
      channel.unsubscribe();
      ably.close();
    };
  }, [clubId, onUpdate]);
}
```

---

## EMAIL TEMPLATE PATTERN

All email templates are React components using @react-email/components:

```typescript
// packages/email-templates/booking-confirmation.tsx
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from '@react-email/components';

interface BookingConfirmationProps {
  riderName: string;
  lessonType: string;
  date: string;
  time: string;
  horseName: string;
  coachName: string;
  arena: string;
  clubName: string;
  clubLogo: string;
  amount?: string;
  addToCalendarUrl: string;
}

export function BookingConfirmation(props: BookingConfirmationProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Inter, sans-serif', backgroundColor: '#f9fafb' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '40px 20px' }}>
          {/* Club logo */}
          {/* Booking details */}
          {/* Add to calendar button */}
          {/* Cancellation policy note */}
          {/* Footer with unsubscribe */}
        </Container>
      </Body>
    </Html>
  );
}
```

---

## STRUCTURED LOGGING

```typescript
// lib/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  event: string;
  timestamp: string;
  requestId?: string;
  clubId?: string;
  userId?: string;
  [key: string]: unknown;
}

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => log('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => log('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
  debug: (event: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      log('debug', event, data);
    }
  },
};

function log(level: LogLevel, event: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // NEVER log sensitive data
  if (entry.password) delete entry.password;
  if (entry.token) delete entry.token;
  if (entry.cardNumber) delete entry.cardNumber;

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

// Usage:
logger.info('booking_created', {
  clubId: 'xxx',
  riderId: 'yyy',
  horseId: 'zzz',
  bookingId: 'aaa',
  lessonType: 'private',
  amount: 200,
  currency: 'AED',
});
```

---

## FILE UPLOAD PATTERN

```typescript
// lib/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Cloudflare R2 uses S3-compatible API
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Generate upload URL (client uploads directly to R2, never through our server)
export async function getUploadUrl(params: {
  clubId: string;
  folder: string; // 'horses/photos', 'horses/medical', 'invoices', etc.
  fileName: string;
  contentType: string;
  maxSizeBytes: number;
}) {
  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/gif'];
  if (!allowedTypes.includes(params.contentType)) {
    throw new Error(`File type ${params.contentType} is not allowed`);
  }

  const key = `${params.clubId}/${params.folder}/${Date.now()}-${params.fileName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    ContentType: params.contentType,
  });

  const url = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 minutes

  return { uploadUrl: url, key };
}

// Generate download URL (for sensitive files that need auth check)
export async function getDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });

  return getSignedUrl(r2, command, { expiresIn: 3600 }); // 1 hour
}
```

---

## ENVIRONMENT VARIABLES

```bash
# .env.example — Commit this file (no real values)

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Clerk (Auth)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Database (Neon)
DATABASE_URL=postgresql://...
DATABASE_URL_UNPOOLED=postgresql://...  # For migrations

# Cloudflare R2 (File Storage)
R2_ENDPOINT=https://...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=https://...

# Stripe (Payments)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Ably (Real-time)
ABLY_API_KEY=...
NEXT_PUBLIC_ABLY_KEY=...  # Client-side (subscribe only)

# Resend (Email)
RESEND_API_KEY=re_...

# Sentry (Error Tracking)
SENTRY_DSN=https://...
NEXT_PUBLIC_SENTRY_DSN=https://...

# Encryption
ENCRYPTION_KEY=...  # For field-level encryption of medical data
```

NEVER put real values in .env.example. NEVER commit .env.local.

---

## DEPLOYMENT

### Web App

- Host on Vercel (connects to GitHub, auto-deploys on push to main)
- Preview deployments for every PR
- Environment variables set in Vercel dashboard

### Mobile App

- Build with EAS (Expo Application Services)
- Test builds via Expo Go and development builds
- Production builds submitted to App Store and Google Play via EAS Submit

### Database

- Neon auto-manages scaling
- Migrations run via `pnpm db:migrate` (uses drizzle-kit)
- Never manually modify production database — always use migrations

### Domain Setup

- Main domain: TBD
- API: api.{domain}.com (or same domain, /api routes)
- Dashboard: app.{domain}.com
- Status page: status.{domain}.com
- Email sending: mail.{domain}.com (verified in Resend)
- All behind Cloudflare (DNS, CDN, WAF)
