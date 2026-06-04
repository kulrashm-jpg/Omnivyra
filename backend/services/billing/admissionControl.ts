/**
 * Phase 8D — Launch-time ADMISSION CONTROL (read-only, dark by default).
 *
 * Answers one question before an activity starts: can the organization safely
 * cover the activity's MAXIMUM exposure given what it has already committed?
 *
 *   availableCredits   = free + paid + incentive balance (gross spendable)
 *   activeReservations = reserved_free + reserved_paid + reserved_incentive
 *   effectiveCredits   = availableCredits − activeReservations
 *   requiredCredits    = resolveActivityEconomics(activity).maximumCredits
 *   allowed            = effectiveCredits >= requiredCredits        // MAX, not min/entry
 *
 * Properties (Phase 8D guardrails):
 *   • READ-ONLY — getWalletSnapshot only. No ledger write, no wallet mutation,
 *     no reservation, no RPC. Calling it twice is identical and side-effect-free
 *     (replay-safe by construction).
 *   • ENGINE-AGNOSTIC — depends only on the catalog max + wallet, so the verdict
 *     is identical whether the entry-consumption engine or the legacy HOLD(MAX)
 *     engine settles (both reserve up to `maximumCredits` of exposure).
 *   • DARK — `canStartActivity` always returns an HONEST verdict (useful for
 *     shadow telemetry / UI preview). Whether that verdict actually BLOCKS an
 *     execution is gated by PHASE2_ADMISSION_CONTROL (default OFF) at the
 *     enforcement boundary (`assertCanStartActivity`). No call site is wired in
 *     this phase, so production behavior is unchanged.
 */

import { getWalletSnapshot } from '../creditPriorityService';
import { resolveActivityEconomics } from '../activityEconomyCatalog';
import { incrCounter } from './billingMetrics';
import { logger } from '../logger';

export type AdmissionReason = 'ok' | 'insufficient_credits' | 'no_credit_account' | 'unknown_activity';

export interface AdmissionDecision {
  allowed: boolean;
  reason: AdmissionReason;
  availableCredits: number;
  activeReservations: number;
  effectiveCredits: number;
  /** The MAXIMUM exposure the org must be able to cover (not min, not entry). */
  requiredCredits: number;
  /** max(0, requiredCredits − effectiveCredits). 0 when allowed. */
  shortfall: number;
}

const FLAG = 'PHASE2_ADMISSION_CONTROL';

/**
 * Admission rollout mode (Phase 11D). Three states drive the launch-point
 * boundary — the entire rollout is moving this flag, never editing code:
 *   'off'     (default / unset)        — passthrough; NO wallet read, NO observe.
 *   'shadow'                            — evaluate + durably observe; NEVER block.
 *   'enforce' ('enforce'|'true'|'1'|'on') — evaluate + observe + BLOCK on shortfall.
 * 'true' maps to 'enforce' for backward compatibility with the original boolean.
 */
export type AdmissionMode = 'off' | 'shadow' | 'enforce';

export function resolveAdmissionMode(): AdmissionMode {
  const v = String(process.env[FLAG] ?? '').trim().toLowerCase();
  if (v === 'enforce' || v === 'true' || v === '1' || v === 'on') return 'enforce';
  if (v === 'shadow') return 'shadow';
  return 'off';
}

/** Dark rollout switch — default OFF. Gates ENFORCEMENT, not evaluation. */
export function isAdmissionControlEnabled(): boolean {
  return resolveAdmissionMode() === 'enforce';
}

function emit(decision: AdmissionDecision, input: { organizationId: string; activity: string }): void {
  if (decision.allowed) {
    incrCounter('admission_allowed');
  } else {
    incrCounter('admission_blocked');
    if (decision.shortfall > 0) incrCounter('admission_shortfall', decision.shortfall);
  }
  logger.info('admission_evaluated', {
    org: input.organizationId,
    activity: input.activity,
    allowed: decision.allowed,
    reason: decision.reason,
    required: decision.requiredCredits,
    effective: decision.effectiveCredits,
    reservations: decision.activeReservations,
    shortfall: decision.shortfall,
    enforced: isAdmissionControlEnabled(),
  });
}

/**
 * Evaluate launch-time affordability for `activity` against the org's wallet.
 * Read-only; always returns an honest verdict + the full breakdown. Emits
 * observability counters/events. Never mutates anything.
 */
