import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // pacotes que rodam só no servidor/worker (binários, Chromium, webpack do Remotion)
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', '@remotion/vercel', '@vercel/sandbox', 'esbuild'],
  experimental: {serverActions: {bodySizeLimit: '10mb'}},
};

export default nextConfig;
