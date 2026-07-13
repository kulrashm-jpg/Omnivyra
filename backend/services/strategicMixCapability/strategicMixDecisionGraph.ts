/**
 * strategicMixDecisionGraph.ts — the Strategic Mix Decision Graph (PMF-006 §2/§3).
 *
 * ONE deterministic graph modelling every strategic decision as a node. The
 * Strategic Mix AIA agent orchestrates these nodes rather than implementing them
 * directly; adding a strategic capability becomes "add a node + edges", not "write
 * orchestration code". Each node selects the existing engine/prompts via its
 * capability (prompt selection behind the profile, §7) and changes no strategy logic
 * and no recommendation quality.
 */

export type StrategicMixNodeId =
  | 'BUSINESS_ANALYSIS'
  | 'MARKET_ANALYSIS'
  | 'AUDIENCE_ANALYSIS'
  | 'POSITIONING'
  | 'COMPETITOR_REVIEW'
  | 'CHANNEL_STRATEGY'
  | 'CONTENT_STRATEGY'
  | 'CAMPAIGN_SELECTION'
  | 'BUDGET_ALLOCATION'
  | 'TIMELINE'
  | 'RISK_ASSESSMENT'
  | 'FINAL_RECOMMENDATION';

export interface StrategicMixNode {
  id: StrategicMixNodeId;
  /** Dependencies — nodes that must complete first (§2). */
  dependsOn: StrategicMixNodeId[];
  /** Inputs consumed (dependency outputs). */
  inputs: string[];
  /** Outputs produced. */
  outputs: string[];
  /** Required CKC knowledge (consumer + mode). */
  knowledge: { consumer: string; minConfidence?: number; mode?: 'summary' | 'full' | 'compressed' };
  /** Deterministic validation applied. */
  validation: string[];
  /** Minimum confidence for this decision (0–100). */
  confidenceThreshold: number;
  /** The AIC capability this node executes (§3). */
  aicCapability: string;
  outputContract: string;
  /** The node that produces the definitive mix (engine backend). */
  producesMix: boolean;
  /** Terminal node gating on human approval (§6 approval gate). */
  requiresApproval: boolean;
  executionMetadata: { kind: 'analysis' | 'strategy' | 'allocation' | 'synthesis'; deterministic: boolean };
}

function node(
  id: StrategicMixNodeId, dependsOn: StrategicMixNodeId[], outputs: string[],
  kind: StrategicMixNode['executionMetadata']['kind'], overrides: Partial<StrategicMixNode> = {},
): StrategicMixNode {
  return {
    id, dependsOn,
    inputs: overrides.inputs ?? dependsOn.map((d) => `${d}.output`),
    outputs,
    knowledge: { consumer: 'STRATEGIC_MIX', mode: 'summary', ...(overrides.knowledge ?? {}) },
    validation: overrides.validation ?? ['schema'],
    confidenceThreshold: overrides.confidenceThreshold ?? 0,
    aicCapability: overrides.aicCapability ?? 'STRATEGIC_MIX_DECISION',
    outputContract: overrides.outputContract ?? 'strategic_mix',
    producesMix: overrides.producesMix ?? false,
    requiresApproval: overrides.requiresApproval ?? false,
    executionMetadata: overrides.executionMetadata ?? { kind, deterministic: kind !== 'synthesis' },
  };
}

const GRAPH_INTERNAL: Record<StrategicMixNodeId, StrategicMixNode> = {
  BUSINESS_ANALYSIS:  node('BUSINESS_ANALYSIS', [], ['business_profile'], 'analysis'),
  MARKET_ANALYSIS:    node('MARKET_ANALYSIS', ['BUSINESS_ANALYSIS'], ['market_signals'], 'analysis'),
  AUDIENCE_ANALYSIS:  node('AUDIENCE_ANALYSIS', ['BUSINESS_ANALYSIS'], ['audience_segments'], 'analysis'),
  POSITIONING:        node('POSITIONING', ['BUSINESS_ANALYSIS', 'MARKET_ANALYSIS'], ['positioning'], 'strategy'),
  COMPETITOR_REVIEW:  node('COMPETITOR_REVIEW', ['MARKET_ANALYSIS'], ['competitor_gaps'], 'analysis'),
  CHANNEL_STRATEGY:   node('CHANNEL_STRATEGY', ['AUDIENCE_ANALYSIS', 'POSITIONING', 'COMPETITOR_REVIEW'], ['channel_mix'], 'strategy', { validation: ['schema', 'platform_authority', 'format_platform_binding'] }),
  CONTENT_STRATEGY:   node('CONTENT_STRATEGY', ['AUDIENCE_ANALYSIS', 'POSITIONING'], ['format_mix'], 'strategy', { validation: ['schema', 'text_lane_floor'] }),
  // The selection node produces the definitive mix via the existing engine (backend).
  CAMPAIGN_SELECTION: node('CAMPAIGN_SELECTION', ['CHANNEL_STRATEGY', 'CONTENT_STRATEGY'], ['strategic_mix'], 'synthesis', { producesMix: true, validation: ['schema', 'capacity', 'distribution_floor'] }),
  BUDGET_ALLOCATION:  node('BUDGET_ALLOCATION', ['CHANNEL_STRATEGY', 'CAMPAIGN_SELECTION'], ['budget_split'], 'allocation'),
  TIMELINE:           node('TIMELINE', ['CAMPAIGN_SELECTION'], ['schedule'], 'allocation'),
  RISK_ASSESSMENT:    node('RISK_ASSESSMENT', ['CAMPAIGN_SELECTION', 'BUDGET_ALLOCATION', 'TIMELINE'], ['risk_report'], 'analysis'),
  // Terminal synthesis, gated on approval (§6 approval gate).
  FINAL_RECOMMENDATION: node('FINAL_RECOMMENDATION', ['CONTENT_STRATEGY', 'CHANNEL_STRATEGY', 'BUDGET_ALLOCATION', 'TIMELINE', 'RISK_ASSESSMENT'], ['recommendation'], 'synthesis', { requiresApproval: true, validation: ['schema', 'final_contract'] }),
};

export const STRATEGIC_MIX_GRAPH: Readonly<Record<StrategicMixNodeId, StrategicMixNode>> = GRAPH_INTERNAL;
export const STRATEGIC_MIX_NODE_IDS = Object.keys(GRAPH_INTERNAL) as StrategicMixNodeId[];

export function resolveStrategicMixNode(id: StrategicMixNodeId): StrategicMixNode | null {
  return GRAPH_INTERNAL[id] ?? null;
}

/** The node that produces the definitive mix (engine backend). */
export function mixProducingNode(): StrategicMixNodeId {
  return (STRATEGIC_MIX_NODE_IDS.find((id) => GRAPH_INTERNAL[id].producesMix) ?? 'CAMPAIGN_SELECTION') as StrategicMixNodeId;
}

/**
 * Deterministic topological execution order over the dependency edges (§2/§6).
 * Cycle-detecting; stable (ids sorted within each ready set). Pure.
 */
export function strategicMixExecutionOrder(): StrategicMixNodeId[] {
  const visited = new Set<StrategicMixNodeId>();
  const temp = new Set<StrategicMixNodeId>();
  const order: StrategicMixNodeId[] = [];
  const visit = (id: StrategicMixNodeId) => {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`STRATEGIC_MIX_GRAPH_CYCLE:${id}`);
    temp.add(id);
    for (const dep of [...GRAPH_INTERNAL[id].dependsOn].sort()) visit(dep);
    temp.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...STRATEGIC_MIX_NODE_IDS].sort()) visit(id);
  return order;
}
