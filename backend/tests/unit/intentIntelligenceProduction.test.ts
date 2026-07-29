/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase D — Intent Contract, Governance & Production Adoption.
 * Independent production falsification (I-D408): freezes the canonical Intent contract and attempts to
 * break adoption, contract conformance (incl. reasoning-edge leak), platform consumption, explainability
 * continuity, operational readiness, competing-intent preservation, and governance — confirming all
 * hold. Programs 1–6 + Phase A–C run in regression.
 */

import {
  assembleIntentIntelligence, validateIntentContract, INTENT_CANONICAL_CONTRACT,
  INTENT_GOVERNANCE_RULES, INTENT_MIGRATION_PROHIBITIONS,
  computeIntentUnderstandingShadow, isIntentUnderstandingEnabled, isIntentProjectionAuthoritative,
  explainIntentAll, type IntentIntelligenceContext,
} from '../../services/intentIntelligence';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

function ctx(id: string): IntentIntelligenceContext {
  return {
    key: { companyId: 'C1', intentId: id }, asOf: ASOF,
    raw: {
      companyId: 'C1', asOf: ASOF, source: 'web_analytics', intentId: id, actorRef: 'v-1001', actorType: 'visitor', objectRef: 'widget', objectType: 'offering',
      signals: [
        { objective: 'evaluation', observedAt: '2026-07-20T00:00:00.000Z', weight: 0.9 },
        { objective: 'evaluation', observedAt: '2026-07-24T00:00:00.000Z', weight: 0.8 },
        { objective: 'comparison', observedAt: '2026-07-23T00:00:00.000Z', weight: 0.85 },
      ],
    },
    upstream: { visitorRef: 'v-1001', offeringRef: 'widget' },
  };
}

describe('I-D402 canonical Intent contract (frozen + conformant + reasoning-edge-safe)', () => {
  it('the contract is frozen and a produced understanding conforms', () => {
    expect(Object.isFrozen(INTENT_CANONICAL_CONTRACT)).toBe(true);
    expect(INTENT_CANONICAL_CONTRACT.interpretationSource).toBe('observed_evidence');
    const { understanding: u } = assembleIntentIntelligence(ctx('int-1'));
    const c = validateIntentContract(u);
    expect(c.conforms).toBe(true);
    expect(c.issues).toEqual([]);
  });
  it('falsify: non-intent root / unpublished (reasoning) edge is rejected', () => {
    const { understanding: u } = assembleIntentIntelligence(ctx('int-1'));
    expect(validateIntentContract({ ...u, graph: { root: { type: 'visitor' as const, id: 'x' }, edges: u.graph.edges } } as typeof u).conforms).toBe(false);
    const leaked = { ...u, graph: { root: u.graph.root, edges: [...u.graph.edges, { id: 'x', type: 'influences' as const, from: { type: 'intent' as const, id: 'int-1' }, to: { type: 'lead' as const, id: 'L' }, evidence: [], confidence: 0.5, asOf: null }] } };
    expect(validateIntentContract(leaked as typeof u).conforms).toBe(false);   // interpretation must not leak into the graph
  });
});

describe('I-D401/D403 consumer adoption + platform consumption + competing preservation', () => {
  it('functions through the unmodified platform; competing intents preserved', () => {
    const { understanding: intent, projection } = assembleIntentIntelligence(ctx('int-1'));
    expect(projection.competingObjectives).toContain('comparison');           // competing preserved into Phase D
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const s = openIntelligencePlatform([intent, lead], ASOF, { focusKey: 'intent:int-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('intent');
    expect(s.traverse('intent:int-1', 'visitor:v-1001')).toEqual(['intent:int-1', 'visitor:v-1001']);
  });
});

describe('I-D404/D407 migration prohibitions + governance (declared + frozen)', () => {
  it('governance rules + migration prohibitions are declared and frozen', () => {
    expect(Object.isFrozen(INTENT_GOVERNANCE_RULES)).toBe(true);
    expect(INTENT_GOVERNANCE_RULES.some((r) => /sole canonical owner of interpretation/.test(r))).toBe(true);
    expect(INTENT_GOVERNANCE_RULES.some((r) => /descriptive over observed evidence — never a prediction/.test(r))).toBe(true);
    expect(INTENT_MIGRATION_PROHIBITIONS).toContain('duplicate inference framework');
    expect(INTENT_MIGRATION_PROHIBITIONS).toContain('parallel intent graph / reasoning-edge model');
  });
});

describe('I-D405 explainability continuity + I-D406 operational readiness', () => {
  it('explainability inherited (evidence/uncertainty); deterministic; contract stable', () => {
    const { understanding: u } = assembleIntentIntelligence(ctx('int-1'));
    const ex = explainIntentAll(u);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => Array.isArray(e.evidence) && e.uncertainty >= 0)).toBe(true);
    expect(validateIntentContract(assembleIntentIntelligence(ctx('int-1')).understanding)).toEqual(validateIntentContract(u));
  });
  it('operational readiness: flags OFF by default, shadow gated, rollback inert', () => {
    delete process.env.INTENT_UNDERSTANDING_ENABLED;
    delete process.env.INTENT_UNDERSTANDING_AUTHORITATIVE;
    expect(isIntentUnderstandingEnabled()).toBe(false);
    expect(isIntentProjectionAuthoritative()).toBe(false);
    expect(computeIntentUnderstandingShadow(ctx('int-1').raw!)).toBeNull();
  });
});
