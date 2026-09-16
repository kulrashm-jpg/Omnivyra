import type { NextApiRequest } from 'next';
import { config } from '@/config';
import { getCanonicalAppUrl } from '../config/getCanonicalAppUrl';

/**
 * SEC91-W2B-2 — where an OAuth `redirect_uri` origin may come from.
 *
 * Several redirect_uri builders took the origin from the request: `Host`, or
 * `X-Forwarded-Host` when present (plus `X-Forwarded-Proto`). Both headers are
 * client-controlled unless the platform in front of the app overwrites them, and
 * `getBaseUrl` even preferred the request host whenever it merely CLAIMED to be
 * localhost. A redirect_uri the client can choose is one the provider may send the
 * authorization code to.
 *
 * The rule now:
 *   - production (NODE_ENV=production — every Vercel deployment): the configured
 *     canonical app URL (`NEXT_PUBLIC_APP_URL`, validated by config/env.schema.ts,
 *     default https://www.omnivyra.com) ONLY. Request headers are ignored.
 *   - development / test: the request origin, exactly as before, so a developer on
 *     localhost gets a localhost callback that matches the app registered for it.
 *
 * Production compatibility: the builders that already preferred NEXT_PUBLIC_APP_URL
 * (getBaseUrl → every /api/auth/<provider>/callback) produce the same string as before.
 * The builders that followed the request host (X, community-AI connectors) now produce
 * `${NEXT_PUBLIC_APP_URL}/…`, which is the URL the Super Admin → Social Platforms screen
 * tells operators to register (components/super-admin/tabs/SocialPlatformsSectionModel.tsx
 * getPublicAppBaseUrl) and the same string the request host produced for traffic on the
 * canonical host.
 */

/** True only in development and test runtimes; anything else (incl. unset) is production. */
export function isRequestDerivedOriginAllowed(): boolean {
  const env = (config as { NODE_ENV?: string }).NODE_ENV ?? process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/** The configured public origin: lower-case, no trailing slash. */
export function getConfiguredAppOrigin(): string {
  return getCanonicalAppUrl().toLowerCase();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * The request origin (`proto://host`) — for NON-production callers only. Prefers
 * X-Forwarded-Host over Host, as the builders it replaces did.
 */
export function getRequestOrigin(req: NextApiRequest, defaultHost = 'localhost:3000'): string {
  const proto = firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() || 'http';
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host) || defaultHost;
  return `${proto}://${host}`;
}

/**
 * Origin for an OAuth redirect_uri that historically followed the request host.
 *
 * `loopback` keeps each provider's development spelling of the loopback host:
 *   - 'localhost'  — `127.0.0.1[:port]` → `localhost[:port]` (community-AI connectors);
 *   - '127.0.0.1'  — `localhost:<port>` → `127.0.0.1:<port>` (X, which requires it).
 * It applies only outside production.
 */
export function getOAuthRedirectBase(
  req: NextApiRequest,
  opts: { loopback?: 'localhost' | '127.0.0.1' } = {},
): string {
  if (!isRequestDerivedOriginAllowed()) return getConfiguredAppOrigin();
  const origin = getRequestOrigin(req).replace(/\/$/, '');
  if (opts.loopback === 'localhost') return origin.replace(/:\/\/127\.0\.0\.1(:|$)/, '://localhost$1');
  if (opts.loopback === '127.0.0.1') return origin.replace('://localhost:', '://127.0.0.1:');
  return origin;
}
