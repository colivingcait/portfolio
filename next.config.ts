import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Server actions in this app only ever write a handful of rows.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
