/**
 * POST /api/rpa/auth/save-session
 *
 * Accepts a captured Playwright storageState blob and persists it to the
 * rpa_sessions table (DB canonical) + local fs (legacy fallback). The
 * caller MUST provide the session_token issued at /api/rpa/auth/start —
 * the token scopes the write to (organization_id, platform) and prevents
 * a cross-org save.
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

import { verifyRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const verified = verifyRpaAuthToken(token);
    if (verified.ok !== true) {
      return res.status(401).json({ error: 'INVALID_SESSION_TOKEN', reason: verified.reason });
    }

    const { organization_id, platform } = verified.payload;
    const accountTier = body.account_tier != null ? String(body.account_tier) : null;

    await saveRpaSession(organization_id, platform, storageState as Parameters<typeof saveRpaSession>[2], {
      account_tier: accountTier,
      last_login_at: new Date().toISOString(),
      expires_at: body.expires_at ?? null,
      last_verified_at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      organization_id,
      platform,
      account_tier: accountTier,
    });
  } catch (err) {
    console.error('[rpa/auth/save-session]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to save RPA session' });
  }
}
