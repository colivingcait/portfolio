import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Server actions in this app only ever write a handful of rows, but a PDF
    // statement arrives base64-encoded in the action body.
    serverActions: { bodySizeLimit: '8mb' },
  },
  /**
   * pdfjs resolves its worker relative to its own package. Bundled into a
   * server chunk it looks for the worker beside the chunk instead and fails
   * with "Setting up fake worker failed", so it is loaded from node_modules
   * at runtime.
   */
  serverExternalPackages: ['pdfjs-dist'],
};

export default nextConfig;
