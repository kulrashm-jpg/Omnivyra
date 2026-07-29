/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase B — canonical Journey Understanding tests.
 * Deterministic. Proves Journey is the 5th canonical Understanding (builder/projection/persistence/
 * graph/shadow/explainability), OWNS ONLY progression semantics, orders DETERMINISTICALLY from EVIDENCE
 * CHRONOLOGY (not the graph), PUBLISHES references-only edges, and INTEGRATES NATIVELY through the
 * UNMODIFIED Program 1–5 graph + cross-entity + platform APIs. Programs 1–5 run in regression.
 */

import {
  assembleJourneyUnderstanding, buildJourneyUnderstanding, journeyFromRaw, resolveJourneyId,
  projectJourney, computeJourneyUnderstandingShadow, isJourneyUnderstandingEnabled, explainJourneyAll,
  toShadowRecord, toLegacyFields, type JourneyRawInput,
} from '../../services/journeyIntelligence';
import { openIntelligencePlatform, type CanonicalEntityUnderstanding } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

// Touchpoints intentionally OUT of chronological order in the input — the module must order them by observedAt.
const RAW: JourneyRawInput = {
  companyId: 'C1', asOf: ASOF, source: 'web_analytics', journeyId: 'J-1001', actorRef: 'v-1001', actorType: 'visitor', companyRef: 'C1',
  status: 'active',
  touchpoints: [
    { entityType: 'content', entityId: 'whitepaper', label: 'read wp', observedAt: '2026-06-10T00:00:00.000Z', stage: 'aware' },
    { entityType: 'offering', entityId: 'widget', label: 'viewed pricing', observedAt: '2026-07-01T00:00:00.000Z', stage: 'evaluate', milestone: 'pricing_viewed' },
    { entityType: 'content', entityId: 'landing', label: 'first visit', observedAt: '2026-06-01T00:00:00.000Z', stage: 'aware' },
    { entityType: 'offering', entityId: 'widget', label: 'demo request', observedAt: '2026-07-20T00:00:00.000Z', stage: 'decide', milestone: 'demo_requested' },
  ],
  pendingStages: ['purchase'],
};

describe('J-B201/202 canonical Journey Understanding (5th entity; chronological ordering)', () => {
  it('assembles progression facets; orders touchpoints by evidence chronology (not input order)', () => {
    const { understanding: u, projection: p } = assembleJourneyUnderstanding(RAW);
    expect(u.key).toEqual({ companyId: 'C1', journeyId: 'j-1001' });
    const times = u.facets.touchpoints.value!.ordered!.map((t) => t.at);
    expect(times).toEqual([...times].sort());                       // deterministic chronological order
    expect(times[0]).toBe('2026-06-01T00:00:00.000Z');              // earliest first despite input order
    expect(u.facets.touchpoints.value!.count).toBe(4);
    // Phase-B foundation: no enrichment engines yet ⇒ score dimensions abstain
    expect(u.score.overall).toBeNull();
    expect(p.touchpointCount).toBe(4);
  });
  it('J-B203 stages: current/previous/completed/pending derived from chronology', () => {
    const { understanding: u } = assembleJourneyUnderstanding(RAW);
    const s = u.facets.stages.value!;
    expect(s.current).toBe('decide');
    expect(s.previous).toBe('evaluate');
    expect(s.completed).toEqual(['aware', 'evaluate']);
    expect(s.pending).toEqual(['purchase']);
  });
  it('J-B204/B205 milestones + transitions with chronology', () => {
    const { understanding: u } = assembleJourneyUnderstanding(RAW);
    expect(u.facets.milestones.value!.achieved!.map((m) => m.name)).toEqual(['pricing_viewed', 'demo_requested']);
    const tr = u.facets.transitions.value!.transitions!;
    expect(tr.map((t) => `${t.from}->${t.to}`)).toEqual(['aware->evaluate', 'evaluate->decide']);
    expect(tr[0].at < tr[1].at).toBe(true);                          // chronological
  });
  it('J-B206 journey summary state + continuity', () => {
    const { understanding: u } = assembleJourneyUnderstanding(RAW);
    expect(u.facets.state.value!.status).toBe('active');
    expect(u.facets.continuity.value!.spanDays).toBeGreaterThan(0);
  });
});

describe('J-B208 graph publication — references-only (journey owns only its root)', () => {
  it('every edge originates from the journey node; ordering is NOT in the graph', () => {
    const { understanding: u } = assembleJourneyUnderstanding(RAW);
    expect(u.graph.root).toEqual({ type: 'journey', id: 'j-1001' });
    expect(u.graph.edges.every((e) => e.from.type === 'journey')).toBe(true);
    const rels = new Set(u.graph.edges.map((e) => `${e.type}:${e.to.type}`));
    expect(rels.has('journey_of:visitor')).toBe(true);              // actor reference
    expect(rels.has('has_touchpoint:touchpoint')).toBe(true);
    expect(rels.has('reached_stage:stage')).toBe(true);
    expect(rels.has('achieved_milestone:milestone')).toBe(true);
    expect(rels.has('engaged_with:offering')).toBe(true);           // touched entity reference
    expect(u.graph.edges.some((e) => e.to.type === 'journey')).toBe(false); // owns no foreign journey node
    // no transitioned_to edge published — ordering stays in facets, graph carries no order
    expect(u.graph.edges.some((e) => e.type === 'transitioned_to')).toBe(false);
  });
});

describe('J-B209 platform compatibility — consumed by UNMODIFIED Program 1–5 APIs', () => {
  it('a JourneyUnderstanding flows into openIntelligencePlatform natively (first-class citizen)', () => {
    const { understanding: journey } = assembleJourneyUnderstanding(RAW);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const _ok: CanonicalEntityUnderstanding = journey;              // structural conformance
    const s = openIntelligencePlatform([journey, lead], ASOF, { focusKey: 'journey:j-1001', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('journey');
    expect(s.traverse('journey:j-1001', 'visitor:v-1001')).toEqual(['journey:j-1001', 'visitor:v-1001']);
    expect(s.evidence().length).toBeGreaterThan(0);
    void _ok;
  });
});

describe('explainability + persistence + shadow (shared reuse, flag-gated, deterministic)', () => {
  it('explainability reuses shared framework; persistence + shadow shapes build', () => {
    const { understanding: u, projection: p } = assembleJourneyUnderstanding(RAW);
    expect(Array.isArray(explainJourneyAll(u))).toBe(true);
    expect(toLegacyFields(u).current_stage).toBe('decide');
    expect(toShadowRecord(u, p, null).journey_id).toBe('j-1001');
  });
  it('shadow null when OFF (default), bundle when ON; deterministic; ids resolve deterministically', () => {
    delete process.env.JOURNEY_UNDERSTANDING_ENABLED;
    expect(isJourneyUnderstandingEnabled()).toBe(false);
    expect(computeJourneyUnderstandingShadow(RAW)).toBeNull();
    process.env.JOURNEY_UNDERSTANDING_ENABLED = 'true';
    expect(computeJourneyUnderstandingShadow(RAW)?.comparison.parity).toBeGreaterThan(0);
    delete process.env.JOURNEY_UNDERSTANDING_ENABLED;
    expect(resolveJourneyId('J-1001')).toBe('j-1001');
    expect(assembleJourneyUnderstanding(RAW).understanding).toEqual(assembleJourneyUnderstanding(RAW).understanding);
    expect(buildJourneyUnderstanding({ key: { companyId: 'C1', journeyId: 'x' }, builtAt: ASOF }).graph.root.type).toBe('journey');
  });
});
