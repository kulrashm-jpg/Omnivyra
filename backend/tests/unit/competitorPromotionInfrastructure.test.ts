/**
 * COMPETITOR-TAXONOMY-P3-PROMOTION-INFRASTRUCTURE-001 — validation of the promotion framework.
 *
 * Validates: authority flag (legacy vs multisignal), routing (accept/reject mapping without
 * touching scoring/tier/schema), configurable borderline policy, observability metrics,
 * single-step rollback, and backward compatibility (legacy default = no routing invoked).
 *
 * Qualification logic / weights / calibration are NOT exercised for change here — only the
 * framework around them.
 */

import { CALIBRATION_CASES } from '../../services/competitor/qualification/competitorQualificationCalibration';
import { EXTENDED_CALIBRATION_CASES } from '../../services/competitor/qualification/competitorCalibrationDataset';
import { getFinalCompetitorsSync } from '../../services/competitorEngineServiceEngineRankingFinal';
import { normalizeCompetitorDomain, type CompanyCompetitiveContext, type CompetitorCandidate } from '../../services/competitorEngineServiceModel';
import {
  resolveQualificationAuthority,
  resolveBorderlinePolicy,
  multiSignalEngineAuthoritative,
  getPromotionRuntimeState,
  routeQualificationKeep,
  getRouterMetricsSnapshot,
  resetRouterMetrics,
} from '../../services/competitor/qualification/competitorQualificationRouter';

const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES];
const byId = (id: string) => ALL.find((c) => c.id === id)!;

function surfaces(candidate: CompetitorCandidate, context: CompanyCompetitiveContext): boolean {
  const out = getFinalCompetitorsSync({ candidates: [candidate], context, alwaysRank: true });
  const dom = normalizeCompetitorDomain(candidate.domain ?? candidate.name);
  return out.some((c) => normalizeCompetitorDomain(c.domain ?? c.name) === dom || c.name.toLowerCase() === candidate.name.toLowerCase());
}

const ENGINE = 'COMPETITOR_QUALIFICATION_ENGINE';
const POLICY = 'COMPETITOR_MULTISIGNAL_BORDERLINE_POLICY';

