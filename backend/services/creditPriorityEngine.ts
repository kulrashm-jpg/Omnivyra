/**
 * Credit Priority Engine — Step 5
 *
 * When credits are scarce, actions are prioritised by their business impact tier.
 * The engine evaluates pending work and returns an ordered action queue, dropping
 * lower-priority work until the balance can cover the queue.
 *
 * Priority tiers (highest → lowest):
 *   1. execution    — campaign execution, auto-post, content generation (non-negotiable)
 *   2. content      — content rewrite, AI reply (user-facing quality)
 *   3. prediction   — campaign outcome prediction (informed decisions)
 *   4. optimization — live optimization loop, portfolio rebalancing
 *   5. insights     — pattern detection, market positioning, competitor intel, strategy
 *   6. replies      — community reply generation (nice-to-have)
 */

import { supabase } from '../db/supabaseClient';
import { hasEnoughCredits, CREDIT_COSTS, type CreditAction } from './creditDeductionService';
import { getEfficiencyDiscount } from './creditEfficiencyEngine';

// ── Actions known to historically drive conversions (ROI-boosted) ─────────────
// These get tier-1 priority boost when credits are scarce.
const ROI_BOOSTED_ACTIONS = new Set<CreditAction>([
  'lead_detection',
  'campaign_optimization',
  'pattern_detection',
  'prediction',
]);

// Intelligence actions that receive efficiency tier discounts (non-execution)
const DISCOUNTABLE_ACTIONS = new Set<CreditAction>([
  'pattern_detection', 'market_positioning', 'competitor_signals',
  'strategy_evolution', 'insight_generation', 'daily_insight_scan',
  'trend_analysis', 'lead_detection', 'portfolio_decision',
]);

// ── Action tiers ──────────────────────────────────────────────────────────────

const PRIORITY_TIERS: Array<{ tier: number; label: string; actions: CreditAction[] }> = [
  {
    tier: 1,
    label: 'execution',
    actions: ['auto_post', 'content_basic', 'campaign_creation', 'campaign_generation'],
  },
  {
    tier: 2,
    label: 'content',
    actions: ['content_rewrite', 'ai_reply'],
  },
  {
    tier: 3,
    label: 'prediction',
    actions: ['prediction'],
  },
  {
    tier: 4,
    label: 'optimization',
    actions: ['optimization_loop', 'campaign_optimization', 'portfolio_decision'],
  },
  {
    tier: 5,
    label: 'insights',
    actions: [
      'pattern_detection',
      'market_positioning',
      'competitor_signals',
      'strategy_evolution',
      'insight_generation',
      'daily_insight_scan',
      'trend_analysis',
      'lead_detection',
    ],
  },
  {
    tier: 6,
    label: 'replies',
    actions: ['reply_generation'],
  },
];

export type ActionPriority = {
  action: CreditAction;
  tier: number;
  tier_label: string;
  cost: number;
  effective_cost: number;  // after efficiency discount
  affordable: boolean;
  roi_boosted: boolean;    // true if this action historically led to conversions
};

export type PriorityQueueResult = {
  balance: number | null;
  affordable_actions: ActionPriority[];
  deferred_actions:   ActionPriority[];
  lowest_affordable_tier: number;
  credit_health: 'healthy' | 'low' | 'critical' | 'empty';
};

// ── Balance thresholds ────────────────────────────────────────────────────────

/** Returns a credit health label based on balance. */
function creditHealth(balance: number | null): PriorityQueueResult['credit_health'] {
  if (balance === null || balance === 0) return 'empty';
  if (balance < 50)  return 'critical';
  if (balance < 200) return 'low';
  return 'healthy';
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Evaluate which actions a company can afford and rank them by priority.
 *
 * @param orgId           Organization / company ID
 * @param candidateActions  The subset of actions to evaluate. Defaults to all known actions.
 */
export async function prioritizeActions(
  orgId: string,
  candidateActions?: CreditAction[],
): Promise<PriorityQueueResult> {
  // Fetch balance and efficiency discount in parallel
  const [balanceRes, discount] = await Promise.all([
    supabase
      .from('organization_credits')
      .select('free_balance, paid_balance, incentive_balance')
      .eq('organization_id', orgId)
      .maybeSingle(),
    getEfficiencyDiscount(orgId),
  ]);

  const bd = (balanceRes.data as any) ?? {};
  const balance: number | null = balanceRes.data
    ? (bd.free_balance ?? 0) + (bd.paid_balance ?? 0) + (bd.incentive_balance ?? 0)
    : null;
  const availableBalance = balance ?? 0;

  const actionsToEvaluate: CreditAction[] = candidateActions ?? (
    PRIORITY_TIERS.flatMap(t => t.actions)
  );

  const affordable: ActionPriority[] = [];
  const deferred:   ActionPriority[] = [];

  let runningCost = 0;
  let lowestAffordableTier = 7;

  // Walk tiers in order — ROI-boosted actions get evaluated first within each tier
  const tiersWithROISort = PRIORITY_TIERS.map(tier => ({
    ...tier,
    actions: [
      ...tier.actions.filter(a => ROI_BOOSTED_ACTIONS.has(a)),
      ...tier.actions.filter(a => !ROI_BOOSTED_ACTIONS.has(a)),
    ],
  }));

  for (const { tier, label, actions } of tiersWithROISort) {
    for (const action of actions) {
      if (!actionsToEvaluate.includes(action)) continue;

      const baseCost = CREDIT_COSTS[action];
      // Apply efficiency discount to intelligence actions
      const effectiveCost = DISCOUNTABLE_ACTIONS.has(action)
        ? Math.round(baseCost * discount)
        : baseCost;

      const canAfford = (runningCost + effectiveCost) <= availableBalance;
      const roiBoosted = ROI_BOOSTED_ACTIONS.has(action);

      const entry: ActionPriority = {
        action,
        tier,
        tier_label: label,
        cost:         baseCost,
        effective_cost: effectiveCost,
        affordable:   canAfford,
        roi_boosted:  roiBoosted,
      };

      if (canAfford) {
        affordable.push(entry);
        runningCost += effectiveCost;
        lowestAffordableTier = Math.max(lowestAffordableTier, tier);
      } else {
        deferred.push(entry);
      }
    }
  }

  return {
    balance,
    affordable_actions:       affordable,
    deferred_actions:          deferred,
    lowest_affordable_tier:    lowestAffordableTier === 7 ? 0 : lowestAffordableTier,
    credit_health:             creditHealth(balance),
  };
}

/**
 * Quick check: can a company afford a specific set of actions in sequence?
 * Returns the first action they cannot afford, or null if all are affordable.
 */
export async function firstUnaffordableAction(
  orgId: string,
  actions: CreditAction[],
): Promise<CreditAction | null> {
  const result = await prioritizeActions(orgId, actions);
  const affordable = new Set(result.affordable_actions.map(a => a.action));
  return actions.find(a => !affordable.has(a)) ?? null;
}
