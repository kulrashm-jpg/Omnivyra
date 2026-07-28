/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase D — Journey Contract, Governance & Production Adoption.
 * Independent production falsification (J-D408): freezes the canonical Journey contract and attempts to
 * break adoption, contract conformance (incl. ordering-leak), platform consumption, explainability
 * continuity, operational readiness, and governance — confirming all hold. Programs 1–5 + Phase A–C
 * run in regression.
 */

import {
  assembleJourneyIntelligence, validateJourneyContract, JOURNEY_CANONICAL_CONTRACT,
  JOURNEY_GOVERNANCE_RULES, JOURNEY_MIGRATION_PROHIBITIONS,
  computeJourneyUnderstandingShadow, isJourneyUnderstandingEnabled, isJourneyProjectionAuthoritative,
  explainJourneyAll, type JourneyIntelligenceContext,
} from '../../services/journeyIntelligence';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

function ctx(id: string): JourneyIntelligenceContext {
  return {
    key: { companyId: 'C1', journeyId: id }, asOf: ASOF,
    raw: {
      companyId: 'C1', asOf: ASOF, source: 'web_analytics', journeyId: id, actorRef: 'v-1001', actorType: 'visitor', companyRef: 'C1', status: 'active', pendingStages: ['purchase'],
      touchpoints: [
        { entityType: 'content', entityId: 'landing', observedAt: '2026-06-01T00:00:00.000Z', stage: 'aware' },
        { entityType: 'offering', entityId: 'widget', observedAt: '2026-07-01T00:00:00.000Z', stage: 'evaluate', milestone: 'pricing_viewed' },
        { entityType: 'offering', entityId: 'widget', observedAt: '2026-07-20T00:00:00.000Z', stage: 'decide', milestone: 'demo_requested' },
      ],
    },
  };
}

describe('J-D402 canonical Journey contract (frozen + conformant + ordering-safe)', () => {
  it('the contract is frozen and a produced understanding conforms', () => {
    expect(Object.isFrozen(JOURNEY_CANONICAL_CONTRACT)).toBe(true);
    expect(JOURNEY_CANONICAL_CONTRACT.orderingSource).toBe('evidence_chronology');
    const { understanding: u } = assembleJourneyIntelligence(ctx('j-1'));
    const c = validateJourneyContract(u);
    expect(c.conforms).toBe(true);
    expect(c.issues).toEqual([]);
  });
  it('falsify: non-journey root / unpublished edge / ordering-leak are rejected', () => {
    const { understanding: u } = assembleJourneyIntelligence(ctx('j-1'));
    expect(validateJourneyContract({ ...u, graph: { root: { type: 'visitor' as const, id: 'x' }, edges: u.graph.edges } } as typeof u).conforms).toBe(false);
    const leaked = { ...u, graph: { root: u.graph.root, edges: [...u.graph.edges, { id: 'x', type: 'transitioned_to' as const, from: { type: 'journey' as const, id: 'j-1' }, to: { type: 'stage' as const, id: 's' }, evidence: [], confidence: 0.5, asOf: null }] } };
    expect(validateJourneyContract(leaked as typeof u).conforms).toBe(false);   // ordering must not leak into the graph
  });
});

describe('J-D401/D403 consumer adoption + platform consumption (no parallel model)', () => {
  it('functions through the unmodified platform as a first-class citizen', () => {
    const { understanding: journey } = assembleJourneyIntelligence(ctx('j-1'));
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const s = openIntelligencePlatform([journey, lead], ASOF, { focusKey: 'journey:j-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('journey');
    expect(s.traverse('journey:j-1', 'visitor:v-1001')).toEqual(['journey:j-1', 'visitor:v-1001']);
  });
});

describe('J-D404/D407 migration prohibitions + governance (declared + frozen)', () => {
  it('governance rules + migration prohibitions are declared and frozen', () => {
    expect(Object.isFrozen(JOURNEY_GOVERNANCE_RULES)).toBe(true);
    expect(JOURNEY_GOVERNANCE_RULES.some((r) => /sole canonical owner of progression/.test(r))).toBe(true);
    expect(JOURNEY_GOVERNANCE_RULES.some((r) => /evidence chronology/.test(r))).toBe(true);
    expect(JOURNEY_MIGRATION_PROHIBITIONS).toContain('duplicate journey model');
    expect(JOURNEY_MIGRATION_PROHIBITIONS).toContain('parallel journey graph / ordering model');
  });
});

describe('J-D405 explainability continuity + J-D406 operational readiness', () => {
  it('explainability inherited (evidence/chronology/uncertainty); deterministic; contract stable', () => {
    const { understanding: u } = assembleJourneyIntelligence(ctx('j-1'));
    const ex = explainJourneyAll(u);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => Array.isArray(e.evidence) && e.uncertainty >= 0)).toBe(true);
    expect(validateJourneyContract(assembleJourneyIntelligence(ctx('j-1')).understanding)).toEqual(validateJourneyContract(u));
  });
  it('operational readiness: flags OFF by default, shadow gated, rollback inert', () => {
    delete process.env.JOURNEY_UNDERSTANDING_ENABLED;
    delete process.env.JOURNEY_UNDERSTANDING_AUTHORITATIVE;
    expect(isJourneyUnderstandingEnabled()).toBe(false);
    expect(isJourneyProjectionAuthoritative()).toBe(false);
    expect(computeJourneyUnderstandingShadow(ctx('j-1').raw!)).toBeNull();
  });
});
