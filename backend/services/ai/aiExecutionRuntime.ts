/**
 * CAMPAIGN-IMPL-005 — the canonical AI execution runtime.
 *
 * ONE lifecycle for every interactive AI surface:
 *
 *   REQUESTED → RESERVATION_CREATED → EXECUTING → PERSISTING → COMPLETED
 *
 * built as a thin composition over the EXISTING bank-grade seams
 * (executeWithCredits / executeWithEntryConsumption — never bypassed, never
 * reimplemented) plus the result store. What it adds, in one place:
 *
 *  RESUME  — `already_settled` / `already_confirmed` are CONTINUATION
 *            states, not failures. The stored result is returned with no
 *            new charge and no new LLM call. If the charge settled but no
 *            result was stored (legacy settlement, or a persist failure),
 *            the work re-runs UNCHARGED — the user paid once, the user
 *            gets their artifact.
 *  RETRY   — `already_released` means the prior attempt refunded; one
 *            deterministic re-entry runs with a derived key (same logical
 *            request retried → same derived key → still deduped).
 *  LANGUAGE— internal billing vocabulary NEVER escapes. Blocked outcomes
 *            carry a user-facing message + HTTP status; continuation is
 *            invisible to the user (mandate: a resumed generation should
 *            feel like nothing happened).
 *
 * Terminal (blocking) states — the ONLY ones that stop execution:
 *   insufficient_credits · no_credit_account · not_a_member ·
 *   org_control_blocked. Everything else resumes.
 */

import {
  executeWithCredits,
  executeWithEntryConsumption,
  makeIdempotencyKey,
} from '../creditExecutionService';
import { getCreditEconomyExecutionMode } from '../billing/creditEconomyActivation';
import { loadAiExecutionResult, saveAiExecutionResult } from './aiExecutionResultStore';

/* ── Outcome model ── */

export interface AiExecutionCompleted<T> {
  status: 'completed';
  result: T;
  /** True when this response came from resume (stored result or uncharged
   *  re-run) rather than a fresh billed execution. Callers may log it;
   *  they must not surface it as an error. */
  resumed: boolean;
  charged: boolean;
}

export type AiBlockedCode =
  | 'insufficient_credits'
  | 'no_credit_account'
  | 'not_authorized'
  | 'org_blocked';

export interface AiExecutionBlocked {
  status: 'blocked';
  code: AiBlockedCode;
  httpStatus: 402 | 403;
  /** Safe for direct display. No billing vocabulary, ever. */
  userMessage: string;
  required?: number;
  available?: number;
}

export type AiExecutionOutcome<T> = AiExecutionCompleted<T> | AiExecutionBlocked;

export const AI_BLOCKED_MESSAGES: Record<AiBlockedCode, string> = {
  insufficient_credits: 'Not enough credits to run this AI action. Add credits and try again.',
  no_credit_account: 'Your organization has no credit account yet. Contact your administrator.',
  not_authorized: 'You do not have access to run AI actions for this organization.',
  org_blocked: 'AI actions are currently disabled for your organization.',
};

function blocked(code: AiBlockedCode, extra: { required?: number; available?: number } = {}): AiExecutionBlocked {
  return {
    status: 'blocked',
    code,
    httpStatus: code === 'not_authorized' || code === 'org_blocked' ? 403 : 402,
    userMessage: AI_BLOCKED_MESSAGES[code],
    ...extra,
  };
}

/** Typed error for chokepoints that must throw (runBilledAiCompletion). The
 *  message IS the user message — safe to surface verbatim. */
export class AiBillingBlockedError extends Error {
  readonly httpStatus: 402 | 403;
  readonly code: AiBlockedCode;
  constructor(b: AiExecutionBlocked) {
    super(b.userMessage);
    this.name = 'AiBillingBlockedError';
    this.httpStatus = b.httpStatus;
    this.code = b.code;
  }
}

/* ── The runtime ── */

export interface RunAiExecutionArgs<T> {
  userId: string;
  companyId: string;
  action: string;
  module: string;
  referenceType: string;
  /** Deterministic LOGICAL identity of this request. Must include the
   *  finest-grained target the user acts on (slot id, activity id, asset
   *  id…) — never just company/topic. Same logical request → same id →
   *  resume; different target → different id → independent execution. */
  referenceId: string;
  /** Salt for key derivation (operation family, e.g. 'workspace-content'). */
  salt: string;
  amountOverride?: number;
  note?: string;
  /** 'credits' = executeWithCredits; 'entry-auto' = consult the credit
   *  economy mode per org (the pattern the workspace routes already use). */
  billing?: 'credits' | 'entry-auto';
  executor: () => Promise<T>;
  /** Persist the result for resume (default true). Disable only for
   *  outputs that must never be stored. */
  persistResult?: boolean;
}

