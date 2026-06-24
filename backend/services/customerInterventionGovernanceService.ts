/**
 * customerInterventionGovernanceService.ts
 *
 * GOVERNANCE ONLY. The deterministic, READ-ONLY gate between Customer Intelligence (12A–14I)
 * and any future customer-facing action. Computes a customer lifecycle state and, per
 * intervention type, whether a company is ELIGIBLE / SUPPRESSED / BLOCKED / UNKNOWN — with
 * explicit evidence. NO delivery, NO execution, NO writes, NO automation. UNKNOWN stays
 * UNKNOWN. Association is never treated as causation.
 *
 * Top gate (per 14I): only tenant_class CUSTOMER is eligible; INTERNAL/QA/TEST/DEMO/UNKNOWN
 * are globally suppressed (POPULATION_INTEGRITY).
 */

import type { ReadinessArea, ReadinessState, ReadinessBucket } from './customerReadinessService';
import type { ConfidenceLevel } from './customerSignalConfidenceService';
import type { TenantClass } from './customerPopulationIntegrityService';
import type { Trajectory } from './customerEvolutionService';

export type CustomerState = 'PROSPECT' | 'ONBOARDING' | 'ACTIVATING' | 'ADOPTING' | 'VALUE_REALIZING' | 'EXPANDING' | 'AT_RISK' | 'CHURNED' | 'UNKNOWN';
export type InterventionId =
  | 'PROFILE_COMPLETION' | 'DOMAIN_VERIFICATION' | 'GA_CONNECTION' | 'GSC_CONNECTION' | 'SOCIAL_CONNECTION'
  | 'TEAM_EXPANSION' | 'VALUE_REALIZATION' | 'ACTIVATION_RECOVERY' | 'ADOPTION_EXPANSION' | 'EXECUTION_EXPANSION';
export type EligibilityStatus = 'ELIGIBLE' | 'SUPPRESSED' | 'BLOCKED' | 'UNKNOWN';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
type Confidence = ConfidenceLevel;

const CONF_RANK: Record<Confidence, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const STALE_DAYS = 30;

export interface GovCompany {
  company_id: string; company_name: string; tenant_class: TenantClass;
  areas: Record<ReadinessArea, ReadinessState>;
  signal_confidence: Record<ReadinessArea, Confidence>;
  overall_confidence: Confidence;
  is_active: boolean; is_paying: boolean; has_value: boolean; value_category_count: number;
  adoption_score: number; execution_volume: number; trajectory: Trajectory; readiness_bucket: ReadinessBucket;
  created_at: string | null; active_30d: number;
}

export interface InterventionDef {
  id: InterventionId; purpose: string; trigger_source: string; area: ReadinessArea | null;
  severity: Severity; min_confidence: Confidence; eligible_states: CustomerState[];
  gap: (c: GovCompany) => boolean | 'UNKNOWN'; // does the gap exist? UNKNOWN if undeterminable
}

const areaGap = (area: ReadinessArea) => (c: GovCompany): boolean | 'UNKNOWN' => {
  const s = c.areas[area]; return s === 'UNKNOWN' ? 'UNKNOWN' : s !== 'READY';
};

