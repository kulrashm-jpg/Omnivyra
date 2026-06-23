/**
 * customerOutcomeIntelligenceService.ts
 *
 * READ-ONLY measurement of whether customer health improves over time, derived
 * deterministically from `customer_readiness_snapshots`. No AI, no mutations (outcomes
 * are computed live from snapshots — no separate outcome table is written), no
 * notifications, no recommendations.
 *
 * Outcome = comparison of a company's EARLIEST vs LATEST snapshot (cumulative movement
 * over the tracked window). < 2 snapshots → NO_HISTORY (no guessing).
 */

import { supabase } from '../db/supabaseClient';
import type { ReadinessArea, ReadinessState, ReadinessBucket } from './customerReadinessService';

export type OutcomeClassification = 'IMPROVED' | 'UNCHANGED' | 'DECLINED' | 'NO_HISTORY';

export interface OutcomeSnapshot {
  company_id: string;
  snapshot_date: string;
  taken_at: string;
  readiness_score: number;
  readiness_bucket: ReadinessBucket;
  priority_score: number;
  opportunity_count: number;
  areas: Record<ReadinessArea, ReadinessState>;
}

export interface CompanyOutcome {
  company_id: string;
  company_name?: string;
  snapshot_date: string | null;
  readiness_score: number | null;
  priority_score: number | null;
  opportunity_count: number | null;
  previous_score: number | null;
  current_score: number | null;
  net_change: number | null;
  opportunity_delta: number | null;
  bucket_movement: string | null;
  outcome_classification: OutcomeClassification;
  area_improvements: ReadinessArea[];
  area_regressions: ReadinessArea[];
  snapshots_compared: number;
}

const AREAS: ReadinessArea[] = ['COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE', 'SOCIAL_INTEGRATIONS', 'COMMUNITY', 'TEAM_MEMBERS', 'BILLING'];
const STATE_RANK: Record<ReadinessState, number> = { NOT_READY: 0, UNKNOWN: 1, READY: 2 };
const BUCKET_RANK: Record<ReadinessBucket, number> = { AT_RISK: 0, PARTIAL: 1, READY: 2 };
const CHANGE_BAND = 3; // |Δreadiness| within this, no bucket move → UNCHANGED

/** Compare a company's earliest vs latest snapshot. Pure + deterministic. */
export function computeCompanyOutcome(snapshots: OutcomeSnapshot[], company_name?: string): CompanyOutcome {
  if (snapshots.length === 0) {
    return { company_id: '', company_name, snapshot_date: null, readiness_score: null, priority_score: null, opportunity_count: null, previous_score: null, current_score: null, net_change: null, opportunity_delta: null, bucket_movement: null, outcome_classification: 'NO_HISTORY', area_improvements: [], area_regressions: [], snapshots_compared: 0 };
  }
  const ordered = [...snapshots].sort((a, b) => (a.taken_at || a.snapshot_date).localeCompare(b.taken_at || b.snapshot_date));
  const company_id = ordered[0].company_id;
  const current = ordered[ordered.length - 1];
  const base = {
    company_id, company_name, snapshot_date: current.snapshot_date,
    readiness_score: current.readiness_score, priority_score: current.priority_score, opportunity_count: current.opportunity_count,
  };
  if (ordered.length < 2) {
    return { ...base, previous_score: null, current_score: current.readiness_score, net_change: null, opportunity_delta: null, bucket_movement: null, outcome_classification: 'NO_HISTORY', area_improvements: [], area_regressions: [], snapshots_compared: 1 };
  }
  const previous = ordered[0];
  const net_change = current.readiness_score - previous.readiness_score;
  const bucketMove = BUCKET_RANK[current.readiness_bucket] - BUCKET_RANK[previous.readiness_bucket];
  const area_improvements = AREAS.filter((a) => STATE_RANK[current.areas[a]] > STATE_RANK[previous.areas[a]]);
  const area_regressions = AREAS.filter((a) => STATE_RANK[current.areas[a]] < STATE_RANK[previous.areas[a]]);

  let outcome_classification: OutcomeClassification;
  if (net_change > CHANGE_BAND || bucketMove > 0) outcome_classification = 'IMPROVED';
  else if (net_change < -CHANGE_BAND || bucketMove < 0) outcome_classification = 'DECLINED';
  else outcome_classification = 'UNCHANGED';

  return {
    ...base, previous_score: previous.readiness_score, current_score: current.readiness_score,
    net_change, opportunity_delta: current.opportunity_count - previous.opportunity_count,
    bucket_movement: previous.readiness_bucket !== current.readiness_bucket ? `${previous.readiness_bucket} → ${current.readiness_bucket}` : null,
    outcome_classification, area_improvements, area_regressions, snapshots_compared: ordered.length,
  };
}

export interface PortfolioOutcomes {
  improved_companies: number; declined_companies: number; unchanged_companies: number; no_history_companies: number;
  average_readiness_change: number | null;
  top_improvers: CompanyOutcome[];
  top_decliners: CompanyOutcome[];
  most_improved_areas: Array<{ area: ReadinessArea; count: number }>;
  most_regressed_areas: Array<{ area: ReadinessArea; count: number }>;
}