const CONTINUATION_STATUSES = new Set(['already_settled', 'already_confirmed', 'already_released']);

export function makeAiOperationKey(args: Pick<RunAiExecutionArgs<unknown>, 'userId' | 'action' | 'referenceId' | 'salt'>): string {
  return makeIdempotencyKey(args.userId, args.action, args.referenceId, args.salt);
}

export async function runAiExecution<T>(args: RunAiExecutionArgs<T>): Promise<AiExecutionOutcome<T>> {
  const persist = args.persistResult !== false;
  const rootKey = makeAiOperationKey(args);

  // REQUESTED — a stored result means this logical request already
  // COMPLETED once; return it. Covers double-click-after-completion,
  // browser refresh, response-lost retries. Zero charge, zero LLM.
  if (persist) {
    const stored = await loadAiExecutionResult<T>(rootKey);
    if (stored) return { status: 'completed', result: stored.payload, resumed: true, charged: false };
  }

  // RESERVATION_CREATED → EXECUTING → (ledger CONFIRM) via the existing seams.
  const attempt = async (key: string) => {
    const common = {
      userId: args.userId,
      orgId: args.companyId,
      action: args.action as never,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      idempotencyKey: key,
      ...(args.amountOverride != null ? { amountOverride: args.amountOverride } : {}),
      note: args.note ?? args.salt,
      executor: args.executor,
    };
    if (args.billing === 'entry-auto') {
      const mode = await getCreditEconomyExecutionMode({ organizationId: args.companyId, surface: `ai-runtime:${args.action}` });
      return mode === 'enforce'
        ? executeWithEntryConsumption<T>(common as never)
        : executeWithCredits<T>(common as never);
    }
    return executeWithCredits<T>(common as never);
  };

  const settle = async (result: T, charged: boolean, resumed: boolean): Promise<AiExecutionOutcome<T>> => {
    // PERSISTING — best-effort; a failed save never fails the request.
    if (persist) {
      await saveAiExecutionResult({
        idempotencyKey: rootKey,
        action: args.action,
        organizationId: args.companyId,
        actorUserId: args.userId,
        module: args.module,
        payload: result,
      });
    }
    // COMPLETED
    return { status: 'completed', result, resumed, charged };
  };

  const outcome = await attempt(rootKey);

  if (outcome.status === 'executed') return settle(outcome.result, true, false);

  if (CONTINUATION_STATUSES.has(outcome.status)) {
    if (outcome.status === 'already_released') {
      // Prior attempt refunded — this is a fresh billable attempt, keyed
      // deterministically so ITS retries still dedupe.
      const retry = await attempt(makeIdempotencyKey(args.userId, args.action, args.referenceId, `${args.salt}:r1`));
      if (retry.status === 'executed') return settle(retry.result, true, false);
      if (!CONTINUATION_STATUSES.has(retry.status)) return mapBlocked(retry);
      // The retry key itself already settled — fall through to resume.
    }
    // The charge is settled. Recover the artifact: stored result first
    // (race with a concurrent completer), else UNCHARGED re-run — the
    // established phase2RouteWiring precedent. The user paid once.
    if (persist) {
      const stored = await loadAiExecutionResult<T>(rootKey);
      if (stored) return { status: 'completed', result: stored.payload, resumed: true, charged: false };
    }
    const rerun = await args.executor();
    return settle(rerun, false, true);
  }

  return mapBlocked(outcome);
}

function mapBlocked<T>(outcome: { status: string; required?: number; available?: number }): AiExecutionOutcome<T> {
  switch (outcome.status) {
    case 'insufficient_credits':
      return blocked('insufficient_credits', { required: outcome.required, available: outcome.available });
    case 'no_credit_account':
      return blocked('no_credit_account');
    case 'not_a_member':
      return blocked('not_authorized');
    case 'org_control_blocked':
      return blocked('org_blocked');
    default:
      // Unknown future status — fail CLOSED with user language, never leak.
      return blocked('org_blocked');
  }
}
