/**
 * customerOperationsCockpitService.ts
 *
 * THE single READ-ONLY aggregation layer for the Customer Operations Command Center
 * (Phase 13A). Unifies readiness (12A/C) + opportunities (12D) + priority (12E) +
 * executive insights (12F) + evolution (12G/H) + company identity + signup-funnel
 * failures into one per-company view. NO business logic, NO recommendations, NO
 * mutations — only aggregation of existing sources.
 *
 * (Distinct from the unrelated enterprise-scoring `customerOperationsService.ts`.)
 */

import { supabase } from '../db/supabaseClient';
import { getCustomerReadiness, type CompanyReadiness, type TenantStatus, type ReadinessBucket } from './customerReadinessService';
import { detectCustomerOpportunities, type OpportunitySeverity } from './customerOpportunityService';
import { prioritizeCustomers, type PriorityTier } from './customerOpportunityPriorityService';
import { generatePortfolioInsights, type ExecutiveInsight } from './customerExecutiveInsightService';
import { loadReadinessHistory, computeCompanyEvolution, snapshotFromCurrent, generatePortfolioEvolution, type Trajectory } from './customerEvolutionService';
import { checkCompanyIdentityDrift } from './companyIdentityDriftService';

export type IdentityHealth = 'OK' | 'DRIFT' | 'UNKNOWN';

export interface CockpitCompany {
  company_id: string;
  company_name: string;
  website: string | null;
  website_domain: string | null;
  admin_email_domain: string | null;
  identity_health: IdentityHealth;
  tenant_status: TenantStatus;
  plan: string;
  paying: boolean;
  user_count: number;
  active_user_count_30d: number;
  readiness_score: number;
  readiness_bucket: ReadinessBucket;
  priority_score: number;
  priority_tier: PriorityTier;
  key_insight: ExecutiveInsight | null;
  primary_blocker: ExecutiveInsight | null;
  primary_opportunity: ExecutiveInsight | null;
  narrative: string;
  trajectory: Trajectory;
  score_delta: number | null;
  ga: string; gsc: string; social: string; community: string;
  opportunity_count: number;
  highest_severity: OpportunitySeverity | null;
  last_activity_at: string | null;
}

export type SignupFunnelBucket = 'PUBLIC_EMAIL' | 'DOMAIN_RESOLUTION_FAILED' | 'NO_WEBSITE_FOUND' | 'DOMAIN_NOT_CANONICAL' | 'FORWARDING_DOMAIN' | 'CLAIMED_DOMAIN';
export interface SignupFunnelEntry { bucket: SignupFunnelBucket; count: number; last_occurrence: string | null; affected_domains: string[]; }
export interface SignupFunnel { onboarded: number; total_failures: number; failures: SignupFunnelEntry[]; }

export interface CockpitFilters {
  status?: TenantStatus; plan?: string; priority?: PriorityTier; readiness?: ReadinessBucket; trajectory?: Trajectory; search?: string;
}

export interface CockpitResult {
  summary: {
    total_companies: number; active: number; dormant: number; inactive: number;
    paying: number; critical_priority: number; signup_failures: number; identity_drift: number;
  };
  companies: CockpitCompany[];
  signup_funnel: SignupFunnel;
  portfolio: {
    priority_distribution: Record<PriorityTier, number>;
    trajectory_distribution: Record<Trajectory, number>;
    top_blockers: ReturnType<typeof generatePortfolioInsights>['portfolio']['top_blockers'];
  };
}

const safe = async <T, F = T>(fn: () => Promise<T>, fb: F): Promise<T | F> => { try { return await fn(); } catch { return fb; } };

async function loadIdentity(ids: string[]): Promise<Map<string, { website: string | null; website_domain: string | null; admin_email_domain: string | null; identity_health: IdentityHealth }>> {
  const map = new Map<string, { website: string | null; website_domain: string | null; admin_email_domain: string | null; identity_health: IdentityHealth }>();
  if (ids.length === 0) return map;
  const rows = await safe(async () => {
    const { data } = await supabase.from('companies').select('id, name, website, website_domain, admin_email_domain').in('id', ids);
    return (data ?? []) as Array<{ id: string; name: string | null; website: string | null; website_domain: string | null; admin_email_domain: string | null }>;
  }, [] as Array<{ id: string; name: string | null; website: string | null; website_domain: string | null; admin_email_domain: string | null }>);
  for (const r of rows) {
    const drift = checkCompanyIdentityDrift(r);
    map.set(r.id, { website: r.website, website_domain: r.website_domain, admin_email_domain: r.admin_email_domain, identity_health: drift.hasDrift ? 'DRIFT' : 'OK' });
  }
  return map;
}

