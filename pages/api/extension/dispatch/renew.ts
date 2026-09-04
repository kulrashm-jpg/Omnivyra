import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/dispatch/renew
 *
 * Extends the dispatch lease of a browser command the caller is actively
 * executing.
 *
 * WHY THIS EXISTS
 *   The extension's own worst-case execution window is 96s
 *   (EXECUTION_TIMEOUT 30s x 3 attempts + RETRY_DELAY 2s + 4s), while the
 *   server lease was 90s and was never renewed. A command that hit two
 *   transient failures was therefore GUARANTEED to outlive its lease, at which
 *   point /api/extension/commands re-offered it to another session while the
 *   first was still driving the browser. One intended DM, two real DMs, and the
 *   first sender's result rejected as LEASE_EXPIRED so nothing recorded it.
 *
 *   Renewal makes the claim survive as long as the claimant is demonstrably
 *   alive and working, which is the only honest basis for holding it.
 *
 * WHAT THIS IS NOT
 *   Renewal is not delivery, not execution, and not acknowledgement. It moves
 *   an expiry timestamp and nothing else. It writes no engagement_messages,
 *   no platform_message_id, no counters, no opportunity transition and no
 *   reply-performance event. A renewed command is still merely `claimed`.
 *
 * Request:  { commandId: string, leaseId: string }
 * Response: { success: true, lease: { id, expires_at } }
 *
 * Fail-closed: every rejection is a 4xx and leaves the row untouched.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { supabase } from '@/backend/db/supabaseClient';

/**
 * Must match the claim TTL in /api/extension/commands. Renewal grants another
 * full window; it never grants an unbounded reservation, because a client that
 * stops renewing lets the lease lapse on schedule.
 */
export const RENEWAL_TTL_SECONDS = 90;

/** Identical derivation to /api/extension/commands — same session, same id. */
function deriveHolderId(session: { userId: string; orgId: string; hmacNonce: string }): string {
  const basis = `${session.userId}:${session.orgId}:${session.hmacNonce}`;
  return createHash('sha256').update(`lease-holder:${basis}`).digest('hex').slice(0, 32);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;

  if (!session.hmacNonce) {
    return res.status(401).json({ success: false, error: 'INVALID_SESSION', reason: 'SESSION_MISSING_HMAC_NONCE' });
  }

  const body = (req.body || {}) as { commandId?: string; leaseId?: string };
  const commandId = String(body.commandId || '').trim();
  const leaseId = String(body.leaseId || '').trim();

  if (!commandId) return res.status(400).json({ success: false, error: 'commandId required' });
  if (!leaseId) return res.status(400).json({ success: false, error: 'leaseId required' });

  const holderId = deriveHolderId({
    userId: session.userId,
    orgId: session.orgId,
    hmacNonce: session.hmacNonce as string,
  });

  const nowIso = new Date().toISOString();
  const nextExpiry = new Date(Date.now() + RENEWAL_TTL_SECONDS * 1000).toISOString();

  try {
    // ── Single conditional update — no read-then-write ────────────────────
    //    Every safety predicate lives in the WHERE clause, so the database is
    //    the serialisation point:
    //      organization_id  → tenant isolation (never from the request body)
    //      dispatch_lease_id / _holder_id → only the true holder may renew
    //      status='pending' → a terminalised command can never be revived
    //      expires_at > now → an already-lapsed lease is NOT renewable; by then
    //                         the command may have been re-offered, and silently
    //                         extending it would hand two sessions a live claim
    //    Zero rows matched ⇒ refusal. There is no fallback path.
    const { data: updated, error } = await supabase
      .from('community_ai_actions')
      .update({ dispatch_lease_expires_at: nextExpiry, updated_at: nowIso })
      .eq('id', commandId)
      .eq('organization_id', session.orgId)
      .eq('dispatch_lease_id', leaseId)
      .eq('dispatch_lease_holder_id', holderId)
      .eq('status', 'pending')
      .gt('dispatch_lease_expires_at', nowIso)
      .select('id, dispatch_lease_expires_at')
      .maybeSingle();

    if (error) {
      console.error('[extension/dispatch/renew] update failed:', error.message);
      return res.status(500).json({ success: false, error: 'RENEWAL_PERSIST_FAILED' });
    }

    if (!updated) {
      // Diagnose WITHOUT widening authority: this read is org-scoped and is
      // used only to return an actionable code. It never renews anything.
      const { data: row } = await supabase
        .from('community_ai_actions')
        .select('id, status, dispatch_lease_id, dispatch_lease_holder_id, dispatch_lease_expires_at')
        .eq('id', commandId)
        .eq('organization_id', session.orgId)
        .maybeSingle();

      if (!row) {
        // Covers both "no such command" and "belongs to another company".
        return res.status(404).json({ success: false, error: 'COMMAND_NOT_FOUND' });
      }
      const r = row as {
        status?: string | null;
        dispatch_lease_id?: string | null;
        dispatch_lease_holder_id?: string | null;
        dispatch_lease_expires_at?: string | null;
      };
      if (r.status !== 'pending') {
        return res.status(409).json({ success: false, error: 'TERMINAL', current_status: r.status });
      }
      if (!r.dispatch_lease_id || !r.dispatch_lease_holder_id) {
        return res.status(409).json({ success: false, error: 'NO_ACTIVE_LEASE' });
      }
      if (r.dispatch_lease_holder_id !== holderId) {
        return res.status(409).json({ success: false, error: 'LEASE_HOLDER_MISMATCH' });
      }
      if (r.dispatch_lease_id !== leaseId) {
        return res.status(409).json({ success: false, error: 'LEASE_ID_MISMATCH' });
      }
      return res.status(409).json({ success: false, error: 'LEASE_EXPIRED' });
    }

    return res.status(200).json({
      success: true,
      lease: {
        id: leaseId,
        expires_at: (updated as { dispatch_lease_expires_at?: string }).dispatch_lease_expires_at ?? nextExpiry,
      },
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Renewal failed';
    console.error('[extension/dispatch/renew]', message);
    return res.status(500).json({ success: false, error: 'RENEWAL_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/extension/dispatch/renew' });
