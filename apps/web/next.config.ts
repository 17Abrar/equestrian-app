import type { NextConfig } from 'next';

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
      // Add custom domain for production R2 bucket when configured
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
};

export default nextConfig;
