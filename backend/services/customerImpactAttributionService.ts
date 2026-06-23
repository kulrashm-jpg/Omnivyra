/**
 * customerImpactAttributionService.ts
 *
 * READ-ONLY measurement of whether a readiness improvement can be attributed to an
 * Omnivyra intervention. Deterministic, derived from `customer_readiness_snapshots`.
 *
 * Signal model: a readiness AREA flipping to READY between two consecutive snapshots is
 * the dated, traceable proxy for an intervention (domain verified → WEBSITE, GA connected
 * → GOOGLE_ANALYTICS, profile completed → COMPANY_PROFILE, …). When such a flip coincides
 * with a positive outcome (readiness ↑ / bucket ↑ / opportunities ↓) in the same window,
 * the improvement is attributed to that intervention.
 *
 * No mutations, no notifications, no recommendations, no intervention execution.
 */

import type { ReadinessArea, ReadinessState, ReadinessBucket } from './customerReadinessService';
import { loadOutcomeSnapshots, type OutcomeSnapshot } from './customerOutcomeIntelligenceService';

export type InterventionType =
  | 'DOMAIN_VERIFICATION' | 'GA_CONNECTION' | 'GSC_CONNECTION' | 'SOCIAL_CONNECTION'
  | 'PROFILE_COMPLETION' | 'TEAM_EXPANSION' | 'BILLING_ACTIVATION';
export type AttributionStatus = 'ATTRIBUTED' | 'POSSIBLY_ATTRIBUTED' | 'NOT_ATTRIBUTED' | 'INSUFFICIENT_DATA';
export type OutcomeType = 'READINESS_INCREASE' | 'BUCKET_INCREASE' | 'OPPORTUNITY_REDUCTION';

/** Readiness area → the Omnivyra intervention that makes it READY (COMMUNITY has none). */
export const INTERVENTION_FOR_AREA: Record<ReadinessArea, InterventionType | null> = {
  WEBSITE: 'DOMAIN_VERIFICATION', GOOGLE_ANALYTICS: 'GA_CONNECTION', GOOGLE_SEARCH_CONSOLE: 'GSC_CONNECTION',
  SOCIAL_INTEGRATIONS: 'SOCIAL_CONNECTION', COMPANY_PROFILE: 'PROFILE_COMPLETION', TEAM_MEMBERS: 'TEAM_EXPANSION',
  BILLING: 'BILLING_ACTIVATION', COMMUNITY: null,
};
const AREAS = Object.keys(INTERVENTION_FOR_AREA) as ReadinessArea[];
const STATE_RANK: Record<ReadinessState, number> = { NOT_READY: 0, UNKNOWN: 1, READY: 2 };
const BUCKET_RANK: Record<ReadinessBucket, number> = { AT_RISK: 0, PARTIAL: 1, READY: 2 };

export interface AttributionCandidate {
  company_id: string;
  company_name?: string;
  intervention_type: InterventionType;
  event_date: string;
  outcome_date: string;
  outcome_types: OutcomeType[];
  readiness_delta: number;
  attribution_status: Exclude<AttributionStatus, 'INSUFFICIENT_DATA'>;
}

export interface CompanyAttribution {
  company_id: string;
  company_name?: string;
  impact_status: AttributionStatus;
  candidates: AttributionCandidate[];
  unattributed_improvements: number; // positive-outcome windows with no area flip
}