describe('authority flag + configuration', () => {
  const origEngine = process.env[ENGINE];
  const origPolicy = process.env[POLICY];
  afterEach(() => {
    if (origEngine === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = origEngine;
    if (origPolicy === undefined) delete process.env[POLICY]; else process.env[POLICY] = origPolicy;
  });

  it('defaults to the legacy taxonomy engine when unset', () => {
    delete process.env[ENGINE];
    expect(resolveQualificationAuthority()).toBe('live_taxonomy');
    expect(multiSignalEngineAuthoritative()).toBe(false);
    expect(getPromotionRuntimeState().rollbackState).toBe('legacy_active');
  });

  it('exactly one engine is authoritative; only "multisignal" flips it', () => {
    process.env[ENGINE] = 'multisignal';
    expect(resolveQualificationAuthority()).toBe('multisignal');
    expect(getPromotionRuntimeState().rollbackState).toBe('multisignal_active');
    for (const bad of ['', 'legacy', 'taxonomy', 'live_taxonomy', 'MULTI', 'true', '1']) {
      process.env[ENGINE] = bad;
      expect(resolveQualificationAuthority()).toBe(bad === 'multisignal' ? 'multisignal' : 'live_taxonomy');
    }
  });

  it('borderline policy is configurable and defaults to observe', () => {
    delete process.env[POLICY];
    expect(resolveBorderlinePolicy()).toBe('observe');
    process.env[POLICY] = 'accept';
    expect(resolveBorderlinePolicy()).toBe('accept');
    process.env[POLICY] = 'reject';
    expect(resolveBorderlinePolicy()).toBe('reject');
    process.env[POLICY] = 'garbage';
    expect(resolveBorderlinePolicy()).toBe('observe');
  });
});

describe('legacy authority (default) — backward compatibility', () => {
  const orig = process.env[ENGINE];
  beforeEach(() => { delete process.env[ENGINE]; resetRouterMetrics(); });
  afterEach(() => { if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig; });

  it('preserves current live behavior: surfaces a live Tier-3 cross-category candidate; drops an unseen competitor', () => {
    expect(surfaces(byId('x-cyber-crm-neg').candidate, byId('x-cyber-crm-neg').context)).toBe(true);
    expect(surfaces(byId('logistics-true').candidate, byId('logistics-true').context)).toBe(false);
  });

  it('does NOT invoke the router (no routed decisions recorded) — proving the legacy path is untouched', () => {
    resetRouterMetrics();
    for (const c of ALL.slice(0, 8)) surfaces(c.candidate, c.context);
    expect(getRouterMetricsSnapshot().decisions).toBe(0);
  });
});

describe('multisignal authority — routing changes accept/reject only', () => {
  const orig = process.env[ENGINE];
  beforeEach(() => { process.env[ENGINE] = 'multisignal'; delete process.env[POLICY]; resetRouterMetrics(); });
  afterEach(() => {
    if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig;
    delete process.env[POLICY];
  });

  it('rejects a clearly cross-category non-competitor the live engine surfaces as Tier 3 (precision gain)', () => {
    // Live surfaces Headspace (meditation) as a Tier-3 "competitor" for a legaltech company via
    // the unknown-defer gate; the multisignal engine scores it unqualified and drops it.
    const c = byId('x-legaltech-wellness-neg');
    expect(surfaces(c.candidate, c.context)).toBe(false);
  });

  it('surfaces the unseen-industry competitor the live engine dropped (recall gain), preserving tier + score', () => {
    const c = byId('logistics-true');
    const out = getFinalCompetitorsSync({ candidates: [c.candidate], context: c.context, alwaysRank: true });
    const hit = out.find((r) => r.name.toLowerCase() === c.candidate.name.toLowerCase());
    expect(hit).toBeDefined();
    // Scoring + tier come from the live engine and are preserved (schema unchanged).
    expect(hit!.tier).toMatch(/^Tier [123]$/);
    expect(typeof hit!.relevance_score).toBe('number');
    expect(hit!.score_card).toBeDefined();
  });
});

describe('borderline policy — pipeline behavior', () => {
  const orig = process.env[ENGINE];
  const origPol = process.env[POLICY];
  // Headspace-for-CRM… actually HubSpot (CRM) for a cybersecurity company scores borderline once
  // enriched (weak B2B-automation adjacency). Its fate is governed entirely by the policy.
  const c = byId('x-cyber-crm-neg');
  beforeEach(() => { process.env[ENGINE] = 'multisignal'; resetRouterMetrics(); });
  afterEach(() => {
    if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig;
    if (origPol === undefined) delete process.env[POLICY]; else process.env[POLICY] = origPol;
  });

  it('OBSERVE (default) defers the borderline candidate to legacy — stays surfaced', () => {
    delete process.env[POLICY];
    expect(surfaces(c.candidate, c.context)).toBe(true);
    expect(getRouterMetricsSnapshot().borderlineObserve).toBeGreaterThanOrEqual(1);
  });

  it('REJECT drops the borderline candidate', () => {
    process.env[POLICY] = 'reject';
    expect(surfaces(c.candidate, c.context)).toBe(false);
    expect(getRouterMetricsSnapshot().borderlineReject).toBeGreaterThanOrEqual(1);
  });

  it('ACCEPT keeps the borderline candidate', () => {
    process.env[POLICY] = 'accept';
    expect(surfaces(c.candidate, c.context)).toBe(true);
    expect(getRouterMetricsSnapshot().borderlineAccept).toBeGreaterThanOrEqual(1);
  });
});

describe('configurable borderline policy (routing map)', () => {
  // Marketing company + an adjacent AI-content assistant scores in the [40,55) borderline band.
  const context: CompanyCompetitiveContext = {
    marketFocus: 'AI marketing and content platform',
    primaryService: 'AI content generation, SEO copywriting and social media scheduling for brands',
    targetCustomer: 'B2B marketing teams and founders',
    idealCustomerProfile: 'SMB marketing teams doing content marketing and SEO',
    brandPositioning: 'AI marketing intelligence and content automation',
    geography: null, teamSize: null, foundedYear: null, revenueRange: null,
    businessModel: 'B2B SaaS', entityArchetype: null,
  };
  const borderline: CompetitorCandidate = {
    name: 'BorderlineCo', source: 'serp_live', confidenceScore: 0.6,
    category: 'ai_platform', description: 'AI content and marketing assistant for teams',
  };

  beforeEach(() => resetRouterMetrics());

  it('ACCEPT keeps a borderline candidate', () => {
    const r = routeQualificationKeep({ candidate: borderline, context, legacyKeep: false, borderlinePolicy: 'accept' });
    expect(r.decision).toBe('borderline');
    expect(r.keep).toBe(true);
    expect(r.borderlineHandling).toBe('accept');
  });

  it('REJECT drops a borderline candidate', () => {
    const r = routeQualificationKeep({ candidate: borderline, context, legacyKeep: true, borderlinePolicy: 'reject' });
    expect(r.decision).toBe('borderline');
    expect(r.keep).toBe(false);
    expect(r.borderlineHandling).toBe('reject');
  });

  it('OBSERVE defers a borderline candidate to the legacy decision', () => {
    const kept = routeQualificationKeep({ candidate: borderline, context, legacyKeep: true, borderlinePolicy: 'observe' });
    const dropped = routeQualificationKeep({ candidate: borderline, context, legacyKeep: false, borderlinePolicy: 'observe' });
    expect(kept.keep).toBe(true);
    expect(dropped.keep).toBe(false);
    expect(kept.borderlineHandling).toBe('observe_defer_legacy');
  });
});

describe('observability metrics', () => {
  const orig = process.env[ENGINE];
  beforeEach(() => { process.env[ENGINE] = 'multisignal'; resetRouterMetrics(); });
  afterEach(() => { if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig; });

  it('records agreement/disagreement, promoted, rejected and unseen-qualified counters', () => {
    delete process.env[POLICY]; // default observe
    for (const c of ALL) surfaces(c.candidate, c.context);
    const m = getRouterMetricsSnapshot();
    expect(m.engine).toBe('multisignal');
    expect(m.decisions).toBeGreaterThanOrEqual(40);
    expect(m.decisions).toBe(m.agreements + m.disagreements); // invariant
    expect(m.disagreements).toBe(m.promoted + m.rejected); // invariant
    expect(m.promoted).toBeGreaterThanOrEqual(3); // unseen recoveries
    expect(m.rejected).toBeGreaterThanOrEqual(8); // cross-category removals
    expect(m.unseenQualified).toBeGreaterThanOrEqual(10);
    expect(m.agreements).toBeGreaterThan(m.disagreements);
  });
});

describe('single-step rollback', () => {
  const orig = process.env[ENGINE];
  afterEach(() => { if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig; });

  it('one config change flips authority and immediately restores legacy behavior', () => {
    const c = byId('x-legaltech-wellness-neg'); // clearly unqualified; not policy-dependent
    process.env[ENGINE] = 'multisignal';
    expect(surfaces(c.candidate, c.context)).toBe(false); // promoted engine rejects it
    // Single-step rollback:
    process.env[ENGINE] = 'live_taxonomy';
    expect(multiSignalEngineAuthoritative()).toBe(false);
    expect(surfaces(c.candidate, c.context)).toBe(true); // legacy behavior restored immediately
    // Unsetting is equally valid rollback.
    delete process.env[ENGINE];
    expect(resolveQualificationAuthority()).toBe('live_taxonomy');
    expect(surfaces(c.candidate, c.context)).toBe(true);
  });
});
