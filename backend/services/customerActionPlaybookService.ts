/**
 * customerActionPlaybookService.ts
 *
 * READ-ONLY, admin-only. Converts readiness gaps (+ priority, outcome, acquisition,
 * signal confidence) into deterministic operational playbooks for super-admins to act on
 * manually. Rules only — no AI, no inference. No writes, notifications, emails,
 * automation, or customer-facing delivery. Visibility only.
 *
 * Suppression is first-class: a playbook is NOT generated when the underlying signal is
 * untrustworthy (LOW/UNKNOWN confidence), the gap is uncertain, a required signal is
 * missing, outcome history is insufficient, or acquisition evidence is incomplete.
 */

import type { ReadinessArea, ReadinessState } from './customerReadinessService';
import type { PriorityTier } from './customerOpportunityPriorityService';
import type { OutcomeClassification } from './customerOutcomeIntelligenceService';
import type { ConfidenceLevel } from './customerSignalConfidenceService';

export type ImpactBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type SuppressionReason =
  | 'SIGNAL_LOW_CONFIDENCE' | 'SIGNAL_UNKNOWN_CONFIDENCE' | 'GAP_UNCERTAIN'
  | 'REQUIRED_SIGNAL_MISSING' | 'INSUFFICIENT_OUTCOME_HISTORY' | 'ACQUISITION_EVIDENCE_INCOMPLETE';

export interface PlaybookDef {
  playbook_id: string;
  playbook_name: string;
  area: ReadinessArea;
  impact: ImpactBand;
  required_signals: ReadinessArea[];
  blocked_signals: ReadinessArea[];
  success_measure: string;
  requires_outcome?: boolean;
  requires_acquisition_evidence?: boolean;
}

/** The action catalog — one playbook per addressable readiness gap. */
export const PLAYBOOK_CATALOG: PlaybookDef[] = [
  { playbook_id: 'VERIFY_DOMAIN', playbook_name: 'Verify company domain', area: 'WEBSITE', impact: 'HIGH', required_signals: ['WEBSITE'], blocked_signals: [], success_measure: 'WEBSITE → READY' },
  { playbook_id: 'COMPLETE_PROFILE', playbook_name: 'Complete company profile', area: 'COMPANY_PROFILE', impact: 'HIGH', required_signals: ['COMPANY_PROFILE'], blocked_signals: [], success_measure: 'COMPANY_PROFILE → READY' },
  { playbook_id: 'ACTIVATE_BILLING', playbook_name: 'Activate plan / billing', area: 'BILLING', impact: 'HIGH', required_signals: ['BILLING'], blocked_signals: [], success_measure: 'BILLING → READY' },
  { playbook_id: 'CONNECT_GA', playbook_name: 'Connect Google Analytics', area: 'GOOGLE_ANALYTICS', impact: 'MEDIUM', required_signals: ['GOOGLE_ANALYTICS'], blocked_signals: [], success_measure: 'GOOGLE_ANALYTICS → READY' },
  { playbook_id: 'CONNECT_GSC', playbook_name: 'Connect Google Search Console', area: 'GOOGLE_SEARCH_CONSOLE', impact: 'MEDIUM', required_signals: ['GOOGLE_SEARCH_CONSOLE'], blocked_signals: [], success_measure: 'GOOGLE_SEARCH_CONSOLE → READY' },
  { playbook_id: 'CONNECT_SOCIAL', playbook_name: 'Connect social accounts', area: 'SOCIAL_INTEGRATIONS', impact: 'MEDIUM', required_signals: ['SOCIAL_INTEGRATIONS'], blocked_signals: [], success_measure: 'SOCIAL_INTEGRATIONS → READY' },
  { playbook_id: 'INVITE_TEAM', playbook_name: 'Invite team members', area: 'TEAM_MEMBERS', impact: 'LOW', required_signals: ['TEAM_MEMBERS'], blocked_signals: [], success_measure: 'TEAM_MEMBERS → READY' },
];

export interface PlaybookCompanyInput {
  company_id: string; company_name: string;
  priority_tier: PriorityTier; priority_score: number;
  areas: Record<ReadinessArea, ReadinessState>;
  signal_confidence: Record<ReadinessArea, ConfidenceLevel>;
  outcome_classification: OutcomeClassification;
  acquisition_evidence_complete: boolean;
}

export interface RecommendedPlaybook {
  company_id: string; company_name: string;
  playbook_id: string; playbook_name: string; area: ReadinessArea;
  reason: string; evidence: string;
  priority: PriorityTier; confidence: ConfidenceLevel;
  expected_value: number; expected_value_band: ImpactBand;
  success_measure: string;
}
export interface SuppressedPlaybook { company_id: string; playbook_id: string; area: ReadinessArea; suppression_reason: SuppressionReason; }

const IMPACT_WEIGHT: Record<ImpactBand, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const PRIORITY_FACTOR: Record<PriorityTier, number> = { CRITICAL: 1, HIGH: 0.8, MEDIUM: 0.6, LOW: 0.4, READ_ONLY: 0.2 };
const PRIORITY_RANK: Record<PriorityTier, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, READ_ONLY: 0 };
const CONF_RANK: Record<ConfidenceLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

const expectedValue = (impact: ImpactBand, tier: PriorityTier) => Math.round(IMPACT_WEIGHT[impact] * PRIORITY_FACTOR[tier] * 10) / 10;
const valueBand = (v: number): ImpactBand => (v >= 2.4 ? 'HIGH' : v >= 1.2 ? 'MEDIUM' : 'LOW');

