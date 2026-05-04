// AUTH EXEMPT: OAuth callback handles external provider redirect
/**
 * GET /api/rpa/auth/callback?session_token=...
 *
 * Convenience endpoint the login helper can hit after completing platform
 * login. Returns current registration status for the (organization_id,
 * platform) implied by the session_token. Does NOT accept storageState
 * here â€” that goes to /api/rpa/auth/save-session so the caller can hold
 * the blob in a secure context.
 *
 * Returns: { status: 'pending' | 'registered', last_login_at?, expires_at?, account_tier? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { verifyRpaAuthToken } from '../../../../backend/services/rpaWorker/rpaAuthTokens';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.query.session_token ?? req.query.token ?? '').toString().trim();
  if (!token) return res.status(400).json({ error: 'session_token required' });

  const verified = verifyRpaAuthToken(token);
  if (verified.ok !== true) {
    return res.status(401).json({ error: 'INVALID_SESSION_TOKEN', reason: verified.reason });
  }

  const { organization_id, platform } = verified.payload;

  try {
    const { data } = await supabase
      .from('rpa_sessions')
      .select('account_tier, last_login_at, expires_at, last_verified_at')
      .eq('organization_id', organization_id)
      .eq('platform', platform)
      .maybeSingle();

    if (!data) {
      return res.status(200).json({
        status: 'pending',
        organization_id,
        platform,
        instruction: 'POST storage_state to /api/rpa/auth/save-session with this session_token.',
      });
    }

    return res.status(200).json({
      status: 'registered',
      organization_id,
      platform,
      account_tier: data.account_tier,
      last_login_at: data.last_login_at,
      expires_at: data.expires_at,
      last_verified_at: data.last_verified_at,
    });
  } catch (err) {
    console.error('[rpa/auth/callback]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Callback failed' });
  }
}

