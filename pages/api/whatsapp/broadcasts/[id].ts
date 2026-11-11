import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET  /api/whatsapp/broadcasts/[id]           — broadcast detail + stats
 * POST /api/whatsapp/broadcasts/[id]/enqueue   — enqueue a draft broadcast
 * POST /api/whatsapp/broadcasts/[id]/retry     — retry failed recipients
 *
 * Action routing via ?action= query param:
 *   ?action=enqueue  → enqueueBroadcast
 *   ?action=retry    → retryFailed
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  enqueueBroadcast,
  retryFailed,
  expandRecipients,
  enqueueOutcomeResponse,
  retryOutcomeResponse,
  type ContactInput,
} from '../../../../backend/services/whatsappBroadcastService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id, action } = req.query as { id: string; action?: string };

  if (!id) return res.status(400).json({ error: 'Broadcast id required' });

  // Fetch broadcast first to get company_id for auth
  const { data: broadcast, error: fetchErr } = await supabase
    .from('whatsapp_broadcasts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !broadcast) return res.status(404).json({ error: 'Broadcast not found' });

  const access = await enforceCompanyAccess({ req, res, companyId: broadcast.company_id });
  if (!access) return;

  // ── GET: broadcast detail ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: recipientStats } = await supabase
      .from('whatsapp_broadcast_recipients')
      .select('status', { count: 'exact' })
      .eq('broadcast_id', id);

    // Group by status
    const byStatus: Record<string, number> = {};
    if (Array.isArray(recipientStats)) {
      for (const r of recipientStats) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      }
    }

    return res.status(200).json({ broadcast, recipient_status_counts: byStatus });
  }

  // ── POST: actions (enqueue / retry / add-recipients) ──────────────────────
  if (req.method === 'POST') {
    const roleGate = await enforceRole({ req, res, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
    if (!roleGate) return;

    if (action === 'enqueue') {
      const { plan = 'free' } = req.body || {};
      // `enqueued: true` only when jobs are known to be queued (enqueueOutcomeResponse).
      let outcome: Parameters<typeof enqueueOutcomeResponse>[0];
      try {
        outcome = { ok: true, result: await enqueueBroadcast(id, plan as string) };
      } catch (err) {
        outcome = { ok: false, error: err };
      }
      const answer = enqueueOutcomeResponse(outcome);
      return res.status(answer.status).json(answer.body);
    }

    if (action === 'retry') {
      // `retried: true` only when recipients were actually re-queued.
      let outcome: Parameters<typeof retryOutcomeResponse>[0];
      try {
        outcome = { ok: true, result: await retryFailed(id) };
      } catch (err) {
        outcome = { ok: false, error: err };
      }
      const answer = retryOutcomeResponse(outcome);
      return res.status(answer.status).json(answer.body);
    }

    if (action === 'recipients') {
      const { contacts } = req.body || {};
      if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts[] required' });
      }
      try {
        const result = await expandRecipients(id, contacts as ContactInput[]);
        return res.status(200).json(result);
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=enqueue|retry|recipients' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/whatsapp/broadcasts/:id' });
