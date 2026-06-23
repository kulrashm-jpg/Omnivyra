/**
 * Phase 12A — Customer Readiness Console aggregation tests (pure, hermetic).
 */

import {
  computeTenantStatus,
  buildCompanyReadiness,
  bucketFor,
  filterTenants,
  summarize,
  getCustomerReadiness,
  type CompanyRawSignals,
  type CompanyReadiness,
} from '../../services/customerReadinessService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const raw = (over: Partial<CompanyRawSignals> = {}): CompanyRawSignals => ({
  id: 'co_1', name: 'Acme', companyStatus: 'active', createdAt: daysAgo(100),
  websiteDomain: 'acme.com', websiteVerified: true,
  profile: { name: 'Acme', websiteUrl: 'https://www.acme.com', industry: 'Tech', confidence: 80 },
  userCount: 3, activeUserCount: 2, activeUserCount30d: 2, lastActivityAt: daysAgo(5),
  ga: 'connected', gsc: 'connected', socialConnectedCount: 2,
  billing: { paying: true, plan: 'Pro' },
  ...over,
});

describe('computeTenantStatus', () => {
  const base = { hasCompany: true, emailVerified: true, companyStatus: 'active', lastActivityAt: null as string | null, now: NOW };
  it('SIGNUP_STARTED / EMAIL_VERIFIED (pre-company)', () => {
    expect(computeTenantStatus({ ...base, hasCompany: false, emailVerified: false })).toBe('SIGNUP_STARTED');
    expect(computeTenantStatus({ ...base, hasCompany: false, emailVerified: true })).toBe('EMAIL_VERIFIED');
  });
  it('COMPANY_CREATED when no activity', () => {
    expect(computeTenantStatus({ ...base, lastActivityAt: null })).toBe('COMPANY_CREATED');
  });
  it('ACTIVE / DORMANT / INACTIVE by activity age', () => {
    expect(computeTenantStatus({ ...base, lastActivityAt: daysAgo(10) })).toBe('ACTIVE');
    expect(computeTenantStatus({ ...base, lastActivityAt: daysAgo(60) })).toBe('DORMANT');
    expect(computeTenantStatus({ ...base, lastActivityAt: daysAgo(200) })).toBe('INACTIVE');
  });
  it('INACTIVE when company disabled', () => {
    expect(computeTenantStatus({ ...base, companyStatus: 'inactive', lastActivityAt: daysAgo(1) })).toBe('INACTIVE');
  });
});

describe('buildCompanyReadiness — readiness areas', () => {
  it('fully ready company → high score, no missing areas (except UNKNOWN community)', () => {
    const r = buildCompanyReadiness(raw(), NOW);
    expect(r.website_ready).toBe('READY');
    expect(r.company_profile_ready).toBe('READY');
    expect(r.ga_ready).toBe('READY');
    expect(r.gsc_ready).toBe('READY');
    expect(r.social_ready).toBe('READY');
    expect(r.team_ready).toBe('READY');     // 2 active members
    expect(r.billing_ready).toBe('READY');
    expect(r.community_ready).toBe('UNKNOWN'); // no source — always unknown
    expect(r.missing_areas).toEqual([]);
    expect(r.overall_readiness_score).toBe(100); // 7 ready / 7 known (community excluded)
  });

  it('NOT_READY areas appear in missing_areas and lower the score', () => {
    const r = buildCompanyReadiness(raw({ websiteVerified: false, billing: { paying: false, plan: 'Free' }, socialConnectedCount: 0 }), NOW);
    expect(r.website_ready).toBe('NOT_READY');
    expect(r.billing_ready).toBe('NOT_READY');
    expect(r.social_ready).toBe('NOT_READY');
    expect(r.missing_areas).toEqual(expect.arrayContaining(['WEBSITE', 'BILLING', 'SOCIAL_INTEGRATIONS']));
    expect(r.overall_readiness_score).toBeLessThan(100);
  });

  it('UNKNOWN areas are excluded from the score denominator', () => {
    // ga/gsc/social/billing unknown → only profile, website, team count.
    const r = buildCompanyReadiness(raw({ ga: 'unknown', gsc: 'unknown', socialConnectedCount: 'unknown', billing: 'unknown' }), NOW);
    expect(r.ga_ready).toBe('UNKNOWN');
    expect(r.billing_ready).toBe('UNKNOWN');
    // profile READY + website READY + team READY = 3/3 known → 100
    expect(r.overall_readiness_score).toBe(100);
    expect(r.plan).toBe('Unknown');
  });

  it('team needs ≥2 active members', () => {
    expect(buildCompanyReadiness(raw({ activeUserCount: 1 }), NOW).team_ready).toBe('NOT_READY');
    expect(buildCompanyReadiness(raw({ activeUserCount: 2 }), NOW).team_ready).toBe('READY');
  });

  it('profile missing a core field → NOT_READY; missing row → UNKNOWN', () => {
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: '', industry: 'Tech' } }), NOW).company_profile_ready).toBe('NOT_READY');
    expect(buildCompanyReadiness(raw({ profile: 'unknown' }), NOW).company_profile_ready).toBe('UNKNOWN');
  });
});

