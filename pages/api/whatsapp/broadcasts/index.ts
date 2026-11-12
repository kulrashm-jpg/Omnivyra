import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET  /api/whatsapp/broadcasts        — list broadcasts for a company
 * POST /api/whatsapp/broadcasts        — create + optionally enqueue
 *
 * Query params (GET): company_id, status (optional filter), limit, offset
 * Body (POST): CreateBroadcastInput + contacts[] + enqueue? (bool) + plan?
 *
 * POST requires an Idempotency-Key header (CLASS-2, e9): a double-clicked or re-sent create with
 * enqueue:true used to create TWO broadcasts and message every contact twice. withIdempotency
 * reserves the key (api_idempotency_keys, unique) before the handler runs, so the second request
 * replays the first's answer or is refused while it runs. The page mints one key per form
 * submission (useIdempotencyKey). GET is unaffected.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  createBroadcast,
  expandRecipients,
  enqueueBroadcast,
  BroadcastPartiallyEnqueuedError,
  refreshDirtyBroadcastCounts,
  senderAccountRefusalResponse,
  type CreateBroadcastInput,
  type ContactInput,
} from '../../../../backend/services/whatsappBroadcastService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: list broadcasts ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { company_id, status, limit = '20', offset = '0' } = req.query as Record<string, string>;

    if (!company_id) return res.status(400).json({ error: 'company_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    let query = supabase
      .from('whatsapp_broadcasts')
      .select('*', { count: 'exact' })
      .eq('company_id', company_id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);

    if (status) query = query.eq('status', status);

    let { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // A debounced (dirty) count is refreshed from the recipient rows, then re-read.
    if (await refreshDirtyBroadcastCounts((data ?? []) as Array<{ id: string; counts_dirty?: boolean | null }>)) {
      ({ data, count, error } = await query);
      if (error) return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ broadcasts: data ?? [], total: count ?? 0 });
  }

  // ── POST: create broadcast ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      company_id,
      social_account_id,
      name,
      message_type,
      template_name,
      template_params,
      body,
      media_id,
      media_caption,
      scheduled_for,
      contacts,
      enqueue = false,
      plan = 'free',
    } = req.body || {};

    if (!company_id || !social_account_id || !name || !message_type) {
      return res.status(400).json({ error: 'company_id, social_account_id, name, message_type required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: company_id });
    if (!access) return;

    const roleGate = await enforceRole({ req, res, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
    if (!roleGate) return;

    const input: CreateBroadcastInput = {
      company_id,
      social_account_id,
      name,
      message_type,
      template_name,
      template_params,
      body,
      media_id,
      media_caption,
      scheduled_for,
      created_by: access.userId,
    };

    let broadcastId: string;
    try {
      // createBroadcast refuses a social_account_id that does not belong to
      // company_id. Unknown and foreign accounts get the same 404.
      broadcastId = await createBroadcast(input);
    } catch (err) {
      const refused = senderAccountRefusalResponse(err);
      if (refused) return res.status(refused.status).json({ error: refused.error });
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create broadcast' });
    }

    // Expand recipients if contacts provided
    let inserted = 0;
    let skipped = 0;
    if (Array.isArray(contacts) && contacts.length > 0) {
      try {
        const result = await expandRecipients(broadcastId, contacts as ContactInput[]);
        inserted = result.inserted;
        skipped = result.skipped;
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to expand recipients', broadcast_id: broadcastId });
      }
    }

    // Optionally enqueue immediately
    if (enqueue && inserted > 0) {
      let run;
      try {
        run = await enqueueBroadcast(broadcastId, plan as string);
      } catch (err) {
        // A partial run still has queued batches that WILL send: enqueued stays true.
        const partial = err instanceof BroadcastPartiallyEnqueuedError;
        return res.status(202).json({
          broadcast_id: broadcastId,
          inserted,
          skipped,
          enqueued: partial,
          ...(partial ? { partial: true, uncertain: err.uncertain, batches: err.result.batches } : {}),
          enqueue_error: err instanceof Error ? err.message : String(err),
        });
      }
      // `enqueued: true` only when jobs are known to be queued.
      return res.status(201).json({ broadcast_id: broadcastId, inserted, skipped, enqueued: run.batches > 0, batches: run.batches });
    }

    return res.status(201).json({ broadcast_id: broadcastId, inserted, skipped, enqueued: false });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(withIdempotency(handler, { methods: ['POST'], scope: 'whatsapp-broadcast-create' }), { route: '/api/whatsapp/broadcasts' });
