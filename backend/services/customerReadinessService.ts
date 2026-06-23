/**
 * customerReadinessService.ts
 *
 * READ-ONLY aggregation for the Customer Readiness Console (super-admin).
 * Computes per-company tenant status + readiness areas + an overall score.
 *
 * No writes, no messaging, no recommendations — visibility only. Every external
 * read is defensive: a failed/absent source yields UNKNOWN, never a hard error.
 *
 * The scoring logic is pure and exported for tests; the DB layer is thin and
 * injectable (`getCustomerReadiness(filters, { load })`).
 */

import { supabase } from '../db/supabaseClient';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';

// ── Types ───────────────────────────────────────────────────────────────────
export type TenantStatus =
  | 'SIGNUP_STARTED' | 'EMAIL_VERIFIED' | 'COMPANY_CREATED'
  | 'ACTIVE' | 'DORMANT' | 'INACTIVE';

export type ReadinessState = 'READY' | 'NOT_READY' | 'UNKNOWN';

export type ReadinessArea =
  | 'COMPANY_PROFILE' | 'WEBSITE' | 'GOOGLE_ANALYTICS' | 'GOOGLE_SEARCH_CONSOLE'
  | 'SOCIAL_INTEGRATIONS' | 'COMMUNITY' | 'TEAM_MEMBERS' | 'BILLING';

export type ReadinessBucket = 'READY' | 'PARTIAL' | 'AT_RISK';

/** Raw per-company signals gathered from the (read-only) data layer. */
export interface CompanyRawSignals {
  id: string;
  name: string;
  companyStatus: string | null;       // 'active' | 'inactive' | null
  createdAt: string | null;
  websiteDomain: string | null;
  /** Phase 12C: true when a VERIFIED company_domains row exists; 'unknown' if unread. */
  websiteVerified: boolean | 'unknown';
  profile: { name?: string | null; websiteUrl?: string | null; industry?: string | null; confidence?: number | null } | null | 'unknown';
  userCount: number;
  activeUserCount: number;            // active members (status='active')
  activeUserCount30d: number;
  lastActivityAt: string | null;
  ga: 'connected' | 'not_connected' | 'unknown';
  gsc: 'connected' | 'not_connected' | 'unknown';
  socialConnectedCount: number | 'unknown';
  billing: { paying: boolean; plan: string } | 'unknown';
}

export interface CompanyReadiness {
  company_id: string;
  company_name: string;
  plan: string;
  user_count: number;
  active_user_count_30d: number;
  created_at: string | null;
  last_activity_at: string | null;
  tenant_status: TenantStatus;
  company_profile_ready: ReadinessState;
  website_ready: ReadinessState;
  ga_ready: ReadinessState;
  gsc_ready: ReadinessState;
  social_ready: ReadinessState;
  community_ready: ReadinessState;
  team_ready: ReadinessState;
  billing_ready: ReadinessState;
  overall_readiness_score: number;
  readiness_bucket: ReadinessBucket;
  missing_areas: ReadinessArea[];
}

export interface ReadinessFilters {
  status?: TenantStatus;
  plan?: string;
  readiness?: ReadinessBucket;
  search?: string;
}

export interface ReadinessSummary {
  total_tenants: number;
  paying_tenants: number;
  by_status: Record<TenantStatus, number>;
  by_bucket: Record<ReadinessBucket, number>;
  readiness_breakdown: Record<ReadinessArea, Record<ReadinessState, number>>;
}

// ── Pure logic (exported for tests) ──────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Phase 12C: minimum `company_profiles.overall_confidence` for a "complete" profile. */
export const PROFILE_CONFIDENCE_THRESHOLD = 60;

export function computeTenantStatus(input: {
  hasCompany: boolean;
  emailVerified: boolean;
  companyStatus: string | null;
  lastActivityAt: string | null;
  now: number;
}): TenantStatus {
  if (!input.hasCompany) return input.emailVerified ? 'EMAIL_VERIFIED' : 'SIGNUP_STARTED';
  if (String(input.companyStatus ?? '').toLowerCase() === 'inactive') return 'INACTIVE';
  if (!input.lastActivityAt) return 'COMPANY_CREATED';
  const ts = Date.parse(input.lastActivityAt);
  if (Number.isNaN(ts)) return 'COMPANY_CREATED';
  const ageDays = (input.now - ts) / DAY_MS;
  if (ageDays <= 30) return 'ACTIVE';
  if (ageDays <= 90) return 'DORMANT';
  return 'INACTIVE';
}

