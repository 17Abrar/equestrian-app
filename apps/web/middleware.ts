import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

// audit F-3 (2026-05-05) — CSP host allowlists. Mirrored from the
// previous next.config.ts CSP block so behaviour for legacy browsers
// (no `'strict-dynamic'` support) is byte-for-byte unchanged. Modern
// browsers ignore the host list when `'strict-dynamic'` is present in
// `script-src` and trust the nonce-loaded scripts' transitive imports
// instead.
//
// Clerk production uses a custom subdomain (`clerk.cavaliq.com`) for
// the Frontend API, plus `*.clerk.services` for account portal / image
// CDN / webhook backends. `*.clerk.accounts.dev` stays so the app can
// boot against a dev Clerk instance without a config change.
// `challenges.cloudflare.com` is Clerk's bot-protection challenge host.
const CLERK_SCRIPT =
  'https://clerk.cavaliq.com https://*.clerk.services https://*.clerk.accounts.dev https://challenges.cloudflare.com';
const CLERK_CONNECT =
  'https://clerk.cavaliq.com https://*.clerk.services https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com';
const CLERK_FRAME =
  'https://clerk.cavaliq.com https://*.clerk.accounts.dev https://challenges.cloudflare.com';

const SENTRY_CONNECT =
  'https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io';

const STRIPE_SCRIPT = 'https://js.stripe.com';
const STRIPE_CONNECT = 'https://api.stripe.com';
const STRIPE_FRAME = 'https://js.stripe.com https://hooks.stripe.com';

/**
 * Build the per-request CSP. The `nonce` flows through three places:
 *
 *   1. The `script-src` directive carries `'nonce-${nonce}' 'strict-dynamic'`
 *      so Next.js's hydration scripts (which the framework auto-tags
 *      with the nonce when it sees `x-nonce` on the incoming request)
 *      and ClerkProvider's injected scripts (passed `nonce` via the
 *      layout) are trusted, plus any non-parser-inserted descendant
 *      scripts those load (e.g. Stripe.js inserted by `loadStripe()`).
 *   2. `'unsafe-inline'` is kept in script-src purely as the legacy
 *      fallback. CSP3-compliant browsers IGNORE `'unsafe-inline'` when
 *      `'strict-dynamic'` is present, so this only relaxes the policy
 *      for browsers that wouldn't have understood `'strict-dynamic'`
 *      anyway — they would already be running with the prior, looser
 *      behaviour.
 *   3. The host allowlist (`CLERK_SCRIPT`, `STRIPE_SCRIPT`) is also
 *      kept as a legacy fallback for the same reason. CSP3 browsers
 *      ignore it; pre-CSP3 browsers continue to use it.
 *
 * `style-src` keeps `'unsafe-inline'` deliberately. Clerk's React
 * components inject inline `style="…"` attributes (no nonce attribute
 * exists for inline style attributes in CSP3), and Tailwind v4's
 * generated stylesheets are external. The XSS blast radius from inline
 * styles is much smaller than from inline scripts (no JS execution).
 *
 * `'unsafe-eval'` is added in dev because React's dev runtime uses
 * `eval` for component-stack resolution — production never needs it.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' ${CLERK_SCRIPT} ${STRIPE_SCRIPT}${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${CLERK_SCRIPT}`,
    "img-src 'self' data: blob: https://*.r2.dev https://img.clerk.com",
    "font-src 'self' data:",
    `connect-src 'self' ${CLERK_CONNECT} ${SENTRY_CONNECT} ${STRIPE_CONNECT} https://maps.googleapis.com`,
    `frame-src 'self' ${CLERK_FRAME} ${STRIPE_FRAME}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * Apply CSP to the response only when the request will likely render
 * an HTML document — CSP on a JSON API response is wasted bytes and
 * the browser doesn't enforce it (no rendering context). Webhook
 * receivers under `/api/webhooks/*` and the Sentry tunnel
 * (`/monitoring/*`) similarly don't need CSP — they're server-to-
 * server or bare ingest endpoints. Everything else gets the header.
 */
function shouldApplyCsp(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/monitoring')) return false;
  return true;
}

