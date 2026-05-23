import type { NextApiRequest } from 'next';
import { getBaseUrl } from './getBaseUrl';

/**
 * Build the canonical OAuth redirect_uri for a provider callback.
 *
 * Critical invariant: the same `(provider, runtime)` pair MUST produce the
 * exact same string at authorization-URL construction AND at token exchange,
 * even if the two requests arrive at different hostnames (www vs apex, raw
 * vs forwarded host, preview-alias vs canonical). Most OAuth providers
 * reject token exchange when redirect_uri differs from the value used to
 * mint the authorization code.
 *
 * Host derivation is delegated to `getBaseUrl`, which pins to the
 * env-configured canonical (`NEXT_PUBLIC_APP_URL`) for deployed
 * environments and falls back to the request host only for localhost dev.
 * Callers in both the authorize and callback handlers must use this helper
 * instead of inlining their own header-derived URL.
 */
export function getCanonicalOAuthRedirectUri(
  provider: string,
  req: NextApiRequest,
): string {
  return `${getBaseUrl(req)}/api/auth/${provider}/callback`;
}
