/**
 * agentRegistry.ts — the ONE canonical agent registry (AIA-001 §2).
 *
 * Every agent is defined HERE — identifier, purpose, supported capabilities,
 * permissions, execution strategy, approval requirements, memory strategy,
 * completion strategy, config, and its deterministic step plan template. No
 * scattered definitions. New autonomous workflows are added as configuration.
 *
 * The step template IS the plan — a deterministic, dependency-ordered list of
 * capability invocations. This reuses AIC-001 for execution; it introduces no
 * planning engine of its own.
 */

import type { AgentId, AgentStep } from './agentContracts';
import type { CapabilityId } from '../aiCapability/capabilityContracts';
// PMF-005 — the Campaign Planner agent's steps are derived from the capability graph.
import { CAMPAIGN_CAPABILITY_IDS, CAMPAIGN_CAPABILITY_GRAPH } from '../campaignCapability/campaignCapabilityGraph';
// PMF-006 — the Strategic Mix agent's steps are derived from the decision graph.
import { STRATEGIC_MIX_NODE_IDS, STRATEGIC_MIX_GRAPH } from '../strategicMixCapability/strategicMixDecisionGraph';
// PMF-007 — the Recommendation agent's steps are derived from the recommendation graph.
import { RECOMMENDATION_NODE_IDS, RECOMMENDATION_GRAPH } from '../recommendationCapability/recommendationGraph';

export type AgentExecutionStrategy = 'sequential' | 'dependency_graph';
export type MemoryStrategy = 'persistent' | 'ephemeral';
export type CompletionStrategy = 'all_steps' | 'best_effort';

export interface AgentDefinition {
  id: AgentId;
  purpose: string;
  supportedCapabilities: CapabilityId[];
  permissions: string[];
  executionStrategy: AgentExecutionStrategy;
  /** Whether the agent requires human approval at any gate. */
  approvalRequired: boolean;
  memoryStrategy: MemoryStrategy;
  completionStrategy: CompletionStrategy;
  /** Deterministic plan template — expanded verbatim by the planner. */
  steps: AgentStep[];
  config: {
    maxStepAttempts: number;
    approvalTimeoutMs: number;
    checkpointEveryStep: boolean;
  };
}

function step(id: string, capability: CapabilityId, opts: Partial<Omit<AgentStep, 'id' | 'capability'>> = {}): AgentStep {
  return {
    id, capability,
    mode: opts.mode ?? 'sequential',
    dependsOn: opts.dependsOn ?? [],
    requiresApproval: opts.requiresApproval ?? false,
    when: opts.when,
    fallbackCapability: opts.fallbackCapability,
    input: opts.input,
  };
}

function def(
  id: AgentId, purpose: string, steps: AgentStep[],
  overrides: Partial<Omit<AgentDefinition, 'id' | 'purpose' | 'steps' | 'supportedCapabilities'>> = {},
): AgentDefinition {
  const supportedCapabilities = Array.from(new Set(steps.flatMap((s) => [s.capability, ...(s.fallbackCapability ? [s.fallbackCapability] : [])])));
  return {
    id, purpose, supportedCapabilities,
    permissions: overrides.permissions ?? ['agent.execute'],
    executionStrategy: overrides.executionStrategy ?? 'dependency_graph',
    approvalRequired: overrides.approvalRequired ?? steps.some((s) => s.requiresApproval),
    memoryStrategy: overrides.memoryStrategy ?? 'persistent',
    completionStrategy: overrides.completionStrategy ?? 'all_steps',
    steps,
    config: { maxStepAttempts: 2, approvalTimeoutMs: 24 * 60 * 60 * 1000, checkpointEveryStep: true, ...(overrides.config ?? {}) },
  };
}

/** PMF-005 — derive the Campaign Planner agent's steps from the capability graph. */
function buildCampaignPlannerSteps(): AgentStep[] {
  return CAMPAIGN_CAPABILITY_IDS.map((id) => {
    const gNode = CAMPAIGN_CAPABILITY_GRAPH[id];
    return step(id, 'CAMPAIGN_PLAN', { mode: 'parallel', dependsOn: gNode.dependsOn, requiresApproval: gNode.requiresApproval });
  });
}

/** PMF-006 — derive the Strategic Mix agent's steps from the decision graph. */
function buildStrategicMixSteps(): AgentStep[] {
  return STRATEGIC_MIX_NODE_IDS.map((id) => {
    const gNode = STRATEGIC_MIX_GRAPH[id];
    return step(id, 'STRATEGIC_MIX_DECISION', { mode: 'parallel', dependsOn: gNode.dependsOn, requiresApproval: gNode.requiresApproval });
  });
}

/** PMF-007 — derive the Recommendation agent's steps from the recommendation graph. */
function buildRecommendationSteps(): AgentStep[] {
  return RECOMMENDATION_NODE_IDS.map((id) => {
    const gNode = RECOMMENDATION_GRAPH[id];
    return step(id, 'RECOMMENDATION_DECISION', { mode: 'parallel', dependsOn: gNode.dependsOn, requiresApproval: gNode.requiresApproval });
  });
}