export async function canStartActivity(input: {
  organizationId: string;
  activity: string;
}): Promise<AdmissionDecision> {
  // TASK 2 — required exposure comes from the single economics source.
  let requiredCredits: number;
  try {
    requiredCredits = resolveActivityEconomics(input.activity).maximumCredits;
  } catch {
    const decision: AdmissionDecision = {
      allowed: false,
      reason: 'unknown_activity',
      availableCredits: 0,
      activeReservations: 0,
      effectiveCredits: 0,
      requiredCredits: 0,
      shortfall: 0,
    };
    emit(decision, input);
    return decision;
  }

  const wallet = await getWalletSnapshot(input.organizationId);
  if (!wallet) {
    const decision: AdmissionDecision = {
      allowed: false,
      reason: 'no_credit_account',
      availableCredits: 0,
      activeReservations: 0,
      effectiveCredits: 0,
      requiredCredits,
      shortfall: requiredCredits,
    };
    emit(decision, input);
    return decision;
  }

  const availableCredits   = wallet.free_balance + wallet.paid_balance + wallet.incentive_balance;
  const activeReservations = wallet.reserved_free + wallet.reserved_paid + wallet.reserved_incentive;
  const effectiveCredits   = availableCredits - activeReservations;
  const allowed            = effectiveCredits >= requiredCredits;
  const shortfall          = allowed ? 0 : Math.max(0, requiredCredits - effectiveCredits);

  const decision: AdmissionDecision = {
    allowed,
    reason: allowed ? 'ok' : 'insufficient_credits',
    availableCredits,
    activeReservations,
    effectiveCredits,
    requiredCredits,
    shortfall,
  };
  emit(decision, input);
  return decision;
}

/** Thrown by assertCanStartActivity when admission is enabled AND blocked. */
export class AdmissionBlockedError extends Error {
  public readonly code = 'insufficient_credits' as const;
  constructor(public readonly decision: AdmissionDecision) {
    super(
      `[admission] insufficient_credits — required=${decision.requiredCredits} ` +
      `effective=${decision.effectiveCredits} shortfall=${decision.shortfall}`,
    );
    this.name = 'AdmissionBlockedError';
  }
}

/**
 * Enforcement boundary (TASK 6). Evaluates admission and — ONLY when
 * PHASE2_ADMISSION_CONTROL is ON — throws AdmissionBlockedError on a blocked
 * verdict so execution never starts. When OFF it returns the (honest) decision
 * without blocking, so wiring this in is a no-op until the flag is flipped.
 *
 * Intentionally NOT called from any route/processor in this phase
 * (no enforcement activation).
 */
export async function assertCanStartActivity(input: {
  organizationId: string;
  activity: string;
}): Promise<AdmissionDecision> {
  const decision = await canStartActivity(input);
  if (isAdmissionControlEnabled() && !decision.allowed) {
    throw new AdmissionBlockedError(decision);
  }
  return decision;
}

export interface ActivityAdmissionResult {
  mode: AdmissionMode;
  /** True when a real wallet evaluation ran (mode != off, catalogued activity). */
  evaluated: boolean;
  allowed: boolean;
  decision?: AdmissionDecision;
}

/**
 * Phase 11D — THE single admission boundary every customer-activity launch point
 * calls BEFORE billing / reservations / provider execution. Three clearly
 * separated stages, so a future enforce rollout is a CONFIG change, never a code
 * change at the launch points:
 *
 *   EVALUATION  — canStartActivity (read-only; reuses the one economics + wallet
 *                 + shortfall implementation, never reimplements it).
 *   OBSERVATION — durable 11C admission record (fire-and-forget; replay-safe).
 *   ENFORCEMENT — throw AdmissionBlockedError ONLY in 'enforce' mode (mirrors
 *                 assertCanStartActivity's gate + error).
 *
 * DARK BY DEFAULT: mode 'off' (PHASE2_ADMISSION_CONTROL unset) returns instantly
 * — NO wallet read, NO observation, NO throw — so wiring it into every launch
 * point changes nothing in production. It NEVER throws except the deliberate,
 * flag-gated enforcement block: evaluation/observation failures are swallowed,
 * and an uncatalogued activity (no catalog max to admit against) is treated as
 * not-evaluated rather than a false block.
 */
export async function evaluateActivityAdmission(input: {
  organizationId: string;
  activity: string;
  surface?: string;
  /** Stable per-launch id → replay-safe observation dedupe. */
  referenceId?: string;
}): Promise<ActivityAdmissionResult> {
  const mode = resolveAdmissionMode();
  if (mode === 'off') return { mode, evaluated: false, allowed: true };

  // ── EVALUATION ───────────────────────────────────────────────────────────
  let decision: AdmissionDecision;
  try {
    decision = await canStartActivity({ organizationId: input.organizationId, activity: input.activity });
  } catch {
    return { mode, evaluated: false, allowed: true }; // eval failure never blocks
  }
  // Uncatalogued activity has no max to admit against — never a false block.
  if (decision.reason === 'unknown_activity') return { mode, evaluated: false, allowed: true };

  // ── OBSERVATION (durable, fire-and-forget, replay-safe) ──────────────────
  void import('./creditEconomyObservability')
    .then((m) => m.recordAdmissionObservation({
      activity:         input.activity,
      allowed:          decision.allowed,
      requiredCredits:  decision.requiredCredits,
      effectiveCredits: decision.effectiveCredits,
      shortfall:        decision.shortfall,
      dedupeKey:        input.referenceId ? `adm:${input.surface ?? ''}:${input.referenceId}` : undefined,
    }))
    .catch(() => {});

  // ── ENFORCEMENT (the ONLY throw; gated to 'enforce') ─────────────────────
  if (mode === 'enforce' && !decision.allowed) throw new AdmissionBlockedError(decision);

  return { mode, evaluated: true, allowed: decision.allowed, decision };
}
