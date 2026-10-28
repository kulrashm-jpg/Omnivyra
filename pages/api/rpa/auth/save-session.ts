import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/rpa/auth/save-session
 *
 * Accepts a captured Playwright storageState blob and persists it, ENCRYPTED
 * (AES-256-GCM, ENCRYPTION_KEY), to the rpa_sessions table. There is no
 * filesystem copy. The caller MUST provide the single-use, user-bound
 * session_token issued at /api/rpa/auth/start — the token scopes the write to
 * (organization_id, platform) and prevents a cross-org save or a replay.
 * `account_tier` is accepted for compatibility but ignored (never trusted).
 *
 * Body:
 *   {
 *     session_token: string,
 *     storage_state: PlaywrightStorageState,
 *     account_tier?: 'business' | 'creator' | 'personal' | null,
 *     expires_at?: ISO string,
 *   }
 *
 * Returns: { success, organization_id, platform }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { consumeRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';
import { saveRpaSession } from '../../../../backend/services/rpaWorker/rpaSessionStore';

type SaveSessionBody = {
  session_token?: string;
  storage_state?: unknown;
  account_tier?: string | null;
  expires_at?: string | null;
};

function looksLikeStorageState(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  // Playwright shape: { cookies: [...], origins: [...] }
  return Array.isArray(obj.cookies) || Array.isArray(obj.origins);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as SaveSessionBody;
    const token = (body.session_token ?? '').toString();
    const storageState = body.storage_state;

    if (!token) return res.status(400).json({ error: 'session_token required' });
    if (!looksLikeStorageState(storageState)) {
      return res.status(400).json({ error: 'storage_state must be a Playwright storageState object' });
    }

    // Single-use, user-bound redemption: signature + expiry, the issuing user
    // must still hold the connector-management role for the organization, and
    // the token nonce is consumed durably BEFORE anything is written. A replay
    // (or a concurrent second submission) is refused.
    const verified = await consumeRpaAuthToken(token);
    if (verified.ok === false) {
      return res.status(verified.status).json({
        error: verified.status === 403 ? 'FORBIDDEN_ROLE' : verified.status === 503 ? 'TOKEN_REDEMPTION_UNAVAILABLE' : 'INVALID_SESSION_TOKEN',
        reason: verified.reason,
      });
    }

    const { organization_id, platform } = verified.payload;
    // A client-declared account_tier is NEVER stored or trusted: it gated the
    // Instagram business-only DM path. The tier stays unknown (null) until a
    // server-side verifier establishes it.
    const declaredTierIgnored = body.account_tier != null;

    await saveRpaSession(organization_id, platform, storageState as Parameters<typeof saveRpaSession>[2], {
      account_tier: null,
      last_login_at: new Date().toISOString(),
      expires_at: body.expires_at ?? null,
      last_verified_at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      organization_id,
      platform,
      account_tier: null,
      account_tier_status: 'unverified',
      declared_account_tier_ignored: declaredTierIgnored,
    });
  } catch (err) {
    console.error('[rpa/auth/save-session]', err);
    return res.status(500).json({ error: 'Failed to save RPA session' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/rpa/auth/save-session' });
