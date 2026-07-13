/**
 * refreshPolicyRegistry.ts — canonical Refresh Policy Rule Registry (CKRE-002R §1).
 *
 * ONE central definition of every policy rule the Refresh Policy Engine
 * evaluates. Nothing else hardcodes rule identifiers, priorities, or evaluation
 * order — decideRefresh iterates this registry. This is declarative metadata
 * ABOUT the rules; the (unchanged) decision semantics live in
 * refreshPolicyEngine.ts. Pure and deterministic (a frozen literal).
 */

import type { RefreshAction } from './refreshPolicyEngine';

export type RefreshRuleId =
  // pre-emptive rules (operational guards, highest precedence)
  | 'ADMIN_OVERRIDE'
  | 'PENDING_REFRESH'
  | 'PLATFORM_DEGRADED'
  | 'GATING_DISABLED'
  | 'MANUAL_REFRESH'
  | 'WITHIN_COOLDOWN'
  // verdict rules (change-driven)
  | 'UNCHANGED_SITE'
  | 'FIRST_REFRESH'
  | 'COSMETIC_CHANGE'
  | 'BUSINESS_CHANGE'
  | 'MAJOR_CHANGE'
  | 'UNKNOWN'
  // budget rules (post-condition on AI actions)
  | 'TOKEN_BUDGET'
  | 'NETWORK_BUDGET'
  | 'CRAWL_BUDGET'
  | 'TIME_BUDGET';

export type RulePhase = 'pre' | 'verdict' | 'budget';

export interface RefreshRuleDefinition {
  id: RefreshRuleId;
  /** Lower = evaluated first. Determines evaluation order + decision precedence. */
  priority: number;
  phase: RulePhase;
  /** Deterministic action the rule yields when it triggers, or 'derived' when
   *  it depends on further inputs (verdict rules that branch on a baseline). */
  action: RefreshAction | 'derived';
  description: string;
  /** Where the rule's inputs come from (config / change decision / context). */
  configSource: string;
  /** Future-extensibility metadata (CKRE-003+ hooks). */
  extensibility: { budgetType?: string; sectionScoped?: boolean; overridable?: boolean };
}

