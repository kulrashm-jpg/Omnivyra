/**
 * PMF-007 §2/§6/§7/§11 — Recommendation Graph, execution graph, AIA agent, reversible
 * flag, and explainability (confidence/evidence/knowledge version/decision source/
 * dependencies/reason codes/priority explanation).
 */

import {
  RECOMMENDATION_NODE_IDS, RECOMMENDATION_GRAPH, resolveRecommendationNode,
  recommendationExecutionOrder, recommendationProducingNode,
} from '../../services/recommendationCapability/recommendationGraph';
import { getRecommendationRuntimeMode, shouldRunPlatform } from '../../services/recommendationCapability/recommendationMigrationFlag';
import { buildRecommendationExplanation, withExplanation } from '../../services/recommendationCapability/recommendationExplainability';
import { resolveAgent } from '../../services/aiAgent/agentRegistry';

describe('PMF-007 §2 — recommendation graph', () => {
  test('all ten recommendations registered as nodes', () => {
    expect(RECOMMENDATION_NODE_IDS.sort()).toEqual([
      'BUSINESS_ANALYSIS', 'CAMPAIGN_RECOMMENDATIONS', 'CHANNEL_RECOMMENDATIONS', 'CONTENT_RECOMMENDATIONS',
      'FINAL_RECOMMENDATIONS', 'GROWTH_RECOMMENDATIONS', 'KNOWLEDGE_ANALYSIS', 'PRIORITY_SCORING',
      'RISK_ANALYSIS', 'SEO_RECOMMENDATIONS',
    ]);
    expect(resolveRecommendationNode('CAMPAIGN_RECOMMENDATIONS')!.producesRecommendations).toBe(true);
    expect(resolveRecommendationNode('FINAL_RECOMMENDATIONS')!.requiresApproval).toBe(true);
    expect(recommendationProducingNode()).toBe('CAMPAIGN_RECOMMENDATIONS');
    // every node carries knowledge, evidence, reason code, priority (§2/§7)
    for (const id of RECOMMENDATION_NODE_IDS) {
      const n = RECOMMENDATION_GRAPH[id];
      expect(n.knowledge.consumer).toBe('RECOMMENDATION_ENGINE');
      expect(n.evidence.length).toBeGreaterThan(0);
      expect(typeof n.reasonCode).toBe('string');
      expect(typeof n.priority).toBe('number');
      expect(n.aicCapability).toBe('RECOMMENDATION_DECISION');
    }
  });
});

describe('PMF-007 §2/§6 — deterministic execution graph', () => {
  test('topological order respects dependencies and is deterministic', () => {
    const order = recommendationExecutionOrder();
    expect(order.length).toBe(10);
    const pos = (id: string) => order.indexOf(id as any);
    for (const id of RECOMMENDATION_NODE_IDS) {
      for (const dep of RECOMMENDATION_GRAPH[id].dependsOn) expect(pos(dep)).toBeLessThan(pos(id));
    }
    expect(order[0]).toBe('KNOWLEDGE_ANALYSIS');           // no deps
    expect(order[order.length - 1]).toBe('FINAL_RECOMMENDATIONS'); // terminal
    expect(recommendationExecutionOrder()).toEqual(order);  // deterministic
  });
});

describe('PMF-007 §6 — Recommendation AIA agent', () => {
  test('registered, derived from the graph, gates final on approval', () => {
    const agent = resolveAgent('RECOMMENDATION_AGENT');
    expect(agent).not.toBeNull();
    expect(agent!.steps.map((s) => s.id).sort()).toEqual(RECOMMENDATION_NODE_IDS.slice().sort());
    expect(agent!.steps.every((s) => s.capability === 'RECOMMENDATION_DECISION')).toBe(true);
    expect(agent!.steps.find((s) => s.id === 'CAMPAIGN_RECOMMENDATIONS')!.dependsOn.sort()).toEqual(['CHANNEL_RECOMMENDATIONS', 'CONTENT_RECOMMENDATIONS']);
    expect(agent!.steps.find((s) => s.id === 'FINAL_RECOMMENDATIONS')!.requiresApproval).toBe(true);
    expect(agent!.approvalRequired).toBe(true);
  });
});

describe('PMF-007 §7 — explainability', () => {
  test('buildRecommendationExplanation carries every required field', () => {
    const e = buildRecommendationExplanation({ nodeId: 'CAMPAIGN_RECOMMENDATIONS', confidence: 87, knowledgeVersion: 7, extraReasonCodes: ['RC_EXTRA'] });
    expect(e.confidence).toBe(87);
    expect(e.evidence).toEqual(RECOMMENDATION_GRAPH.CAMPAIGN_RECOMMENDATIONS.evidence);
    expect(e.knowledgeVersion).toBe(7);
    expect(e.decisionSource).toEqual({ node: 'CAMPAIGN_RECOMMENDATIONS', capability: 'RECOMMENDATION_DECISION', runtime: 'platform' });
    expect(e.dependencies).toEqual(RECOMMENDATION_GRAPH.CAMPAIGN_RECOMMENDATIONS.dependsOn);
    expect(e.reasonCodes).toEqual(['RC_CAMPAIGN', 'RC_EXTRA']);
    expect(e.priorityExplanation).toMatch(/priority=\d+ \((critical|high|medium|low)\)/);
  });
  test('withExplanation is additive and non-mutating; passes through non-objects', () => {
    const recs = { recommendations: [1, 2], confidence: 80 };
    const e = buildRecommendationExplanation({ nodeId: 'FINAL_RECOMMENDATIONS', confidence: 80, knowledgeVersion: null });
    const out = withExplanation(recs, e) as any;
    expect(out.__explanation).toEqual(e);
    expect(out.recommendations).toEqual([1, 2]); // payload preserved
    expect((recs as any).__explanation).toBeUndefined(); // original not mutated
    expect(withExplanation('not-an-object' as any, e)).toBe('not-an-object'); // passthrough
  });
});

describe('PMF-007 §11 — reversible flag', () => {
  const orig = process.env.RECOMMENDATION_RUNTIME;
  afterEach(() => { if (orig === undefined) delete process.env.RECOMMENDATION_RUNTIME; else process.env.RECOMMENDATION_RUNTIME = orig; });
  test('defaults to legacy; platform/dual run platform; unknown → legacy', () => {
    delete process.env.RECOMMENDATION_RUNTIME;
    expect(getRecommendationRuntimeMode()).toBe('legacy');
    expect(shouldRunPlatform()).toBe(false);
    process.env.RECOMMENDATION_RUNTIME = 'platform';
    expect(shouldRunPlatform()).toBe(true);
    process.env.RECOMMENDATION_RUNTIME = 'dual';
    expect(shouldRunPlatform()).toBe(true);
    process.env.RECOMMENDATION_RUNTIME = 'garbage';
    expect(getRecommendationRuntimeMode()).toBe('legacy');
  });
});
