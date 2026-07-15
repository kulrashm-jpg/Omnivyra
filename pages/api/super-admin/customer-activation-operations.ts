import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/super-admin/customer-activation-operations
 *
 * OPERATIONAL execution tracking (Phase 20) — the Customer Activation Operations surface.
 *   GET  → per-customer ops tracker (milestones, %, outreach state, recent activity).
 *   POST → operator mutations on the isolated tracking tables:
 *            { action: 'set_state', company_id, state }                    — update workflow state
 *            { action: 'add_activity', company_id, activity_type, notes }  — append an activity
 *
 * Writes only to customer_activation_outreach / customer_activation_activity_log. Auth:
 * SUPER_ADMIN_DASHBOARD_VIEW (super-admin-only; isolated operational tables).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { supabase } from '../../../backend/db/supabaseClient';
import { loadCustomerActivationInputs } from '../../../backend/services/customerActivationWorkbenchService';
import {
  buildOperations,
  isOutreachState,
  type OutreachRecord,
  type ActivityLogEntry,
} from '../../../backend/services/customerActivationOperationsService';

async function loadOps() {
  const inputs = await loadCustomerActivationInputs(supabase);
  const ids = inputs.map((i) => i.company_id);
  const [outreachRes, activityRes] = await Promise.all([
    supabase.from('customer_activation_outreach').select('company_id, current_state, last_activity_date').in('company_id', ids),
    supabase.from('customer_activation_activity_log').select('id, company_id, activity_type, activity_date, owner, notes, status').in('company_id', ids),
  ]);
  return buildOperations(inputs, (outreachRes.data ?? []) as OutreachRecord[], (activityRes.data ?? []) as ActivityLogEntry[]);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin customer-activation-operations',
  });
  if (!guard.ok) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ operations: await loadOps() });
    }

    if (req.method === 'POST') {
      const body = req.body ?? {};
      const action = String(body.action ?? '');
      const companyId = String(body.company_id ?? '');
      if (!companyId) return res.status(400).json({ error: 'company_id required' });

      // Operate only on already-tracked CUSTOMER companies.
      const { data: existing } = await supabase
        .from('customer_activation_outreach').select('company_id').eq('company_id', companyId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'company is not a tracked customer' });

      const owner = String(body.owner ?? guard.principal?.userId ?? 'operator');
      const nowIso = new Date().toISOString();

      if (action === 'set_state') {
        const state = body.state;
        if (!isOutreachState(state)) return res.status(400).json({ error: 'invalid state' });
        await supabase.from('customer_activation_outreach')
          .update({ current_state: state, last_activity_date: nowIso, updated_at: nowIso })
          .eq('company_id', companyId);
        await supabase.from('customer_activation_activity_log').insert({
          company_id: companyId, activity_type: 'STATE_CHANGE', activity_date: nowIso, owner,
          notes: typeof body.notes === 'string' ? body.notes : null, status: state,
        });
        return res.status(200).json({ ok: true, operations: await loadOps() });
      }

      if (action === 'add_activity') {
        const activityType = String(body.activity_type ?? 'NOTE').slice(0, 64);
        await supabase.from('customer_activation_activity_log').insert({
          company_id: companyId, activity_type: activityType, activity_date: nowIso, owner,
          notes: typeof body.notes === 'string' ? body.notes : null,
          status: typeof body.status === 'string' ? body.status : null,
        });
        await supabase.from('customer_activation_outreach')
          .update({ last_activity_date: nowIso, updated_at: nowIso }).eq('company_id', companyId);
        return res.status(200).json({ ok: true, operations: await loadOps() });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message ?? 'operations_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/customer-activation-operations' });
