import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/v1/health',
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
  if (request.nextUrl.pathname.startsWith('/api/v1/')) {
    const origin = request.headers.get('origin');
    if (isAllowedOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
    }
  }

  return response;
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