const REGISTRY_INTERNAL: Record<string, AgentDefinition> = {
  // Website intelligence → competitor intelligence (depends on the first).
  WEBSITE_INTELLIGENCE_AGENT: def('WEBSITE_INTELLIGENCE_AGENT', 'Analyze the company website and derive competitive intelligence.', [
    step('analyze_site', 'WEBSITE_INTELLIGENCE', { mode: 'single' }),
    step('competitors', 'COMPETITOR_INTELLIGENCE', { mode: 'sequential', dependsOn: ['analyze_site'] }),
  ]),

  // Content agent: writer + creator brief run in parallel, publish gated by approval.
  CONTENT_AGENT: def('CONTENT_AGENT', 'Produce written + creator content, gated by human approval before publishing.', [
    step('write', 'CONTENT_WRITER', { mode: 'parallel' }),
    step('creative', 'CONTENT_CREATOR', { mode: 'parallel' }),
    step('recommend', 'RECOMMENDATION_ENGINE', { mode: 'sequential', dependsOn: ['write', 'creative'], requiresApproval: true }),
  ]),

  // Campaign agent: growth + SEO analysis → strategic mix → plan (approval before continuation).
  CAMPAIGN_AGENT: def('CAMPAIGN_AGENT', 'Plan a campaign from growth, SEO, and mix analysis.', [
    step('growth', 'GROWTH_INTELLIGENCE', { mode: 'parallel' }),
    step('seo', 'SEO_INTELLIGENCE', { mode: 'parallel' }),
    step('mix', 'STRATEGIC_MIX', { mode: 'sequential', dependsOn: ['growth', 'seo'] }),
    step('plan', 'CAMPAIGN_PLANNER', { mode: 'sequential', dependsOn: ['mix'], requiresApproval: true, fallbackCapability: 'STRATEGIC_MIX' }),
  ], { completionStrategy: 'best_effort' }),

  GROWTH_AGENT: def('GROWTH_AGENT', 'Synthesize growth intelligence and next-best actions.', [
    step('growth', 'GROWTH_INTELLIGENCE', { mode: 'single' }),
    step('recommend', 'RECOMMENDATION_ENGINE', { mode: 'sequential', dependsOn: ['growth'] }),
  ]),

  // PMF-005 — the Campaign Planner as an AIA agent. Steps + edges are DERIVED from
  // the Campaign Capability Graph (single source), so the agent IS the execution
  // graph. Every node executes through AIC (capability CAMPAIGN_PLAN); the definitive
  // plan is produced by the existing planner engine inside an injected runner (zero
  // quality change). The validation node gates on approval (§5). best_effort so a
  // non-plan analysis node can degrade without failing the campaign.
  CAMPAIGN_PLANNER_AGENT: def('CAMPAIGN_PLANNER_AGENT', 'Orchestrate campaign planning across the capability graph.',
    buildCampaignPlannerSteps(), { completionStrategy: 'best_effort' }),

  // PMF-006 — Strategic Mix as an AIA agent. Steps + edges are DERIVED from the
  // Strategic Mix Decision Graph (single source), so the agent IS the decision graph.
  // Every node executes through AIC (capability STRATEGIC_MIX_DECISION); the definitive
  // mix is produced by the existing engine inside an injected runner (zero strategy
  // change). FINAL_RECOMMENDATION gates on approval (§6). best_effort so a non-mix
  // analysis node can degrade without failing the recommendation.
  STRATEGIC_MIX_AGENT: def('STRATEGIC_MIX_AGENT', 'Orchestrate the strategic mix across the decision graph.',
    buildStrategicMixSteps(), { completionStrategy: 'best_effort' }),

  // PMF-007 — Recommendation Engine as an AIA agent. Steps + edges are DERIVED from the
  // Recommendation Graph (single source), so the agent IS the recommendation graph.
  // Every node executes through AIC (capability RECOMMENDATION_DECISION); the definitive
  // recommendations are produced by the existing engine inside an injected runner (zero
  // recommendation change). FINAL_RECOMMENDATIONS gates on approval (§6). best_effort so
  // a non-producing analysis node can degrade without failing the recommendations.
  RECOMMENDATION_AGENT: def('RECOMMENDATION_AGENT', 'Orchestrate recommendations across the recommendation graph.',
    buildRecommendationSteps(), { completionStrategy: 'best_effort' }),
};

export const AGENT_REGISTRY: Readonly<Record<string, AgentDefinition>> = REGISTRY_INTERNAL;
export const REGISTERED_AGENTS: ReadonlyArray<string> = Object.keys(REGISTRY_INTERNAL);

export function resolveAgent(id: AgentId): AgentDefinition | null {
  return REGISTRY_INTERNAL[id] ?? null;
}
