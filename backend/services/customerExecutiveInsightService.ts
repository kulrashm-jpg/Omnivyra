/**
 * customerExecutiveInsightService.ts
 *
 * READ-ONLY Executive Insight Engine. Turns readiness + opportunities + priority
 * into human-readable, DETERMINISTIC, rules-based insights and narratives.
 * No AI, no LLM calls, no I/O, no writes, no delivery. Same input → same output.
 *
 * Answers: "why does this company matter, what changed, what's the biggest blocker?"
 */

import type { CompanyReadiness } from './customerReadinessService';
import { companyOpportunities, type CompanyOpportunities } from './customerOpportunityService';
import { computeCompanyPriority, type CompanyPriority } from './customerOpportunityPriorityService';

export type InsightType =
  | 'READINESS_BLOCKER' | 'ADOPTION_GAP' | 'ENGAGEMENT_RISK'
  | 'BILLING_RISK' | 'VERIFICATION_GAP' | 'TEAM_EXPANSION_OPPORTUNITY';

export type InsightSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type InsightConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ExecutiveInsight {
  type: InsightType;
  title: string;
  severity: InsightSeverity;
  reason: string;
  evidence: string;
  confidence: InsightConfidence;
}

export interface CompanyExecutiveInsight {
  company_id: string;
  company_name: string;
  insights: ExecutiveInsight[];
  key_insight: ExecutiveInsight | null;
  primary_blocker: ExecutiveInsight | null;
  primary_opportunity: ExecutiveInsight | null;
  narrative: string;
}

const SEV_RANK: Record<InsightSeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
// Deterministic tiebreak order when severities are equal.
const TYPE_ORDER: InsightType[] = [
  'VERIFICATION_GAP', 'READINESS_BLOCKER', 'ENGAGEMENT_RISK', 'BILLING_RISK',
  'ADOPTION_GAP', 'TEAM_EXPANSION_OPPORTUNITY',
];
const BLOCKER_TYPES = new Set<InsightType>(['VERIFICATION_GAP', 'READINESS_BLOCKER', 'ENGAGEMENT_RISK', 'BILLING_RISK']);
const OPPORTUNITY_TYPES = new Set<InsightType>(['ADOPTION_GAP', 'TEAM_EXPANSION_OPPORTUNITY']);

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Pick the highest-severity insight (deterministic tiebreak by TYPE_ORDER). */
function pick(insights: ExecutiveInsight[], allowed?: Set<InsightType>): ExecutiveInsight | null {
  const pool = allowed ? insights.filter((i) => allowed.has(i.type)) : insights;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) =>
    SEV_RANK[b.severity] - SEV_RANK[a.severity] || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type),
  )[0];
}