/**
 * Pure: map raw telemetry rows → the 6 signup-funnel buckets. Exported for tests.
 */
export function aggregateSignupFunnel(input: {
  eligibility: Array<{ domain?: string | null; reason?: string | null; checked_at?: string | null }>;
  events: Array<{ event_type?: string | null; final_domain?: string | null; created_at?: string | null }>;
  referrals: Array<{ domain?: string | null; last_attempt_at?: string | null }>;
  onboarded: number;
}): SignupFunnel {
  const agg: Record<SignupFunnelBucket, { count: number; last: string | null; domains: Set<string> }> = {
    PUBLIC_EMAIL: { count: 0, last: null, domains: new Set() },
    DOMAIN_RESOLUTION_FAILED: { count: 0, last: null, domains: new Set() },
    NO_WEBSITE_FOUND: { count: 0, last: null, domains: new Set() },
    DOMAIN_NOT_CANONICAL: { count: 0, last: null, domains: new Set() },
    FORWARDING_DOMAIN: { count: 0, last: null, domains: new Set() },
    CLAIMED_DOMAIN: { count: 0, last: null, domains: new Set() },
  };
  const bump = (b: SignupFunnelBucket, when: string | null | undefined, domain: string | null | undefined) => {
    agg[b].count += 1;
    if (when && (!agg[b].last || when > agg[b].last)) agg[b].last = when;
    if (domain) agg[b].domains.add(String(domain).toLowerCase());
  };
  for (const r of input.eligibility) {
    const reason = String(r.reason ?? '');
    if (/PUBLIC_EMAIL|public_provider/i.test(reason)) bump('PUBLIC_EMAIL', r.checked_at, r.domain);
    else if (/FORWARDING_DOMAIN|forwarding/i.test(reason)) bump('FORWARDING_DOMAIN', r.checked_at, r.domain);
    else if (/DOMAIN_NOT_CANONICAL/i.test(reason)) bump('DOMAIN_NOT_CANONICAL', r.checked_at, r.domain);
    else if (/NO_WEBSITE_FOUND/i.test(reason)) bump('NO_WEBSITE_FOUND', r.checked_at, r.domain);
  }
  for (const e of input.events) {
    const et = String(e.event_type ?? '');
    if (/DOMAIN_RESOLUTION_FAILED|RESOLUTION_BLOCKED/i.test(et)) bump('DOMAIN_RESOLUTION_FAILED', e.created_at, e.final_domain);
    else if (/DOMAIN_NOT_CANONICAL/i.test(et)) bump('DOMAIN_NOT_CANONICAL', e.created_at, e.final_domain);
    else if (/FORWARDING/i.test(et)) bump('FORWARDING_DOMAIN', e.created_at, e.final_domain);
  }
  for (const r of input.referrals) bump('CLAIMED_DOMAIN', r.last_attempt_at, r.domain);

  const failures: SignupFunnelEntry[] = (Object.keys(agg) as SignupFunnelBucket[]).map((bucket) => ({
    bucket, count: agg[bucket].count, last_occurrence: agg[bucket].last, affected_domains: Array.from(agg[bucket].domains).slice(0, 25),
  }));
  return { onboarded: input.onboarded, total_failures: failures.reduce((a, f) => a + f.count, 0), failures };
}

/** Signup-funnel failures from existing telemetry. Read-only; defensive. */
export async function loadSignupFunnel(): Promise<SignupFunnel> {
  const eligibility = await safe(async () => ((await supabase.from('domain_eligibility_cache').select('domain, reason, checked_at')).data ?? []) as any[], [] as any[]);
  const events = await safe(async () => ((await supabase.from('domain_events').select('event_type, final_domain, created_at')).data ?? []) as any[], [] as any[]);
  const referrals = await safe(async () => ((await supabase.from('signup_referrals').select('domain, last_attempt_at')).data ?? []) as any[], [] as any[]);
  const onboarded = await safe(async () => (await supabase.from('companies').select('id', { count: 'exact', head: true })).count ?? 0, 0);
  return aggregateSignupFunnel({ eligibility, events, referrals, onboarded });
}

