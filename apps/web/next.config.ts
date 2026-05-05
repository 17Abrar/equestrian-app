import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// audit F-3 (2026-05-05) — CSP moved out of next.config.ts.
//
// The header is now built per-request in `middleware.ts` so each
// response carries a fresh nonce: `script-src 'strict-dynamic'
// 'nonce-XXX' 'self' 'unsafe-inline' <hosts>`. Modern browsers
// (Chrome 52+, Firefox 52+, Safari 15.4+) honour `'strict-dynamic'`
// and treat the nonce as the only source of trust — `'unsafe-inline'`
// and the host allowlist are silently ignored. Older browsers fall
// back to the host list + `'unsafe-inline'`, preserving the prior
// looser-but-functional behaviour.
//
// Static security headers (X-Frame-Options, HSTS, Permissions-Policy,
// X-Content-Type-Options) stay here — they don't need per-request
// state and benefit from being baked into the build.

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
          // Content-Security-Policy: set per-request in middleware.ts.
          // Required for the per-request nonce; see audit F-3 above.
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
