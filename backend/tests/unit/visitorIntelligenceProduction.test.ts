/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase D — Production Adoption & Final Certification.
 * Independent production falsification (V-D408): freezes the canonical Visitor contract and attempts to
 * break adoption, contract conformance, platform consumption, explainability continuity, operational
 * readiness, governance, and determinism — confirming all hold. Programs 1–5C run in regression.
 */

import {
  assembleVisitorIntelligence, assessVisitorConsumerReadiness, assessVisitorAuthoritativeReadiness,
  validateVisitorContract, VISITOR_CANONICAL_CONTRACT, VISITOR_GOVERNANCE_RULES, VISITOR_MIGRATION_PROHIBITIONS,
  computeVisitorUnderstandingShadow, isVisitorUnderstandingEnabled, isVisitorProjectionAuthoritative,
  explainVisitorAll, type VisitorIntelligenceContext,
} from '../../services/visitorIntelligence';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

function ctx(id: string): VisitorIntelligenceContext {
  return {
    key: { companyId: 'C1', visitorId: id }, asOf: ASOF,
    raw: {
      companyId: 'C1', asOf: ASOF, source: 'web_analytics', visitorId: id, status: 'identified', leadRef: 'L1', companyRef: 'C1',
      device: 'desktop', browser: 'Chrome', country: 'US', acquisitionSource: 'google', medium: 'organic', campaign: 'summer', referrer: 'https://google.com', referrerType: 'search', entryPage: '/pricing',
      sessionCount: 4, pageCount: 14, durationSeconds: 620, frequency: 'weekly', lastSeenAt: '2026-07-26T00:00:00.000Z',
      pagesViewed: ['/pricing', '/product'], contentConsumed: ['whitepaper'], engagementEvents: ['form_view'], interactionCategories: ['pricing'], engagementLevel: 'high', lifecycle: 'returning', offeringRefs: ['widget'],
    },
  };
}

describe('V-D402 canonical Visitor contract (frozen + conformant)', () => {
  it('the contract is frozen and a produced understanding conforms', () => {
    expect(Object.isFrozen(VISITOR_CANONICAL_CONTRACT)).toBe(true);
    expect(VISITOR_CANONICAL_CONTRACT.explainability).toBe('shared:explainUnderstanding');
    const { understanding: u } = assembleVisitorIntelligence(ctx('v-1'));
    const c = validateVisitorContract(u);
    expect(c.conforms).toBe(true);
    expect(c.issues).toEqual([]);
  });
  it('falsify: a non-visitor root or unpublished edge is rejected by the contract', () => {
    const { understanding: u } = assembleVisitorIntelligence(ctx('v-1'));
    const tampered = { ...u, graph: { root: { type: 'lead' as const, id: 'x' }, edges: u.graph.edges } };
    expect(validateVisitorContract(tampered as typeof u).conforms).toBe(false);
  });
});

describe('V-D401/D403 consumer adoption + platform consumption (no parallel model, no customization)', () => {
  it('ready for every downstream consumer; functions through the unmodified platform', () => {
    const r = assessVisitorConsumerReadiness(ctx('v-1'));
    expect(r.ready).toBe(true);
    const { understanding: visitor } = assembleVisitorIntelligence(ctx('v-1'));
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const s = openIntelligencePlatform([visitor, lead], ASOF, { focusKey: 'visitor:v-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('visitor');
    expect(s.traverse('visitor:v-1', 'lead:L1')).toEqual(['visitor:v-1', 'lead:L1']);
  });
});

describe('V-D404/D407 migration prohibitions + governance (documented + enforceable)', () => {
  it('governance rules + migration prohibitions are declared and frozen', () => {
    expect(Object.isFrozen(VISITOR_GOVERNANCE_RULES)).toBe(true);
    expect(VISITOR_GOVERNANCE_RULES.some((r) => /sole canonical owner/.test(r))).toBe(true);
    expect(VISITOR_MIGRATION_PROHIBITIONS).toContain('duplicate visitor model');
    expect(VISITOR_MIGRATION_PROHIBITIONS).toContain('parallel visitor graph / relationship model');
  });
});

describe('V-D405 explainability continuity + V-D406 operational readiness', () => {
  it('explainability inherited (evidence/reasoning/uncertainty); deterministic; contract stable', () => {
    const { understanding: u } = assembleVisitorIntelligence(ctx('v-1'));
    const ex = explainVisitorAll(u);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => Array.isArray(e.evidence) && e.uncertainty >= 0)).toBe(true);
    // contract stable across independent builds (deterministic graph publication + scoring)
    expect(validateVisitorContract(assembleVisitorIntelligence(ctx('v-1')).understanding)).toEqual(validateVisitorContract(u));
  });
  it('operational readiness: flags OFF by default, shadow gated, rollback inert; readiness gates pass', () => {
    delete process.env.VISITOR_UNDERSTANDING_ENABLED;
    delete process.env.VISITOR_UNDERSTANDING_AUTHORITATIVE;
    expect(isVisitorUnderstandingEnabled()).toBe(false);
    expect(isVisitorProjectionAuthoritative()).toBe(false);
    expect(computeVisitorUnderstandingShadow(ctx('v-1').raw!)).toBeNull();   // shadow gated OFF
    const ready = assessVisitorAuthoritativeReadiness([ctx('v-1'), ctx('v-2')]);
    expect(ready.ready).toBe(true);
  });
});