/**
 * Generate a CSP nonce. URL-safe base64 of 16 random bytes (128 bits)
 * is unguessable enough for the CSP3 nonce contract — the spec
 * recommends >= 128 bits. `crypto.randomUUID()` is also 122 bits of
 * entropy when base64-encoded, but UUIDs include hyphens which look
 * odd in a CSP header and need quoting; a base64 string is cleaner.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa is available in the Workers + Edge runtimes.
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '');
}

// Audit auth-2: Public-route matcher locked to specific paths (NOT
// `/api/cron(.*)` or `/api/webhooks(.*)` blanket prefixes) so a future
// route added under those prefixes can't be unintentionally exposed
// without an explicit secret check. Add new public routes here
// deliberately.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/stripe/(.*)',
  '/api/webhooks/clerk',
  '/api/webhooks/n-genius',
  '/api/webhooks/ziina/(.*)',
  '/api/webhooks/ziina-platform',
  // Cron endpoints authenticate via x-cron-secret header, not Clerk session.
  // Cloudflare's scheduled() invocation has no user context.
  '/api/cron/livery-billing',
  '/api/cron/platform-billing',
  '/api/cron/booking-reminders',
  '/api/cron/horse-care-reminders',
  '/api/v1/health',
  // Sentry's tunnel route — forwards client-side errors through our origin
  // so they aren't blocked by ad-blockers. Must be reachable unauthenticated.
  '/monitoring(.*)',
  // Public rider funnel — unauthenticated club discovery and public profiles.
  // Riders need to browse before deciding to sign up.
  '/discover(.*)',
  '/c/(.*)',
  '/api/v1/discover(.*)',
]);

// CORS origin allowlist — set CORS_ALLOWED_ORIGINS as comma-separated list in env.
// When empty, no Access-Control-Allow-Origin header is set (same-origin only).
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

export default clerkMiddleware(async (auth, request) => {
  const requestId = crypto.randomUUID();

  // Handle CORS preflight — OPTIONS requests carry no auth token,
  // so they must be answered before auth.protect() runs.
  if (
    request.method === 'OPTIONS' &&
    request.nextUrl.pathname.startsWith('/api/v1/')
  ) {
    const origin = request.headers.get('origin');
    const preflightHeaders: Record<string, string> = {
      'x-request-id': requestId,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-request-id',
      'Access-Control-Max-Age': '86400',
    };
    if (isAllowedOrigin(origin)) {
      preflightHeaders['Access-Control-Allow-Origin'] = origin;
      preflightHeaders['Vary'] = 'Origin';
    }
    return new NextResponse(null, { status: 204, headers: preflightHeaders });
  }

  request.headers.set('x-request-id', requestId);

  // audit F-3 (2026-05-05) — generate the per-request CSP nonce here,
  // BEFORE NextResponse.next(), so it's both:
  //   * On the request headers (`x-nonce`) — Next.js auto-tags its own
  //     hydration scripts with this value, and Server Components can
  //     read it via `headers()` to pass to ClerkProvider / <Script>.
  //   * In the CSP response header (set after the response is built
  //     below), so the browser's enforcement points at the same value.
  // Generated for every request; the response header is only attached
  // when the response is HTML-ish (see shouldApplyCsp). Applies even
  // for public routes — the nonce isn't a secret, it's a one-shot
  // trust marker.
  const nonce = generateNonce();
  request.headers.set('x-nonce', nonce);

  // Audit X-1 / B-2: enforce a 1 MB body cap on every /api/v1/* mutation
  // BEFORE handlers run. Per-route helpers (`parseRequiredBody`) cap as
  // well, but ~55 routes still call `request.json()` directly. The
  // Content-Length pre-check rejects oversized bodies before the worker
  // isolate parses anything. Webhooks have their own per-provider caps
  // in `lib/payments/webhook-body.ts` (smaller than this default).
  //
  // Audit AI-10: Cloudflare Workers buffers the request body and sets
  // `Content-Length` before invoking the worker, so chunked-transfer
  // requests don't reach this middleware in practice. We still reject
  // them explicitly here as defense in depth — a future runtime change
  // (or a different reverse proxy in front of this code) would otherwise
  // let a `Transfer-Encoding: chunked` request slip past the cap and
  // burn the worker's CPU/memory budget on a hostile body. The same
  // guard refuses a bodied request that omits Content-Length entirely.
  if (
    request.nextUrl.pathname.startsWith('/api/v1/') &&
    request.method !== 'GET' &&
    request.method !== 'HEAD'
  ) {
    const transferEncoding = request.headers.get('transfer-encoding');
    if (transferEncoding && transferEncoding.toLowerCase().includes('chunked')) {
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: {
            code: 'LENGTH_REQUIRED',
            message: 'Chunked transfer encoding is not supported. Send Content-Length.',
          },
        }),
        {
          status: 411,
          headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
        },
      );
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > 1 * 1024 * 1024) {
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 1 MB cap' },
          }),
          {
            status: 413,
            headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
          },
        );
      }
    }
  }

  if (!isPublicRoute(request)) {
    await auth.protect({
      unauthenticatedUrl: new URL('/sign-in', request.url).toString(),
    });
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  response.headers.set('x-request-id', requestId);

  // Dynamic CORS: echo back origin only if it's in the allowlist
  // Stash the request pathname so api-utils' withAuth can default the
  // rate-limit bucket key per-route — see audit G-21. Request headers are
  // mutable here (NextRequest's headers are a copy of the incoming
  // Headers object); withAuth reads via headers().get('x-pathname').
  request.headers.set('x-pathname', request.nextUrl.pathname);

  if (request.nextUrl.pathname.startsWith('/api/v1/')) {
    const origin = request.headers.get('origin');
    if (isAllowedOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
    }
  }

  // audit F-3 (2026-05-05) — attach the CSP last so it survives any
  // earlier `response.headers.set('Content-Security-Policy', ...)` from
  // upstream code (there is none today, but the explicit ordering
  // documents intent). Skipped on API and webhook responses where CSP
  // has no enforcement target — see shouldApplyCsp.
  if (shouldApplyCsp(request)) {
    response.headers.set('Content-Security-Policy', buildCsp(nonce));
  }

  return response;
});

// The extension list is anchored to the end of the path with `$`, so
// `data.json` is NOT excluded by the `js` alternative — only paths ending
// in `.js` are. Replaces the previous `js(?!on)` lookahead, which was
// easy to break when adding extensions (every new alternative had to be
// audited for partial-prefix collisions like js/json). To add a new
// static extension, append it to the alternation below.
//
// NB: Next.js parses `config.matcher` statically at build time and rejects
// template-literal interpolation, so the pattern has to be a literal
// string here — don't refactor it into a constant.
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)',
    '/(api|trpc)(.*)',
  ],
};
