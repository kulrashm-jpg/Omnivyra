/**
 * campaignCapabilityGraph.ts — the Campaign Planner Capability Graph (PMF-005 §2/§6).
 *
 * ONE declarative graph of the planner's capabilities + the deterministic execution
 * graph (dependency edges). The Campaign Planner AIA agent orchestrates these nodes
 * rather than implementing them directly; adding a planner capability becomes "add a
 * profile + edges", not "write orchestration code". The graph selects the existing
 * prompts/engine via the profile (prompt selection behind the profile, §7) and
 * changes no prompt and no planning behavior.
 */

export type CampaignCapabilityId =
  | 'GOAL_ANALYSIS'
  | 'AUDIENCE_ANALYSIS'
  | 'CHANNEL_SELECTION'
  | 'CAMPAIGN_STRATEGY'
  | 'CONTENT_STRATEGY'
  | 'CONTENT_CALENDAR'
  | 'BUDGET_PLANNING'
  | 'KPI_SELECTION'
  | 'RISK_ANALYSIS'
  | 'CAMPAIGN_VALIDATION';

export interface CampaignCapabilityProfile {
  id: CampaignCapabilityId;
  /** CKC knowledge requirements (domains via consumer + confidence/freshness/mode). */
  knowledge: { consumer: string; minConfidence?: number; maxAgeMs?: number; mode?: 'summary' | 'full' | 'compressed' };
  planningStrategy: string;
  validation: string[];
  outputContract: string;
  timeoutMs: number;
  retryPolicy: { maxRetries: number };
  /** Execution-graph edges — capabilities that must complete first (§6). */
  dependsOn: CampaignCapabilityId[];
  /** Whether this node is the one that produces the definitive plan (engine backend). */
  producesPlan: boolean;
  /** Whether this node gates on human approval (§5 approval gates). */
  requiresApproval: boolean;
  executionMetadata: { kind: 'analysis' | 'strategy' | 'schedule' | 'validation'; deterministic: boolean };
}

function node(
  id: CampaignCapabilityId, dependsOn: CampaignCapabilityId[], kind: CampaignCapabilityProfile['executionMetadata']['kind'],
  overrides: Partial<CampaignCapabilityProfile> = {},
): CampaignCapabilityProfile {
  return {
    id,
    knowledge: { consumer: 'CAMPAIGN_PLANNER', mode: 'summary', ...(overrides.knowledge ?? {}) },
    planningStrategy: overrides.planningStrategy ?? id.toLowerCase(),
    validation: overrides.validation ?? ['schema', 'planner_contract'],
    outputContract: overrides.outputContract ?? 'campaign_plan',
    timeoutMs: overrides.timeoutMs ?? 120_000,
    retryPolicy: overrides.retryPolicy ?? { maxRetries: 0 },
    dependsOn,
    producesPlan: overrides.producesPlan ?? false,
    requiresApproval: overrides.requiresApproval ?? false,
    executionMetadata: overrides.executionMetadata ?? { kind, deterministic: kind === 'validation' },
  };
}

const GRAPH_INTERNAL: Record<CampaignCapabilityId, CampaignCapabilityProfile> = {
  GOAL_ANALYSIS:      node('GOAL_ANALYSIS', [], 'analysis'),
  AUDIENCE_ANALYSIS:  node('AUDIENCE_ANALYSIS', ['GOAL_ANALYSIS'], 'analysis'),
  CHANNEL_SELECTION:  node('CHANNEL_SELECTION', ['GOAL_ANALYSIS', 'AUDIENCE_ANALYSIS'], 'analysis'),
  // The strategy node produces the definitive plan via the existing engine (backend).
  CAMPAIGN_STRATEGY:  node('CAMPAIGN_STRATEGY', ['GOAL_ANALYSIS', 'AUDIENCE_ANALYSIS', 'CHANNEL_SELECTION'], 'strategy', { producesPlan: true, timeoutMs: 300_000 }),
  CONTENT_STRATEGY:   node('CONTENT_STRATEGY', ['CAMPAIGN_STRATEGY'], 'strategy'),
  CONTENT_CALENDAR:   node('CONTENT_CALENDAR', ['CONTENT_STRATEGY', 'CHANNEL_SELECTION'], 'schedule'),
  BUDGET_PLANNING:    node('BUDGET_PLANNING', ['CHANNEL_SELECTION', 'CAMPAIGN_STRATEGY'], 'analysis'),
  KPI_SELECTION:      node('KPI_SELECTION', ['GOAL_ANALYSIS', 'CAMPAIGN_STRATEGY'], 'analysis'),
  RISK_ANALYSIS:      node('RISK_ANALYSIS', ['CAMPAIGN_STRATEGY', 'CONTENT_CALENDAR'], 'analysis'),
  // Terminal deterministic validation, gated on approval (§5 approval gate).
  CAMPAIGN_VALIDATION: node('CAMPAIGN_VALIDATION', ['CONTENT_CALENDAR', 'BUDGET_PLANNING', 'KPI_SELECTION', 'RISK_ANALYSIS'], 'validation', { requiresApproval: true, validation: ['schema', 'planner_contract', 'capacity', 'schedule_floor'] }),
};

export const CAMPAIGN_CAPABILITY_GRAPH: Readonly<Record<CampaignCapabilityId, CampaignCapabilityProfile>> = GRAPH_INTERNAL;
export const CAMPAIGN_CAPABILITY_IDS = Object.keys(GRAPH_INTERNAL) as CampaignCapabilityId[];

export function resolveCampaignCapability(id: CampaignCapabilityId): CampaignCapabilityProfile | null {
  return GRAPH_INTERNAL[id] ?? null;
}

/** The node that produces the definitive plan (engine backend). */
export function planProducingCapability(): CampaignCapabilityId {
  return (CAMPAIGN_CAPABILITY_IDS.find((id) => GRAPH_INTERNAL[id].producesPlan) ?? 'CAMPAIGN_STRATEGY') as CampaignCapabilityId;
}

/**
 * Deterministic topological execution order over the dependency edges (§6).
 * Cycle-detecting; stable (ids sorted within each ready set). Pure.
 */
export function campaignExecutionOrder(): CampaignCapabilityId[] {
  const visited = new Set<CampaignCapabilityId>();
  const temp = new Set<CampaignCapabilityId>();
  const order: CampaignCapabilityId[] = [];
  const visit = (id: CampaignCapabilityId) => {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`CAMPAIGN_GRAPH_CYCLE:${id}`);
    temp.add(id);
    for (const dep of [...GRAPH_INTERNAL[id].dependsOn].sort()) visit(dep);
    temp.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...CAMPAIGN_CAPABILITY_IDS].sort()) visit(id);
  return order;
}
