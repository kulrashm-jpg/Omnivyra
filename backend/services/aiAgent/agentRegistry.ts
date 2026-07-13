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
};

export const AGENT_REGISTRY: Readonly<Record<string, AgentDefinition>> = REGISTRY_INTERNAL;
export const REGISTERED_AGENTS: ReadonlyArray<string> = Object.keys(REGISTRY_INTERNAL);

export function resolveAgent(id: AgentId): AgentDefinition | null {
  return REGISTRY_INTERNAL[id] ?? null;
}
