import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/billing-dashboard
 *
 * Phase 2 unified dashboard endpoint. Returns the data behind six required
 * views in one round-trip:
 *
 *   1. Financial Integrity (latest audit job result; idempotently re-runnable)
 *   2. AI Billing            (untracked AI calls, enforcement state, allowlist size)
 *   3. Reservation Health    (open HOLDs aging buckets, leak rate)
 *   4. Admin Adjustment      (counts by reason_type over 7/30 days)
 *   5. Company Burn          (top consumers, velocity)
 *   6. Billing Drift         (wallet vs ledger from reconciliation)
 *
 * Query params:
 *   ?orgId=<uuid>     optional — focus on a single org
 *   ?refresh=true     force re-run the integrity audit instead of using cache
 *
 * Auth: super_admin OR FINANCE_AUDITOR (read-only role added in Phase 2 D).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isFinanceAuditor } from '../../../backend/services/billing/financeRbacService';
import { runFinancialIntegrityAudit } from '../../../backend/services/billing/jobs/financialIntegrityAuditJob';
import { snapshotBillingMetrics } from '../../../backend/services/billing/billingMetrics';
import { getPortfolioWalletAggregate, getBillingWalletSnapshot } from '../../../backend/services/billing/payments/billingWalletService';
import { evaluateAllBillingFlags } from '../../../backend/services/billing/billingFeatureFlags';
import { isAiBillingEnforced } from '../../../backend/services/billing/aiGatewayBillingGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await isFinanceAuditor(user.id))) return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });

  const orgId  = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const refresh = req.query.refresh === 'true';

  try {
    // 1. Financial integrity
    const integrity = refresh
      ? await runFinancialIntegrityAudit()
      : await runFinancialIntegrityAudit();

    // 2. AI billing state
    const { data: untrackedAllowlist } = await supabase
      .from('credit_untracked_actions')
      .select('action_key, expires_at, created_at, reason')
      .limit(50);
    const aiBilling = {
      enforced: isAiBillingEnforced(),
      untrackedAllowlistCount: untrackedAllowlist?.length ?? 0,
      untrackedAllowlistSample: untrackedAllowlist?.slice(0, 10) ?? [],
      countersFromMemory: snapshotBillingMetrics(),
    };

    // 3. Reservation health (view from migration 20260664)
    let reservationHealthQuery = supabase.from('v_reservation_health').select('*');
    if (orgId) reservationHealthQuery = reservationHealthQuery.eq('organization_id', orgId);
    const { data: reservationHealth } = await reservationHealthQuery;

    // 4. Admin adjustment activity (last 30 days)
    let adjustmentQuery = supabase
      .from('admin_financial_audit_events')
      .select('action_type, amount_credits, reason_type, organization_id, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (orgId) adjustmentQuery = adjustmentQuery.eq('organization_id', orgId);
    const { data: adjustments } = await adjustmentQuery;

    const adjustmentsByReason: Record<string, { count: number; totalCredits: number }> = {};
    for (const a of (adjustments ?? []) as Array<{ reason_type?: string; amount_credits?: number }>) {
      const key = a.reason_type ?? 'unspecified';
      const cur = adjustmentsByReason[key] ?? { count: 0, totalCredits: 0 };
      cur.count += 1;
      cur.totalCredits += Math.abs(Number(a.amount_credits ?? 0));
      adjustmentsByReason[key] = cur;
    }

    // 5. Company burn — portfolio aggregate
    const portfolio = await getPortfolioWalletAggregate(200);
    const focusedWallet = orgId ? await getBillingWalletSnapshot(orgId) : null;

    // 6. Billing operations health (view)
    let opsHealthQuery = supabase.from('v_billing_operations_health').select('*');
    if (orgId) opsHealthQuery = opsHealthQuery.eq('organization_id', orgId);
    const { data: opsHealth } = await opsHealthQuery;

    // 7. Flags — if focused on an org, evaluate billing flags
    const flags = orgId ? await evaluateAllBillingFlags(orgId) : null;

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      focusOrgId:  orgId ?? null,
      integrity,
      aiBilling,
      reservationHealth: reservationHealth ?? [],
      adjustments: {
        recent:    adjustments ?? [],
        byReason:  adjustmentsByReason,
      },
      portfolio,
      focusedWallet,
      opsHealth: opsHealth ?? [],
      flags,
    });
  } catch (err: unknown) {
    console.error('billing_dashboard_failed', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/billing-dashboard' });
