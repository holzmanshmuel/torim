import type { NextConfig } from 'next';
import { allowedHosts } from './src/lib/canonical-origin';

/*
 * Read at server start as well as at build time, so APP_BASE_URL and
 * SERVER_ACTIONS_ALLOWED_ORIGINS are runtime settings here and do not have to be
 * present in the build environment.
 *
 * The allowlist is empty unless one of them is set, which is the correct default:
 * Next.js already permits same-origin Server Action requests on its own. It matters
 * only behind a proxy that rewrites Host — see src/lib/canonical-origin.ts for what
 * that failure looks like, because it is not obvious from the symptom.
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: allowedHosts(process.env),
    },
  },
};

export default nextConfig;
