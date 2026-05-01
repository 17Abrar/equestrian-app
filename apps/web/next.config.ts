import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// CSP allowlist per third-party service.
//
// Clerk production uses a custom subdomain (`clerk.cavaliq.com`) for the
// Frontend API, plus `*.clerk.services` for account portal / image CDN /
// webhook backends. `*.clerk.accounts.dev` is kept so the app can still
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

const cspDirectives = [
  "default-src 'self'",
  // unsafe-inline required: Next.js injects inline hydration scripts; Clerk SDK injects inline scripts
  `script-src 'self' 'unsafe-inline' ${CLERK_SCRIPT} ${STRIPE_SCRIPT}`,
  // unsafe-inline required: Clerk SDK injects inline styles for its UI components
  `style-src 'self' 'unsafe-inline' ${CLERK_SCRIPT}`,
  // Any R2 public bucket (pub-*.r2.dev) — wildcard covers all buckets in the account
  "img-src 'self' data: blob: https://*.r2.dev https://img.clerk.com",
  "font-src 'self' data:",
  `connect-src 'self' ${CLERK_CONNECT} ${SENTRY_CONNECT} ${STRIPE_CONNECT} https://maps.googleapis.com`,
  `frame-src 'self' ${CLERK_FRAME} ${STRIPE_FRAME}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ');

const nextConfig: NextConfig = {
  transpilePackages: [
    '@equestrian/shared',
    '@equestrian/db',
    '@equestrian/api-client',
    '@equestrian/email-templates',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.dev',
        pathname: '/**',
      },
      // Audit L-8: Clerk's user avatars come from img.clerk.com. The
      // CSP `img-src` already allows it, but `next/image` enforces a
      // separate `remotePatterns` allowlist that would otherwise reject
      // the avatar URL at runtime.
      {
        protocol: 'https' as const,
        hostname: 'img.clerk.com',
        pathname: '/**',
      },
      ...(process.env.R2_PUBLIC_URL
        ? [
            {
              protocol: 'https' as const,
              hostname: new URL(process.env.R2_PUBLIC_URL).hostname,
              pathname: '/**',
            },
          ]
        : []),
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Content-Security-Policy', value: cspDirectives },
        ],
      },
      // CORS headers are set dynamically in middleware.ts (origin allowlist)
      {
        source: '/api/v1/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, x-request-id',
          },
          {
            key: 'Access-Control-Expose-Headers',
            value: 'x-request-id, retry-after',
          },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ];
  },
};

// Wrap the config with Sentry. Source-map upload is active only when
// SENTRY_AUTH_TOKEN is set at build time; otherwise the wrapper is a
// pass-through.
export default withSentryConfig(nextConfig, {
  // Org + project are public slugs; baking them in keeps the build
  // self-contained and removes env-var coupling at build time.
  org: 'cavaliq',
  project: 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Include dependencies from the Next.js output when uploading source
  // maps so stack traces in node_modules still resolve to readable frames.
  widenClientFileUpload: true,
  // Surface the Sentry wrapper's console output in CI (source-map upload
  // diagnostics are useful when a release pushes silently fails). Quiet
  // locally so dev builds don't spam the terminal. Audit L-2 — fixes the
  // prior comment-vs-code inversion.
  silent: !process.env.CI,
  // Avoid ad-blocker interference in production by routing Sentry's ingest
  // through a same-origin `/monitoring` tunnel.
  tunnelRoute: '/monitoring',
});
