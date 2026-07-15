/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reviews/builds shouldn't fail on lint; lint is run separately via `npm run lint`.
  eslint: { ignoreDuringBuilds: true },
  // Server-only libraries that must not be bundled for the browser.
  experimental: {
    serverComponentsExternalPackages: [
      'docxtemplater',
      'pizzip',
      'exceljs',
      'postgres',
      '@anthropic-ai/sdk',
      '@supabase/supabase-js',
    ],
  },
};

export default nextConfig;
