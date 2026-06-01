/**
 * POST /api/engagement/thread/reply-lock
 * Lightweight, non-binding soft-lock for the reply composer. Discourages two
 * operators from replying to the same thread at once. A lock auto-expires after
 * LOCK_TTL; any operator may override an active lock with { force: true }.
 *
 * Body: { thread_id, organization_id, action: 'acquire' | 'release' | 'heartbeat', force? }
 * Lock owner is server-derived from the session (never client-supplied).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

type Body = {
  thread_id?: string;
  organization_id?: string;
  action?: 'acquire' | 'release' | 'heartbeat';
  force?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const threadId = body.thread_id?.trim();
    const organizationId = body.organization_id ?? user?.defaultCompanyId;
    const action = body.action || 'acquire';

    if (!threadId) return res.status(400).json({ error: 'thread_id required' });
    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;
    const me = access.userId;

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('id, organization_id, reply_lock_user_id, reply_lock_expires_at')
      .eq('id', threadId)
      .maybeSingle();

    if (!thread || (thread as { organization_id: string | null }).organization_id !== organizationId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const row = thread as {
      reply_lock_user_id: string | null;
      reply_lock_expires_at: string | null;
    };
    const now = Date.now();
    const lockExpMs = row.reply_lock_expires_at ? Date.parse(row.reply_lock_expires_at) : 0;
    const lockActive = !!row.reply_lock_user_id && lockExpMs > now;

    if (action === 'release') {
      // Only the holder can release; releasing a lock you don't hold is a no-op.
      if (row.reply_lock_user_id === me) {
        await supabase
          .from('engagement_threads')
          .update({ reply_lock_user_id: null, reply_lock_expires_at: null })
          .eq('id', threadId);
      }
      return res.status(200).json({ success: true, locked: false, held_by: null });
    }

    // acquire / heartbeat
    if (lockActive && row.reply_lock_user_id !== me && !body.force) {
      // Held by someone else and not expired — report the conflict; the client
      // decides whether to override (non-blocking).
      return res.status(200).json({
        success: true,
        locked: false,
        held_by: row.reply_lock_user_id,
        expires_at: row.reply_lock_expires_at,
      });
    }

    const expiresAt = new Date(now + LOCK_TTL_MS).toISOString();
    const { error: updateError } = await supabase
      .from('engagement_threads')
      .update({ reply_lock_user_id: me, reply_lock_expires_at: expiresAt })
      .eq('id', threadId);

    if (updateError) {
      console.warn('[engagement/thread/reply-lock]', updateError.message);
      return res.status(500).json({ error: 'Failed to update reply lock' });
    }

    return res.status(200).json({ success: true, locked: true, held_by: me, expires_at: expiresAt });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/reply-lock]', msg);
    return res.status(500).json({ error: msg });
  }
}
