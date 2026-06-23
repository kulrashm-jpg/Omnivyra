/**
 * customerOpportunityPriorityService.ts
 *
 * READ-ONLY prioritization on top of Customer Readiness + Opportunity Detection.
 * Answers "which companies deserve super-admin attention first?" by scoring each
 * tenant on value × engagement × addressable opportunity. Pure — no I/O, no writes,
 * no delivery.
 *
 * Priority favors VALUABLE + ENGAGED + ADDRESSABLE tenants. It deliberately does
 * NOT just rank by opportunity count — a churned free tenant with many gaps is low
 * priority; a paying, active, near-ready tenant with a high-severity gap is high.
 */

import type { CompanyReadiness, TenantStatus, ReadinessBucket } from './customerReadinessService';
import { companyOpportunities, type CompanyOpportunities, type OpportunitySeverity } from './customerOpportunityService';

export type PriorityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'READ_ONLY';

export interface PriorityFactors {
  value: number;          // subscription value
  engagement: number;     // tenant status / recency
  severity: number;       // highest opportunity severity
  addressability: number; // readiness bucket (closer-to-ready = more addressable)
  opportunity_volume: number;
  age_momentum: number;   // recent tenant in onboarding window
}

export interface CompanyPriority {
  company_id: string;
  company_name: string;
  priority_score: number;     // 0–100
  priority_tier: PriorityTier;
  opportunity_count: number;
  highest_severity: OpportunitySeverity | null;
  factors: PriorityFactors;
}

// ── Documented weights (see CUSTOMER_OPPORTUNITY_PRIORITY_MODEL.md) ───────────
export const PRIORITY_WEIGHTS = {
  // Calibrated so attention concentrates on ENGAGED + ADDRESSABLE tenants. Engagement
  // (ACTIVE vs DORMANT) and addressability (PARTIAL vs AT_RISK) are the primary
  // discriminators; opportunity volume is deliberately small (many gaps ≠ urgent).
  paying: 20, free: 3,
  status: { ACTIVE: 30, COMPANY_CREATED: 18, DORMANT: 5, INACTIVE: 0, EMAIL_VERIFIED: 0, SIGNUP_STARTED: 0 } as Record<TenantStatus, number>,
  severity: { HIGH: 15, MEDIUM: 8, LOW: 3 } as Record<OpportunitySeverity, number>,
  bucket: { PARTIAL: 22, AT_RISK: 5, READY: 0 } as Record<ReadinessBucket, number>,
  volumeMax: 5, volumeCap: 6,
  ageMomentum: 5, ageWindowDays: 30,
} as const;

export const PRIORITY_TIER_THRESHOLDS = { CRITICAL: 75, HIGH: 55, MEDIUM: 35 } as const;

const DAY_MS = 86_400_000;

function tierFor(score: number, hasOpportunities: boolean): PriorityTier {
  if (!hasOpportunities) return 'READ_ONLY';
  if (score >= PRIORITY_TIER_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (score >= PRIORITY_TIER_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= PRIORITY_TIER_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/** Compute a single company's priority. Pure + deterministic. */
export function computeCompanyPriority(
  c: CompanyReadiness,
  opps?: CompanyOpportunities,
  now: number = Date.now(),
): CompanyPriority {
  const o = opps ?? companyOpportunities(c);
  const base = { company_id: c.company_id, company_name: c.company_name, opportunity_count: o.opportunity_count, highest_severity: o.highest_severity };

  // Nothing to act on → READ_ONLY, score 0.
  if (o.opportunity_count === 0) {
    return { ...base, priority_score: 0, priority_tier: 'READ_ONLY',
      factors: { value: 0, engagement: 0, severity: 0, addressability: 0, opportunity_volume: 0, age_momentum: 0 } };
  }

  const value = c.billing_ready === 'READY' ? PRIORITY_WEIGHTS.paying : PRIORITY_WEIGHTS.free;
  const engagement = PRIORITY_WEIGHTS.status[c.tenant_status] ?? 0;
  const severity = o.highest_severity ? PRIORITY_WEIGHTS.severity[o.highest_severity] : 0;
  const addressability = PRIORITY_WEIGHTS.bucket[c.readiness_bucket] ?? 0;
  const opportunity_volume = Math.round(Math.min(o.opportunity_count, PRIORITY_WEIGHTS.volumeCap) / PRIORITY_WEIGHTS.volumeCap * PRIORITY_WEIGHTS.volumeMax);
  const ageDays = c.created_at ? (now - Date.parse(c.created_at)) / DAY_MS : Infinity;
  const age_momentum = Number.isFinite(ageDays) && ageDays <= PRIORITY_WEIGHTS.ageWindowDays ? PRIORITY_WEIGHTS.ageMomentum : 0;

  const factors: PriorityFactors = { value, engagement, severity, addressability, opportunity_volume, age_momentum };
  const priority_score = Math.min(100, value + engagement + severity + addressability + opportunity_volume + age_momentum);

  return { ...base, priority_score, priority_tier: tierFor(priority_score, true), factors };
}

export interface PrioritizationResult {
  ranked: CompanyPriority[];
  distribution: Record<PriorityTier, number>;
}

/** Rank all companies by priority (desc), deterministically. Read-only. */
export function prioritizeCustomers(companies: CompanyReadiness[], now: number = Date.now()): PrioritizationResult {
  const ranked = companies
    .map((c) => computeCompanyPriority(c, undefined, now))
    .sort((a, b) => b.priority_score - a.priority_score || a.company_id.localeCompare(b.company_id));
  const distribution: Record<PriorityTier, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, READ_ONLY: 0 };
  for (const r of ranked) distribution[r.priority_tier] += 1;
  return { ranked, distribution };
}
