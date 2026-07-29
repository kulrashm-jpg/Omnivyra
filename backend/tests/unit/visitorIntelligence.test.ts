/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase A — canonical Visitor Understanding tests.
 * Deterministic. Proves Visitor is the 4th canonical Understanding (builder/projection/persistence/
 * graph/shadow/explainability), OWNS ONLY visitor semantics, PUBLISHES references-only edges, and
 * INTEGRATES NATIVELY through the UNMODIFIED Program-4 graph + cross-entity + platform APIs — reusing
 * shared EvidenceRef/ReasoningTrace/explainability/graph primitives, no new infrastructure. Programs
 * 1–4 run in regression.
 */

import {
  assembleVisitorUnderstanding, buildVisitorUnderstanding, visitorFromRaw, resolveVisitorId,
  projectVisitor, computeVisitorUnderstandingShadow, isVisitorUnderstandingEnabled, explainVisitorAll,
  toShadowRecord, toLegacyFields, type VisitorRawInput,
} from '../../services/visitorIntelligence';
// Program-4 platform APIs — consumed UNMODIFIED to prove native integration:
import { openIntelligencePlatform, type CanonicalEntityUnderstanding } from '../../services/intelligencePlatform';
// REAL sibling entities (regression + cross-entity):
import { assembleCompanyUnderstanding } from '../../services/companyIntelligence/engines';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

const RAW: VisitorRawInput = {
  companyId: 'C1', asOf: ASOF, source: 'web_analytics', visitorId: 'V-1001', status: 'identified',
  leadRef: 'L1', companyRef: 'C1', device: 'desktop', browser: 'Chrome', os: 'Windows', language: 'en-US', timezone: 'UTC',
  country: 'US', region: 'CA', city: 'SF', referrer: 'https://google.com', referrerDomain: 'google.com', referrerType: 'search',
  acquisitionSource: 'google', medium: 'organic', campaign: 'summer_launch', entryPage: '/pricing', utm: { source: 'google', medium: 'cpc' },
  sessionCount: 3, pageCount: 12, durationSeconds: 540, frequency: 'weekly', bounce: false, firstSeenAt: '2026-06-01T00:00:00.000Z', lastSeenAt: ASOF,
  pagesViewed: ['/pricing', '/product'], contentConsumed: ['whitepaper'], downloads: ['spec.pdf'], engagementEvents: ['form_view'], interactionCategories: ['pricing'],
  engagementLevel: 'high', engagementSignals: ['repeat_visit'], lifecycle: 'returning',
  offeringRefs: ['widget'], contentRefs: ['whitepaper'],
};

describe('V-A101 canonical Visitor Understanding (4th entity, shared spine)', () => {
  it('assembles facets/score/graph/projection; abstains on unevidenced score (foundation)', () => {
    const { understanding: u, projection: p } = assembleVisitorUnderstanding(RAW);
    expect(u.key).toEqual({ companyId: 'C1', visitorId: 'v-1001' });
    expect(u.facets.identity.value?.status).toBe('identified');
    expect(u.facets.device.value?.browser).toBe('Chrome');
    expect(u.facets.acquisition.value?.campaign).toBe('summer_launch');
    expect(u.facets.session.value?.pageCount).toBe(12);
    // Phase-A foundation: no enrichment engines yet ⇒ score dimensions abstain (null), never fabricated
    expect(u.score.overall).toBeNull();
    expect(p.status).toBe('identified');
    expect(p.lifecycle).toBe('returning');
  });
  it('abstains cleanly for an anonymous visitor with minimal evidence', () => {
    const { understanding: u } = assembleVisitorUnderstanding({ companyId: 'C1', asOf: ASOF, anonymousId: 'anon-xyz' });
    expect(u.key.visitorId).toBe('anon-xyz');
    expect(u.facets.identity.value?.status).toBe('anonymous');
    expect(u.facets.device.value).toBeNull();     // no device evidence ⇒ abstain
    expect(u.graph.edges.length).toBe(0);         // no references without evidence
  });
});

