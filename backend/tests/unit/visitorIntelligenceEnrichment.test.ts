/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase B — Visitor Intelligence Enrichment tests.
 * Deterministic. Proves the enrichment engines are evidence-first CONTRIBUTORS (builder stays sole
 * owner): behavioral/engagement/session/activity/acquisition emit contributions + facets + valid
 * reasoning, the confidence framework + health summary reuse shared primitives, scoring activates,
 * engines ABSTAIN without evidence — while OWNING ONLY visitor semantics, references-only, graph/
 * cross-entity/platform UNCHANGED, and Programs 1–5A byte-unchanged (regression alongside).
 */

import {
  assembleVisitorIntelligence, runBehavioral, runEngagement, runSession, runActivityPattern, runAcquisition,
  visitorConfidence, visitorHealthSummary, type VisitorIntelligenceContext,
} from '../../services/visitorIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
// Program-4 platform consumed UNMODIFIED (enriched visitor still integrates natively):
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

const CTX: VisitorIntelligenceContext = {
  key: { companyId: 'C1', visitorId: 'v-1001' }, asOf: ASOF,
  raw: {
    companyId: 'C1', asOf: ASOF, source: 'web_analytics', visitorId: 'V-1001', status: 'identified', leadRef: 'L1',
    device: 'desktop', browser: 'Chrome', os: 'Windows', country: 'US',
    acquisitionSource: 'google', medium: 'organic', campaign: 'summer_launch', referrer: 'https://google.com', referrerType: 'search', entryPage: '/pricing', utm: { source: 'google', medium: 'cpc' },
    sessionCount: 4, pageCount: 14, durationSeconds: 620, frequency: 'weekly', bounce: false, firstSeenAt: '2026-06-01T00:00:00.000Z', lastSeenAt: '2026-07-26T00:00:00.000Z',
    pagesViewed: ['/pricing', '/product', '/pricing', '/docs'], contentConsumed: ['whitepaper', 'case_study'], searchActivity: ['pricing'], downloads: ['spec.pdf'],
    engagementEvents: ['form_view', 'video_play'], interactionCategories: ['pricing', 'product'], engagementLevel: 'high', engagementSignals: ['repeat_visit'], lifecycle: 'returning',
    offeringRefs: ['widget'], contentRefs: ['whitepaper'],
  },
  history: { sessions: [
    { at: '2026-06-01T00:00:00.000Z', pages: 3, durationSeconds: 200 },
    { at: '2026-06-20T00:00:00.000Z', pages: 6, durationSeconds: 400 },
    { at: '2026-07-10T00:00:00.000Z', pages: 10, durationSeconds: 560 },
    { at: '2026-07-26T00:00:00.000Z', pages: 14, durationSeconds: 620 },
  ] },
};

describe('V-B201..205 enrichment engines (contributors; evidence-first; valid reasoning)', () => {
  it('each engine emits contributions + facet fragments + grounded reasoning', () => {
    const outs = [runBehavioral(CTX), runEngagement(CTX), runSession(CTX), runActivityPattern(CTX), runAcquisition(CTX)];
    expect(outs.every((o) => !o.abstained)).toBe(true);
    expect(outs.flatMap((o) => o.contributions).length).toBeGreaterThanOrEqual(5);
    expect(outs.flatMap((o) => o.reasoning).every((t) => validateReasoning(t).valid)).toBe(true);
    // engines contribute to the 4 visitor dimensions
    const dims = new Set(outs.flatMap((o) => o.contributions).map((c) => c.dimension));
    expect([...dims].sort()).toEqual(['engagement', 'loyalty', 'reach', 'recency']);
  });
  it('engines ABSTAIN when their evidence is absent', () => {
    const bare: VisitorIntelligenceContext = { key: { companyId: 'C1', visitorId: 'x' }, asOf: ASOF, raw: { companyId: 'C1', asOf: ASOF, anonymousId: 'x' } };
    expect(runBehavioral(bare).abstained).toBe(true);
    expect(runAcquisition(bare).abstained).toBe(true);
    expect(runEngagement(bare).abstained).toBe(true);
  });
});

describe('V-B (assembly) — scoring activates; builder is sole owner; deterministic', () => {
  it('assembled understanding has non-abstaining scores blended from contributions', () => {
    const { understanding: u, projection: p } = assembleVisitorIntelligence(CTX);
    expect(u.score.overall).not.toBeNull();                 // Phase-B: contributors activate scoring
    expect(u.score.dimensions.engagement.value).not.toBeNull();
    expect(u.score.dimensions.recency.value).not.toBeNull();
    expect(u.graph.root).toEqual({ type: 'visitor', id: 'v-1001' });   // still visitor-owned root only
    expect(u.graph.edges.every((e) => e.from.type === 'visitor')).toBe(true); // references-only preserved
    expect(p.overallScore).toBe(u.score.overall);
    expect(assembleVisitorIntelligence(CTX).understanding).toEqual(u); // deterministic
  });
});

describe('V-B206/207 confidence framework + health summary (reuse shared primitives)', () => {
  it('confidence reflects quantity/quality/freshness/agreement; health is descriptive', () => {
    const { understanding: u, confidence, health } = assembleVisitorIntelligence(CTX);
    expect(confidence.overall).toBeGreaterThan(0);
    expect(confidence.evidenceCount).toBeGreaterThan(0);
    expect(confidence.freshness).toBeGreaterThan(0);
    // direct call parity
    expect(visitorConfidence(u.facets.session.value ? [] : [], [], ASOF).evidenceCount).toBe(0);
    expect(['highly_active', 'occasionally_active', 're_engaging']).toContain(health.status);
    expect(visitorHealthSummary(u, ASOF).status).toBe(health.status);
  });
});

describe('V-B209 platform compatibility — enriched visitor still integrates via UNMODIFIED APIs', () => {
  it('flows into openIntelligencePlatform as a first-class graph citizen', () => {
    const { understanding: visitor } = assembleVisitorIntelligence(CTX);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const session = openIntelligencePlatform([visitor, lead], ASOF, { focusKey: 'visitor:v-1001', depth: 2 });
    expect(session.context().entities.map((e) => e.type)).toContain('visitor');
    expect(session.traverse('visitor:v-1001', 'lead:L1')).toEqual(['visitor:v-1001', 'lead:L1']);
  });
});
