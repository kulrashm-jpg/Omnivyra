/**
 * C75 (e1 2026-11-13) - the creator scheduler's per-row AI generation as ONE billed unit.
 *
 * structuredPlanSchedulerExecWeeklyA runs engine.generateFromIntent (blueprint - up to 3 calls for a carousel - plus
 * marketing packaging) for every creator daily-plan row. That AI ran unbilled. This helper bills it token-actual
 * through executeWithEntryConsumption (owner rule: hold the maximum, settle actual x 15).
 *
 * DOUBLY DARK: billed only when getCreditEconomyExecutionMode() is 'enforce' (master entry-consumption switch AND the
 * per-org enforcement gate). Any other mode runs generate() exactly as before - no ledger read, no stash.
 *
 * Identity: one per campaign / row / plan version (a new plan version is new content and a new charge). A failed
 * attempt RELEASES its exposure, so the same identity answers already_released and the next slot `:r<n>` is used
 * (the shared reclaim semantics). already_settled means this row's generation was ALREADY CHARGED: it is never
 * re-run for free. The charged output is stashed on the row immediately after the charge (STASH_KEY) and reused by
 * any later attempt or run; a settled identity with no stash is a charged-no-output event (critical anomaly, a
 * permanent typed refusal - an operator decides, the customer is not charged twice).
 */
import { executeWithEntryConsumption, makeIdempotencyKey } from '../creditExecutionService';
import { getCreditEconomyExecutionMode } from './creditEconomyActivation';
import { emitAnomaly } from './billingAuditEmitter';
import { logger } from '../logger';

export const CREATOR_ROW_SURFACE = 'scheduler.creator-row';
/** Same action as the queued creator-content processor bills for the same engine work (LONG_GENERATION). */
export const CREATOR_ROW_ACTION = 'content_generation';
export const CREATOR_ROW_REFERENCE_TYPE = 'creator_daily_plan_row';
/** Shared reclaim cap (backend/tests/helpers/reclaimSemanticsCases.ts RECLAIM_CAP). */
export const MAX_CREATOR_ROW_RECLAIM_ATTEMPTS = 20;
/** Row-content key holding a charged generation for reuse. Never passed back into a prompt. */
export const STASH_KEY = 'billed_generation';
/** Calls in one unit: a carousel blueprint (1 + MAX_CAROUSEL_COMPLETION_RETRIES=2) + packaging. */
export const CREATOR_ROW_UNIT_CALLS = 4;

export type CreatorRowBillingCode =
  | 'INSUFFICIENT_CREDITS' | 'NO_CREDIT_ACCOUNT' | 'ORG_CONTROL_BLOCKED' | 'NOT_A_MEMBER'
  | 'CHARGED_NO_OUTPUT' | 'RECLAIM_CAP_EXHAUSTED';

/** A billing refusal for one row. `retryable`: a later run can succeed without operator action. */
export class CreatorRowBillingRefusedError extends Error {
  constructor(
    public readonly code: CreatorRowBillingCode,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'CreatorRowBillingRefusedError';
  }
}

export interface CreatorRowStash {
  plan_version: number;
  reference_id: string;
  output: Record<string, unknown>;
}

export function creatorRowIdentity(campaignId: string, rowId: string, planVersion: number): string {
  return `creator_row:${campaignId}:${rowId}:v${planVersion}`;
}

/** A stash is reusable only for the SAME plan version and with an object output. */
export function readCreatorRowStash(raw: unknown, planVersion: number): CreatorRowStash | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CreatorRowStash>;
  if (s.plan_version !== planVersion) return null;
  if (!s.output || typeof s.output !== 'object') return null;
  if (typeof s.reference_id !== 'string') return null;
  return s as CreatorRowStash;
}

export type CreatorRowGenerationResult<T> =
  | { billed: false; reused: false; output: T }                        // not enforced: today's path
  | { billed: true; reused: false; output: T; stash: CreatorRowStash } // charged now - caller persists the stash
  | { billed: true; reused: true; output: T };                         // already charged - reused, no AI, no charge

