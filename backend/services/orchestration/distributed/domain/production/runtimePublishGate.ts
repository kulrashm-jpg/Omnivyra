/**
 * Phase 27B.1 — Runtime Publish Gate.
 *
 * SINGLE chokepoint for any provider publish that the durable distributed
 * runtime can drive. Replaces ad-hoc "call adapter then write
 * platform_post_id" sequences with a transactional, replay-safe gate that:
 *
 *   1. SELECT platform_post_id ... FOR UPDATE under the caller-supplied
 *      transaction client.
 *   2. If already populated → short-circuit (no adapter call), emit
 *      duplicate-suppression telemetry, return { outcome: 'duplicate', ... }.
 *   3. Otherwise → call adapter, persist platform_post_id, commit atomically.
 *
 * GUARANTEES:
 *   - Distributed-safe locking: the row-level lock is held for the
 *     duration of the adapter call inside the same DB transaction.
 *   - Adapter calls NEVER happen outside the gate.
 *   - Adapter calls NEVER happen on a row whose platform_post_id is
 *     already populated.
 *   - Adapter is untouched — it still receives the same input shape.
 *
 * SCOPE: replay-safe publish gating only. Does NOT manage retries,
 * adapter idempotency, queue dedup, or fingerprint caches — those layers
 * sit AROUND the gate (queue dedup → idempotency governor → fingerprint
 * cache → THIS GATE → adapter).
 *
 * Telemetry:
 *   runtime_publish_gate_started
 *   runtime_publish_gate_duplicate_suppressed
 *   runtime_publish_gate_adapter_called
 *   runtime_publish_gate_completed
 *   runtime_publish_gate_failed
 */

// ────────────────────────────────────────────────────────────────────
// Transaction client contract
// ────────────────────────────────────────────────────────────────────

/**
 * Minimal SQL transaction client. Callers wrap whatever transaction
 * primitive their persistence layer exposes (supabase rpc, pg pool
 * client, knex transaction, etc.) into this shape.
 *
 * `selectForUpdate` MUST issue a row-level lock (e.g. `SELECT ... FOR
 * UPDATE`) on the scheduled_posts row identified by scheduledPostId.
 *
 * `updatePlatformPostId` MUST set platform_post_id only if currently
 * null (defensive against double-update). Returns the count of rows
 * updated.
 */
export interface PublishGateTxClient {
  selectForUpdate(input: {
    scheduledPostId: string;
  }): Promise<{ exists: boolean; platformPostId: string | null }>;
  updatePlatformPostId(input: {
    scheduledPostId: string;
    platformPostId: string;
    publishedAt: Date;
  }): Promise<{ updated: number }>;
}

/**
 * Caller-supplied transactional runner. The body executes inside an
 * open transaction; the runner commits on resolve, rolls back on reject.
 */
export type RunInTransaction = <T>(body: (tx: PublishGateTxClient) => Promise<T>) => Promise<T>;

// ────────────────────────────────────────────────────────────────────
// Adapter contract
// ────────────────────────────────────────────────────────────────────

/**
 * Adapter call signature accepted by the gate. The gate calls the
 * adapter and expects it to return the provider's platform_post_id.
 *
 * Adapters are NOT modified to fit this shape — operators wrap their
 * existing adapter functions inside this signature at boot wiring.
 */
export type GatedAdapterFn = (input: {
  executionId: string;
  provider: string;
  socialAccountId: string;
  scheduledPostId: string;
  contentFingerprint: string;
}) => Promise<{ platformPostId: string }>;

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RuntimePublishGateTelemetryEvent =
  | 'runtime_publish_gate_started'
  | 'runtime_publish_gate_duplicate_suppressed'
  | 'runtime_publish_gate_adapter_called'
  | 'runtime_publish_gate_completed'
  | 'runtime_publish_gate_failed';

