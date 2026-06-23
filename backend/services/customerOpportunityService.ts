/**
 * customerOpportunityService.ts
 *
 * READ-ONLY Opportunity Detection Engine. Derives "what could create additional
 * value" from the Customer Readiness model (CompanyReadiness). Pure functions —
 * no I/O, no writes, no delivery, no messaging. Nothing is shown to customers or
 * executed here; this only DETECTS opportunities for super-admin visibility.
 *
 * Opportunities are derived from KNOWN gaps (NOT_READY). UNKNOWN areas are never
 * opportunities (we don't flag what we can't see).
 */

import type { CompanyReadiness } from './customerReadinessService';

export type OpportunityType =
  | 'WEBSITE_UNVERIFIED' | 'PROFILE_INCOMPLETE'
  | 'MISSING_GA' | 'MISSING_GSC' | 'MISSING_SOCIAL' | 'MISSING_TEAM' | 'MISSING_BILLING'
  | 'INACTIVE_COMPANY' | 'DORMANT_COMPANY' | 'LOW_READINESS';

export type OpportunitySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DetectedOpportunity {
  type: OpportunityType;
  severity: OpportunitySeverity;
  reason: string;     // human-readable why
  evidence: string;   // the underlying signal/value
}

export interface CompanyOpportunities {
  company_id: string;
  company_name: string;
  opportunities: DetectedOpportunity[];
  opportunity_count: number;
  highest_severity: OpportunitySeverity | null;
}

export interface OpportunitySummary {
  total_opportunities: number;
  companies_with_opportunities: number;
  by_type: Record<OpportunityType, number>;
  by_severity: Record<OpportunitySeverity, number>;
  top_opportunities: Array<{ type: OpportunityType; count: number }>;
}

const SEV_RANK: Record<OpportunitySeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const ALL_TYPES: OpportunityType[] = [
  'WEBSITE_UNVERIFIED', 'PROFILE_INCOMPLETE', 'MISSING_GA', 'MISSING_GSC',
  'MISSING_SOCIAL', 'MISSING_TEAM', 'MISSING_BILLING', 'INACTIVE_COMPANY',
  'DORMANT_COMPANY', 'LOW_READINESS',
];

/**
 * Detectors: each is eligible only on a KNOWN gap and yields one opportunity.
 * Severity reflects priority/value, not certainty.
 */
type Detector = (c: CompanyReadiness) => DetectedOpportunity | null;

const detectors: Detector[] = [
  // Identity foundation — highest leverage.
  (c) => c.website_ready === 'NOT_READY'
    ? { type: 'WEBSITE_UNVERIFIED', severity: 'HIGH', reason: 'Company domain is not verified', evidence: `website_ready=${c.website_ready}` } : null,
  (c) => c.company_profile_ready === 'NOT_READY'
    ? { type: 'PROFILE_INCOMPLETE', severity: 'MEDIUM', reason: 'Company profile is incomplete (missing fields or low confidence)', evidence: `company_profile_ready=${c.company_profile_ready}` } : null,
  // Analytics/insight adoption.
  (c) => c.ga_ready === 'NOT_READY'
    ? { type: 'MISSING_GA', severity: 'MEDIUM', reason: 'Google Analytics is not connected', evidence: `ga_ready=${c.ga_ready}` } : null,
  (c) => c.gsc_ready === 'NOT_READY'
    ? { type: 'MISSING_GSC', severity: 'MEDIUM', reason: 'Google Search Console is not connected', evidence: `gsc_ready=${c.gsc_ready}` } : null,
  (c) => c.social_ready === 'NOT_READY'
    ? { type: 'MISSING_SOCIAL', severity: 'MEDIUM', reason: 'No connected social integrations', evidence: `social_ready=${c.social_ready}` } : null,
  (c) => c.team_ready === 'NOT_READY'
    ? { type: 'MISSING_TEAM', severity: 'LOW', reason: 'Single-seat tenant — no additional team members', evidence: `team_ready=${c.team_ready}, users=${c.user_count}` } : null,
  // Revenue opportunity — only for engaged (not brand-new, not churned) tenants.
  (c) => c.billing_ready === 'NOT_READY' && (c.tenant_status === 'ACTIVE' || c.tenant_status === 'DORMANT')
    ? { type: 'MISSING_BILLING', severity: c.tenant_status === 'ACTIVE' ? 'HIGH' : 'MEDIUM', reason: 'Engaged tenant with no paid plan / purchase', evidence: `billing_ready=${c.billing_ready}, status=${c.tenant_status}` } : null,
  // Lifecycle.
  (c) => c.tenant_status === 'INACTIVE'
    ? { type: 'INACTIVE_COMPANY', severity: 'HIGH', reason: 'No activity > 90 days (churn risk)', evidence: `tenant_status=INACTIVE, last_activity_at=${c.last_activity_at ?? 'none'}` } : null,
  (c) => c.tenant_status === 'DORMANT'
    ? { type: 'DORMANT_COMPANY', severity: 'MEDIUM', reason: 'Activity 31–90 days ago (re-engagement window)', evidence: `tenant_status=DORMANT, last_activity_at=${c.last_activity_at ?? 'none'}` } : null,
  // Aggregate onboarding gap.
  (c) => c.readiness_bucket === 'AT_RISK'
    ? { type: 'LOW_READINESS', severity: 'HIGH', reason: 'Overall readiness is at-risk (< 40%)', evidence: `overall_readiness_score=${c.overall_readiness_score}` } : null,
];

/** Detect all opportunities for a single company. Pure. */
export function detectOpportunities(c: CompanyReadiness): DetectedOpportunity[] {
  return detectors.map((d) => d(c)).filter((o): o is DetectedOpportunity => o !== null);
}

/** Per-company opportunity record with count + highest severity. */
export function companyOpportunities(c: CompanyReadiness): CompanyOpportunities {
  const opportunities = detectOpportunities(c);
  const highest = opportunities.reduce<OpportunitySeverity | null>(
    (acc, o) => (acc === null || SEV_RANK[o.severity] > SEV_RANK[acc] ? o.severity : acc), null,
  );
  return {
    company_id: c.company_id,
    company_name: c.company_name,
    opportunities,
    opportunity_count: opportunities.length,
    highest_severity: highest,
  };
}

/** Aggregate detection + summary across many companies. Read-only. */
export function detectCustomerOpportunities(companies: CompanyReadiness[]): {
  per_company: CompanyOpportunities[];
  summary: OpportunitySummary;
} {
  const per_company = companies.map(companyOpportunities);

  const by_type = Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as Record<OpportunityType, number>;
  const by_severity: Record<OpportunitySeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  let total = 0, withOpps = 0;
  for (const c of per_company) {
    if (c.opportunity_count > 0) withOpps += 1;
    for (const o of c.opportunities) { by_type[o.type] += 1; by_severity[o.severity] += 1; total += 1; }
  }
  const top_opportunities = ALL_TYPES
    .map((t) => ({ type: t, count: by_type[t] }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    per_company,
    summary: { total_opportunities: total, companies_with_opportunities: withOpps, by_type, by_severity, top_opportunities },
  };
}
