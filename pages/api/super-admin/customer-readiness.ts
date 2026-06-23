/**
 * GET /api/super-admin/customer-readiness
 *
 * READ-ONLY operational visibility for the Customer Readiness Console.
 * Returns { summary, tenants, readiness_breakdown }. No writes, no side effects.
 *
 * Query params (all optional): status, plan, readiness, search.
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW capability.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import {
  getCustomerReadiness,
  type ReadinessFilters,
  type TenantStatus,
  type ReadinessBucket,
} from '../../../backend/services/customerReadinessService';
import { detectCustomerOpportunities } from '../../../backend/services/customerOpportunityService';
import { prioritizeCustomers } from '../../../backend/services/customerOpportunityPriorityService';
import { generatePortfolioInsights } from '../../../backend/services/customerExecutiveInsightService';
import {
  loadReadinessHistory,
  snapshotFromCurrent,
  computeCompanyEvolution,
  generatePortfolioEvolution,
} from '../../../backend/services/customerEvolutionService';

const STATUSES: TenantStatus[] = ['SIGNUP_STARTED', 'EMAIL_VERIFIED', 'COMPANY_CREATED', 'ACTIVE', 'DORMANT', 'INACTIVE'];
const BUCKETS: ReadinessBucket[] = ['READY', 'PARTIAL', 'AT_RISK'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin customer-readiness (GET)',
  });
  if (guard.ok !== true) return;

  const q = req.query;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const statusRaw = str(q.status);
  const readinessRaw = str(q.readiness);

  const filters: ReadinessFilters = {
    status: statusRaw && STATUSES.includes(statusRaw as TenantStatus) ? (statusRaw as TenantStatus) : undefined,
    plan: str(q.plan),
    readiness: readinessRaw && BUCKETS.includes(readinessRaw as ReadinessBucket) ? (readinessRaw as ReadinessBucket) : undefined,
    search: str(q.search),
  };

  try {
    const result = await getCustomerReadiness(filters);
    // Phase 12D — read-only opportunity detection layered on the readiness model.
    const opp = detectCustomerOpportunities(result.tenants);
    const oppByCompany = new Map(opp.per_company.map((c) => [c.company_id, c]));
    // Phase 12E — read-only prioritization.
    const prio = prioritizeCustomers(result.tenants);
    const prioByCompany = new Map(prio.ranked.map((p) => [p.company_id, p]));
    // Phase 12F — read-only executive insights + narratives.
    const ins = generatePortfolioInsights(result.tenants);
    const insByCompany = new Map(ins.per_company.map((c) => [c.company_id, c]));
    // Phase 12G — read-only evolution (UNKNOWN until snapshots accumulate).
    const nowIso = new Date().toISOString();
    const history = await loadReadinessHistory(result.tenants.map((t) => t.company_id));
    const evoByCompany = new Map(result.tenants.map((t) => {
      const o = oppByCompany.get(t.company_id);
      const p = prioByCompany.get(t.company_id);
      const snaps = [...(history.get(t.company_id) ?? []), snapshotFromCurrent(t, nowIso, o?.opportunity_count ?? 0, p?.priority_tier ?? 'READ_ONLY')];
      return [t.company_id, computeCompanyEvolution(snaps, t.company_name)] as const;
    }));
    const tenants = result.tenants.map((t) => {
      const o = oppByCompany.get(t.company_id);
      const p = prioByCompany.get(t.company_id);
      const i = insByCompany.get(t.company_id);
      return {
        ...t,
        opportunities: o?.opportunities ?? [],
        opportunity_count: o?.opportunity_count ?? 0,
        highest_severity: o?.highest_severity ?? null,
        priority_score: p?.priority_score ?? 0,
        priority_tier: p?.priority_tier ?? 'READ_ONLY',
        narrative: i?.narrative ?? '',
        key_insight: i?.key_insight ?? null,
        primary_blocker: i?.primary_blocker ?? null,
        primary_opportunity: i?.primary_opportunity ?? null,
        insights: i?.insights ?? [],
        evolution: evoByCompany.get(t.company_id) ?? null,
      };
    });
    return res.status(200).json({
      ...result, tenants,
      opportunity_summary: opp.summary,
      priority_distribution: prio.distribution,
      top_companies: prio.ranked.slice(0, 10),
      portfolio_insights: ins.portfolio,
      portfolio_evolution: generatePortfolioEvolution(Array.from(evoByCompany.values())),
    });
  } catch (err) {
    console.error('[super-admin/customer-readiness]', err);
    return res.status(500).json({ error: 'Failed to load customer readiness' });
  }
}
