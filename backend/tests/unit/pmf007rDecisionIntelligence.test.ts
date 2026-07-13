/**
 * PMF-007R §1–§6/§8 — canonical Decision Objects: model, mapping, lifecycle,
 * explainability, relationships, export, observability, determinism, backward compat.
 */

import {
  buildDecisionObject, decisionId, DECISION_SCHEMA_VERSION, type DecisionObject,
} from '../../services/decisionIntelligence/decisionObjectModel';
import {
  canDecisionTransition, assertDecisionTransition, isDecisionTerminal, replayDecisionLifecycle, DECISION_STATES,
} from '../../services/decisionIntelligence/decisionLifecycle';
import {
  mapNodeToDecision, mapRecommendationsToDecisions, mapGraphToDecisions,
} from '../../services/decisionIntelligence/decisionMapping';
import { explainDecision } from '../../services/decisionIntelligence/decisionExplainability';
import { deriveDecisionRelationships } from '../../services/decisionIntelligence/decisionRelationships';
import { exportDecisions, decisionsToRecommendationText } from '../../services/decisionIntelligence/decisionExport';
import { buildDecisionSnapshot } from '../../services/decisionIntelligence/decisionObservability';
import { RECOMMENDATION_GRAPH } from '../../services/recommendationCapability/recommendationGraph';

const NOW = '2026-07-13T00:00:00.000Z';
const CTX = { companyId: 'org1', knowledgeVersion: 9, runtime: 'platform' as const, createdAt: NOW, defaultConfidence: 80 };

function dec(over: Partial<Parameters<typeof buildDecisionObject>[0]> = {}): DecisionObject {
  return buildDecisionObject({
    companyId: 'org1', node: 'CONTENT_RECOMMENDATIONS', capability: 'RECOMMENDATION_DECISION',
    decisionType: 'CONTENT_RECOMMENDATIONS', title: 'Post more video', summary: 's', recommendedAction: 'do X',
    expectedOutcome: 'more reach', priority: 30, confidence: 82, knowledgeVersion: 9,
    evidence: ['content_performance'], reasonCodes: ['RC_CONTENT'], dependencies: ['BUSINESS_ANALYSIS'], createdAt: NOW,
    ...over,
  });
}

describe('PMF-007R §1 — Decision Object model', () => {
  test('carries every canonical field; deterministic id; schema version', () => {
    const d = dec();
    expect(d.decisionId).toBe(decisionId({ companyId: 'org1', decisionType: 'CONTENT_RECOMMENDATIONS', node: 'CONTENT_RECOMMENDATIONS', title: 'Post more video' }));
    expect(d.schemaVersion).toBe(DECISION_SCHEMA_VERSION);
    for (const k of ['decisionId', 'decisionType', 'priority', 'confidence', 'status', 'title', 'summary', 'recommendedAction', 'expectedOutcome', 'businessImpact', 'effort', 'urgency', 'risk', 'dependencies', 'prerequisites', 'reasonCodes', 'evidence', 'knowledgeVersion', 'decisionSource', 'createdAt', 'metadata']) {
      expect(d).toHaveProperty(k);
    }
    expect(d.status).toBe('CREATED');
    expect(d.businessImpact).toBe('medium'); // priority 30
    expect(dec()).toEqual(d); // deterministic
  });
});

describe('PMF-007R §3 — lifecycle', () => {
  test('legal path, illegal transition, replay, terminal', () => {
    expect(DECISION_STATES.length).toBe(7);
    expect(canDecisionTransition('CREATED', 'VALIDATED')).toBe(true);
    expect(canDecisionTransition('COMPLETED', 'EXECUTING')).toBe(false);
    expect(() => assertDecisionTransition('REJECTED', 'APPROVED')).toThrow(/ILLEGAL_DECISION_TRANSITION/);
    expect(replayDecisionLifecycle('CREATED', ['VALIDATED', 'APPROVED', 'EXECUTING', 'COMPLETED'])).toBe('COMPLETED');
    expect(isDecisionTerminal('SUPERSEDED')).toBe(true);
    expect(isDecisionTerminal('EXECUTING')).toBe(false);
  });
});

