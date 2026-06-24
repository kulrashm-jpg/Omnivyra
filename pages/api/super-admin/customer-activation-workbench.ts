/**
 * GET /api/super-admin/customer-activation-workbench
 *
 * OPERATIONAL tooling (Phase 17) — the Customer Activation Workbench. Returns the per-customer
 * milestone status matrix, executable Action Cards, the Customer Success Queue, and the First
 * Customer Success Tracker. Read-only; no writes/side effects. Not an intelligence/audit layer.
 *
 * Query params (optional): target (tracker company name).
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  buildWorkbench,
  loadCustomerActivationInputs,
  DEFAULT_TRACKER_TARGET,
} from '../../../backend/services/customerActivationWorkbenchService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin customer-activation-workbench (GET)',
  });
  if (!guard.ok) return;

  try {
    const target = typeof req.query.target === 'string' && req.query.target.trim()
      ? req.query.target.trim()
      : DEFAULT_TRACKER_TARGET;

    const inputs = await loadCustomerActivationInputs(supabase);
    const result = buildWorkbench(inputs, target);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message ?? 'workbench_failed' });
  }
}