/** Deterministic, rules-based insight detection. */
function buildInsights(c: CompanyReadiness): ExecutiveInsight[] {
  const out: ExecutiveInsight[] = [];

  if (c.website_ready === 'NOT_READY') {
    out.push({ type: 'VERIFICATION_GAP', title: 'Website domain not verified', severity: 'HIGH',
      reason: 'The company domain has not been verified', evidence: 'website_ready=NOT_READY', confidence: 'HIGH' });
  }

  if (c.company_profile_ready === 'NOT_READY') {
    out.push({ type: 'READINESS_BLOCKER', title: 'Company profile incomplete', severity: 'MEDIUM',
      reason: 'Core profile fields or confidence are insufficient', evidence: 'company_profile_ready=NOT_READY', confidence: 'HIGH' });
  } else if (c.readiness_bucket === 'AT_RISK') {
    out.push({ type: 'READINESS_BLOCKER', title: 'Overall readiness at risk', severity: 'HIGH',
      reason: `Overall readiness is ${c.overall_readiness_score}%`, evidence: 'readiness_bucket=AT_RISK', confidence: 'HIGH' });
  }

  const adoption = [
    c.ga_ready === 'NOT_READY' ? 'GA' : null,
    c.gsc_ready === 'NOT_READY' ? 'GSC' : null,
    c.social_ready === 'NOT_READY' ? 'social' : null,
  ].filter((x): x is string => x !== null);
  if (adoption.length) {
    out.push({ type: 'ADOPTION_GAP', title: `Missing ${joinAnd(adoption)} ${adoption.length === 1 ? 'integration' : 'integrations'}`,
      severity: 'MEDIUM', reason: 'Key integrations are not adopted', evidence: `missing=${adoption.join(',')}`, confidence: 'HIGH' });
  }

  if (c.tenant_status === 'INACTIVE') {
    out.push({ type: 'ENGAGEMENT_RISK', title: 'Inactive — churn risk', severity: 'HIGH',
      reason: 'No activity for over 90 days', evidence: `last_activity_at=${c.last_activity_at ?? 'none'}`, confidence: 'MEDIUM' });
  } else if (c.tenant_status === 'DORMANT') {
    out.push({ type: 'ENGAGEMENT_RISK', title: 'Dormant — re-engagement window', severity: 'MEDIUM',
      reason: 'Activity 31–90 days ago', evidence: `last_activity_at=${c.last_activity_at ?? 'none'}`, confidence: 'MEDIUM' });
  }

  if (c.billing_ready === 'NOT_READY' && (c.tenant_status === 'ACTIVE' || c.tenant_status === 'DORMANT')) {
    out.push({ type: 'BILLING_RISK', title: 'Engaged tenant with no paid plan',
      severity: c.tenant_status === 'ACTIVE' ? 'HIGH' : 'MEDIUM', reason: 'No paid plan or purchase despite engagement',
      evidence: `billing_ready=NOT_READY, status=${c.tenant_status}`, confidence: 'MEDIUM' });
  }

  if (c.team_ready === 'NOT_READY') {
    out.push({ type: 'TEAM_EXPANSION_OPPORTUNITY', title: 'Single-seat — expansion opportunity', severity: 'LOW',
      reason: 'Only one active member', evidence: `team_ready=NOT_READY, users=${c.user_count}`, confidence: 'HIGH' });
  }

  return out;
}

/** Deterministic rules-based narrative. No AI. */
export function buildNarrative(c: CompanyReadiness): string {
  const statusWord = c.tenant_status === 'ACTIVE' ? 'Active'
    : c.tenant_status === 'DORMANT' ? 'Dormant'
    : c.tenant_status === 'INACTIVE' ? 'Inactive'
    : c.tenant_status === 'COMPANY_CREATED' ? 'New'
    : c.tenant_status.replace('_', ' ').toLowerCase();
  const valueWord = c.billing_ready === 'READY' ? 'paying customer' : 'tenant';

  const readinessParts: string[] = [];
  if (c.company_profile_ready === 'READY') readinessParts.push('a complete profile');
  else if (c.company_profile_ready === 'NOT_READY') readinessParts.push('an incomplete profile');
  if (c.website_ready === 'READY') readinessParts.push('a verified website');
  else if (c.website_ready === 'NOT_READY') readinessParts.push('an unverified website');
  const readinessClause = readinessParts.length ? `with ${joinAnd(readinessParts)}` : 'with limited profile data';

  const gapParts: string[] = [];
  const integ = [
    c.ga_ready === 'NOT_READY' ? 'GA' : null,
    c.gsc_ready === 'NOT_READY' ? 'GSC' : null,
    c.social_ready === 'NOT_READY' ? 'social' : null,
  ].filter((x): x is string => x !== null);
  if (integ.length) gapParts.push(`missing ${joinAnd(integ)} ${integ.length === 1 ? 'integration' : 'integrations'}`);
  if (c.team_ready === 'NOT_READY') gapParts.push('no team expansion');
  if (c.billing_ready === 'NOT_READY' && (c.tenant_status === 'ACTIVE' || c.tenant_status === 'DORMANT')) gapParts.push('no paid plan');

  const readinessPositive = c.company_profile_ready === 'READY' || c.website_ready === 'READY';
  const connective = readinessPositive ? 'but' : 'and';
  const gapClause = gapParts.length ? ` ${connective} ${joinAnd(gapParts)}` : '';

  return `${statusWord} ${valueWord} ${readinessClause}${gapClause}.`;
}