describe('PMF-007R §2 — recommendation mapping', () => {
  test('node → one decision; result items → one each; graph → one per node; deterministic', () => {
    const nodeDec = mapNodeToDecision(RECOMMENDATION_GRAPH.CAMPAIGN_RECOMMENDATIONS, CTX);
    expect(nodeDec.decisionType).toBe('CAMPAIGN_RECOMMENDATIONS');

    const fromItems = mapRecommendationsToDecisions({ recommendations: [{ title: 'A', confidence: 90 }, { title: 'B' }] }, CTX);
    expect(fromItems).toHaveLength(2);
    expect(fromItems[0].title).toBe('A');
    expect(fromItems[0].confidence).toBe(90);

    const empty = mapRecommendationsToDecisions({}, CTX);
    expect(empty).toHaveLength(1); // producing node fallback

    expect(mapGraphToDecisions(CTX)).toHaveLength(10);
    expect(mapRecommendationsToDecisions({ recommendations: [{ title: 'A' }] }, CTX)).toEqual(mapRecommendationsToDecisions({ recommendations: [{ title: 'A' }] }, CTX));
  });
});

describe('PMF-007R §4 — explainability', () => {
  test('every decision exposes why / why now / why priority / evidence / deps / confidence factors', () => {
    const e = explainDecision(dec());
    expect(e.why).toContain('Post more video');
    expect(e.whyNow).toMatch(/urgency/i);
    expect(e.whyThisPriority).toContain('priority=30');
    expect(e.whatEvidence).toEqual(['content_performance']);
    expect(e.whatDependencies).toEqual(['BUSINESS_ANALYSIS']);
    expect(e.whatConfidenceFactors.length).toBeGreaterThan(0);
  });
});

describe('PMF-007R §5 — relationships', () => {
  test('depends_on/blocks across the graph; duplicates/conflicts by content', () => {
    const rels = deriveDecisionRelationships(mapGraphToDecisions(CTX));
    expect(rels.some((r) => r.type === 'depends_on')).toBe(true);
    expect(rels.some((r) => r.type === 'blocks')).toBe(true);

    const a = dec({ title: 'Same', recommendedAction: 'do A' });
    const b = dec({ title: 'Same', recommendedAction: 'do A' });
    const c = dec({ title: 'Same', recommendedAction: 'do B' });
    expect(deriveDecisionRelationships([a, b]).some((r) => r.type === 'duplicates')).toBe(true);
    expect(deriveDecisionRelationships([a, c]).some((r) => r.type === 'conflicts_with')).toBe(true);
    // deterministic
    expect(deriveDecisionRelationships([a, b])).toEqual(deriveDecisionRelationships([a, b]));
  });
});

describe('PMF-007R §6/§8 — export + observability + backward compat', () => {
  test('canonical export envelope + relationships + explanations', () => {
    const exp = exportDecisions(mapGraphToDecisions(CTX), { companyId: 'org1', exportedAt: NOW });
    expect(exp.schemaVersion).toBe(DECISION_SCHEMA_VERSION);
    expect(exp.count).toBe(10);
    expect(exp.decisions[0].explanation).toBeDefined();
    expect(exp.relationships.length).toBeGreaterThan(0);
  });
  test('backward-compat: decisions → recommendation text (presentation over decisions)', () => {
    const lines = decisionsToRecommendationText([dec({ title: 'X' })]);
    expect(lines[0]).toContain('X');
    expect(lines[0]).toMatch(/\[(CRITICAL|HIGH|MEDIUM|LOW)\]/);
  });
  test('decision snapshot: count, distributions, ages, relationship graph', () => {
    const snap = buildDecisionSnapshot(mapGraphToDecisions(CTX), Date.parse('2026-07-14T00:00:00.000Z'));
    expect(snap.count).toBe(10);
    expect(Object.values(snap.byImpact).reduce((s, n) => s + n, 0)).toBe(10);
    expect(snap.confidenceDistribution.high + snap.confidenceDistribution.medium + snap.confidenceDistribution.low).toBe(10);
    expect(snap.ageMs.avg).toBeGreaterThan(0);
    expect(snap.relationshipTotal).toBe(snap.relationshipCounts.depends_on + snap.relationshipCounts.blocks + snap.relationshipCounts.duplicates + snap.relationshipCounts.supersedes + snap.relationshipCounts.conflicts_with + snap.relationshipCounts.related_to);
  });
});