describe('V-A109 graph publication — references-only (visitor owns only its root)', () => {
  it('every edge originates from the visitor node; targets are references to other entities', () => {
    const { understanding: u } = assembleVisitorUnderstanding(RAW);
    expect(u.graph.root).toEqual({ type: 'visitor', id: 'v-1001' });
    expect(u.graph.edges.every((e) => e.from.type === 'visitor')).toBe(true);
    const targets = u.graph.edges.map((e) => `${e.type}:${e.to.type}`).sort();
    expect(targets).toContain('identified_as:lead');    // visitor → lead (identity ref, not ownership)
    expect(targets).toContain('belongs_to:company');
    expect(targets).toContain('acquired_via:campaign');
    expect(targets).toContain('engaged_with:offering');
    // no edge terminates at another visitor-owned node — visitor owns no graph beyond its root
    expect(u.graph.edges.some((e) => e.to.type === 'visitor')).toBe(false);
  });
});

describe('V-A110 platform compatibility — consumed by UNMODIFIED Program-4 APIs', () => {
  function siblings(): CanonicalEntityUnderstanding[] {
    const company = assembleCompanyUnderstanding({ key: { companyId: 'C1' }, asOf: ASOF, profile: { companyId: 'C1', asOf: ASOF, name: 'Acme' }, competitors: [], executives: [{ name: 'Jane', role: 'CEO', source: 'news', observedAt: ASOF }] }).understanding;
    const offering = assembleOfferingUnderstanding({ key: { companyId: 'C1', offeringId: 'widget' }, asOf: ASOF, seed: { companyId: 'C1', asOf: ASOF, name: 'Widget', offeringType: 'product' } }).understanding;
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    return [company, offering, lead];
  }
  it('a VisitorUnderstanding flows into openIntelligencePlatform natively (structural CanonicalEntityUnderstanding)', () => {
    const { understanding: visitor } = assembleVisitorUnderstanding(RAW);
    const session = openIntelligencePlatform([visitor, ...siblings()], ASOF, { focusKey: 'visitor:v-1001', depth: 2 });
    const ctx = session.context();
    expect(ctx.focus.key).toBe('visitor:v-1001');
    expect(ctx.entities.map((e) => e.type)).toContain('visitor');       // visitor is a first-class graph citizen
    expect(ctx.entities.map((e) => e.type).sort()).toEqual(['company', 'lead', 'offering', 'visitor']);
    // graph publication makes the visitor→lead reference traversable through the unmodified platform
    expect(session.traverse('visitor:v-1001', 'lead:L1')).toEqual(['visitor:v-1001', 'lead:L1']);
    expect(session.evidence().length).toBeGreaterThan(0);
  });
});

describe('V-A108 explainability + persistence + shadow (shared reuse, flag-gated)', () => {
  it('explainability reuses the shared framework; persistence + shadow shapes build', () => {
    const { understanding: u, projection: p } = assembleVisitorUnderstanding(RAW);
    expect(Array.isArray(explainVisitorAll(u))).toBe(true);
    expect(toLegacyFields(u).status).toBe('identified');
    expect(toShadowRecord(u, p, null).visitor_id).toBe('v-1001');
  });
  it('shadow runtime null when OFF (default), bundle when ON; deterministic; ids resolve deterministically', () => {
    delete process.env.VISITOR_UNDERSTANDING_ENABLED;
    expect(isVisitorUnderstandingEnabled()).toBe(false);
    expect(computeVisitorUnderstandingShadow(RAW)).toBeNull();
    process.env.VISITOR_UNDERSTANDING_ENABLED = 'true';
    const bundle = computeVisitorUnderstandingShadow(RAW);
    expect(bundle?.comparison.parity).toBeGreaterThan(0);
    delete process.env.VISITOR_UNDERSTANDING_ENABLED;
    expect(resolveVisitorId({ visitorId: 'V-1001' })).toBe('v-1001');
    expect(assembleVisitorUnderstanding(RAW).understanding).toEqual(assembleVisitorUnderstanding(RAW).understanding); // deterministic
    // builder is the sole producer — direct build parity
    expect(buildVisitorUnderstanding({ key: { companyId: 'C1', visitorId: 'x' }, builtAt: ASOF }).graph.root.type).toBe('visitor');
  });
});
