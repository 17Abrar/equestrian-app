import type { NextConfig } from 'next';

const cspDirectives = [
  "default-src 'self'",
  // unsafe-inline required: Next.js injects inline hydration scripts; Clerk SDK injects inline scripts
  "script-src 'self' 'unsafe-inline' https://accounts.clerk.dev https://*.clerk.accounts.dev",
  // unsafe-inline required: Clerk SDK injects inline styles for its UI components
  "style-src 'self' 'unsafe-inline' https://accounts.clerk.dev https://*.clerk.accounts.dev",
  `img-src 'self' data: blob: https://*.r2.dev https://img.clerk.com${process.env.R2_PUBLIC_URL ? ` https://${new URL(process.env.R2_PUBLIC_URL).hostname}` : ''}`,
  "font-src 'self'",
  "connect-src 'self' https://accounts.clerk.dev https://*.clerk.accounts.dev",
  "frame-src 'self' https://accounts.clerk.dev https://*.clerk.accounts.dev",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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

export default nextConfig;
