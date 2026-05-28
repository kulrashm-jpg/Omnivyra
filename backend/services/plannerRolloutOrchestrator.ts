/**
 * Planner rollout orchestrator.
 *
 * Manages the staged promotion of `PLANNER_ROLLOUT_MODE` through:
 *   legacy → distributed_pools_only → streaming_only →
 *   async_refinement → full_progressive → full_production
 *
 * The rollout state is persisted in Redis so a separate operator process
 * can pause / resume / rollback even after the deciding worker restarts.
 * Each transition emits a structured audit-log event for forensic review.
 *
 * The orchestrator does NOT itself change `process.env` — it writes the
 * target mode to Redis, and `plannerRolloutMode.applyActiveRolloutMode`
 * picks it up on the next planner request via a periodic `pollDesiredMode`
 * sync. This indirection lets a single operator decision propagate to
 * every instance without a redeploy.
 *
 * State transitions:
 *   idle → promoting   (operator called `promote()`)
 *   promoting → in_canary  (canary mode active, gates watching)
 *   in_canary → promoting  (next stage starts after soak)
 *   in_canary → rolled_back (gates tripped OR operator forced rollback)
 *   in_canary → paused     (operator paused; gates still observe but no auto-progress)
 *   paused → promoting     (operator resumed)
 *   any → idle              (rollout finished or aborted)
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import type { PlannerRolloutMode } from './plannerRolloutMode';

export const ROLLOUT_ORDER: PlannerRolloutMode[] = [
  'legacy',
  'distributed_pools_only',
  'streaming_only',
  'async_refinement',
  'full_progressive',
  'full_production',
];

export type RolloutStatus =
  | 'idle'
  | 'promoting'
  | 'in_canary'
  | 'paused'
  | 'rolled_back';

export interface RolloutState {
  /** Mode the cluster should be running right now. Read by
   *  `plannerRolloutMode.applyActiveRolloutMode` and overrides
   *  PLANNER_ROLLOUT_MODE env if Redis is reachable. */
  active_mode: PlannerRolloutMode;
  /** Mode the orchestrator is trying to reach (== active_mode when settled). */
  target_mode: PlannerRolloutMode;
  /** Mode to fall back to if a canary gate trips. Usually the previously
   *  successful mode. */
  rollback_mode: PlannerRolloutMode;
  status: RolloutStatus;
  /** When `status === 'in_canary'`, the canary started at this epoch ms. */
  canary_started_at: number | null;
  /** Soak duration the operator chose for this stage. */
  canary_soak_ms: number;
  /** Last observed transition reason (operator note, gate trip reason, etc.). */
  last_reason: string;
  /** Operator id (super-admin user) that triggered the most recent change. */
  last_operator_id: string | null;
  updated_at: number;
}

const STATE_KEY = 'planner:rollout:state';
const AUDIT_STREAM = 'planner:rollout:audit';
const AUDIT_MAXLEN = 2000;
const FAILURE_DISABLE_THRESHOLD = 5;

let _client: IORedis | null = null;
let _failureCount = 0;