/** Per-company attribution from consecutive snapshot windows. Pure + deterministic. */
export function attributeCompany(snapshots: OutcomeSnapshot[], company_name?: string): CompanyAttribution {
  const company_id = snapshots[0]?.company_id ?? '';
  if (snapshots.length < 2) {
    return { company_id, company_name, impact_status: 'INSUFFICIENT_DATA', candidates: [], unattributed_improvements: 0 };
  }
  const ordered = [...snapshots].sort((a, b) => (a.taken_at || a.snapshot_date).localeCompare(b.taken_at || b.snapshot_date));
  const candidates: AttributionCandidate[] = [];
  let unattributed_improvements = 0;

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1], cur = ordered[i];
    const improved = AREAS.filter((a) => INTERVENTION_FOR_AREA[a] && cur.areas[a] === 'READY' && STATE_RANK[cur.areas[a]] > STATE_RANK[prev.areas[a]]);
    const outcome_types: OutcomeType[] = [];
    const readiness_delta = cur.readiness_score - prev.readiness_score;
    if (readiness_delta > 0) outcome_types.push('READINESS_INCREASE');
    if (BUCKET_RANK[cur.readiness_bucket] > BUCKET_RANK[prev.readiness_bucket]) outcome_types.push('BUCKET_INCREASE');
    if (cur.opportunity_count < prev.opportunity_count) outcome_types.push('OPPORTUNITY_REDUCTION');
    const positive = outcome_types.length > 0;

    if (improved.length === 0) { if (positive) unattributed_improvements += 1; continue; }
    const status: AttributionCandidate['attribution_status'] = !positive ? 'NOT_ATTRIBUTED' : improved.length === 1 ? 'ATTRIBUTED' : 'POSSIBLY_ATTRIBUTED';
    for (const area of improved) {
      candidates.push({
        company_id, company_name, intervention_type: INTERVENTION_FOR_AREA[area]!,
        event_date: cur.snapshot_date, outcome_date: cur.snapshot_date,
        outcome_types: [...outcome_types], readiness_delta, attribution_status: status,
      });
    }
  }

  const impact_status: AttributionStatus =
    candidates.some((c) => c.attribution_status === 'ATTRIBUTED') ? 'ATTRIBUTED' :
    candidates.some((c) => c.attribution_status === 'POSSIBLY_ATTRIBUTED') ? 'POSSIBLY_ATTRIBUTED' : 'NOT_ATTRIBUTED';
  return { company_id, company_name, impact_status, candidates, unattributed_improvements };
}

export interface PortfolioImpact {
  attributed_improvements: number;
  possible_improvements: number;
  unattributed_improvements: number;
  insufficient_data_companies: number;
  top_impact_drivers: Array<{ intervention_type: InterventionType; attributed: number; possible: number }>;
  most_common_improvement_paths: Array<{ path: string; count: number }>;
}

export function generatePortfolioImpact(perCompany: CompanyAttribution[]): PortfolioImpact {
  const all = perCompany.flatMap((c) => c.candidates);
  const drivers = new Map<InterventionType, { attributed: number; possible: number }>();
  const paths = new Map<string, number>();
  for (const c of all) {
    const d = drivers.get(c.intervention_type) ?? { attributed: 0, possible: 0 };
    if (c.attribution_status === 'ATTRIBUTED') d.attributed += 1;
    else if (c.attribution_status === 'POSSIBLY_ATTRIBUTED') d.possible += 1;
    drivers.set(c.intervention_type, d);
    if (c.attribution_status !== 'NOT_ATTRIBUTED') {
      for (const ot of c.outcome_types) {
        const key = `${c.intervention_type} → ${ot}`;
        paths.set(key, (paths.get(key) ?? 0) + 1);
      }
    }
  }
  return {
    attributed_improvements: all.filter((c) => c.attribution_status === 'ATTRIBUTED').length,
    possible_improvements: all.filter((c) => c.attribution_status === 'POSSIBLY_ATTRIBUTED').length,
    unattributed_improvements: perCompany.reduce((a, c) => a + c.unattributed_improvements, 0),
    insufficient_data_companies: perCompany.filter((c) => c.impact_status === 'INSUFFICIENT_DATA').length,
    top_impact_drivers: Array.from(drivers.entries())
      .map(([intervention_type, v]) => ({ intervention_type, ...v }))
      .sort((a, b) => b.attributed - a.attributed || b.possible - a.possible || a.intervention_type.localeCompare(b.intervention_type)),
    most_common_improvement_paths: Array.from(paths.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
  };
}

export interface CustomerImpactResult { per_company: CompanyAttribution[]; portfolio: PortfolioImpact; }

/** Orchestrator: load snapshots → per-company attribution → portfolio. Read-only. */
export async function getCustomerImpactAttribution(
  companies: Array<{ company_id: string; company_name: string }>,
  deps: { load?: (ids: string[]) => Promise<Map<string, OutcomeSnapshot[]>> } = {},
): Promise<CustomerImpactResult> {
  const load = deps.load ?? loadOutcomeSnapshots;
  const history = await load(companies.map((c) => c.company_id));
  const per_company = companies.map((c) => {
    const a = attributeCompany(history.get(c.company_id) ?? [], c.company_name);
    return { ...a, company_id: c.company_id, company_name: c.company_name };
  });
  return { per_company, portfolio: generatePortfolioImpact(per_company) };
}