export interface RuntimePublishGateTelemetrySink {
  emit(event: RuntimePublishGateTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RuntimePublishGateTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'runtime_publish_gate_failed') console.warn(`[publish_gate] ${line}`);
      else console.log(`[publish_gate] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class RuntimePublishGateError extends Error {
  constructor(
    public readonly code: 'ROW_MISSING' | 'ADAPTER_THREW' | 'UPDATE_LOST' | 'INVALID_INPUT',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[runtimePublishGate] ${code}: ${message}`);
    this.name = 'RuntimePublishGateError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Result shape
// ────────────────────────────────────────────────────────────────────

export type RuntimePublishGateOutcome =
  | { outcome: 'duplicate'; platformPostId: string; suppressed: true }
  | { outcome: 'published'; platformPostId: string; suppressed: false };

export interface RuntimePublishGateInput {
  executionId: string;
  provider: string;
  socialAccountId: string;
  scheduledPostId: string;
  contentFingerprint: string;
  adapter: GatedAdapterFn;
  runInTransaction: RunInTransaction;
  telemetry?: RuntimePublishGateTelemetrySink;
  /** Optional clock override for tests. */
  now?: () => Date;
}

// ────────────────────────────────────────────────────────────────────
// Gate entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Execute a publish through the runtime publish gate. SAFE TO REPLAY.
 *
 * Contract:
 *   - If `scheduled_posts.platform_post_id` is already populated (any
 *     value), the gate returns { outcome: 'duplicate', ... } WITHOUT
 *     calling the adapter.
 *   - Otherwise the gate calls the adapter inside the transaction and
 *     persists the returned platformPostId. If the persist fails
 *     (zero rows updated), the gate raises UPDATE_LOST.
 */
export async function runtimePublishGate(
  input: RuntimePublishGateInput,
): Promise<RuntimePublishGateOutcome> {
  if (!input || typeof input !== 'object') {
    throw new RuntimePublishGateError('INVALID_INPUT', 'input required');
  }
  const required: Array<keyof RuntimePublishGateInput> = [
    'executionId', 'provider', 'socialAccountId', 'scheduledPostId',
    'contentFingerprint', 'adapter', 'runInTransaction',
  ];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      throw new RuntimePublishGateError('INVALID_INPUT', `missing field: ${String(key)}`);
    }
  }
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  const now = input.now ?? (() => new Date());

  const basePayload = {
    executionId: input.executionId,
    provider: input.provider,
    socialAccountId: input.socialAccountId,
    scheduledPostId: input.scheduledPostId,
    contentFingerprint: input.contentFingerprint,
  };
  telemetry.emit('runtime_publish_gate_started', basePayload);

  try {
    return await input.runInTransaction(async (tx) => {
      const lookup = await tx.selectForUpdate({ scheduledPostId: input.scheduledPostId });
      if (!lookup.exists) {
        throw new RuntimePublishGateError(
          'ROW_MISSING',
          `scheduled_post ${input.scheduledPostId} not found`,
        );
      }
      if (lookup.platformPostId && lookup.platformPostId.length > 0) {
        telemetry.emit('runtime_publish_gate_duplicate_suppressed', {
          ...basePayload,
          platformPostId: lookup.platformPostId,
        });
        telemetry.emit('runtime_publish_gate_completed', {
          ...basePayload,
          outcome: 'duplicate',
          platformPostId: lookup.platformPostId,
        });
        return {
          outcome: 'duplicate',
          platformPostId: lookup.platformPostId,
          suppressed: true,
        } as RuntimePublishGateOutcome;
      }

      telemetry.emit('runtime_publish_gate_adapter_called', basePayload);
      let adapterResult: { platformPostId: string };
      try {
        adapterResult = await input.adapter({
          executionId: input.executionId,
          provider: input.provider,
          socialAccountId: input.socialAccountId,
          scheduledPostId: input.scheduledPostId,
          contentFingerprint: input.contentFingerprint,
        });
      } catch (err) {
        telemetry.emit('runtime_publish_gate_failed', {
          ...basePayload,
          phase: 'adapter',
          error: (err as Error)?.message ?? String(err),
        });
        throw new RuntimePublishGateError(
          'ADAPTER_THREW',
          `adapter for '${input.provider}' threw: ${(err as Error)?.message ?? String(err)}`,
          err,
        );
      }
      if (!adapterResult || !adapterResult.platformPostId) {
        throw new RuntimePublishGateError(
          'ADAPTER_THREW',
          `adapter for '${input.provider}' returned no platformPostId`,
        );
      }

      const updateRes = await tx.updatePlatformPostId({
        scheduledPostId: input.scheduledPostId,
        platformPostId: adapterResult.platformPostId,
        publishedAt: now(),
      });
      if (updateRes.updated !== 1) {
        // Defense-in-depth: should be impossible because we hold the
        // row lock. If the row was deleted mid-transaction or the
        // SET clause filtered it out, surface as UPDATE_LOST so the
        // queue retry policy doesn't blindly call the adapter again.
        throw new RuntimePublishGateError(
          'UPDATE_LOST',
          `expected 1 row updated, got ${updateRes.updated}`,
        );
      }

      telemetry.emit('runtime_publish_gate_completed', {
        ...basePayload,
        outcome: 'published',
        platformPostId: adapterResult.platformPostId,
      });
      return {
        outcome: 'published',
        platformPostId: adapterResult.platformPostId,
        suppressed: false,
      } as RuntimePublishGateOutcome;
    });
  } catch (err) {
    if (err instanceof RuntimePublishGateError) {
      if (err.code !== 'ADAPTER_THREW') {
        telemetry.emit('runtime_publish_gate_failed', {
          ...basePayload,
          phase: 'gate',
          code: err.code,
          error: err.message,
        });
      }
      throw err;
    }
    telemetry.emit('runtime_publish_gate_failed', {
      ...basePayload,
      phase: 'transaction',
      error: (err as Error)?.message ?? String(err),
    });
    throw err;
  }
}
