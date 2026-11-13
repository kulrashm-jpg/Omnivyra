/**
 * C75 (BLOCKING money): billing for the interactive campaign planner (POST /api/campaigns/ai/plan and its ai-heavy
 * worker). Owner ruling via e9: hold the prescribed price, settle by ACTUAL consumption (token-actual through
 * executeWithEntryConsumption), release the remainder when stopped part-way.
 *
 * Every planner mode calls the same gateway operation (generateCampaignPlan), so featureRegistry cannot tell modes
 * apart; the ACTION is chosen here, by mode, in ONE table (e1 ruling 2026-11-13):
 *   generate_plan      -> campaign_generation   (the full plan)
 *   refine_day         -> content_rewrite        (conversational refinement)
 *   platform_customize -> content_rewrite
 *   planner_command    -> content_rewrite        (a targeted calendar edit; the planner applies the commands
 *                                                  deterministically - it never regenerates the whole plan)
 *   plan_preview       -> content_rewrite        (preview_mode; its own customer entry)
 *
 * IDENTITY (explicit, per e1):
 *   generate_plan: (company, campaign_generation, pollKey) - the SAME key inline and on the worker, so a request
 *     enqueued and then run inline (or a flag flip mid-flight) is ONE charge. Actor-free, because the worker's actor
 *     can differ from the inline caller's.
 *   other modes:   (actor, action, pollKey).
 *   Both use the released-attempt reclaim (resolveHttpAttemptRoot over the engine's exposure keys): a failed attempt
 *   never locks out the identical retry; a settled one dedups (ALREADY_PROCESSED).
 */
import { makeIdempotencyKey } from '../creditExecutionServiceContracts';
import type { CreditAction } from '../creditDeductionService';
import { runEntryConsumptionBilled, type EntryConsumptionHttpOutcome } from './entryConsumptionHttp';

export const PLANNER_BILLING_ACTIONS = {
  generate_plan: 'campaign_generation',
  refine_day: 'content_rewrite',
  platform_customize: 'content_rewrite',
  planner_command: 'content_rewrite',
  plan_preview: 'content_rewrite',
} as const satisfies Record<string, CreditAction>;

export type PlannerBillingKind = keyof typeof PLANNER_BILLING_ACTIONS;

/** Gate surface shared by the inline route and the worker (one enforcement decision for the planner). */
export const PLANNER_BILLING_SURFACE = 'campaigns.ai-plan';

export function plannerActionFor(kind: string): CreditAction {
  const action = (PLANNER_BILLING_ACTIONS as Record<string, CreditAction>)[kind];
  if (!action) throw new Error(`[plannerBilling] no billing action for planner kind '${kind}'`);
  return action;
}

export function plannerIdentityRoot(args: { kind: PlannerBillingKind; companyId: string; actorUserId: string; pollKey: string }): string {
  const action = plannerActionFor(args.kind);
  return args.kind === 'generate_plan'
    ? makeIdempotencyKey(args.companyId, action, `plan:${args.pollKey}`)
    : makeIdempotencyKey(args.actorUserId, action, `plan:${args.pollKey}`);
}

export async function runInteractivePlanBilled<T>(args: {
  kind: PlannerBillingKind;
  companyId: string;
  actorUserId: string;
  campaignId: string;
  pollKey: string;
  executor: () => Promise<T>;
}): Promise<EntryConsumptionHttpOutcome<T>> {
  const action = plannerActionFor(args.kind);
  return runEntryConsumptionBilled<T>({
    surface: PLANNER_BILLING_SURFACE,
    actorUserId: args.actorUserId,
    orgId: args.companyId,
    action,
    referenceType: 'campaign_ai_plan',
    referenceId: `${args.kind}:${args.campaignId}`,
    identityRoot: plannerIdentityRoot(args),
    llmPricing: {
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      actionKey: action,
      maxInputTokens: 16000,
      maxOutputTokens: 8000,
    },
    note: `planner ${args.kind} ${args.campaignId}`,
    executor: args.executor,
  });
}