export function generatePortfolioOutcomes(outcomes: CompanyOutcome[]): PortfolioOutcomes {
  const withHistory = outcomes.filter((o) => o.outcome_classification !== 'NO_HISTORY');
  const improvedAreas = new Map<ReadinessArea, number>();
  const regressedAreas = new Map<ReadinessArea, number>();
  for (const o of outcomes) {
    for (const a of o.area_improvements) improvedAreas.set(a, (improvedAreas.get(a) ?? 0) + 1);
    for (const a of o.area_regressions) regressedAreas.set(a, (regressedAreas.get(a) ?? 0) + 1);
  }
  const changes = withHistory.map((o) => o.net_change ?? 0);
  const average_readiness_change = changes.length ? Math.round((changes.reduce((a, b) => a + b, 0) / changes.length) * 10) / 10 : null;
  const rank = (m: Map<ReadinessArea, number>) => Array.from(m.entries()).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count);

  return {
    improved_companies: outcomes.filter((o) => o.outcome_classification === 'IMPROVED').length,
    declined_companies: outcomes.filter((o) => o.outcome_classification === 'DECLINED').length,
    unchanged_companies: outcomes.filter((o) => o.outcome_classification === 'UNCHANGED').length,
    no_history_companies: outcomes.filter((o) => o.outcome_classification === 'NO_HISTORY').length,
    average_readiness_change,
    top_improvers: [...withHistory].filter((o) => (o.net_change ?? 0) > 0).sort((a, b) => (b.net_change ?? 0) - (a.net_change ?? 0)).slice(0, 10),
    top_decliners: [...withHistory].filter((o) => (o.net_change ?? 0) < 0).sort((a, b) => (a.net_change ?? 0) - (b.net_change ?? 0)).slice(0, 10),
    most_improved_areas: rank(improvedAreas),
    most_regressed_areas: rank(regressedAreas),
  };
}

const AREA_LABEL: Record<ReadinessArea, string> = {
  COMPANY_PROFILE: 'Profile completeness', WEBSITE: 'Website verification', GOOGLE_ANALYTICS: 'GA adoption',
  GOOGLE_SEARCH_CONSOLE: 'GSC adoption', SOCIAL_INTEGRATIONS: 'Social integration', COMMUNITY: 'Community',
  TEAM_MEMBERS: 'Team expansion', BILLING: 'Paid conversion',
};

/** Deterministic executive summary lines (no AI). */
export function executiveOutcomeSummary(p: PortfolioOutcomes): string[] {
  const lines: string[] = [];
  lines.push(`${p.improved_companies} ${p.improved_companies === 1 ? 'company' : 'companies'} improved readiness.`);
  if (p.declined_companies > 0) lines.push(`${p.declined_companies} ${p.declined_companies === 1 ? 'company' : 'companies'} declined.`);
  if (p.average_readiness_change != null) lines.push(`Average readiness change: ${p.average_readiness_change >= 0 ? '+' : ''}${p.average_readiness_change}.`);
  for (const { area, count } of p.most_improved_areas) lines.push(`${AREA_LABEL[area]} increased by ${count} ${count === 1 ? 'company' : 'companies'}.`);
  if (p.no_history_companies > 0) lines.push(`${p.no_history_companies} ${p.no_history_companies === 1 ? 'company has' : 'companies have'} insufficient history yet.`);
  return lines;
}

// ── Read-only snapshot loader ────────────────────────────────────────────────
export async function loadOutcomeSnapshots(companyIds: string[]): Promise<Map<string, OutcomeSnapshot[]>> {
  const map = new Map<string, OutcomeSnapshot[]>();
  if (companyIds.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from('customer_readiness_snapshots')
      .select('company_id, snapshot_date, taken_at, overall_readiness_score, readiness_bucket, priority_score, opportunity_count, company_profile_ready, website_ready, ga_ready, gsc_ready, social_ready, community_ready, team_ready, billing_ready')
      .in('company_id', companyIds);
    if (error || !data) return map;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      const snap: OutcomeSnapshot = {
        company_id: String(r.company_id), snapshot_date: String(r.snapshot_date), taken_at: String(r.taken_at),
        readiness_score: Number(r.overall_readiness_score), readiness_bucket: r.readiness_bucket as ReadinessBucket,
        priority_score: Number(r.priority_score), opportunity_count: Number(r.opportunity_count),
        areas: {
          COMPANY_PROFILE: r.company_profile_ready as ReadinessState, WEBSITE: r.website_ready as ReadinessState,
          GOOGLE_ANALYTICS: r.ga_ready as ReadinessState, GOOGLE_SEARCH_CONSOLE: r.gsc_ready as ReadinessState,
          SOCIAL_INTEGRATIONS: r.social_ready as ReadinessState, COMMUNITY: r.community_ready as ReadinessState,
          TEAM_MEMBERS: r.team_ready as ReadinessState, BILLING: r.billing_ready as ReadinessState,
        },
      };
      map.set(snap.company_id, [...(map.get(snap.company_id) ?? []), snap]);
    }
  } catch { /* no history */ }
  return map;
}

export interface CustomerOutcomeResult { per_company: CompanyOutcome[]; portfolio: PortfolioOutcomes; executive_summary: string[]; }

/** Orchestrator: load snapshots → per-company outcomes → portfolio + executive summary. Read-only. */
export async function getCustomerOutcomes(
  companies: Array<{ company_id: string; company_name: string }>,
  deps: { load?: (ids: string[]) => Promise<Map<string, OutcomeSnapshot[]>> } = {},
): Promise<CustomerOutcomeResult> {
  const load = deps.load ?? loadOutcomeSnapshots;
  const history = await load(companies.map((c) => c.company_id));
  const per_company = companies.map((c) => {
    const o = computeCompanyOutcome(history.get(c.company_id) ?? [], c.company_name);
    return { ...o, company_id: c.company_id, company_name: c.company_name };
  });
  const portfolio = generatePortfolioOutcomes(per_company);
  return { per_company, portfolio, executive_summary: executiveOutcomeSummary(portfolio) };
}
