import type { NextApiRequest } from 'next';
import { config } from '@/config';

/**
 * Derives the app base URL from the incoming request.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL env var — set this in production/staging so the redirect_uri
 *      is always exactly what was registered in the OAuth developer console.
 *   2. x-forwarded-proto + x-forwarded-host (reverse proxy / Vercel / Railway)
 *   3. req.headers.host (local dev fallback)
 *
 * The super admin UI should display the same value so admins copy the correct redirect URI
 * when registering their OAuth app.
 */
export function getBaseUrl(req: NextApiRequest): string {
  if (config.NEXT_PUBLIC_APP_URL) {
    return config.NEXT_PUBLIC_APP_URL.replace(/\/$/, '').toLowerCase();
  }
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http';
  const rawHost = ((req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost:3000').toLowerCase();
  // Browsers sometimes switch between localhost and 127.0.0.1; OAuth providers require an exact match
  // against registered redirect URIs, so pin to localhost for loopback.
  const host = rawHost.replace(/^127\.0\.0\.1(:|$)/, 'localhost$1');
  return `${proto}://${host}`;
}
