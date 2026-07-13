/**
 * PMF-006 §2/§6/§10 — Strategic Mix Decision Graph, execution graph (dependency
 * ordering), AIA agent registration, reversible flag.
 */

import {
  STRATEGIC_MIX_NODE_IDS, STRATEGIC_MIX_GRAPH, resolveStrategicMixNode,
  strategicMixExecutionOrder, mixProducingNode,
} from '../../services/strategicMixCapability/strategicMixDecisionGraph';
import { getStrategicMixRuntimeMode, shouldRunPlatform } from '../../services/strategicMixCapability/strategicMixMigrationFlag';
import { resolveAgent } from '../../services/aiAgent/agentRegistry';

describe('PMF-006 §2 — decision graph', () => {
  test('all twelve strategic decisions registered as nodes', () => {
    expect(STRATEGIC_MIX_NODE_IDS.sort()).toEqual([
      'AUDIENCE_ANALYSIS', 'BUDGET_ALLOCATION', 'BUSINESS_ANALYSIS', 'CAMPAIGN_SELECTION', 'CHANNEL_STRATEGY',
      'COMPETITOR_REVIEW', 'CONTENT_STRATEGY', 'FINAL_RECOMMENDATION', 'MARKET_ANALYSIS', 'POSITIONING',
      'RISK_ASSESSMENT', 'TIMELINE',
    ]);
    expect(resolveStrategicMixNode('CAMPAIGN_SELECTION')!.producesMix).toBe(true);
    expect(resolveStrategicMixNode('FINAL_RECOMMENDATION')!.requiresApproval).toBe(true);
    expect(mixProducingNode()).toBe('CAMPAIGN_SELECTION');
    // every node declares knowledge, inputs, outputs, validation, execution metadata
    for (const id of STRATEGIC_MIX_NODE_IDS) {
      const n = STRATEGIC_MIX_GRAPH[id];
      expect(n.knowledge.consumer).toBe('STRATEGIC_MIX');
      expect(Array.isArray(n.outputs)).toBe(true);
      expect(Array.isArray(n.validation)).toBe(true);
      expect(n.aicCapability).toBe('STRATEGIC_MIX_DECISION');
    }
    // domain-specific validators are modeled
    expect(STRATEGIC_MIX_GRAPH.CHANNEL_STRATEGY.validation).toContain('platform_authority');
    expect(STRATEGIC_MIX_GRAPH.CONTENT_STRATEGY.validation).toContain('text_lane_floor');
  });
});

describe('PMF-006 §2/§6 — deterministic execution graph', () => {
  test('topological order respects dependencies and is deterministic', () => {
    const order = strategicMixExecutionOrder();
    expect(order.length).toBe(12);
    const pos = (id: string) => order.indexOf(id as any);
    for (const id of STRATEGIC_MIX_NODE_IDS) {
      for (const dep of STRATEGIC_MIX_GRAPH[id].dependsOn) expect(pos(dep)).toBeLessThan(pos(id));
    }
    expect(order[0]).toBe('BUSINESS_ANALYSIS');           // no deps
    expect(order[order.length - 1]).toBe('FINAL_RECOMMENDATION'); // terminal
    expect(strategicMixExecutionOrder()).toEqual(order);  // deterministic
  });
});

describe('PMF-006 §6 — Strategic Mix AIA agent', () => {
  test('registered, derived from the graph, gates final recommendation on approval', () => {
    const agent = resolveAgent('STRATEGIC_MIX_AGENT');
    expect(agent).not.toBeNull();
    expect(agent!.steps.map((s) => s.id).sort()).toEqual(STRATEGIC_MIX_NODE_IDS.slice().sort());
    expect(agent!.steps.every((s) => s.capability === 'STRATEGIC_MIX_DECISION')).toBe(true);
    const selection = agent!.steps.find((s) => s.id === 'CAMPAIGN_SELECTION')!;
    expect(selection.dependsOn.sort()).toEqual(['CHANNEL_STRATEGY', 'CONTENT_STRATEGY']);
    expect(agent!.steps.find((s) => s.id === 'FINAL_RECOMMENDATION')!.requiresApproval).toBe(true);
    expect(agent!.approvalRequired).toBe(true);
  });
});

describe('PMF-006 §10 — reversible flag', () => {
  const orig = process.env.STRATEGIC_MIX_RUNTIME;
  afterEach(() => { if (orig === undefined) delete process.env.STRATEGIC_MIX_RUNTIME; else process.env.STRATEGIC_MIX_RUNTIME = orig; });
  test('defaults to legacy; platform/dual run platform; unknown → legacy', () => {
    delete process.env.STRATEGIC_MIX_RUNTIME;
    expect(getStrategicMixRuntimeMode()).toBe('legacy');
    expect(shouldRunPlatform()).toBe(false);
    process.env.STRATEGIC_MIX_RUNTIME = 'platform';
    expect(shouldRunPlatform()).toBe(true);
    process.env.STRATEGIC_MIX_RUNTIME = 'dual';
    expect(shouldRunPlatform()).toBe(true);
    process.env.STRATEGIC_MIX_RUNTIME = 'garbage';
    expect(getStrategicMixRuntimeMode()).toBe('legacy');
  });
});
