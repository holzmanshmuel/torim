import type { NextConfig } from 'next';
import { allowedServerActionHosts } from './src/lib/canonical-origin';

/*
 * Read at server start as well as at build time, so APP_BASE_URL is a runtime
 * setting here and does not have to be present in the build environment.
 *
 * The allowlist is empty unless APP_BASE_URL is set, which is the correct default:
 * Next.js already permits same-origin Server Action requests on its own. It matters
 * only behind a proxy that rewrites Host — see src/lib/canonical-origin.ts for what
 * that failure looks like, because it is not obvious from the symptom.
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionHosts(process.env.APP_BASE_URL),
    },
  },
};

export default nextConfig;