/** Pure: why a playbook is suppressed for a company (null if it should be generated). Order matters. */
export function evaluateSuppression(pb: PlaybookDef, input: PlaybookCompanyInput): SuppressionReason | null {
  if (pb.requires_outcome && input.outcome_classification === 'NO_HISTORY') return 'INSUFFICIENT_OUTCOME_HISTORY';
  if (pb.requires_acquisition_evidence && !input.acquisition_evidence_complete) return 'ACQUISITION_EVIDENCE_INCOMPLETE';
  const conf = input.signal_confidence[pb.area];
  if (conf === 'LOW') return 'SIGNAL_LOW_CONFIDENCE';
  if (conf === 'UNKNOWN') return 'SIGNAL_UNKNOWN_CONFIDENCE';
  if (input.areas[pb.area] === 'UNKNOWN') return 'GAP_UNCERTAIN';
  if (pb.required_signals.some((s) => input.signal_confidence[s] === 'UNKNOWN')) return 'REQUIRED_SIGNAL_MISSING';
  return null;
}

/** Pure: per-company recommended (top 3) + suppressed playbooks. */
export function generateCompanyPlaybooks(input: PlaybookCompanyInput): { recommended: RecommendedPlaybook[]; suppressed: SuppressedPlaybook[] } {
  const recommended: RecommendedPlaybook[] = [];
  const suppressed: SuppressedPlaybook[] = [];
  for (const pb of PLAYBOOK_CATALOG) {
    if (input.areas[pb.area] === 'READY') continue; // no gap → no playbook (not a suppression)
    const reason = evaluateSuppression(pb, input);
    if (reason) { suppressed.push({ company_id: input.company_id, playbook_id: pb.playbook_id, area: pb.area, suppression_reason: reason }); continue; }
    const conf = input.signal_confidence[pb.area];
    const ev = expectedValue(pb.impact, input.priority_tier);
    recommended.push({
      company_id: input.company_id, company_name: input.company_name,
      playbook_id: pb.playbook_id, playbook_name: pb.playbook_name, area: pb.area,
      reason: `${pb.area} is not ready`, evidence: `readiness ${pb.area}=NOT_READY; signal confidence ${conf}`,
      priority: input.priority_tier, confidence: conf, expected_value: ev, expected_value_band: valueBand(ev), success_measure: pb.success_measure,
    });
  }
  recommended.sort(rankPlaybooks);
  return { recommended: recommended.slice(0, 3), suppressed };
}

/** Deterministic ranking: priority → confidence → expected value → impact → stable id. */
function rankPlaybooks(a: RecommendedPlaybook, b: RecommendedPlaybook): number {
  return (
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
    b.expected_value - a.expected_value ||
    a.company_id.localeCompare(b.company_id) ||
    a.playbook_id.localeCompare(b.playbook_id)
  );
}

export interface PlaybookPortfolio {
  total_recommended: number; total_suppressed: number; blocked_playbooks: number;
  most_common_playbooks: Array<{ playbook_id: string; playbook_name: string; count: number }>;
  highest_impact_playbooks: Array<{ playbook_id: string; playbook_name: string; expected_value: number }>;
  suppressed_by_reason: Record<SuppressionReason, number>;
  confidence_distribution: Record<ConfidenceLevel, number>;
  top_recommendations: RecommendedPlaybook[];
}

export interface CustomerPlaybookResult {
  per_company: Array<{ company_id: string; recommended: RecommendedPlaybook[]; suppressed: SuppressedPlaybook[] }>;
  portfolio: PlaybookPortfolio;
}

export function generatePortfolioPlaybooks(inputs: PlaybookCompanyInput[]): CustomerPlaybookResult {
  const per_company = inputs.map((i) => ({ company_id: i.company_id, ...generateCompanyPlaybooks(i) }));
  const allRec = per_company.flatMap((c) => c.recommended);
  const allSup = per_company.flatMap((c) => c.suppressed);

  const byId = new Map<string, { playbook_name: string; count: number; maxValue: number }>();
  for (const r of allRec) {
    const e = byId.get(r.playbook_id) ?? { playbook_name: r.playbook_name, count: 0, maxValue: 0 };
    e.count += 1; e.maxValue = Math.max(e.maxValue, r.expected_value); byId.set(r.playbook_id, e);
  }
  const suppressed_by_reason = allSup.reduce((acc, s) => { acc[s.suppression_reason] = (acc[s.suppression_reason] ?? 0) + 1; return acc; }, {
    SIGNAL_LOW_CONFIDENCE: 0, SIGNAL_UNKNOWN_CONFIDENCE: 0, GAP_UNCERTAIN: 0, REQUIRED_SIGNAL_MISSING: 0, INSUFFICIENT_OUTCOME_HISTORY: 0, ACQUISITION_EVIDENCE_INCOMPLETE: 0,
  } as Record<SuppressionReason, number>);
  const confidence_distribution = allRec.reduce((acc, r) => { acc[r.confidence] += 1; return acc; }, { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 } as Record<ConfidenceLevel, number>);

  return {
    per_company,
    portfolio: {
      total_recommended: allRec.length, total_suppressed: allSup.length,
      blocked_playbooks: suppressed_by_reason.REQUIRED_SIGNAL_MISSING + suppressed_by_reason.GAP_UNCERTAIN,
      most_common_playbooks: Array.from(byId.entries()).map(([playbook_id, v]) => ({ playbook_id, playbook_name: v.playbook_name, count: v.count })).sort((a, b) => b.count - a.count || a.playbook_id.localeCompare(b.playbook_id)),
      highest_impact_playbooks: Array.from(byId.entries()).map(([playbook_id, v]) => ({ playbook_id, playbook_name: v.playbook_name, expected_value: v.maxValue })).sort((a, b) => b.expected_value - a.expected_value || a.playbook_id.localeCompare(b.playbook_id)),
      suppressed_by_reason, confidence_distribution,
      top_recommendations: [...allRec].sort(rankPlaybooks).slice(0, 20),
    },
  };
}