function getRedisOrNull(): IORedis | null {
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-rollout');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('planner_rollout_redis_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function defaultState(): RolloutState {
  return {
    active_mode: 'legacy',
    target_mode: 'legacy',
    rollback_mode: 'legacy',
    status: 'idle',
    canary_started_at: null,
    canary_soak_ms: 24 * 60 * 60_000,
    last_reason: 'initial',
    last_operator_id: null,
    updated_at: Date.now(),
  };
}

async function readState(): Promise<RolloutState> {
  const client = getRedisOrNull();
  if (!client) return defaultState();
  try {
    const raw = await client.get(STATE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<RolloutState>;
    return { ...defaultState(), ...parsed };
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_rollout_state_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return defaultState();
  }
}

async function writeState(next: RolloutState, reason: string, operatorId: string | null): Promise<RolloutState> {
  const client = getRedisOrNull();
  const stamped: RolloutState = {
    ...next,
    last_reason: reason,
    last_operator_id: operatorId,
    updated_at: Date.now(),
  };
  if (!client) {
    logger.warn('planner_rollout_state_write_skipped_no_redis', { state: stamped });
    return stamped;
  }
  try {
    await client.set(STATE_KEY, JSON.stringify(stamped));
    await client.xadd(
      AUDIT_STREAM,
      'MAXLEN', '~', String(AUDIT_MAXLEN),
      '*',
      'ts', String(Date.now()),
      'status', stamped.status,
      'active_mode', stamped.active_mode,
      'target_mode', stamped.target_mode,
      'rollback_mode', stamped.rollback_mode,
      'reason', reason,
      'operator_id', operatorId ?? 'system',
      'request_id', getRequestContext().requestId ?? '',
    );
    logger.info('planner_rollout_state_transition', {
      request_id: getRequestContext().requestId,
      operator_id: operatorId,
      reason,
      state: stamped,
    });
  } catch (err) {
    _failureCount += 1;
    logger.warn('planner_rollout_state_write_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return stamped;
}

export interface PromoteOptions {
  operatorId: string;
  /** Override the default canary soak (default 24h). */
  canarySoakMs?: number;
  /** Skip the staged path and jump directly to `targetMode` — for
   *  emergency promotions only. Bypasses ordering checks. */
  force?: boolean;
  targetMode?: PlannerRolloutMode;
  reason?: string;
}

/**
 * Promote the cluster ONE step forward (or to `targetMode` when `force`).
 *
 * Behavior:
 *   - From `idle`: starts a canary at the next mode in `ROLLOUT_ORDER`.
 *   - From `in_canary`: advances to the next mode IF soak elapsed.
 *   - From `paused`: refuses unless `force=true` (operator should call resume()).
 *   - From `rolled_back`: refuses unless `force=true` (operator should call
 *     reset() to ack the rollback first).
 *
 * Returns the new state. NEVER throws — all errors return the current state
 * with an updated `last_reason`.
 */
export async function promote(opts: PromoteOptions): Promise<RolloutState> {
  const cur = await readState();
  const idx = ROLLOUT_ORDER.indexOf(cur.active_mode);
  let target: PlannerRolloutMode;
  if (opts.force && opts.targetMode) {
    target = opts.targetMode;
  } else {
    if (idx < 0 || idx + 1 >= ROLLOUT_ORDER.length) {
      return writeState({ ...cur, status: cur.status }, 'cannot_promote_already_at_max', opts.operatorId);
    }
    target = ROLLOUT_ORDER[idx + 1];
  }
  if (cur.status === 'rolled_back' && !opts.force) {
    return writeState(cur, 'refused_promote_during_rolled_back', opts.operatorId);
  }
  if (cur.status === 'paused' && !opts.force) {
    return writeState(cur, 'refused_promote_during_paused', opts.operatorId);
  }
  if (cur.status === 'in_canary' && !opts.force) {
    if (!canSoakElapsed(cur)) {
      return writeState(cur, 'refused_promote_soak_not_elapsed', opts.operatorId);
    }
  }
  const soakMs = Math.max(60_000, opts.canarySoakMs ?? cur.canary_soak_ms);
  const next: RolloutState = {
    ...cur,
    active_mode: target,
    target_mode: target,
    rollback_mode: opts.force ? cur.rollback_mode : cur.active_mode,
    status: 'in_canary',
    canary_started_at: Date.now(),
    canary_soak_ms: soakMs,
    last_reason: opts.reason ?? 'promoted',
    last_operator_id: opts.operatorId,
    updated_at: Date.now(),
  };
  return writeState(next, opts.reason ?? 'promoted', opts.operatorId);
}

export interface RollbackOptions {
  operatorId: string;
  reason: string;
  /** Override the rollback target (defaults to `state.rollback_mode`). */
  targetMode?: PlannerRolloutMode;
}

/**
 * Roll back to `state.rollback_mode` (or `opts.targetMode`). Sets status to
 * `rolled_back` so subsequent `promote()` calls refuse until `reset()`.
 *
 * Safe to call from any state. Auto-triggered by canary gates.
 */
export async function rollback(opts: RollbackOptions): Promise<RolloutState> {
  const cur = await readState();
  const target = opts.targetMode ?? cur.rollback_mode;
  const next: RolloutState = {
    ...cur,
    active_mode: target,
    target_mode: target,
    status: 'rolled_back',
    canary_started_at: null,
    last_reason: opts.reason,
    last_operator_id: opts.operatorId,
    updated_at: Date.now(),
  };
  return writeState(next, opts.reason, opts.operatorId);
}

/**
 * Pause an in-progress canary. The active_mode stays where it is; gates
 * continue to observe but `promote()` will refuse until `resume()`.
 */
export async function pause(operatorId: string, reason: string): Promise<RolloutState> {
  const cur = await readState();
  if (cur.status !== 'in_canary' && cur.status !== 'promoting') {
    return writeState(cur, `cannot_pause_in_status_${cur.status}`, operatorId);
  }
  return writeState({ ...cur, status: 'paused' }, reason, operatorId);
}

/**
 * Resume a paused rollout. Returns to `in_canary` with the existing
 * canary_started_at preserved.
 */
export async function resume(operatorId: string, reason: string): Promise<RolloutState> {
  const cur = await readState();
  if (cur.status !== 'paused') {
    return writeState(cur, `cannot_resume_in_status_${cur.status}`, operatorId);
  }
  return writeState({ ...cur, status: 'in_canary' }, reason, operatorId);
}

/**
 * Acknowledge a rolled-back state and clear the block. After this, `promote()`
 * works again. Use after the operator has investigated the rollback cause.
 */
export async function reset(operatorId: string, reason: string): Promise<RolloutState> {
  const cur = await readState();
  if (cur.status !== 'rolled_back' && cur.status !== 'idle') {
    return writeState(cur, `cannot_reset_in_status_${cur.status}`, operatorId);
  }
  return writeState({ ...cur, status: 'idle', canary_started_at: null }, reason, operatorId);
}

/** Read the current rollout state. Cached client / Redis read. */
export async function getRolloutState(): Promise<RolloutState> {
  return readState();
}

function canSoakElapsed(state: RolloutState): boolean {
  if (!state.canary_started_at) return false;
  return Date.now() - state.canary_started_at >= state.canary_soak_ms;
}

/**
 * Effective mode resolver. Used by `plannerRolloutMode.applyActiveRolloutMode`
 * to pick up the orchestrator's desired state IF Redis is reachable, falling
 * back to `process.env.PLANNER_ROLLOUT_MODE` otherwise.
 *
 * Cached 5s to avoid hammering Redis on every planner request.
 */
let _effectiveCache: { mode: PlannerRolloutMode; cachedAt: number } | null = null;
const EFFECTIVE_CACHE_TTL_MS = 5_000;

export async function getEffectiveRolloutMode(): Promise<PlannerRolloutMode | null> {
  const now = Date.now();
  if (_effectiveCache && now - _effectiveCache.cachedAt < EFFECTIVE_CACHE_TTL_MS) {
    return _effectiveCache.mode;
  }
  const state = await readState();
  if (!ROLLOUT_ORDER.includes(state.active_mode)) return null;
  _effectiveCache = { mode: state.active_mode, cachedAt: now };
  return state.active_mode;
}

/** Read recent audit-stream entries for ops inspection. */
export async function readAuditTrail(limit: number = 50): Promise<Array<Record<string, string>>> {
  const client = getRedisOrNull();
  if (!client) return [];
  try {
    const entries = (await client.xrevrange(AUDIT_STREAM, '+', '-', 'COUNT', limit)) as Array<[string, string[]]>;
    return entries.map(([entryId, fields]) => {
      const obj: Record<string, string> = { entry_id: entryId };
      for (let i = 0; i + 1 < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
      return obj;
    });
  } catch {
    return [];
  }
}

/** Test-only: clear cached client + state. */
export function __resetForTests(): void {
  _client = null;
  _failureCount = 0;
  _effectiveCache = null;
}