describe('Phase 12C — WEBSITE readiness (verified domain)', () => {
  it('verified domain → READY', () => {
    expect(buildCompanyReadiness(raw({ websiteVerified: true }), NOW).website_ready).toBe('READY');
  });
  it('unverified domain → NOT_READY (even if website_domain present)', () => {
    expect(buildCompanyReadiness(raw({ websiteVerified: false, websiteDomain: 'acme.com' }), NOW).website_ready).toBe('NOT_READY');
  });
  it('unread company_domains source → UNKNOWN', () => {
    expect(buildCompanyReadiness(raw({ websiteVerified: 'unknown' }), NOW).website_ready).toBe('UNKNOWN');
  });
});

describe('Phase 12C — COMPANY_PROFILE readiness (completeness + confidence gate)', () => {
  it('core fields + confidence ≥ 60 → READY', () => {
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: 'https://acme.com', industry: 'Tech', confidence: 60 } }), NOW).company_profile_ready).toBe('READY');
  });
  it('confidence below threshold → NOT_READY', () => {
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: 'https://acme.com', industry: 'Tech', confidence: 59 } }), NOW).company_profile_ready).toBe('NOT_READY');
  });
  it('confidence null/absent → NOT_READY (row exists but never scored)', () => {
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: 'https://acme.com', industry: 'Tech', confidence: null } }), NOW).company_profile_ready).toBe('NOT_READY');
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: 'https://acme.com', industry: 'Tech' } }), NOW).company_profile_ready).toBe('NOT_READY');
  });
  it('missing a core field → NOT_READY even with high confidence', () => {
    expect(buildCompanyReadiness(raw({ profile: { name: 'Acme', websiteUrl: '', industry: 'Tech', confidence: 90 } }), NOW).company_profile_ready).toBe('NOT_READY');
  });
  it('unread profile source → UNKNOWN', () => {
    expect(buildCompanyReadiness(raw({ profile: 'unknown' }), NOW).company_profile_ready).toBe('UNKNOWN');
  });
});

describe('Phase 12C — no regression to the other six areas', () => {
  it('changing website/profile signals does NOT alter ga/gsc/social/team/billing/community', () => {
    const a = buildCompanyReadiness(raw({ websiteVerified: true, profile: { name: 'A', websiteUrl: 'https://a.com', industry: 'X', confidence: 90 } }), NOW);
    const b = buildCompanyReadiness(raw({ websiteVerified: false, profile: 'unknown' }), NOW);
    for (const f of ['ga_ready', 'gsc_ready', 'social_ready', 'team_ready', 'billing_ready', 'community_ready'] as const) {
      expect(a[f]).toBe(b[f]); // unchanged by website/profile upgrades
    }
    expect(a.community_ready).toBe('UNKNOWN');
  });
});

describe('bucketFor', () => {
  it('maps score → bucket', () => {
    expect(bucketFor(90)).toBe('READY');
    expect(bucketFor(60)).toBe('PARTIAL');
    expect(bucketFor(20)).toBe('AT_RISK');
  });
});

describe('filterTenants + summarize', () => {
  const list: CompanyReadiness[] = [
    buildCompanyReadiness(raw({ id: 'a', name: 'Acme', billing: { paying: true, plan: 'Pro' } }), NOW),
    buildCompanyReadiness(raw({ id: 'b', name: 'Beta', billing: { paying: false, plan: 'Free' }, websiteVerified: false, ga: 'not_connected', gsc: 'not_connected', socialConnectedCount: 0, activeUserCount: 1, lastActivityAt: daysAgo(200) }), NOW),
  ];

  it('filters by status, plan, readiness, search', () => {
    expect(filterTenants(list, { status: 'ACTIVE' }).map((t) => t.company_id)).toEqual(['a']);
    expect(filterTenants(list, { plan: 'Free' }).map((t) => t.company_id)).toEqual(['b']);
    expect(filterTenants(list, { readiness: 'READY' }).map((t) => t.company_id)).toEqual(['a']);
    expect(filterTenants(list, { search: 'bet' }).map((t) => t.company_id)).toEqual(['b']);
  });

  it('summary counts statuses, buckets, paying, and area breakdown', () => {
    const s = summarize(list);
    expect(s.total_tenants).toBe(2);
    expect(s.paying_tenants).toBe(1);
    expect(s.by_status.ACTIVE).toBe(1);
    expect(s.by_status.INACTIVE).toBe(1);
    expect(s.readiness_breakdown.COMMUNITY.UNKNOWN).toBe(2); // both unknown
    expect(s.readiness_breakdown.WEBSITE.READY).toBe(1);
    expect(s.readiness_breakdown.WEBSITE.NOT_READY).toBe(1);
  });
});

describe('getCustomerReadiness — API contract (injected load)', () => {
  it('returns { summary, tenants, readiness_breakdown } and applies filters', async () => {
    const load = async (now: number): Promise<CompanyRawSignals[]> => [
      raw({ id: 'a', name: 'Acme' }),
      raw({ id: 'b', name: 'Beta', billing: { paying: false, plan: 'Free' }, websiteDomain: null }),
    ];
    const all = await getCustomerReadiness({}, { load, now: () => NOW });
    expect(all.tenants).toHaveLength(2);
    expect(all.summary.total_tenants).toBe(2);
    expect(all.readiness_breakdown).toBeDefined();

    const filtered = await getCustomerReadiness({ plan: 'Free' }, { load, now: () => NOW });
    expect(filtered.tenants.map((t) => t.company_id)).toEqual(['b']);
    expect(filtered.summary.total_tenants).toBe(1); // summary reflects the filtered view
  });
});
