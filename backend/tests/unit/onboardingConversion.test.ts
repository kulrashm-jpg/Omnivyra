/**
 * Phase 14A — Onboarding Conversion tests (pure, deterministic).
 */

import {
  classifyProspect,
  classifyCompanyOnboarding,
  blockReasonFor,
  buildFunnel,
  buildOnboardingConversion,
  type ProspectIntent,
  type BlockSignal,
  type CompanyOnboarding,
} from '../../services/onboardingConversionService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const intent = (over: Partial<ProspectIntent> = {}): ProspectIntent => ({
  id: 'i1', email: 'a@acme.com', domain: 'acme.com', status: 'pending',
  created_at: '2026-06-20T00:00:00Z', completed_at: null, expires_at: null, last_touch_at: '2026-06-20T00:00:00Z', ...over,
});
const company = (over: Partial<CompanyOnboarding> = {}): CompanyOnboarding => ({
  company_id: 'c1', company_name: 'Acme', created_at: '2026-05-01T00:00:00Z',
  profile_completed: true, profile_at: '2026-05-03T00:00:00Z', domain_verified: true, domain_verified_at: '2026-05-04T00:00:00Z', ...over,
});

describe('blockReasonFor', () => {
  it('maps eligibility reasons deterministically', () => {
    expect(blockReasonFor('public_email')).toBe('PUBLIC_EMAIL');
    expect(blockReasonFor('no_mx')).toBe('DOMAIN_BLOCKED');
    expect(blockReasonFor('not_canonical')).toBe('DOMAIN_MISMATCH');
    expect(blockReasonFor('no_website')).toBe('NO_WEBSITE_FOUND');
    expect(blockReasonFor('valid_company')).toBeNull();
  });
});

describe('classifyProspect', () => {
  it('COMPLETED when status completed', () => {
    expect(classifyProspect(intent({ status: 'completed' }), new Map(), NOW).label).toBe('COMPLETED');
  });
  it('BLOCKED with reason + evidence when domain matches a block signal', () => {
    const blocks = new Map<string, BlockSignal>([['acme.com', { reason: 'CLAIMED_DOMAIN', source: 'signup_referrals', at: null }]]);
    const c = classifyProspect(intent(), blocks, NOW);
    expect(c.label).toBe('BLOCKED');
    expect(c.reason).toBe('CLAIMED_DOMAIN');
    expect(c.confidence).toBe('HIGH');
  });
  it('ABANDONED when expired (reason UNKNOWN — stage not captured)', () => {
    const c = classifyProspect(intent({ expires_at: '2026-06-01T00:00:00Z' }), new Map(), NOW);
    expect(c.label).toBe('ABANDONED');
    expect(c.reason).toBe('UNKNOWN');
  });
  it('ABANDONED when stale (no touch > 14d)', () => {
    expect(classifyProspect(intent({ last_touch_at: '2026-06-01T00:00:00Z' }), new Map(), NOW).label).toBe('ABANDONED');
  });
  it('PENDING when within window', () => {
    expect(classifyProspect(intent(), new Map(), NOW).label).toBe('PENDING');
  });
});

describe('classifyCompanyOnboarding', () => {
  const active = new Set<string>(['c1']);
  it('COMPLETED when active', () => {
    expect(classifyCompanyOnboarding(company(), active, NOW).label).toBe('COMPLETED');
  });
  it('PROFILE_ABANDONED when no completed profile', () => {
    const c = classifyCompanyOnboarding(company({ profile_completed: false }), new Set(), NOW);
    expect(c.reason).toBe('PROFILE_ABANDONED');
    expect(c.label).toBe('ABANDONED'); // created 2026-05-01, > 14d stale
  });
  it('DOMAIN_UNVERIFIED when profile done but domain not verified', () => {
    expect(classifyCompanyOnboarding(company({ domain_verified: false }), new Set(), NOW).reason).toBe('DOMAIN_UNVERIFIED');
  });
  it('ACTIVATION_ABANDONED when profile + domain done but inactive', () => {
    expect(classifyCompanyOnboarding(company(), new Set(), NOW).reason).toBe('ACTIVATION_ABANDONED');
  });
  it('PENDING (not ABANDONED) when recently created', () => {
    expect(classifyCompanyOnboarding(company({ created_at: '2026-06-22T00:00:00Z', profile_completed: false }), new Set(), NOW).label).toBe('PENDING');
  });
});

