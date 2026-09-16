import type { NextApiRequest } from 'next';
import { config } from '@/config';
import { getConfiguredAppOrigin, isRequestDerivedOriginAllowed } from './oauthRedirectBase';

/**
 * Derives the app base URL for OAuth redirect_uri values.
 *
 * Production (SEC91-W2B-2): the configured canonical app URL
 * (`NEXT_PUBLIC_APP_URL`, lower-cased, trailing slash stripped) and nothing else.
 * `Host` / `X-Forwarded-Host` are client-controlled unless the platform overwrites
 * them, so they never choose where a provider sends an authorization code. This is
 * the same string production produced before for every request that did not claim
 * a localhost host.
 *
 * Development / test — priority:
 *   1. If the request actually arrived on a localhost host, use it. OAuth
 *      providers (LinkedIn, X, Pinterest, …) require an EXACT redirect_uri
 *      match. A dev environment with `NEXT_PUBLIC_APP_URL` pinned to
 *      production cannot prove the localhost callback is registered, and
 *      sending the production URL during a localhost OAuth dance is what
 *      caused the persistent `redirect_uri does not match the registered
 *      value` error on the LinkedIn connect flow.
 *   2. NEXT_PUBLIC_APP_URL env var.
 *   3. x-forwarded-proto + x-forwarded-host.
 *   4. req.headers.host (final fallback).
 *
 * The super admin UI should display the same value so admins copy the
 * correct redirect URI when registering their OAuth app.
 *
 * Localhost detection includes ipv4 loopback aliases. Browsers sometimes
 * switch between localhost and 127.0.0.1; OAuth providers require an exact
 * match, so we pin to `localhost`. The connector path uses the same
 * heuristic — see getCommunityAiConnectorCallbackUrl(utils.ts).
 */
export function getBaseUrl(req: NextApiRequest): string {
  if (!isRequestDerivedOriginAllowed()) return getConfiguredAppOrigin();

  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http';
  const rawHost = ((req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '').toLowerCase();
  const host = rawHost.replace(/^127\.0\.0\.1(:|$)/, 'localhost$1');
  const isLocalhost = host === 'localhost' || host.startsWith('localhost:');

  // (1) Pin to localhost when the request actually came in on localhost.
  if (isLocalhost) {
    return `${proto}://${host}`;
  }

  // (2) Prefer the configured public URL.
  if (config.NEXT_PUBLIC_APP_URL) {
    return config.NEXT_PUBLIC_APP_URL.replace(/\/$/, '').toLowerCase();
  }

  // (3) / (4) Forwarded headers or raw host as the last resort.
  if (host) return `${proto}://${host}`;
  return 'http://localhost:3000';
}