/** Pure: filter + priority-sort the cockpit rows. Exported for tests. */
export function applyCockpitFilters(list: CockpitCompany[], f: CockpitFilters): CockpitCompany[] {
  const q = f.search?.trim().toLowerCase();
  return list.filter((c) =>
    (!f.status || c.tenant_status === f.status) &&
    (!f.plan || c.plan === f.plan) &&
    (!f.priority || c.priority_tier === f.priority) &&
    (!f.readiness || c.readiness_bucket === f.readiness) &&
    (!f.trajectory || c.trajectory === f.trajectory) &&
    (!q || `${c.company_name} ${c.company_id} ${c.website_domain ?? ''}`.toLowerCase().includes(q)),
  ).sort((a, b) => b.priority_score - a.priority_score || a.company_id.localeCompare(b.company_id));
}

/** Single aggregation entry point. Read-only. */
export async function getCustomerOperations(
  filters: CockpitFilters = {},
  deps: { loadFunnel?: () => Promise<SignupFunnel> } = {},
): Promise<CockpitResult> {
  const nowIso = new Date().toISOString();
  const readiness = await getCustomerReadiness({});
  const tenants = readiness.tenants;
  const ids = tenants.map((t) => t.company_id);

  const oppByCompany = new Map(detectCustomerOpportunities(tenants).per_company.map((c) => [c.company_id, c]));
  const prio = prioritizeCustomers(tenants);
  const prioByCompany = new Map(prio.ranked.map((p) => [p.company_id, p]));
  const ins = generatePortfolioInsights(tenants);
  const insByCompany = new Map(ins.per_company.map((c) => [c.company_id, c]));
  const history = await loadReadinessHistory(ids);
  const identity = await loadIdentity(ids);
  const signup_funnel = await (deps.loadFunnel ?? loadSignupFunnel)();

  const evolutions: ReturnType<typeof computeCompanyEvolution>[] = [];
  const companiesAll: CockpitCompany[] = tenants.map((t: CompanyReadiness) => {
    const o = oppByCompany.get(t.company_id);
    const p = prioByCompany.get(t.company_id);
    const i = insByCompany.get(t.company_id);
    const id = identity.get(t.company_id);
    const evo = computeCompanyEvolution([...(history.get(t.company_id) ?? []), snapshotFromCurrent(t, nowIso, o?.opportunity_count ?? 0, p?.priority_tier ?? 'READ_ONLY')], t.company_name);
    evolutions.push(evo);
    return {
      company_id: t.company_id, company_name: t.company_name,
      website: id?.website ?? null, website_domain: id?.website_domain ?? null, admin_email_domain: id?.admin_email_domain ?? null,
      identity_health: id?.identity_health ?? 'UNKNOWN',
      tenant_status: t.tenant_status,
      plan: t.plan, paying: t.billing_ready === 'READY', user_count: t.user_count, active_user_count_30d: t.active_user_count_30d,
      readiness_score: t.overall_readiness_score, readiness_bucket: t.readiness_bucket,
      priority_score: p?.priority_score ?? 0, priority_tier: p?.priority_tier ?? 'READ_ONLY',
      key_insight: i?.key_insight ?? null, primary_blocker: i?.primary_blocker ?? null, primary_opportunity: i?.primary_opportunity ?? null, narrative: i?.narrative ?? '',
      trajectory: evo.trajectory, score_delta: evo.score_delta,
      ga: t.ga_ready, gsc: t.gsc_ready, social: t.social_ready, community: t.community_ready,
      opportunity_count: o?.opportunity_count ?? 0, highest_severity: o?.highest_severity ?? null,
      last_activity_at: t.last_activity_at,
    };
  });

  const companies = applyCockpitFilters(companiesAll, filters);

  const evoPortfolio = generatePortfolioEvolution(evolutions);
  const summary = {
    total_companies: companies.length,
    active: companies.filter((c) => c.tenant_status === 'ACTIVE').length,
    dormant: companies.filter((c) => c.tenant_status === 'DORMANT').length,
    inactive: companies.filter((c) => c.tenant_status === 'INACTIVE').length,
    paying: companies.filter((c) => c.paying).length,
    critical_priority: companies.filter((c) => c.priority_tier === 'CRITICAL').length,
    signup_failures: signup_funnel.total_failures,
    identity_drift: companies.filter((c) => c.identity_health === 'DRIFT').length,
  };

  return {
    summary, companies, signup_funnel,
    portfolio: { priority_distribution: prio.distribution, trajectory_distribution: evoPortfolio.trajectory_distribution, top_blockers: ins.portfolio.top_blockers },
  };
}