const REGISTRY_INTERNAL: Record<RefreshRuleId, RefreshRuleDefinition> = {
  ADMIN_OVERRIDE: {
    id: 'ADMIN_OVERRIDE', priority: 10, phase: 'pre', action: 'derived',
    description: 'Explicit admin/policy override wins over every other rule.',
    configSource: 'input.adminOverride', extensibility: { overridable: false },
  },
  PENDING_REFRESH: {
    id: 'PENDING_REFRESH', priority: 20, phase: 'pre', action: 'DEFER',
    description: 'A refresh is already in flight — defer to avoid double work.',
    configSource: 'input.pendingRefresh', extensibility: { overridable: true },
  },
  PLATFORM_DEGRADED: {
    id: 'PLATFORM_DEGRADED', priority: 30, phase: 'pre', action: 'DEFER',
    description: 'Platform degraded — defer non-manual refreshes.',
    configSource: 'input.platformState', extensibility: { overridable: true },
  },
  GATING_DISABLED: {
    id: 'GATING_DISABLED', priority: 40, phase: 'pre', action: 'EXECUTE_REFRESH',
    description: 'Master kill-switch off — behave as pre-CKRE-002 (always run).',
    configSource: 'config.aiGatingEnabled', extensibility: { overridable: false },
  },
  MANUAL_REFRESH: {
    id: 'MANUAL_REFRESH', priority: 50, phase: 'pre', action: 'REFRESH_FULL',
    description: 'User-initiated refresh bypasses the change gate.',
    configSource: 'input.manualRefresh', extensibility: { overridable: true },
  },
  WITHIN_COOLDOWN: {
    id: 'WITHIN_COOLDOWN', priority: 60, phase: 'pre', action: 'DEFER',
    description: 'Too soon since the last refresh for this tier — defer.',
    configSource: 'config.cooldownMsByTier', extensibility: { overridable: true },
  },
  UNCHANGED_SITE: {
    id: 'UNCHANGED_SITE', priority: 70, phase: 'verdict', action: 'SKIP_REFRESH',
    description: 'Content unchanged with a knowledge baseline — skip AI.',
    configSource: 'changeDecision.verdict + hasPriorKnowledgeVersion', extensibility: { overridable: true },
  },
  FIRST_REFRESH: {
    id: 'FIRST_REFRESH', priority: 71, phase: 'verdict', action: 'REFRESH_FULL',
    description: 'No knowledge baseline yet — run the first full enrichment.',
    configSource: 'hasPriorKnowledgeVersion', extensibility: { overridable: false },
  },
  COSMETIC_CHANGE: {
    id: 'COSMETIC_CHANGE', priority: 72, phase: 'verdict', action: 'REFRESH_METADATA_ONLY',
    description: 'Structural/cosmetic change — deterministic metadata refresh only.',
    configSource: 'changeDecision.verdict', extensibility: { sectionScoped: true, overridable: true },
  },
  BUSINESS_CHANGE: {
    id: 'BUSINESS_CHANGE', priority: 73, phase: 'verdict', action: 'REFRESH_BUSINESS_ONLY',
    description: 'Business fields changed — run business AI refresh.',
    configSource: 'changeDecision.verdict', extensibility: { sectionScoped: true, overridable: true },
  },
  MAJOR_CHANGE: {
    id: 'MAJOR_CHANGE', priority: 74, phase: 'verdict', action: 'REFRESH_FULL',
    description: 'Company name changed / many business fields — full refresh.',
    configSource: 'changeDecision.verdict', extensibility: { sectionScoped: true, overridable: true },
  },
  UNKNOWN: {
    id: 'UNKNOWN', priority: 75, phase: 'verdict', action: 'REFRESH_FULL',
    description: 'Cannot prove unchanged — safe default is a full refresh.',
    configSource: 'changeDecision.verdict', extensibility: { overridable: false },
  },
  TOKEN_BUDGET: {
    id: 'TOKEN_BUDGET', priority: 80, phase: 'budget', action: 'DEFER',
    description: 'AI token budget exhausted — defer AI actions.',
    configSource: 'input.budgets[type=ai]', extensibility: { budgetType: 'ai', overridable: true },
  },
  NETWORK_BUDGET: {
    id: 'NETWORK_BUDGET', priority: 81, phase: 'budget', action: 'DEFER',
    description: 'Network budget exhausted — defer.',
    configSource: 'input.budgets[type=network]', extensibility: { budgetType: 'network', overridable: true },
  },
  CRAWL_BUDGET: {
    id: 'CRAWL_BUDGET', priority: 82, phase: 'budget', action: 'DEFER',
    description: 'Crawl budget exhausted — defer.',
    configSource: 'input.budgets[type=crawl]', extensibility: { budgetType: 'crawl', overridable: true },
  },
  TIME_BUDGET: {
    id: 'TIME_BUDGET', priority: 83, phase: 'budget', action: 'DEFER',
    description: 'Execution-time budget exhausted — defer.',
    configSource: 'input.budgets[type=time]', extensibility: { budgetType: 'time', overridable: true },
  },
};

export const REFRESH_POLICY_REGISTRY: Readonly<Record<RefreshRuleId, RefreshRuleDefinition>> = REGISTRY_INTERNAL;

/** Rule ids in deterministic evaluation order (priority ascending). */
export const REFRESH_RULE_ORDER: ReadonlyArray<RefreshRuleId> = (Object.keys(REGISTRY_INTERNAL) as RefreshRuleId[])
  .sort((a, b) => REGISTRY_INTERNAL[a].priority - REGISTRY_INTERNAL[b].priority);

export function getRefreshRule(id: RefreshRuleId): RefreshRuleDefinition {
  const r = REGISTRY_INTERNAL[id];
  if (!r) throw new Error(`UNKNOWN_REFRESH_RULE:${id}`);
  return r;
}

/** Rule ids of a given phase, in evaluation order. */
export function rulesForPhase(phase: RulePhase): RefreshRuleId[] {
  return REFRESH_RULE_ORDER.filter((id) => REGISTRY_INTERNAL[id].phase === phase);
}