export async function generateCreatorRowBilled<T extends object>(args: {
  /** null = a campaign with no company: no wallet to charge -> refused when enforced (never free AI) */
  companyId: string | null;
  userId?: string | null;
  campaignId: string;
  rowId: string;
  planVersion: number;
  /** the row's STASH_KEY value (or an in-run stash), if any */
  stash: unknown;
  generate: () => Promise<T>;
}): Promise<CreatorRowGenerationResult<T>> {
  const mode = await getCreditEconomyExecutionMode({ organizationId: args.companyId, surface: CREATOR_ROW_SURFACE });
  if (mode !== 'enforce') return { billed: false, reused: false, output: await args.generate() };
  if (!args.companyId) {
    throw new CreatorRowBillingRefusedError('NO_CREDIT_ACCOUNT', false, 'creator row billing refused: NO_CREDIT_ACCOUNT (the campaign has no company)');
  }
  const companyId = args.companyId;

  const reusable = readCreatorRowStash(args.stash, args.planVersion);
  if (reusable) return { billed: true, reused: true, output: reusable.output as T };

  const identity = creatorRowIdentity(args.campaignId, args.rowId, args.planVersion);
  const ctx = { org: companyId, campaign: args.campaignId, row: args.rowId, plan_version: args.planVersion };
  for (let n = 0; n < MAX_CREATOR_ROW_RECLAIM_ATTEMPTS; n++) {
    const referenceId = n === 0 ? identity : `${identity}:r${n}`;
    const r = await executeWithEntryConsumption<T>({
      userId:              String(args.userId ?? companyId),
      orgId:               companyId,
      action:              CREATOR_ROW_ACTION,
      referenceType:       CREATOR_ROW_REFERENCE_TYPE,
      referenceId,
      idempotencyKey:      makeIdempotencyKey(companyId, CREATOR_ROW_ACTION, referenceId),
      validateMembership:  false,
      llmPricing: {
        provider: 'openai',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        actionKey: CREATOR_ROW_ACTION,
        maxInputTokens: 8000 * CREATOR_ROW_UNIT_CALLS,
        maxOutputTokens: 2000 * CREATOR_ROW_UNIT_CALLS,
      },
      collectViaCollector: true,
      executor:            args.generate,
    });
    switch (r.status) {
      case 'executed':
        return {
          billed: true, reused: false, output: r.result as T,
          stash: { plan_version: args.planVersion, reference_id: referenceId, output: r.result as unknown as Record<string, unknown> },
        };
      case 'already_released':
        continue; // that attempt failed uncharged - next slot
      case 'already_settled':
        logger.error('creator_row_charged_no_output', { ...ctx, referenceId });
        emitAnomaly({
          kind: 'charged_no_output', severity: 'critical', organizationId: companyId,
          message: 'creator row generation was charged but its output is not on the row - not re-run, not re-charged',
          metadata: { ...ctx, reference_id: referenceId, surface: CREATOR_ROW_SURFACE },
        });
        throw new CreatorRowBillingRefusedError('CHARGED_NO_OUTPUT', false,
          `creator row billing refused: CHARGED_NO_OUTPUT (${referenceId} was charged; its output was not stashed)`);
      case 'insufficient_credits':
        throw new CreatorRowBillingRefusedError('INSUFFICIENT_CREDITS', true,
          `creator row billing refused: INSUFFICIENT_CREDITS (required ${(r as any).required}, available ${(r as any).available})`);
      case 'no_credit_account':
        throw new CreatorRowBillingRefusedError('NO_CREDIT_ACCOUNT', false, 'creator row billing refused: NO_CREDIT_ACCOUNT');
      case 'org_control_blocked':
        throw new CreatorRowBillingRefusedError('ORG_CONTROL_BLOCKED', (r as any).code === 'DAILY_LIMIT_EXCEEDED',
          `creator row billing refused: ORG_CONTROL_BLOCKED (${(r as any).code})`);
      case 'not_a_member':
        throw new CreatorRowBillingRefusedError('NOT_A_MEMBER', false, 'creator row billing refused: NOT_A_MEMBER');
      default:
        throw new Error(`creator row billing: unexpected engine status ${(r as any).status}`);
    }
  }
  logger.error('creator_row_reclaim_cap_exhausted', { ...ctx, attempts: MAX_CREATOR_ROW_RECLAIM_ATTEMPTS });
  emitAnomaly({
    kind: 'reclaim_cap_exhausted', severity: 'critical', organizationId: companyId,
    message: 'creator row generation failed on every reclaim slot - nothing charged',
    metadata: { ...ctx, surface: CREATOR_ROW_SURFACE, attempts: MAX_CREATOR_ROW_RECLAIM_ATTEMPTS },
  });
  throw new CreatorRowBillingRefusedError('RECLAIM_CAP_EXHAUSTED', false,
    `creator row billing refused: RECLAIM_CAP_EXHAUSTED (${MAX_CREATOR_ROW_RECLAIM_ATTEMPTS} uncharged failed attempts for ${identity})`);
}
