/**
 * PMF-005 §2/§5/§6/§10 — Campaign Capability Graph, execution graph (dependency
 * ordering), AIA agent registration, reversible flag.
 */

import {
  CAMPAIGN_CAPABILITY_IDS, CAMPAIGN_CAPABILITY_GRAPH, resolveCampaignCapability,
  campaignExecutionOrder, planProducingCapability,
} from '../../services/campaignCapability/campaignCapabilityGraph';
import { getCampaignRuntimeMode, shouldRunPlatform } from '../../services/campaignCapability/campaignMigrationFlag';
import { resolveAgent } from '../../services/aiAgent/agentRegistry';

describe('PMF-005 §2 — capability graph', () => {
  test('all ten planner capabilities registered', () => {
    expect(CAMPAIGN_CAPABILITY_IDS.sort()).toEqual([
      'AUDIENCE_ANALYSIS', 'BUDGET_PLANNING', 'CAMPAIGN_STRATEGY', 'CAMPAIGN_VALIDATION', 'CHANNEL_SELECTION',
      'CONTENT_CALENDAR', 'CONTENT_STRATEGY', 'GOAL_ANALYSIS', 'KPI_SELECTION', 'RISK_ANALYSIS',
    ]);
    expect(resolveCampaignCapability('CAMPAIGN_STRATEGY')!.producesPlan).toBe(true);
    expect(resolveCampaignCapability('CAMPAIGN_VALIDATION')!.requiresApproval).toBe(true);
    expect(planProducingCapability()).toBe('CAMPAIGN_STRATEGY');
    // knowledge requirements present on every node
    for (const id of CAMPAIGN_CAPABILITY_IDS) expect(CAMPAIGN_CAPABILITY_GRAPH[id].knowledge.consumer).toBe('CAMPAIGN_PLANNER');
  });
});

describe('PMF-005 §6 — deterministic execution graph', () => {
  test('topological order respects dependencies and is deterministic', () => {
    const order = campaignExecutionOrder();
    expect(order.length).toBe(10);
    const pos = (id: string) => order.indexOf(id as any);
    // every dependency precedes its dependent
    for (const id of CAMPAIGN_CAPABILITY_IDS) {
      for (const dep of CAMPAIGN_CAPABILITY_GRAPH[id].dependsOn) expect(pos(dep)).toBeLessThan(pos(id));
    }
    // GOAL_ANALYSIS first (no deps); CAMPAIGN_VALIDATION last (terminal)
    expect(order[0]).toBe('GOAL_ANALYSIS');
    expect(order[order.length - 1]).toBe('CAMPAIGN_VALIDATION');
    expect(campaignExecutionOrder()).toEqual(order); // deterministic
  });
});

describe('PMF-005 §5 — Campaign Planner AIA agent', () => {
  test('registered, derived from the graph, gates validation on approval', () => {
    const agent = resolveAgent('CAMPAIGN_PLANNER_AGENT');
    expect(agent).not.toBeNull();
    expect(agent!.steps.map((s) => s.id).sort()).toEqual(CAMPAIGN_CAPABILITY_IDS.slice().sort());
    // every step executes through the AIC CAMPAIGN_PLAN capability (agent never runs models directly)
    expect(agent!.steps.every((s) => s.capability === 'CAMPAIGN_PLAN')).toBe(true);
    // edges mirror the graph
    const strategy = agent!.steps.find((s) => s.id === 'CAMPAIGN_STRATEGY')!;
    expect(strategy.dependsOn.sort()).toEqual(['AUDIENCE_ANALYSIS', 'CHANNEL_SELECTION', 'GOAL_ANALYSIS']);
    // approval gate on validation
    expect(agent!.steps.find((s) => s.id === 'CAMPAIGN_VALIDATION')!.requiresApproval).toBe(true);
    expect(agent!.approvalRequired).toBe(true);
  });
});

describe('PMF-005 §10 — reversible flag', () => {
  const orig = process.env.CAMPAIGN_PLANNER_RUNTIME;
  afterEach(() => { if (orig === undefined) delete process.env.CAMPAIGN_PLANNER_RUNTIME; else process.env.CAMPAIGN_PLANNER_RUNTIME = orig; });
  test('defaults to legacy; platform/dual run platform; unknown → legacy', () => {
    delete process.env.CAMPAIGN_PLANNER_RUNTIME;
    expect(getCampaignRuntimeMode()).toBe('legacy');
    expect(shouldRunPlatform()).toBe(false);
    process.env.CAMPAIGN_PLANNER_RUNTIME = 'platform';
    expect(shouldRunPlatform()).toBe(true);
    process.env.CAMPAIGN_PLANNER_RUNTIME = 'dual';
    expect(shouldRunPlatform()).toBe(true);
    process.env.CAMPAIGN_PLANNER_RUNTIME = 'garbage';
    expect(getCampaignRuntimeMode()).toBe('legacy');
  });
});
