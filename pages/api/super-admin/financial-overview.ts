/**
 * GET /api/super-admin/financial-overview
 *
 * Phase A — Super Admin Financial Oversight. Returns:
 *   - global aggregate (portfolio totals)
 *   - per-company financial summary table (filterable)
 *
 * Read-only. Composes existing immutable-billing services; never mutates.
 *
 * Query filters:
 *   status?       'frozen' | 'locked' | 'active'
 *   lowBalance?   'true'  — totalAvailable below `lowBalanceThreshold`
 *   anomaly?      'true'  — burn-rate anomaly present
 *   highBurn?     'true'  — accelerating consumption
 *   limit?        default 100, max 500
 *   lowBalanceThreshold? default 100
 *
 * Auth: FINANCE_AUDITOR or above.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireAuthenticatedInternalUser } from '../../../backend/services/requestAccessService';
import { isFinanceAuditor } from '../../../backend/services/billing/financeRbacService';
import { detectBurnRateAnomaly } from '../../../backend/services/billing/contracts/usageForecastingService';
import { resolveActiveContract } from '../../../backend/services/billing/contracts/enterpriseContractResolver';
import { checkFinancialControls } from '../../../backend/services/billing/orgFinancialControlService';

interface CompanyRow {
  organizationId:      string;
  companyName:         string;
  freeBalance:         number;
  paidBalance:         number;
  incentiveBalance:    number;
  totalAvailable:      number;
  reservedTotal:       number;
  lifetimePurchased:   number;
  lifetimeConsumed:    number;
  estimatedUsdValue:   number;
  lastTransactionAt:   string | null;
  emergencyFreeze:     boolean;
  billingLock:         boolean;
  contractNumber:      string | null;
  burnAnomaly:         boolean;
  burnReason:          string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAuditor(user.id))) {
    return res.status(403).json({ error: 'FINANCE_AUDITOR_REQUIRED' });
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const lowBalanceThreshold = Number(req.query.lowBalanceThreshold ?? 100) || 100;
  const wantFrozen   = req.query.status === 'frozen';
  const wantLocked   = req.query.status === 'locked';
  const wantActive   = req.query.status === 'active';
  const wantLowBal   = req.query.lowBalance === 'true';
  const wantAnomaly  = req.query.anomaly === 'true';
  const wantHighBurn = req.query.highBurn === 'true';

  try {
    // Resolve REAL, active companies only. `organization_credits` accumulates
    // rows for orphaned / test / soft-deleted orgs too — counting those was
    // the source of the inflated "26". The authoritative set is the
    // `companies` table where deleted_at IS NULL. We also pull
    // `company_profiles.name` as a display fallback (same precedence the
    // /api/super-admin/companies endpoint uses).
    const { data: companyRows, error: companyErr } = await supabase
      .from('companies')
      .select('id, name')
      .is('deleted_at', null);
    if (companyErr) return res.status(500).json({ error: companyErr.message });

    const activeCompanyIds = new Set<string>(
      ((companyRows ?? []) as Array<{ id: string }>).map(c => String(c.id)),
    );
    const nameById = new Map<string, string>();
    for (const c of ((companyRows ?? []) as Array<{ id: string; name: string | null }>)) {
      if (c.name && c.name.trim()) nameById.set(String(c.id), c.name.trim());
    }
    if (activeCompanyIds.size > 0) {
      const { data: profileRows } = await supabase
        .from('company_profiles')
        .select('company_id, name, website_url')
        .in('company_id', Array.from(activeCompanyIds));
      for (const p of ((profileRows ?? []) as Array<{ company_id: string; name: string | null; website_url: string | null }>)) {
        if (!nameById.has(String(p.company_id))) {
          const fallback = (p.name && p.name.trim()) || (p.website_url && p.website_url.trim());
          if (fallback) nameById.set(String(p.company_id), fallback);
        }
      }
    }

    const { data: wallets, error } = await supabase
      .from('organization_credits')
      .select('organization_id, free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive, lifetime_purchased, lifetime_consumed, credit_rate_usd')
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });

    const rows: CompanyRow[] = [];
    for (const w of ((wallets ?? []) as Array<Record<string, unknown>>)) {
      const orgId = String(w.organization_id);
      // Skip wallets that don't belong to a real, active company.
      if (!activeCompanyIds.has(orgId)) continue;
      const free = Number(w.free_balance ?? 0);
      const paid = Number(w.paid_balance ?? 0);
      const inc  = Number(w.incentive_balance ?? 0);
      const rf = Number(w.reserved_free ?? 0);
      const rp = Number(w.reserved_paid ?? 0);
      const ri = Number(w.reserved_incentive ?? 0);
      const rate = Number(w.credit_rate_usd ?? 0.01);
      const totalAvailable =
        Math.max(0, free - rf) + Math.max(0, paid - rp) + Math.max(0, inc - ri);

      // Per-org enrichment — parallelizable; sequential is fine at limit≤500
      const [controls, contract, anomaly, lastTx] = await Promise.all([
        checkFinancialControls(orgId),
        resolveActiveContract(orgId),
        detectBurnRateAnomaly(orgId),
        supabase.from('credit_transactions').select('created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      rows.push({
        organizationId:    orgId,
        companyName:       nameById.get(orgId) ?? 'Unnamed company',
        freeBalance:       free,
        paidBalance:       paid,
        incentiveBalance:  inc,
        totalAvailable,
        reservedTotal:     rf + rp + ri,
        lifetimePurchased: Number(w.lifetime_purchased ?? 0),
        lifetimeConsumed:  Number(w.lifetime_consumed ?? 0),
        estimatedUsdValue: totalAvailable * rate,
        lastTransactionAt: (lastTx.data as { created_at?: string } | null)?.created_at ?? null,
        emergencyFreeze:   controls.emergencyFreeze,
        billingLock:       controls.billingLock,
        contractNumber:    contract?.contractNumber ?? null,
        burnAnomaly:       anomaly.anomaly,
        burnReason:        anomaly.anomaly ? (anomaly.reason ?? null) : null,
      });
    }

    let filtered = rows;
    if (wantFrozen)   filtered = filtered.filter(r => r.emergencyFreeze);
    if (wantLocked)   filtered = filtered.filter(r => r.billingLock);
    if (wantActive)   filtered = filtered.filter(r => !r.emergencyFreeze && !r.billingLock);
    if (wantLowBal)   filtered = filtered.filter(r => r.totalAvailable < lowBalanceThreshold);
    if (wantAnomaly)  filtered = filtered.filter(r => r.burnAnomaly);
    if (wantHighBurn) filtered = filtered.filter(r => r.burnAnomaly && r.burnReason === 'accelerating_burn_rate');

    // Aggregate from the active-company-filtered set so the counts/totals
    // match what's actually shown (no orphan/test/deleted inflation).
    const totalAvailableCredits = rows.reduce((s, r) => s + r.totalAvailable, 0);
    const totalAvailableUsd     = rows.reduce((s, r) => s + r.estimatedUsdValue, 0);
    const totalReservedCredits  = rows.reduce((s, r) => s + r.reservedTotal, 0);
    const topByConsumption = [...rows]
      .map(r => ({ organizationId: r.organizationId, companyName: r.companyName, lifetimeConsumed: r.lifetimeConsumed }))
      .sort((a, b) => b.lifetimeConsumed - a.lifetimeConsumed)
      .slice(0, 10);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      aggregate: {
        // Real active companies that have a wallet row. Distinct from the
        // total active-company count, which we also surface for context.
        totalOrgs:             rows.length,
        totalActiveCompanies:  activeCompanyIds.size,
        totalAvailableCredits,
        totalAvailableUsd,
        totalReservedCredits,
        topByConsumption,
        frozenCount:           rows.filter(r => r.emergencyFreeze).length,
        lockedCount:           rows.filter(r => r.billingLock).length,
        anomalyCount:          rows.filter(r => r.burnAnomaly).length,
      },
      companies: {
        count: filtered.length,
        rows:  filtered,
      },
      filtersApplied: { wantFrozen, wantLocked, wantActive, wantLowBal, wantAnomaly, wantHighBurn, lowBalanceThreshold },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