/** Full executive insight for one company. Pure + deterministic. */
export function generateCompanyInsight(
  c: CompanyReadiness,
  _opps?: CompanyOpportunities,
  _priority?: CompanyPriority,
): CompanyExecutiveInsight {
  const insights = buildInsights(c);
  return {
    company_id: c.company_id,
    company_name: c.company_name,
    insights,
    key_insight: pick(insights),
    primary_blocker: pick(insights, BLOCKER_TYPES),
    primary_opportunity: pick(insights, OPPORTUNITY_TYPES),
    narrative: buildNarrative(c),
  };
}

// ── Portfolio insights (Phase 5) ─────────────────────────────────────────────
export interface PortfolioInsights {
  total_tenants: number;
  top_blockers: Array<{ type: InsightType; count: number }>;
  top_opportunities: Array<{ type: InsightType; count: number }>;
  most_common_readiness_gaps: Array<{ area: string; count: number }>;
  most_common_verification_gaps: Array<{ area: string; count: number }>;
}

export function generatePortfolioInsights(companies: CompanyReadiness[]): {
  per_company: CompanyExecutiveInsight[];
  portfolio: PortfolioInsights;
} {
  const per_company = companies.map((c) => generateCompanyInsight(c, companyOpportunities(c), computeCompanyPriority(c)));

  const blockerCounts = new Map<InsightType, number>();
  const opportunityCounts = new Map<InsightType, number>();
  for (const ci of per_company) {
    for (const ins of ci.insights) {
      if (BLOCKER_TYPES.has(ins.type)) blockerCounts.set(ins.type, (blockerCounts.get(ins.type) ?? 0) + 1);
      if (OPPORTUNITY_TYPES.has(ins.type)) opportunityCounts.set(ins.type, (opportunityCounts.get(ins.type) ?? 0) + 1);
    }
  }

  // Readiness gaps = NOT_READY counts per area across the portfolio.
  const areaFields: Array<[string, keyof CompanyReadiness]> = [
    ['COMPANY_PROFILE', 'company_profile_ready'], ['WEBSITE', 'website_ready'],
    ['GOOGLE_ANALYTICS', 'ga_ready'], ['GOOGLE_SEARCH_CONSOLE', 'gsc_ready'],
    ['SOCIAL_INTEGRATIONS', 'social_ready'], ['TEAM_MEMBERS', 'team_ready'], ['BILLING', 'billing_ready'],
  ];
  const gapCounts = new Map<string, number>();
  for (const c of companies) for (const [area, field] of areaFields) if (c[field] === 'NOT_READY') gapCounts.set(area, (gapCounts.get(area) ?? 0) + 1);

  const verification = new Map<string, number>();
  for (const c of companies) if (c.website_ready === 'NOT_READY') verification.set('WEBSITE_UNVERIFIED', (verification.get('WEBSITE_UNVERIFIED') ?? 0) + 1);

  const rank = <K>(m: Map<K, number>) => Array.from(m.entries()).map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count);

  return {
    per_company,
    portfolio: {
      total_tenants: companies.length,
      top_blockers: rank(blockerCounts).map(({ k, count }) => ({ type: k, count })),
      top_opportunities: rank(opportunityCounts).map(({ k, count }) => ({ type: k, count })),
      most_common_readiness_gaps: rank(gapCounts).map(({ k, count }) => ({ area: k, count })),
      most_common_verification_gaps: rank(verification).map(({ k, count }) => ({ area: k, count })),
    },
  };
}