export const INTERVENTION_CATALOG: InterventionDef[] = [
  { id: 'PROFILE_COMPLETION', purpose: 'Complete company profile', trigger_source: 'Profile Completion (14C) / Readiness', area: 'COMPANY_PROFILE', severity: 'HIGH', min_confidence: 'MEDIUM', eligible_states: ['ONBOARDING', 'ACTIVATING', 'ADOPTING'], gap: areaGap('COMPANY_PROFILE') },
  { id: 'DOMAIN_VERIFICATION', purpose: 'Verify company domain', trigger_source: 'Readiness / Onboarding (14A)', area: 'WEBSITE', severity: 'HIGH', min_confidence: 'MEDIUM', eligible_states: ['ONBOARDING', 'ACTIVATING', 'ADOPTING'], gap: areaGap('WEBSITE') },
  { id: 'GA_CONNECTION', purpose: 'Connect Google Analytics', trigger_source: 'Digital Adoption (14D)', area: 'GOOGLE_ANALYTICS', severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['ACTIVATING', 'ADOPTING', 'VALUE_REALIZING'], gap: areaGap('GOOGLE_ANALYTICS') },
  { id: 'GSC_CONNECTION', purpose: 'Connect Search Console', trigger_source: 'Digital Adoption (14D)', area: 'GOOGLE_SEARCH_CONSOLE', severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['ACTIVATING', 'ADOPTING', 'VALUE_REALIZING'], gap: areaGap('GOOGLE_SEARCH_CONSOLE') },
  { id: 'SOCIAL_CONNECTION', purpose: 'Connect social accounts', trigger_source: 'Digital Adoption (14D)', area: 'SOCIAL_INTEGRATIONS', severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['ACTIVATING', 'ADOPTING', 'VALUE_REALIZING'], gap: areaGap('SOCIAL_INTEGRATIONS') },
  { id: 'TEAM_EXPANSION', purpose: 'Invite team members', trigger_source: 'Digital Adoption (14D)', area: 'TEAM_MEMBERS', severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['ADOPTING', 'VALUE_REALIZING', 'EXPANDING'], gap: areaGap('TEAM_MEMBERS') },
  { id: 'VALUE_REALIZATION', purpose: 'Drive first value (content/campaign/report)', trigger_source: 'Value Realization (14E)', area: null, severity: 'HIGH', min_confidence: 'MEDIUM', eligible_states: ['ADOPTING', 'ACTIVATING'], gap: (c) => !c.has_value },
  { id: 'ACTIVATION_RECOVERY', purpose: 'Recover stalled activation', trigger_source: 'Activation (14B)', area: null, severity: 'HIGH', min_confidence: 'MEDIUM', eligible_states: ['ACTIVATING', 'AT_RISK'], gap: (c) => !c.is_active },
  { id: 'ADOPTION_EXPANSION', purpose: 'Expand capability adoption', trigger_source: 'Digital Adoption (14D)', area: null, severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['ADOPTING', 'VALUE_REALIZING'], gap: (c) => c.adoption_score < 50 },
  { id: 'EXECUTION_EXPANSION', purpose: 'Expand execution depth', trigger_source: 'Execution Adoption (14G)', area: null, severity: 'MEDIUM', min_confidence: 'MEDIUM', eligible_states: ['VALUE_REALIZING', 'EXPANDING'], gap: (c) => c.has_value && c.execution_volume < 5 },
];

const olderThan = (iso: string | null, days: number, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 86_400_000 > days : false);

export interface CustomerStateResult { customer_state: CustomerState; state_confidence: Confidence; state_evidence: string[]; }

/** Pure, deterministic customer lifecycle state (exactly one). */
export function calculateCustomerState(c: GovCompany, nowMs: number): CustomerStateResult {
  const stale = olderThan(c.created_at, STALE_DAYS, nowMs);
  const adoptedAny = c.adoption_score > 0;
  const progressing = c.areas.COMPANY_PROFILE === 'READY' || c.areas.WEBSITE === 'READY' || adoptedAny;
  const ev = (s: string) => [s];
  const conf: Confidence = c.readiness_bucket === undefined ? 'UNKNOWN' : c.overall_confidence;

  let state: CustomerState;
  let evidence: string[];
  if (c.tenant_class === 'UNKNOWN' && !progressing && !c.is_active) { state = 'UNKNOWN'; evidence = ev('unclassified tenant, no definite signals'); }
  else if (c.trajectory === 'DECLINING') { state = 'AT_RISK'; evidence = ev('evolution trajectory DECLINING'); }
  else if (c.is_paying && !c.is_active && !c.has_value && stale) { state = 'AT_RISK'; evidence = ev('paying but inactive, no value, stale'); }
  else if (c.is_active && c.value_category_count >= 2) { state = 'EXPANDING'; evidence = ev('active with multiple value signals'); }
  else if (c.is_active && c.has_value) { state = 'VALUE_REALIZING'; evidence = ev('active with value'); }
  else if (c.is_active) { state = 'ADOPTING'; evidence = ev('active, no value yet'); }
  else if (progressing) { state = 'ACTIVATING'; evidence = ev('onboarding progress (profile/domain/adoption), not yet active'); }
  else if (!stale) { state = 'ONBOARDING'; evidence = ev('recently created, minimal progress'); }
  else if (c.active_30d === 0 && !c.has_value) { state = 'CHURNED'; evidence = ev('stale, no progress, no recent activity'); }
  else { state = 'PROSPECT'; evidence = ev('created, no onboarding progress'); }

  return { customer_state: state, state_confidence: conf, state_evidence: evidence };
}

export interface InterventionEligibility { id: InterventionId; status: EligibilityStatus; reason: string; severity: Severity; }
export interface CompanyGovernance {
  company_id: string; company_name: string; tenant_class: TenantClass;
  customer_state: CustomerState; state_confidence: Confidence; state_evidence: string[];
  globally_suppressed: boolean; global_suppression_reason: string | null;
  eligible_interventions: InterventionId[]; ineligible_interventions: InterventionEligibility[];
  eligibility_evidence: string[];
}

