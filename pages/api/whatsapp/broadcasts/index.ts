import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET  /api/whatsapp/broadcasts        â€” list broadcasts for a company
 * POST /api/whatsapp/broadcasts        â€” create + optionally enqueue
 *
 * Query params (GET): company_id, status (optional filter), limit, offset
 * Body (POST): CreateBroadcastInput + contacts[] + enqueue? (bool) + plan?
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  createBroadcast,
  expandRecipients,
  enqueueBroadcast,
  type CreateBroadcastInput,
  type ContactInput,
} from '../../../../backend/services/whatsappBroadcastService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // â”€â”€ GET: list broadcasts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ broadcasts: data ?? [], total: count ?? 0 });
  }

  // â”€â”€ POST: create broadcast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      broadcastId = await createBroadcast(input);
    } catch (err) {
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
      try {
        await enqueueBroadcast(broadcastId, plan as string);
      } catch (err) {
        return res.status(202).json({
          broadcast_id: broadcastId,
          inserted,
          skipped,
          enqueued: false,
          enqueue_error: err instanceof Error ? err.message : String(err),
        });
      }
      return res.status(201).json({ broadcast_id: broadcastId, inserted, skipped, enqueued: true });
    }

    return res.status(201).json({ broadcast_id: broadcastId, inserted, skipped, enqueued: false });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

