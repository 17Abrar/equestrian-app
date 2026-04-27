import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  // Cron endpoints authenticate via x-cron-secret header, not Clerk session.
  // Cloudflare's scheduled() invocation has no user context.
  '/api/cron(.*)',
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
