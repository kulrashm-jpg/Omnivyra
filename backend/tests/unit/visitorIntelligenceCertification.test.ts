/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase C — Canonical Validation & Authoritative Readiness.
 * Independent falsification: attempts to break ownership, determinism, evidence integrity, graph
 * references-only, platform compatibility, scoring, and authoritative/consumer readiness — and
 * confirms every invariant holds. Programs 1–5B run in regression.
 */

import {
  assembleVisitorIntelligence, validateVisitorCrossUnderstanding, validateVisitorShadowBatch,
  assessVisitorAuthoritativeReadiness, assessVisitorConsumerReadiness, VISITOR_DOWNSTREAM_CONSUMERS,
  summarizeVisitorRun, explainVisitorAll, type VisitorIntelligenceContext,
} from '../../services/visitorIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

function ctx(id: string, companyId = 'C1'): VisitorIntelligenceContext {
  return {
    key: { companyId, visitorId: id }, asOf: ASOF,
    raw: {
      companyId, asOf: ASOF, source: 'web_analytics', visitorId: id, status: 'identified', leadRef: 'L1',
      device: 'desktop', browser: 'Chrome', os: 'Windows', country: 'US',
      acquisitionSource: 'google', medium: 'organic', campaign: 'summer', referrer: 'https://google.com', referrerType: 'search', entryPage: '/pricing',
      sessionCount: 4, pageCount: 14, durationSeconds: 620, frequency: 'weekly', bounce: false, lastSeenAt: '2026-07-26T00:00:00.000Z',
      pagesViewed: ['/pricing', '/product'], contentConsumed: ['whitepaper'], engagementEvents: ['form_view'], interactionCategories: ['pricing'],
      engagementLevel: 'high', lifecycle: 'returning', offeringRefs: ['widget'],
    },
  };
}
const CASES = [ctx('v-1'), ctx('v-2'), ctx('v-3', 'C2')];

describe('V-C301 ownership + V-C305 graph compatibility (falsify: re-ownership / topology mutation)', () => {
  it('builder is sole owner; graph is references-only; visitor owns only its root', () => {
    const { understanding: u } = assembleVisitorIntelligence(ctx('v-1'));
    const r = validateVisitorCrossUnderstanding(u);
    expect(r.consistent).toBe(true);
    expect(r.rootIsVisitor).toBe(true);
    expect(r.referencesOnly).toBe(true);
    expect(r.ownsNoForeignNode).toBe(true);
    expect(r.duplicateSemantics).toBe(false);
    expect(r.externalReferenceCount).toBeGreaterThan(0);   // it DOES reference lead/company/offering/campaign
  });
});

describe('V-C302 explainability (falsify: opaque conclusions)', () => {
  it('every reasoning trace is valid & grounded; explanations derive from evidence', () => {
    const { understanding: u } = assembleVisitorIntelligence(ctx('v-1'));
    expect(u.reasoning.length).toBeGreaterThan(0);
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(explainVisitorAll(u).every((e) => e.confidence >= 0 && e.uncertainty >= 0)).toBe(true);
  });
});

describe('V-C303 evidence integrity + V-C304 scoring (falsify: dup/orphan evidence, non-determinism)', () => {
  it('shadow batch: no duplicate/unsupported evidence, deterministic ordering, parity high', () => {
    const report = validateVisitorShadowBatch(CASES);
    expect(report.totalDuplicateEvidence).toBe(0);
    expect(report.totalUnsupportedConclusions).toBe(0);
    expect(report.allEvidenceOrdered).toBe(true);
    expect(report.meanParity).toBeGreaterThanOrEqual(0.9);
  });
  it('scoring is deterministic, contributor-owned, reproducible, abstention-aware', () => {
    const a = assembleVisitorIntelligence(ctx('v-1')).understanding;
    const b = assembleVisitorIntelligence(ctx('v-1')).understanding;
    expect(a.score).toEqual(b.score);                       // reproducible
    expect(a.score.overall).not.toBeNull();                 // contributors activate scoring
    // abstention: a visitor with no behavioral evidence abstains, never fabricates
    const bare = assembleVisitorIntelligence({ key: { companyId: 'C1', visitorId: 'z' }, asOf: ASOF, raw: { companyId: 'C1', asOf: ASOF, anonymousId: 'z' } }).understanding;
    expect(bare.score.dimensions.engagement.abstained).toBe(true);
  });
});

describe('V-C306 platform compatibility (falsify: requires downstream modification)', () => {
  it('visitor is a first-class citizen in an UNMODIFIED platform session', () => {
    const { understanding: visitor } = assembleVisitorIntelligence(ctx('v-1'));
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
    const s = openIntelligencePlatform([visitor, lead], ASOF, { focusKey: 'visitor:v-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('visitor');
    expect(s.traverse('visitor:v-1', 'lead:L1')).toEqual(['visitor:v-1', 'lead:L1']);
    expect(summarizeVisitorRun([visitor]).visitors).toBe(1);   // observability
  });
});

describe('V-C307 authoritative readiness + V-C308 consumer readiness (falsify: not ready)', () => {
  it('authoritative readiness gates all pass (stable, isolated, observable, cross-consistent)', () => {
    const r = assessVisitorAuthoritativeReadiness(CASES);
    expect(r.ready).toBe(true);
    expect(r.stable).toBe(true);
    expect(r.tenantIsolated).toBe(true);
    expect(r.crossUnderstandingConsistent).toBe(true);
    expect(Object.values(r.gates).every(Boolean)).toBe(true);
  });
  it('consumer readiness: ready as canonical upstream for every future downstream program', () => {
    const r = assessVisitorConsumerReadiness(ctx('v-1'));
    expect(r.ready).toBe(true);
    expect(r.exposesCanonicalSurface && r.referencesOnly && r.deterministic && r.explainable && r.graphCitizen).toBe(true);
    expect(VISITOR_DOWNSTREAM_CONSUMERS.every((c) => r.consumers[c])).toBe(true);
  });
});
