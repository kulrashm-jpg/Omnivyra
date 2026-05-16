/**
 * GET /api/super-admin/billing-alert-counts
 *
 * Phase H — lightweight badge counts for the "Credits & Billing" tab.
 * Returns just the numbers needed for the nav alert badge:
 *   - lowBalanceOrgs   (orgs with totalAvailable < threshold)
 *   - pendingApprovals (credit_action_approvals.status='pending')
 *   - anomalyCount     (cost_anomalies in last 24h, severity warn|critical)
 *   - frozenOrgs       (org_controls.emergency_freeze = true)
 *
 * Read-only, cheap (count head queries). Auth: FINANCE_AUDITOR+.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../backend/services/billing/financeRbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const lowBalanceThreshold = Number(req.query.lowBalanceThreshold ?? 100) || 100;

  try {
    const [pending, anomalies, frozen, wallets] = await Promise.all([
      supabase.from('credit_action_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase
        .from('cost_anomalies')
        .select('id', { count: 'exact', head: true })
        .in('severity', ['warn', 'critical'])
        .gte('detected_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      supabase.from('org_controls').select('organization_id', { count: 'exact', head: true }).eq('emergency_freeze', true),
      supabase
        .from('organization_credits')
        .select('free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive')
        .limit(1000),
    ]);

    let lowBalanceOrgs = 0;
    for (const w of ((wallets.data ?? []) as Array<Record<string, unknown>>)) {
      const avail =
        Math.max(0, Number(w.free_balance ?? 0) - Number(w.reserved_free ?? 0)) +
        Math.max(0, Number(w.paid_balance ?? 0) - Number(w.reserved_paid ?? 0)) +
        Math.max(0, Number(w.incentive_balance ?? 0) - Number(w.reserved_incentive ?? 0));
      if (avail < lowBalanceThreshold) lowBalanceOrgs += 1;
    }

    const counts = {
      lowBalanceOrgs,
      pendingApprovals: Number(pending.count ?? 0),
      anomalyCount:     Number(anomalies.count ?? 0),
      frozenOrgs:       Number(frozen.count ?? 0),
    };
    const total = counts.lowBalanceOrgs + counts.pendingApprovals + counts.anomalyCount + counts.frozenOrgs;

    return res.status(200).json({ generatedAt: new Date().toISOString(), counts, total });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