/** Pure, deterministic per-intervention eligibility for one company. */
export function calculateInterventionEligibility(c: GovCompany, nowMs: number): CompanyGovernance {
  const st = calculateCustomerState(c, nowMs);
  const nonCustomer = c.tenant_class !== 'CUSTOMER';
  const evaluations: InterventionEligibility[] = INTERVENTION_CATALOG.map((def) => {
    // 1. Population-integrity suppression (top gate).
    if (nonCustomer) return { id: def.id, status: 'SUPPRESSED', reason: `POPULATION_INTEGRITY: tenant is ${c.tenant_class}`, severity: def.severity };
    // 2. Gap existence.
    const gap = def.gap(c);
    if (gap === 'UNKNOWN') return { id: def.id, status: 'UNKNOWN', reason: 'gap undeterminable (signal UNKNOWN)', severity: def.severity };
    if (gap === false) return { id: def.id, status: 'BLOCKED', reason: 'NO_GAP: capability already satisfied', severity: def.severity };
    // 3. Customer-state suppression.
    if (!def.eligible_states.includes(st.customer_state)) return { id: def.id, status: 'SUPPRESSED', reason: `CUSTOMER_STATE: ${st.customer_state} not eligible`, severity: def.severity };
    // 4. Confidence suppression (signal area or overall).
    const conf = def.area ? c.signal_confidence[def.area] : c.overall_confidence;
    if (conf === 'UNKNOWN') return { id: def.id, status: 'SUPPRESSED', reason: 'UNKNOWN_CONFIDENCE', severity: def.severity };
    if (CONF_RANK[conf] < CONF_RANK[def.min_confidence]) return { id: def.id, status: 'SUPPRESSED', reason: `LOW_CONFIDENCE (${conf} < ${def.min_confidence})`, severity: def.severity };
    return { id: def.id, status: 'ELIGIBLE', reason: `gap present, state ${st.customer_state}, confidence ${conf}`, severity: def.severity };
  });

  const eligible = evaluations.filter((e) => e.status === 'ELIGIBLE');
  return {
    company_id: c.company_id, company_name: c.company_name, tenant_class: c.tenant_class,
    customer_state: st.customer_state, state_confidence: st.state_confidence, state_evidence: st.state_evidence,
    globally_suppressed: nonCustomer, global_suppression_reason: nonCustomer ? `POPULATION_INTEGRITY: ${c.tenant_class}` : null,
    eligible_interventions: eligible.map((e) => e.id),
    ineligible_interventions: evaluations.filter((e) => e.status !== 'ELIGIBLE'),
    eligibility_evidence: eligible.map((e) => `${e.id}: ${e.reason}`),
  };
}

export interface SimulationResult {
  total_companies: number;
  by_intervention: Array<{ id: InterventionId; eligible: number; suppressed: number; blocked: number; unknown: number }>;
  totals: { eligible: number; suppressed: number; blocked: number; unknown: number };
  companies_with_any_eligible: number;
  companies_globally_suppressed: number;
  state_distribution: Record<CustomerState, number>;
  per_company: CompanyGovernance[];
}

/** Pure: simulate the intervention portfolio (no execution, no delivery). */
export function simulateInterventionPortfolio(companies: GovCompany[], nowMs: number): SimulationResult {
  const per_company = companies.map((c) => calculateInterventionEligibility(c, nowMs));
  const STATES: CustomerState[] = ['PROSPECT', 'ONBOARDING', 'ACTIVATING', 'ADOPTING', 'VALUE_REALIZING', 'EXPANDING', 'AT_RISK', 'CHURNED', 'UNKNOWN'];
  const state_distribution = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<CustomerState, number>;
  for (const g of per_company) state_distribution[g.customer_state] += 1;

  const by_intervention = INTERVENTION_CATALOG.map((def) => {
    const evals = per_company.map((g) => [...g.ineligible_interventions, ...g.eligible_interventions.map((id) => ({ id, status: 'ELIGIBLE' as EligibilityStatus }))].find((e) => e.id === def.id)!);
    return {
      id: def.id,
      eligible: evals.filter((e) => e.status === 'ELIGIBLE').length,
      suppressed: evals.filter((e) => e.status === 'SUPPRESSED').length,
      blocked: evals.filter((e) => e.status === 'BLOCKED').length,
      unknown: evals.filter((e) => e.status === 'UNKNOWN').length,
    };
  });
  const totals = by_intervention.reduce((t, b) => ({ eligible: t.eligible + b.eligible, suppressed: t.suppressed + b.suppressed, blocked: t.blocked + b.blocked, unknown: t.unknown + b.unknown }), { eligible: 0, suppressed: 0, blocked: 0, unknown: 0 });

  return {
    total_companies: companies.length,
    by_intervention, totals,
    companies_with_any_eligible: per_company.filter((g) => g.eligible_interventions.length > 0).length,
    companies_globally_suppressed: per_company.filter((g) => g.globally_suppressed).length,
    state_distribution, per_company,
  };
}
