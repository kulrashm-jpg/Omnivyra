/**
 * Token-actual billing for an HTTP route whose AI work is MULTI-CALL (owner ruling via e9, 2026-11-13: hold the
 * prescribed price, settle by ACTUAL consumption, release the remainder when stopped part-way). Sanctioned wrapper
 * (e1): executeWithEntryConsumption({ collectViaCollector: true }) - every provider call inside the executor lands
 * in the engine's usage scope and the SUM of their tokens is settled.
 *
 * DOUBLY DARK (e1): the path is billed only when getCreditEconomyExecutionMode(...) === 'enforce', i.e. the
 * PHASE2_ENTRY_CONSUMPTION master switch AND the org's enforcement gate for `surface`. Otherwise this returns
 * { kind: 'legacy' } and the caller runs its existing path unchanged.
 *
 * Identity: the http idempotency key (actor + action + referenceId + body / Idempotency-Key header), with a RELEASED
 * attempt reclaimed under the next attempt root (resolveHttpAttemptRoot over the engine's EXPOSURE keys) so a failed
 * attempt never locks the identical retry out; a settled attempt still dedups (already_settled -> no second charge).
 *
 * Credit handle: the engine does not set one, so the executor runs inside runWithCreditHandle for this org - every
 * gateway call inside it passes the AI billing guard (BILLING_REQUIRE_AI_HANDLE=true), including nested calls that
 * carry the same companyId.
 */
import { buildBillingIdempotencyKey, resolveHttpAttemptRoot } from './billingIdempotencyService';
import { runWithCreditHandle } from './aiGatewayBillingGuard';
import { getCreditEconomyExecutionMode } from './creditEconomyActivation';
import { executeWithEntryConsumption, type ExecuteWithEntryConsumptionResult } from '../creditExecutionServiceRuntimeEntry';
import { findCreditTransaction } from '../../repositories/creditExecutionRepository';
import type { LlmPricingSpec } from '../creditExecutionServiceContracts';
import type { CreditAction } from '../creditDeductionService';
import { getTotalAvailable } from '../creditPriorityService';
import { resolveActivityEconomics } from '../activityEconomyCatalog';

export type EntryConsumptionHttpOutcome<T> =
  | { kind: 'legacy' }
  | { kind: 'billed'; result: ExecuteWithEntryConsumptionResult<T> };

/** The engine's stage keys for one attempt root (creditExecutionServiceRuntimeEntry: `${key}:exposure`). */
export function entryConsumptionAttemptKeys(attemptRoot: string): { confirm: string; release: string } {
  return { confirm: `${attemptRoot}:exposure:confirm`, release: `${attemptRoot}:exposure:release` };
}

export async function runEntryConsumptionForHttp<T>(args: {
  surface: string;
  actorUserId: string;
  orgId: string;
  action: CreditAction;
  referenceType: string;
  referenceId: string;
  requestBody: unknown;
  requestHeaderIdempotency?: string;
  llmPricing: LlmPricingSpec;
  note?: string;
  executor: () => Promise<T>;
}): Promise<EntryConsumptionHttpOutcome<T>> {
  const { root } = buildBillingIdempotencyKey({
    kind: 'http',
    actorUserId: args.actorUserId,
    action: args.action,
    referenceId: args.referenceId,
    requestBody: args.requestBody,
    requestHeaderIdempotency: args.requestHeaderIdempotency,
  });
  return runEntryConsumptionBilled({ ...args, identityRoot: root });
}

/**
 * The same, with an EXPLICIT identity root (e.g. the interactive planner's pollKey, shared by the inline and worker
 * paths). A RELEASED attempt under that root is reclaimed exactly as for http identities.
 */
export async function runEntryConsumptionBilled<T>(args: {
  surface: string;
  actorUserId: string;
  orgId: string;
  action: CreditAction;
  referenceType: string;
  referenceId: string;
  identityRoot: string;
  llmPricing: LlmPricingSpec;
  note?: string;
  executor: () => Promise<T>;
}): Promise<EntryConsumptionHttpOutcome<T>> {
  const mode = await getCreditEconomyExecutionMode({ organizationId: args.orgId, surface: args.surface });
  if (mode !== 'enforce') return { kind: 'legacy' };

  const attemptRoot = await resolveHttpAttemptRoot(args.identityRoot, findCreditTransaction, entryConsumptionAttemptKeys);

  const result = await executeWithEntryConsumption<T>({
    userId: args.actorUserId,
    orgId: args.orgId,
    action: args.action,
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    idempotencyKey: attemptRoot,
    note: args.note,
    llmPricing: args.llmPricing,
    collectViaCollector: true,
    executor: () => runWithCreditHandle(
      { operationId: `entry:${attemptRoot}`, idempotencyKey: attemptRoot, orgId: args.orgId, action: args.action, source: 'http' },
      args.executor,
    ),
  });
  return { kind: 'billed', result };
}

/**
 * NON-RESERVING pre-check for work that will be billed LATER (e.g. a queued job): when the path is enforced and the
 * balance is below the activity's max exposure - the engine's own admission rule - returns the shared 402 refusal.
 * The worker stays the authority (the balance can change while queued). null = proceed.
 */
export async function precheckEntryConsumption(args: {
  surface: string;
  orgId: string;
  action: CreditAction;
}): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const mode = await getCreditEconomyExecutionMode({ organizationId: args.orgId, surface: args.surface });
  if (mode !== 'enforce') return null;
  const required = resolveActivityEconomics(args.action).maximumCredits;
  const available = (await getTotalAvailable(args.orgId)) ?? 0;
  if (available >= required) return null;
  return { status: 402, body: { error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required, balance: available } };
}

/** Non-executed outcomes -> the SHARED billed-response shape (e9 2026-11-13). null for 'executed'. */
export function entryConsumptionHttpError(
  result: ExecuteWithEntryConsumptionResult<unknown>,
): { status: number; body: Record<string, unknown> } | null {
  switch (result.status) {
    case 'executed':
      return null;
    case 'insufficient_credits':
      return { status: 402, body: { error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: result.required, balance: result.available } };
    case 'no_credit_account':
      return { status: 402, body: { error: 'No credit account for org', code: 'NO_CREDIT_ACCOUNT' } };
    case 'not_a_member':
      return { status: 403, body: { error: 'ORG_SCOPE_VIOLATION' } };
    case 'org_control_blocked':
      return { status: 403, body: { error: result.code, detail: result.reason } };
    case 'already_settled':
      return { status: 409, body: { error: 'This request was already processed.', code: 'ALREADY_PROCESSED' } };
    case 'already_released':
      return { status: 409, body: { error: 'An earlier attempt of this request failed and was not charged. Please try again.', code: 'ALREADY_RELEASED' } };
  }
}
