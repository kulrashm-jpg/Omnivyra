/**
 * customerDataRehabilitationService.ts
 *
 * READ-ONLY remediation analysis (Phase 16A). Pure, deterministic helpers that quantify the
 * data-quality problems found in 12A–15E and what they would become after remediation. No
 * automated writes — the classification persistence (customer_population_classification) is
 * seeded by an operator-run script, not by these functions.
 *
 * Key remediation facts (probed live):
 *  - `organization_id` == `company_id` (no separate organizations table) → org-keyed billing /
 *    engagement / community data IS company-attributable.
 *  - `signup_intents` join by email-domain → company recovers ~96% of the cohort.
 *  - 26 confidence=0 profiles are UNSCORED (have field data, `last_refined_at` null).
 */

import { classifyTenant, type TenantIdentity } from './customerPopulationIntegrityService';

export interface ClassificationRow { company_id: string; classification: string; confidence: string; reason: string; }

/** Pure: deterministic rows for the governed `customer_population_classification` source. */
export function buildClassificationRows(companies: TenantIdentity[]): ClassificationRow[] {
  return companies
    .map((c) => {
      const r = classifyTenant(c);
      return { company_id: r.company_id, classification: r.tenant_class, confidence: r.classification_confidence, reason: r.classification_evidence.join('; ') };
    })
    .sort((a, b) => a.company_id.localeCompare(b.company_id));
}

export type Attribution = 'ATTRIBUTABLE' | 'PARTIALLY_ATTRIBUTABLE' | 'UNATTRIBUTABLE';

/** Pure: can an organization_id-keyed source be attributed to companies? (org_id == company_id). */
export function classifyAttribution(sourceOrgIds: string[], companyIds: Set<string>): { attribution: Attribution; matched: number; total: number } {
  const total = sourceOrgIds.length;
  const matched = sourceOrgIds.filter((id) => companyIds.has(id)).length;
  const attribution: Attribution = total === 0 ? 'UNATTRIBUTABLE' : matched === total ? 'ATTRIBUTABLE' : matched > 0 ? 'PARTIALLY_ATTRIBUTABLE' : 'UNATTRIBUTABLE';
  return { attribution, matched, total };
}

export interface SignupJoinability { total: number; currently_joinable: number; recoverable: number; unrecoverable: number; recoverable_pct: number | null; strategy: string; }

/** Pure: signup-cohort joinability via email-domain → company match. */
export function assessSignupJoinability(intents: Array<{ email: string; supabase_uid: string | null }>, companyDomains: Set<string>): SignupJoinability {
  const dom = (e: string) => (e.includes('@') ? e.split('@')[1] : e).trim().toLowerCase();
  const currently = intents.filter((i) => i.supabase_uid).length;
  const domainMatch = intents.filter((i) => companyDomains.has(dom(i.email))).length;
  const recoverable = Math.max(0, domainMatch - currently);
  return {
    total: intents.length, currently_joinable: currently, recoverable, unrecoverable: intents.length - currently - recoverable,
    recoverable_pct: intents.length ? Math.round((domainMatch / intents.length) * 1000) / 10 : null,
    strategy: 'join signup_intents.email registrable-domain → companies.admin_email_domain | website_domain',
  };
}

export type ProfileRootCause = 'UNSCORED' | 'FAILED_SCORING' | 'MISSING_TRIGGER' | 'INVALID_PROFILE';

/** Pure: classify a zero-confidence profile's root cause from observable fields. */
export function classifyProfileRootCause(p: { overall_confidence: number; has_field_data: boolean; last_refined_at: string | null }): ProfileRootCause {
  if (p.overall_confidence > 0) return 'UNSCORED'; // not a zero-conf case (caller filters); defensive
  if (!p.has_field_data) return 'INVALID_PROFILE';            // no data → genuinely empty
  if (p.last_refined_at == null) return 'MISSING_TRIGGER';    // has data, never refined → scoring trigger absent
  return 'FAILED_SCORING';                                     // refined but still 0 → scoring failed
}

export interface RemediationMaturityEstimate {
  current: { customer_integrity: number; joinability: number; coverage: number; foundation: number };
  remediated_max: { customer_integrity: number; joinability: number; coverage: number; foundation: number };
  level_current: string; level_remediated: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure: re-estimate maturity if remediation lands (customer-only integrity, org=company joinability, scored coverage). */
export function estimateRemediatedMaturity(input: {
  current_integrity: number; current_joinability: number; current_coverage: number; current_telemetry: number; current_confidence: number;
  remediated_integrity: number; remediated_joinability: number; remediated_coverage: number;
}): RemediationMaturityEstimate {
  const W = { integrity: 0.3, telemetry: 0.2, confidence: 0.2, joinability: 0.15, coverage: 0.15 };
  const found = (i: number, j: number, cov: number) => round1(i * W.integrity + input.current_telemetry * W.telemetry + input.current_confidence * W.confidence + j * W.joinability + cov * W.coverage);
  const level = (f: number, i: number) => { let l = f < 20 ? 'LEVEL_0' : f < 40 ? 'LEVEL_1' : f < 60 ? 'LEVEL_2' : f < 80 ? 'LEVEL_3' : 'LEVEL_4'; if (i < 20 && (l === 'LEVEL_2' || l === 'LEVEL_3' || l === 'LEVEL_4')) l = 'LEVEL_1'; return l; };
  const fc = found(input.current_integrity, input.current_joinability, input.current_coverage);
  const fr = found(input.remediated_integrity, input.remediated_joinability, input.remediated_coverage);
  return {
    current: { customer_integrity: input.current_integrity, joinability: input.current_joinability, coverage: input.current_coverage, foundation: fc },
    remediated_max: { customer_integrity: input.remediated_integrity, joinability: input.remediated_joinability, coverage: input.remediated_coverage, foundation: fr },
    level_current: level(fc, input.current_integrity), level_remediated: level(fr, input.remediated_integrity),
  };
}