describe('buildFunnel', () => {
  it('marks VISITOR / EMAIL_VERIFIED / IDENTITY_VALIDATED unobservable (null)', () => {
    const f = buildFunnel({ signup_started: 24, company_created: 38, profile_completed: 3, domain_verified: 3, activated: 4 });
    const by = Object.fromEntries(f.map((s) => [s.stage, s]));
    expect(by.VISITOR.count).toBeNull();
    expect(by.EMAIL_VERIFIED.measurable).toBe(false);
    expect(by.COMPANY_CREATED.count).toBe(38);
    expect(by.ACTIVATED.count).toBe(4);
  });
});

describe('buildOnboardingConversion — portfolio', () => {
  const prospects = [intent({ id: 'p1', status: 'completed', completed_at: '2026-06-21T00:00:00Z', created_at: '2026-06-20T00:00:00Z' }), intent({ id: 'p2', email: 'x@claimed.com', domain: 'claimed.com' }), intent({ id: 'p3', expires_at: '2026-06-01T00:00:00Z' })];
  const blocks = new Map<string, BlockSignal>([['claimed.com', { reason: 'CLAIMED_DOMAIN', source: 'signup_referrals', at: null }]]);
  const companies = [company({ company_id: 'c1' }), company({ company_id: 'c2', profile_completed: false }), company({ company_id: 'c3', domain_verified: false })];
  const r = buildOnboardingConversion({ prospects, blocks, companies, activeIds: new Set(['c1']), nowMs: NOW });

  it('funnel + completion math', () => {
    expect(r.portfolio.total_started).toBe(3);
    expect(r.portfolio.total_completed).toBe(1);
    expect(r.portfolio.completion_rate).toBe(33.3);
    expect(r.portfolio.company_completion_rate).toBe(33.3); // 1 active / 3
  });
  it('prospect classification distribution', () => {
    expect(r.prospects.by_status.COMPLETED).toBe(1);
    expect(r.prospects.by_status.BLOCKED).toBe(1);
    expect(r.prospects.by_status.ABANDONED).toBe(1);
  });
  it('dropoff by reason includes evidence-backed blockers + UNKNOWN bucket', () => {
    const by = Object.fromEntries(r.portfolio.dropoff_by_reason.map((x) => [x.reason, x.count]));
    expect(by.CLAIMED_DOMAIN).toBe(1);
    expect(by.PROFILE_ABANDONED).toBe(1);
    expect(by.DOMAIN_UNVERIFIED).toBe(1);
    expect(by.UNKNOWN).toBeGreaterThanOrEqual(1); // p3 abandoned, reason unknown
  });
  it('cross-population dropoff marked NOT COMPUTABLE', () => {
    const x = r.portfolio.dropoff_by_stage.find((d) => d.from === 'SIGNUP_STARTED');
    expect(x!.lost).toBeNull();
    expect(x!.note).toMatch(/NOT COMPUTABLE/);
  });
  it('median signup→completed measurable (1 day)', () => {
    expect(r.portfolio.median_time_between_stages.signup_to_completed_days).toBe(1);
  });
  it('visibility gaps enumerated', () => {
    expect(r.portfolio.unknown_visibility_gaps.length).toBeGreaterThanOrEqual(4);
  });
  it('deterministic', () => {
    expect(JSON.stringify(buildOnboardingConversion({ prospects, blocks, companies, activeIds: new Set(['c1']), nowMs: NOW }))).toBe(JSON.stringify(r));
  });
});