export function bucketFor(score: number): ReadinessBucket {
  if (score >= 80) return 'READY';
  if (score >= 40) return 'PARTIAL';
  return 'AT_RISK';
}

const present = (v: unknown): boolean => typeof v === 'string' ? v.trim() !== '' : v != null;

/** Build the full per-company readiness record from raw signals. Pure. */
export function buildCompanyReadiness(raw: CompanyRawSignals, now: number): CompanyReadiness {
  // COMPANY_PROFILE (Phase 12C): core identity fields present AND a confidence gate
  // (company_profiles.overall_confidence ≥ threshold). A row that exists but was never
  // confidence-scored is NOT a complete profile. Unread source → UNKNOWN.
  const company_profile_ready: ReadinessState =
    raw.profile === 'unknown' ? 'UNKNOWN'
      : raw.profile
          && present(raw.profile.name) && present(raw.profile.websiteUrl) && present(raw.profile.industry)
          && typeof raw.profile.confidence === 'number' && raw.profile.confidence >= PROFILE_CONFIDENCE_THRESHOLD
        ? 'READY' : 'NOT_READY';

  // WEBSITE (Phase 12C): a VERIFIED company domain, not mere presence. Unread → UNKNOWN.
  const website_ready: ReadinessState =
    raw.websiteVerified === 'unknown' ? 'UNKNOWN' : raw.websiteVerified ? 'READY' : 'NOT_READY';
  const ga_ready: ReadinessState = raw.ga === 'unknown' ? 'UNKNOWN' : raw.ga === 'connected' ? 'READY' : 'NOT_READY';
  const gsc_ready: ReadinessState = raw.gsc === 'unknown' ? 'UNKNOWN' : raw.gsc === 'connected' ? 'READY' : 'NOT_READY';
  const social_ready: ReadinessState =
    raw.socialConnectedCount === 'unknown' ? 'UNKNOWN' : raw.socialConnectedCount > 0 ? 'READY' : 'NOT_READY';
  const community_ready: ReadinessState = 'UNKNOWN'; // no source exists
  const team_ready: ReadinessState = raw.activeUserCount >= 2 ? 'READY' : 'NOT_READY';
  const billing_ready: ReadinessState = raw.billing === 'unknown' ? 'UNKNOWN' : raw.billing.paying ? 'READY' : 'NOT_READY';

  const areas: Record<ReadinessArea, ReadinessState> = {
    COMPANY_PROFILE: company_profile_ready,
    WEBSITE: website_ready,
    GOOGLE_ANALYTICS: ga_ready,
    GOOGLE_SEARCH_CONSOLE: gsc_ready,
    SOCIAL_INTEGRATIONS: social_ready,
    COMMUNITY: community_ready,
    TEAM_MEMBERS: team_ready,
    BILLING: billing_ready,
  };

  let ready = 0, notReady = 0;
  const missing_areas: ReadinessArea[] = [];
  for (const [area, state] of Object.entries(areas) as [ReadinessArea, ReadinessState][]) {
    if (state === 'READY') ready += 1;
    else if (state === 'NOT_READY') { notReady += 1; missing_areas.push(area); }
  }
  const denom = ready + notReady;
  const overall_readiness_score = denom === 0 ? 0 : Math.round((ready / denom) * 100);

  return {
    company_id: raw.id,
    company_name: raw.name,
    plan: raw.billing === 'unknown' ? 'Unknown' : raw.billing.plan,
    user_count: raw.userCount,
    active_user_count_30d: raw.activeUserCount30d,
    created_at: raw.createdAt,
    last_activity_at: raw.lastActivityAt,
    tenant_status: computeTenantStatus({
      hasCompany: true, emailVerified: true,
      companyStatus: raw.companyStatus, lastActivityAt: raw.lastActivityAt, now,
    }),
    company_profile_ready, website_ready, ga_ready, gsc_ready,
    social_ready, community_ready, team_ready, billing_ready,
    overall_readiness_score,
    readiness_bucket: bucketFor(overall_readiness_score),
    missing_areas,
  };
}

