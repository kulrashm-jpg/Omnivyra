/**
 * PI-C1 Phase 1 (B21) — classifying an append-only lifecycle-guard refusal.
 *
 * Two append-only guards protect lifecycle evidence, and they raise DIFFERENT
 * SQLSTATEs:
 *
 *   • `opportunity_lifecycle_states` — `trg_opp_lifecycle_block_mutation`
 *     declares no ERRCODE, so it raises plpgsql's default **P0001**.
 *   • `prospect_lifecycle_transitions` — `trg_prospect_lifecycle_guard`
 *     declares **ERRCODE = '42501'`** (`insufficient_privilege`).
 *
 * Both were observed directly against real PostgreSQL with the migrations
 * replayed (PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001 §17: every probe on the
 * Community table returned `P0001 :: opportunity_lifecycle_states is
 * append-only`).
 *
 * Why this cannot be a bare code comparison in either direction:
 *
 *   • **P0001 is anonymous.** It is the catch-all for `RAISE EXCEPTION`
 *     without an ERRCODE, so a bare `code === 'P0001'` test would classify
 *     any unrelated plpgsql raise as a lifecycle refusal.
 *   • **42501 is overloaded.** It is `insufficient_privilege`, and this
 *     repository already classifies it as a *permission* failure elsewhere
 *     (`attributionResolverService.ts`). Treating every 42501 as an
 *     append-only violation would hide genuine authorization errors; treating
 *     an append-only violation as a permission error would send a caller down
 *     a credential or step-up path for a condition that is really immutability.
 *
 * So a refusal is recognised only when the SQLSTATE is one of the two AND the
 * message carries the guards' own marker. Everything else is left alone — in
 * particular a 42501 with no marker stays a plain authorization error, which
 * `isAuthorizationRefusal` names explicitly so callers can keep the two apart.
 *
 * This module classifies. It does not retry, swallow, or re-raise, and it
 * does not change any trigger: the guards are the authority and a refusal is
 * always final for the statement that provoked it.
 */

/** The guards' own wording. Both raise a message containing this phrase. */
const APPEND_ONLY_MARKER = /append-only/i;

/** SQLSTATEs either guard can raise. Neither is exclusive to a guard. */
const GUARD_SQLSTATES = new Set(['P0001', '42501']);

export type LifecycleGuardRefusal = {
  kind: 'append_only_violation';
  /** The raw SQLSTATE, preserved: P0001 and 42501 are NOT made equivalent. */
  sqlstate: string;
  message: string;
};

const sqlstateOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : '';
};

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : '';
};

/**
 * An append-only guard refusal, or `null` when the error is something else.
 *
 * Returning the SQLSTATE rather than discarding it is deliberate: the two
 * codes are mapped to one APPLICATION class, and they remain distinguishable
 * in telemetry and in tests.
 */
export function classifyLifecycleGuardError(error: unknown): LifecycleGuardRefusal | null {
  const sqlstate = sqlstateOf(error);
  if (!GUARD_SQLSTATES.has(sqlstate)) return null;
  const message = messageOf(error);
  if (!APPEND_ONLY_MARKER.test(message)) return null;
  return { kind: 'append_only_violation', sqlstate, message };
}

/**
 * A genuine authorization refusal: `42501` WITHOUT the append-only marker.
 *
 * Kept separate so that hardening one path never silently reclassifies the
 * other. An append-only violation is never an authorization failure, and a
 * permission denial is never a lifecycle-integrity problem.
 */
export function isAuthorizationRefusal(error: unknown): boolean {
  return sqlstateOf(error) === '42501' && !APPEND_ONLY_MARKER.test(messageOf(error));
}
