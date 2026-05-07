/**
 * GET /api/auth/sessions
 *
 * Lists all active (non-revoked, non-expired) auth_sessions for the
 * authenticated principal. Used by the security dashboard's "Active
 * sessions" section.
 *
 * Includes a `current` flag so the UI can label the calling session.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { supabase as db } from '../../../../backend/db/supabaseClient';

interface AuthSessionRow {
  id: string;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(403).json({ error: 'Bridge principals have no auth sessions', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }

  const { data } = await db
    .from('auth_sessions')
    .select('id, ip, user_agent, device_id, created_at, last_seen_at, expires_at')
    .eq('user_id', p.userId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false });

  const rows = (data ?? []) as AuthSessionRow[];

  return res.status(200).json({
    currentSessionId: p.sessionId,
    sessions: rows.map((r) => ({
      id:           r.id,
      ip:           r.ip,
      userAgent:    r.user_agent,
      deviceId:     r.device_id,
      createdAt:    r.created_at,
      lastSeenAt:   r.last_seen_at,
      expiresAt:    r.expires_at,
      isCurrent:    r.id === p.sessionId,
    })),
  });
}
