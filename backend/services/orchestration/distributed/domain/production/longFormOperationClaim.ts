/**
 * Phase 27B.2 — Long-form operation claim helper.
 *
 * Distributed-safe single-winner claim for long-form generation. The
 * goal is to prevent token burn / duplicate writes when:
 *   - the durable runtime replays a long-form workflow
 *   - the cron path AND the runtime path both attempt the same operation
 *   - two instances race on the same operation_key
 *
 * MECHANIC:
 *   `INSERT INTO long_form_operations (operation_key, status, started_at,
 *    metadata_json) VALUES ($key, 'in_flight', now(), $meta)
 *    ON CONFLICT (operation_key) DO NOTHING RETURNING ...`
 *
 *   The single statement is atomic. Exactly one caller observes a
 *   row-returned outcome → "winner". All other concurrent callers
 *   observe zero rows → "loser" and read the existing row to return
 *   its result_row_id.
 *
 * GUARANTEES:
 *   - Replay-safe generation: replays see the existing row and
 *     short-circuit with `outcome: 'duplicate'`.
 *   - Token-burn prevention: only the winner calls into the AI gateway.
 *   - Deterministic regeneration suppression: same operation_key →
 *     same answer (read back the existing result_row_id).
 *   - Distributed-safe claiming: ON CONFLICT is fully atomic.
 *
 * SCOPE: claim arbitration + result lookup ONLY. Does NOT manage retries,
 * stale-claim recovery (a separate sweeper handles that), or migration
 * application. Callers wire the actual orchestration around the claim.
 */

// ────────────────────────────────────────────────────────────────────
// SQL contract
// ────────────────────────────────────────────────────────────────────

/**
 * Minimal SQL client. Callers wrap whatever DB driver they use
 * (supabase rpc, pg pool, knex) into this shape. Keeping the contract
 * narrow so the substrate stays driver-agnostic.
 */
