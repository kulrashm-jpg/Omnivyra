/**
 * Phase 14C — Profile Completion Intelligence tests (pure, deterministic).
 */

import {
  classifyProfile,
  profileGaps,
  analyzeProfileCompletion,
  isReady,
  type ProfileCompany,
} from '../../services/profileCompletionIntelligenceService';

const NOW = Date.parse('2026-06-23T00:00:00Z');
const co = (over: Partial<ProfileCompany> = {}): ProfileCompany => ({
  company_id: 'c1', company_name: 'Acme', created_at: '2026-05-01T00:00:00Z', is_active: false,
  profile_exists: true, has_name: true, has_website: true, has_industry: true, confidence: 75,
  domain_verified: true, identity_verified: true, ...over,
});

describe('isReady + profileGaps', () => {
  it('ready requires all fields AND confidence ≥ 60', () => {
    expect(isReady(co())).toBe(true);
    expect(isReady(co({ confidence: 40 }))).toBe(false);
    expect(isReady(co({ has_website: false }))).toBe(false);
  });
  it('gaps ordered: row → fields → confidence → domain → identity', () => {
    expect(profileGaps(co({ profile_exists: false, has_name: false }))).toContain('NO_PROFILE_ROW');
    expect(profileGaps(co({ has_website: false }))).toEqual(['MISSING_WEBSITE']);
    expect(profileGaps(co({ confidence: 0 }))).toEqual(['LOW_CONFIDENCE']);
  });
});

describe('classifyProfile', () => {
  it('PROFILE_READY when complete + confident', () => {
    expect(classifyProfile(co(), NOW).status).toBe('PROFILE_READY');
  });
  it('NO_PROFILE_ROW → BLOCKED (recent) / ABANDONED (stale)', () => {
    expect(classifyProfile(co({ profile_exists: false, created_at: '2026-06-22T00:00:00Z' }), NOW).status).toBe('PROFILE_BLOCKED');
    expect(classifyProfile(co({ profile_exists: false, created_at: '2026-05-01T00:00:00Z' }), NOW).status).toBe('PROFILE_ABANDONED');
    expect(classifyProfile(co({ profile_exists: false }), NOW).reason).toBe('NO_PROFILE_ROW');
  });
  it('single core gap → that reason', () => {
    expect(classifyProfile(co({ has_website: false, confidence: 75 }), NOW).reason).toBe('MISSING_WEBSITE');
  });
  it('low confidence only → LOW_CONFIDENCE', () => {
    expect(classifyProfile(co({ confidence: 0 }), NOW).reason).toBe('LOW_CONFIDENCE');
  });
  it('≥ 2 core gaps → MULTIPLE_PROFILE_GAPS', () => {
    expect(classifyProfile(co({ has_name: false, has_website: false }), NOW).reason).toBe('MULTIPLE_PROFILE_GAPS');
  });
  it('domain/identity gaps do not override core reason', () => {
    expect(classifyProfile(co({ has_website: false, domain_verified: false, identity_verified: false }), NOW).reason).toBe('MISSING_WEBSITE');
  });
});

describe('analyzeProfileCompletion — funnel + gaps + associations', () => {
  const companies = [
    co({ company_id: 'a', is_active: true }),                                              // ready + active
    co({ company_id: 'b', confidence: 0 }),                                                // complete fields, low conf
    co({ company_id: 'c', has_website: false, confidence: 0, domain_verified: false }),    // missing website + low conf
    co({ company_id: 'd', profile_exists: false, has_name: false, has_website: false, has_industry: false, confidence: 0, domain_verified: false, identity_verified: false }), // no profile
  ];
  const r = analyzeProfileCompletion(companies, NOW);

  it('funnel independent reach', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.COMPANY_CREATED).toBe(4);
    expect(by.PROFILE_STARTED).toBe(3);   // a,b,c
    expect(by.PROFILE_COMPLETE).toBe(2);  // a,b (c missing website)
    expect(by.PROFILE_CONFIDENT).toBe(1); // a only
    expect(by.PROFILE_READY).toBe(1);     // a only
    expect(r.completion_rate).toBe(25);
  });
  it('gap analysis counts + percentages', () => {
    const by = Object.fromEntries(r.gap_analysis.map((g) => [g.failure, g.count]));
    expect(by.NO_PROFILE_ROW).toBe(1);    // d
    expect(by.MISSING_WEBSITE).toBe(1);   // c
    expect(by.LOW_CONFIDENCE).toBe(3);    // b,c,d
    expect(r.gap_analysis.find((g) => g.failure === 'LOW_CONFIDENCE')!.pct).toBe(75);
  });
  it('top blockers ranked by count', () => {
    expect(r.top_blockers[0].failure).toBe('LOW_CONFIDENCE'); // 3 is the max
  });
  it('associations report population/positive/rate (not causal)', () => {
    const rc = r.associations.find((a) => a.pair === 'PROFILE_READY ↔ ACTIVATED')!;
    expect(rc.population).toBe(1); // only a is ready
    expect(rc.positive).toBe(1);  // and active
    expect(rc.rate).toBe(100);
    expect(rc.confidence).toBe('LOW'); // tiny population
  });
  it('status distribution', () => {
    expect(r.by_status.PROFILE_READY).toBe(1);
    expect(r.by_status.PROFILE_ABANDONED).toBeGreaterThanOrEqual(1);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeProfileCompletion(companies, NOW))).toBe(JSON.stringify(r));
  });
});
