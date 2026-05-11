import type { NextApiRequest } from 'next';
import { config } from '@/config';

/**
 * Derives the app base URL from the incoming request.
 *
 * Priority:
 *   1. If the request actually arrived on a localhost host, use it. OAuth
 *      providers (LinkedIn, X, Pinterest, …) require an EXACT redirect_uri
 *      match. A dev environment with `NEXT_PUBLIC_APP_URL` pinned to
 *      production cannot prove the localhost callback is registered, and
 *      sending the production URL during a localhost OAuth dance is what
 *      caused the persistent `redirect_uri does not match the registered
 *      value` error on the LinkedIn connect flow.
 *   2. NEXT_PUBLIC_APP_URL env var — set this in production/staging so the
 *      redirect_uri is always exactly what was registered in the OAuth
 *      developer console for the deployed environment.
 *   3. x-forwarded-proto + x-forwarded-host (reverse proxy / Vercel / Railway).
 *   4. req.headers.host (final fallback).
 *
 * The super admin UI should display the same value so admins copy the
 * correct redirect URI when registering their OAuth app.
 *
 * Localhost detection includes ipv4 loopback aliases. Browsers sometimes
 * switch between localhost and 127.0.0.1; OAuth providers require an exact
 * match, so we pin to `localhost`. The connector path already uses this
 * heuristic — see getCommunityAiConnectorCallbackUrl(utils.ts) — and this
 * change aligns the two builders so localhost developers no longer get
 * an `https://www.omnivyra.com` redirect_uri.
 */
export function getBaseUrl(req: NextApiRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http';
  const rawHost = ((req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || '').toLowerCase();
  const host = rawHost.replace(/^127\.0\.0\.1(:|$)/, 'localhost$1');
  const isLocalhost = host === 'localhost' || host.startsWith('localhost:');

  // (1) Pin to localhost when the request actually came in on localhost.
  if (isLocalhost) {
    return `${proto}://${host}`;
  }

  // (2) Prefer the configured public URL for deployed environments.
  if (config.NEXT_PUBLIC_APP_URL) {
    return config.NEXT_PUBLIC_APP_URL.replace(/\/$/, '').toLowerCase();
  }

  // (3) / (4) Forwarded headers or raw host as the last resort.
  if (host) return `${proto}://${host}`;
  return 'http://localhost:3000';
}