export interface LongFormClaimSqlClient {
  /**
   * Attempt the atomic insert. MUST execute the equivalent of:
   *   INSERT INTO long_form_operations
   *     (operation_key, status, started_at, metadata_json)
   *   VALUES ($key, 'in_flight', $now, $meta)
   *   ON CONFLICT (operation_key) DO NOTHING
   *   RETURNING operation_key;
   *
   * Returns { inserted: true } when the row was inserted (winner) or
   * { inserted: false } when the conflict suppressed the insert (loser).
   */
  insertIfAbsent(input: {
    operationKey: string;
    startedAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<{ inserted: boolean }>;

  /**
   * Read back the current row state for the key. Used by losers to
   * return the existing result. Returns null when the row is missing
   * (should not happen post-insert; surfaces as RACE_LOST).
   */
  read(input: { operationKey: string }): Promise<LongFormOperationRow | null>;

  /**
   * Mark an in-flight row as completed. Idempotent: safe to call
   * multiple times.
   */
  markCompleted(input: {
    operationKey: string;
    completedAt: Date;
    resultRowId: string;
  }): Promise<void>;

  /**
   * Mark an in-flight row as failed. Increments attempt_count and
   * records last_error. Idempotent.
   */
  markFailed(input: {
    operationKey: string;
    completedAt: Date;
    lastError: string;
  }): Promise<void>;
}

export type LongFormOperationStatus = 'in_flight' | 'completed' | 'failed';

export interface LongFormOperationRow {
  operationKey: string;
  status: LongFormOperationStatus;
  startedAt: Date;
  completedAt: Date | null;
  resultRowId: string | null;
  lastError: string | null;
  attemptCount: number;
  metadata: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type LongFormClaimTelemetryEvent =
  | 'long_form_claim_started'
  | 'long_form_claim_won'
  | 'long_form_claim_lost_duplicate'
  | 'long_form_claim_completed'
  | 'long_form_claim_failed'
  | 'long_form_claim_collision_detected';

export interface LongFormClaimTelemetrySink {
  emit(event: LongFormClaimTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: LongFormClaimTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'long_form_claim_failed' || event === 'long_form_claim_collision_detected') {
        console.warn(`[long_form_claim] ${line}`);
      } else {
        console.log(`[long_form_claim] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class LongFormClaimError extends Error {
  constructor(
    public readonly code: 'RACE_LOST' | 'INVALID_INPUT' | 'SQL_ERROR',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[longFormOperationClaim] ${code}: ${message}`);
    this.name = 'LongFormClaimError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export type ClaimLongFormOperationOutcome =
  | { outcome: 'won'; operationKey: string }
  | { outcome: 'duplicate'; operationKey: string; existing: LongFormOperationRow };

export interface ClaimLongFormOperationInput {
  operationKey: string;
  sql: LongFormClaimSqlClient;
  metadata?: Record<string, unknown>;
  telemetry?: LongFormClaimTelemetrySink;
  /** Optional clock override for tests. */
  now?: () => Date;
}

/**
 * Attempt to claim the operation. Replay-safe: callers MUST branch on
 * the outcome and only proceed with orchestration when `outcome === 'won'`.
 */
export async function claimLongFormOperation(
  input: ClaimLongFormOperationInput,
): Promise<ClaimLongFormOperationOutcome> {
  if (!input || !input.operationKey || !input.sql) {
    throw new LongFormClaimError('INVALID_INPUT', 'operationKey + sql required');
  }
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const metadata = input.metadata ?? {};

  telemetry.emit('long_form_claim_started', {
    operationKey: input.operationKey,
    startedAtIso: startedAt.toISOString(),
  });

  let inserted: boolean;
  try {
    const res = await input.sql.insertIfAbsent({
      operationKey: input.operationKey,
      startedAt,
      metadata,
    });
    inserted = res.inserted;
  } catch (err) {
    telemetry.emit('long_form_claim_failed', {
      operationKey: input.operationKey,
      phase: 'insertIfAbsent',
      error: (err as Error)?.message ?? String(err),
    });
    throw new LongFormClaimError(
      'SQL_ERROR',
      `insertIfAbsent failed: ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }

  if (inserted) {
    telemetry.emit('long_form_claim_won', {
      operationKey: input.operationKey,
    });
    return { outcome: 'won', operationKey: input.operationKey };
  }

  // Loser path: read the existing row.
  let existing: LongFormOperationRow | null;
  try {
    existing = await input.sql.read({ operationKey: input.operationKey });
  } catch (err) {
    telemetry.emit('long_form_claim_failed', {
      operationKey: input.operationKey,
      phase: 'read',
      error: (err as Error)?.message ?? String(err),
    });
    throw new LongFormClaimError(
      'SQL_ERROR',
      `read failed: ${(err as Error)?.message ?? String(err)}`,
      err,
    );
  }
  if (!existing) {
    // Shouldn't happen: the insert was suppressed by a conflict, so a
    // row exists by definition. Surface as RACE_LOST so the runtime
    // can retry rather than treat this as a duplicate suppression.
    telemetry.emit('long_form_claim_collision_detected', {
      operationKey: input.operationKey,
      reason: 'row_missing_after_conflict',
    });
    throw new LongFormClaimError(
      'RACE_LOST',
      `operation ${input.operationKey} had conflict but read returned null`,
    );
  }

  telemetry.emit('long_form_claim_lost_duplicate', {
    operationKey: input.operationKey,
    existingStatus: existing.status,
    existingResultRowId: existing.resultRowId,
  });
  return { outcome: 'duplicate', operationKey: input.operationKey, existing };
}

/**
 * Mark the winning operation as completed. Idempotent; safe to call
 * during replay-completion. Errors are surfaced so the caller can
 * decide whether to retry or escalate.
 */
export async function markLongFormOperationCompleted(input: {
  operationKey: string;
  resultRowId: string;
  sql: LongFormClaimSqlClient;
  telemetry?: LongFormClaimTelemetrySink;
  now?: () => Date;
}): Promise<void> {
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  const now = input.now ?? (() => new Date());
  try {
    await input.sql.markCompleted({
      operationKey: input.operationKey,
      completedAt: now(),
      resultRowId: input.resultRowId,
    });
    telemetry.emit('long_form_claim_completed', {
      operationKey: input.operationKey,
      resultRowId: input.resultRowId,
    });
  } catch (err) {
    telemetry.emit('long_form_claim_failed', {
      operationKey: input.operationKey,
      phase: 'markCompleted',
      error: (err as Error)?.message ?? String(err),
    });
    throw err;
  }
}

/**
 * Mark the winning operation as failed. Idempotent.
 */
export async function markLongFormOperationFailed(input: {
  operationKey: string;
  lastError: string;
  sql: LongFormClaimSqlClient;
  telemetry?: LongFormClaimTelemetrySink;
  now?: () => Date;
}): Promise<void> {
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  const now = input.now ?? (() => new Date());
  try {
    await input.sql.markFailed({
      operationKey: input.operationKey,
      completedAt: now(),
      lastError: input.lastError,
    });
    telemetry.emit('long_form_claim_failed', {
      operationKey: input.operationKey,
      phase: 'markFailed',
      error: input.lastError,
    });
  } catch (err) {
    telemetry.emit('long_form_claim_failed', {
      operationKey: input.operationKey,
      phase: 'markFailed_persist',
      error: (err as Error)?.message ?? String(err),
    });
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────
// In-memory claim client (dev / tests only)
// ────────────────────────────────────────────────────────────────────

/**
 * In-memory implementation of LongFormClaimSqlClient. Intended for
 * tests and the stress harness ONLY — production callers MUST use the
 * Supabase-backed implementation against `long_form_operations`.
 */
export function createInMemoryLongFormClaimSqlClient(): LongFormClaimSqlClient & {
  __debugRows: () => LongFormOperationRow[];
} {
  const rows = new Map<string, LongFormOperationRow>();

  return {
    async insertIfAbsent({ operationKey, startedAt, metadata }) {
      if (rows.has(operationKey)) return { inserted: false };
      rows.set(operationKey, {
        operationKey,
        status: 'in_flight',
        startedAt,
        completedAt: null,
        resultRowId: null,
        lastError: null,
        attemptCount: 1,
        metadata,
      });
      return { inserted: true };
    },
    async read({ operationKey }) {
      return rows.get(operationKey) ?? null;
    },
    async markCompleted({ operationKey, completedAt, resultRowId }) {
      const row = rows.get(operationKey);
      if (!row) return;
      row.status = 'completed';
      row.completedAt = completedAt;
      row.resultRowId = resultRowId;
    },
    async markFailed({ operationKey, completedAt, lastError }) {
      const row = rows.get(operationKey);
      if (!row) return;
      row.status = 'failed';
      row.completedAt = completedAt;
      row.lastError = lastError;
      row.attemptCount += 1;
    },
    __debugRows() {
      return Array.from(rows.values());
    },
  };
}