export function filterTenants(list: CompanyReadiness[], f: ReadinessFilters): CompanyReadiness[] {
  const q = f.search?.trim().toLowerCase();
  return list.filter((t) => {
    if (f.status && t.tenant_status !== f.status) return false;
    if (f.plan && t.plan !== f.plan) return false;
    if (f.readiness && t.readiness_bucket !== f.readiness) return false;
    if (q && !`${t.company_name} ${t.company_id}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const AREAS: ReadinessArea[] = [
  'COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE',
  'SOCIAL_INTEGRATIONS', 'COMMUNITY', 'TEAM_MEMBERS', 'BILLING',
];
const AREA_FIELD: Record<ReadinessArea, keyof CompanyReadiness> = {
  COMPANY_PROFILE: 'company_profile_ready', WEBSITE: 'website_ready',
  GOOGLE_ANALYTICS: 'ga_ready', GOOGLE_SEARCH_CONSOLE: 'gsc_ready',
  SOCIAL_INTEGRATIONS: 'social_ready', COMMUNITY: 'community_ready',
  TEAM_MEMBERS: 'team_ready', BILLING: 'billing_ready',
};

export function summarize(list: CompanyReadiness[]): ReadinessSummary {
  const by_status = { SIGNUP_STARTED: 0, EMAIL_VERIFIED: 0, COMPANY_CREATED: 0, ACTIVE: 0, DORMANT: 0, INACTIVE: 0 } as Record<TenantStatus, number>;
  const by_bucket = { READY: 0, PARTIAL: 0, AT_RISK: 0 } as Record<ReadinessBucket, number>;
  const readiness_breakdown = Object.fromEntries(
    AREAS.map((a) => [a, { READY: 0, NOT_READY: 0, UNKNOWN: 0 }]),
  ) as Record<ReadinessArea, Record<ReadinessState, number>>;
  let paying = 0;
  for (const t of list) {
    by_status[t.tenant_status] += 1;
    by_bucket[t.readiness_bucket] += 1;
    if (t.billing_ready === 'READY') paying += 1;
    for (const a of AREAS) readiness_breakdown[a][t[AREA_FIELD[a]] as ReadinessState] += 1;
  }
  return { total_tenants: list.length, paying_tenants: paying, by_status, by_bucket, readiness_breakdown };
}

// ── Read-only data layer ─────────────────────────────────────────────────────

const safe = async <T, F = T>(fn: () => Promise<T>, fallback: F): Promise<T | F> => {
  try { return await fn(); } catch { return fallback; }
};

/** Load raw signals for all (non-deleted) companies. Defensive: missing → unknown. */
export async function loadCompanyRawSignals(now: number): Promise<CompanyRawSignals[]> {
  const { data: companiesData } = await supabase
    .from('companies')
    .select('id, name, status, created_at, website_domain')
    .order('created_at', { ascending: false });
  const companies = (companiesData ?? []) as Array<{ id: string; name: string | null; status: string | null; created_at: string | null; website_domain: string | null }>;
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) return [];

  // Members (team + activity + social mapping)
  const roles = await safe(async () => {
    const { data } = await supabase.from('user_company_roles').select('user_id, company_id, status').in('company_id', ids);
    return (data ?? []) as Array<{ user_id: string; company_id: string; status: string }>;
  }, [] as Array<{ user_id: string; company_id: string; status: string }>);
  const membersByCompany = new Map<string, { active: string[]; all: Set<string> }>();
  const userToCompanies = new Map<string, string[]>();
  for (const r of roles) {
    const m = membersByCompany.get(r.company_id) ?? { active: [], all: new Set<string>() };
    m.all.add(r.user_id);
    if (r.status === 'active') { m.active.push(r.user_id); userToCompanies.set(r.user_id, [...(userToCompanies.get(r.user_id) ?? []), r.company_id]); }
    membersByCompany.set(r.company_id, m);
  }

  const allUserIds = Array.from(new Set(roles.map((r) => r.user_id)));
  const lastSignInByUser = await safe(async () => {
    const map = new Map<string, string | null>();
    for (let i = 0; i < allUserIds.length; i += 500) {
      const { data } = await supabase.from('users').select('id, last_sign_in_at').in('id', allUserIds.slice(i, i + 500));
      for (const u of (data ?? []) as Array<{ id: string; last_sign_in_at: string | null }>) map.set(u.id, u.last_sign_in_at);
    }
    return map;
  }, new Map<string, string | null>());

  const profileByCompany = await safe(async () => {
    const map = new Map<string, { name?: string | null; website_url?: string | null; industry?: string | null; overall_confidence?: number | null }>();
    const { data } = await supabase.from('company_profiles').select('company_id, name, website_url, industry, overall_confidence').in('company_id', ids);
    for (const p of (data ?? []) as Array<{ company_id: string; name: string | null; website_url: string | null; industry: string | null; overall_confidence: number | null }>) map.set(p.company_id, p);
    return map;
  }, 'unknown' as const);

  // Phase 12C — WEBSITE: a VERIFIED company domain (not mere presence).
  // verification_status ∈ ('verified','admin_override') is the system's canonical
  // "verified domain" definition (cf. getVerifiedCompanyDomains). Unread → unknown.
  const verifiedDomainByCompany = await safe(async () => {
    const map = new Map<string, boolean>();
    const { data } = await supabase.from('company_domains').select('company_id, verification_status').in('company_id', ids);
    for (const r of (data ?? []) as Array<{ company_id: string; verification_status: string | null }>) {
      if (['verified', 'admin_override'].includes(String(r.verification_status ?? ''))) map.set(r.company_id, true);
    }
    return map;
  }, 'unknown' as const);

  const analyticsByCompany = await safe(async () => {
    const map = new Map<string, { ga: boolean; gsc: boolean }>();
    const { data } = await supabase.from('analytics_integrations').select('company_id, provider, status').in('company_id', ids);
    for (const a of (data ?? []) as Array<{ company_id: string; provider: string; status: string }>) {
      const e = map.get(a.company_id) ?? { ga: false, gsc: false };
      const connected = String(a.status).toLowerCase() === 'connected';
      if (/ga|analytics/i.test(a.provider) && connected) e.ga = true;
      if (/gsc|search/i.test(a.provider) && connected) e.gsc = true;
      map.set(a.company_id, e);
    }
    return map;
  }, 'unknown' as const);

  const socialByCompany = await safe(async () => {
    // Map social_accounts (by member user_id) → distinct active platforms per company.
    const map = new Map<string, Set<string>>();
    if (allUserIds.length === 0) return map;
    const rows: Array<{ user_id: string; platform: string }> = [];
    for (let i = 0; i < allUserIds.length; i += 500) {
      const { data } = await supabase.from('social_accounts')
        .select('user_id, platform, is_active, token_expires_at')
        .in('user_id', allUserIds.slice(i, i + 500)).eq('is_active', true);
      for (const s of (data ?? []) as Array<{ user_id: string; platform: string; token_expires_at: string | null }>) {
        if (s.token_expires_at && Date.parse(s.token_expires_at) < now) continue;
        rows.push({ user_id: s.user_id, platform: s.platform });
      }
    }
    for (const s of rows) {
      for (const cid of userToCompanies.get(s.user_id) ?? []) {
        const set = map.get(cid) ?? new Set<string>();
        set.add(String(s.platform).toLowerCase());
        map.set(cid, set);
      }
    }
    return map;
  }, 'unknown' as const);

  const billingByCompany = await safe(async () => {
    const map = new Map<string, { paying: boolean; plan: string }>();
    const planRows = await safe(async () => {
      const { data } = await supabase.from('organization_plan_assignments').select('organization_id, plan_id').in('organization_id', ids);
      return (data ?? []) as Array<{ organization_id: string; plan_id: string }>;
    }, [] as Array<{ organization_id: string; plan_id: string }>);
    const planNameById = await safe(async () => {
      const nameMap = new Map<string, string>();
      const planIds = Array.from(new Set(planRows.map((p) => p.plan_id))).filter(Boolean);
      if (planIds.length) {
        const { data } = await supabase.from('pricing_plans').select('id, name').in('id', planIds);
        for (const pl of (data ?? []) as Array<{ id: string; name: string }>) nameMap.set(pl.id, pl.name);
      }
      return nameMap;
    }, new Map<string, string>());
    const creditRows = await safe(async () => {
      const { data } = await supabase.from('organization_credits').select('organization_id, lifetime_purchased').in('organization_id', ids);
      return (data ?? []) as Array<{ organization_id: string; lifetime_purchased: number | null }>;
    }, [] as Array<{ organization_id: string; lifetime_purchased: number | null }>);
    const purchasedByOrg = new Map(creditRows.map((c) => [c.organization_id, Number(c.lifetime_purchased ?? 0)]));
    const planByOrg = new Map(planRows.map((p) => [p.organization_id, planNameById.get(p.plan_id) ?? 'Assigned plan']));
    for (const id of ids) {
      const planName = planByOrg.get(id);
      const purchased = purchasedByOrg.get(id) ?? 0;
      const paying = !!planName || purchased > 0;
      map.set(id, { paying, plan: planName ?? (paying ? 'Paid' : 'Free') });
    }
    return map;
  }, 'unknown' as const);

  return companies.map((c) => {
    const members = membersByCompany.get(c.id) ?? { active: [], all: new Set<string>() };
    const activeIds = members.active;
    let lastActivityAt: string | null = null;
    let active30 = 0;
    for (const uid of activeIds) {
      const ls = lastSignInByUser.get(uid) ?? null;
      if (ls) {
        if (!lastActivityAt || Date.parse(ls) > Date.parse(lastActivityAt)) lastActivityAt = ls;
        if (now - Date.parse(ls) <= 30 * DAY_MS) active30 += 1;
      }
    }
    const social = socialByCompany === 'unknown' ? 'unknown' : (socialByCompany.get(c.id)?.size ?? 0);
    const an = analyticsByCompany === 'unknown' ? null : (analyticsByCompany.get(c.id) ?? { ga: false, gsc: false });
    const profileRaw = profileByCompany === 'unknown' ? 'unknown' : (profileByCompany.get(c.id) ?? null);
    const billing = billingByCompany === 'unknown' ? 'unknown' : (billingByCompany.get(c.id) ?? { paying: false, plan: 'Free' });

    return {
      id: c.id,
      name: c.name ?? '(unnamed)',
      companyStatus: c.status,
      createdAt: c.created_at,
      websiteDomain: c.website_domain ? normalizeCompanyDomain(c.website_domain) : null,
      websiteVerified: verifiedDomainByCompany === 'unknown' ? 'unknown' : (verifiedDomainByCompany.get(c.id) ?? false),
      profile: profileRaw === 'unknown' ? 'unknown'
        : profileRaw ? { name: profileRaw.name, websiteUrl: profileRaw.website_url, industry: profileRaw.industry, confidence: profileRaw.overall_confidence } : null,
      userCount: members.all.size,
      activeUserCount: activeIds.length,
      activeUserCount30d: active30,
      lastActivityAt,
      ga: an === null ? 'unknown' : an.ga ? 'connected' : 'not_connected',
      gsc: an === null ? 'unknown' : an.gsc ? 'connected' : 'not_connected',
      socialConnectedCount: social as number | 'unknown',
      billing: billing as { paying: boolean; plan: string } | 'unknown',
    } satisfies CompanyRawSignals;
  });
}

export interface CustomerReadinessResult {
  summary: ReadinessSummary;
  tenants: CompanyReadiness[];
  readiness_breakdown: ReadinessSummary['readiness_breakdown'];
}

/** Orchestrator: load → build → filter → summarize. Read-only. */
export async function getCustomerReadiness(
  filters: ReadinessFilters = {},
  deps: { load?: (now: number) => Promise<CompanyRawSignals[]>; now?: () => number } = {},
): Promise<CustomerReadinessResult> {
  const now = deps.now?.() ?? Date.now();
  const load = deps.load ?? loadCompanyRawSignals;
  const raw = await load(now);
  const all = raw.map((r) => buildCompanyReadiness(r, now));
  const tenants = filterTenants(all, filters);
  // Summary reflects the FILTERED view so the console's numbers match the list.
  const summary = summarize(tenants);
  return { summary, tenants, readiness_breakdown: summary.readiness_breakdown };
}
