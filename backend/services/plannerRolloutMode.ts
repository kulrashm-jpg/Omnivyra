/**
 * Planner rollout-mode resolver.
 *
 * Six staged modes that the operator selects via `PLANNER_ROLLOUT_MODE`.
 * Each mode is the canonical setting for a group of individual feature
 * flags so a rollout step is a single env change instead of six. Individual
 * flags still WIN if explicitly set in env — the mode is a default profile.
 *
 *   legacy                — baseline; every protection off, behaves like
 *                            before the multi-pass hardening
 *   distributed_pools_only — distributed semaphore + token bucket on; no
 *                            streaming / async refinement / progressive
 *   streaming_only        — distributed pools + streaming drafting
 *   async_refinement      — distributed pools + streaming + async refinement
 *   full_progressive      — everything above + cross-instance events +
 *                            distributed metrics
 *   full_production       — full_progressive (alias for clarity in ops docs)
 *
 * Downgrade safety:
 *   Each individual flag's default-from-mode is read at boot AND on hot
 *   reload. Downgrading the mode at runtime takes effect for new requests
 *   only — in-flight calls keep their original behavior until they finish.
 *
 * Backward compatibility:
 *   When `PLANNER_ROLLOUT_MODE` is unset, individual env vars are read
 *   exactly as before. Setting `PLANNER_ROLLOUT_MODE=legacy` is the same
 *   as omitting it. So existing deployments are unaffected by this module
 *   landing.
 *
 * Logging:
 *   `getActiveRolloutMode()` is called once per planner request (orchestrator
 *   pre-flight) and the result is included in `plan_total` and emitted as a
 *   discrete `planner_rollout_mode_active` event on the first call after
 *   boot OR after a hot-reload. Subsequent calls within the same mode are
 *   silent — no log spam.
 */

import { logger } from './logger';

export type PlannerRolloutMode =
  | 'legacy'
  | 'distributed_pools_only'
  | 'streaming_only'
  | 'async_refinement'
  | 'full_progressive'
  | 'full_production';

const KNOWN_MODES: PlannerRolloutMode[] = [
  'legacy',
  'distributed_pools_only',
  'streaming_only',
  'async_refinement',
  'full_progressive',
  'full_production',
];

/**
 * Default feature-flag values per mode. Individual env vars override these
 * when set (true / false / 1 / 0). The mode is a profile, not a lock.
 */
interface PlannerFeatureFlags {
  DISTRIBUTED_POOL_ENABLED: boolean;
  PROVIDER_BUCKET_ENABLED: boolean;
  STREAMING_DRAFT_ENABLED: boolean;
  ASYNC_REFINEMENT_ENABLED: boolean;
  DISTRIBUTED_EVENTS_ENABLED: boolean;
  DISTRIBUTED_METRICS_ENABLED: boolean;
}

const MODE_DEFAULTS: Record<PlannerRolloutMode, PlannerFeatureFlags> = {
  legacy: {
    DISTRIBUTED_POOL_ENABLED:    false,
    PROVIDER_BUCKET_ENABLED:     false,
    STREAMING_DRAFT_ENABLED:     false,
    ASYNC_REFINEMENT_ENABLED:    false,
    DISTRIBUTED_EVENTS_ENABLED:  false,
    DISTRIBUTED_METRICS_ENABLED: false,
  },
  distributed_pools_only: {
    DISTRIBUTED_POOL_ENABLED:    true,
    PROVIDER_BUCKET_ENABLED:     true,
    STREAMING_DRAFT_ENABLED:     false,
    ASYNC_REFINEMENT_ENABLED:    false,
    DISTRIBUTED_EVENTS_ENABLED:  false,
    DISTRIBUTED_METRICS_ENABLED: false,
  },
  streaming_only: {
    DISTRIBUTED_POOL_ENABLED:    true,
    PROVIDER_BUCKET_ENABLED:     true,
    STREAMING_DRAFT_ENABLED:     true,
    ASYNC_REFINEMENT_ENABLED:    false,
    DISTRIBUTED_EVENTS_ENABLED:  false,
    DISTRIBUTED_METRICS_ENABLED: false,
  },
  async_refinement: {
    DISTRIBUTED_POOL_ENABLED:    true,
    PROVIDER_BUCKET_ENABLED:     true,
    STREAMING_DRAFT_ENABLED:     true,
    ASYNC_REFINEMENT_ENABLED:    true,
    DISTRIBUTED_EVENTS_ENABLED:  false,
    DISTRIBUTED_METRICS_ENABLED: false,
  },
  full_progressive: {
    DISTRIBUTED_POOL_ENABLED:    true,
    PROVIDER_BUCKET_ENABLED:     true,
    STREAMING_DRAFT_ENABLED:     true,
    ASYNC_REFINEMENT_ENABLED:    true,
    DISTRIBUTED_EVENTS_ENABLED:  true,
    DISTRIBUTED_METRICS_ENABLED: true,
  },
  full_production: {
    DISTRIBUTED_POOL_ENABLED:    true,
    PROVIDER_BUCKET_ENABLED:     true,
    STREAMING_DRAFT_ENABLED:     true,
    ASYNC_REFINEMENT_ENABLED:    true,
    DISTRIBUTED_EVENTS_ENABLED:  true,
    DISTRIBUTED_METRICS_ENABLED: true,
  },
};

let _lastLoggedMode: PlannerRolloutMode | null = null;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase().trim();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

/**
 * Resolve the active mode. Returns `'legacy'` when the env is unset, missing,
 * or set to an unknown value (with a one-time warn for unknown values).
 */
export function getActiveRolloutMode(): PlannerRolloutMode {
  const raw = String(process.env.PLANNER_ROLLOUT_MODE ?? 'legacy').toLowerCase().trim();
  if (KNOWN_MODES.includes(raw as PlannerRolloutMode)) {
    return raw as PlannerRolloutMode;
  }
  if (raw !== '' && _lastLoggedMode !== 'legacy') {
    logger.warn('planner_rollout_mode_unknown_fallback_legacy', {
      requested: raw,
      known: KNOWN_MODES,
    });
  }
  return 'legacy';
}

/**
 * Resolve every feature flag honoring mode-default → env-override precedence.
 *
 * 1. Compute defaults from the active rollout mode.
 * 2. For each flag, if the corresponding env var is set, honor it.
 * 3. Return the merged record.
 */
export function getActiveFeatureFlags(): PlannerFeatureFlags {
  const mode = getActiveRolloutMode();
  const defaults = MODE_DEFAULTS[mode];
  return {
    DISTRIBUTED_POOL_ENABLED:    parseBool(process.env.DISTRIBUTED_POOL_ENABLED,    defaults.DISTRIBUTED_POOL_ENABLED),
    PROVIDER_BUCKET_ENABLED:     parseBool(process.env.PROVIDER_BUCKET_ENABLED,     defaults.PROVIDER_BUCKET_ENABLED),
    STREAMING_DRAFT_ENABLED:     parseBool(process.env.STREAMING_DRAFT_ENABLED,     defaults.STREAMING_DRAFT_ENABLED),
    ASYNC_REFINEMENT_ENABLED:    parseBool(process.env.ASYNC_REFINEMENT_ENABLED,    defaults.ASYNC_REFINEMENT_ENABLED),
    DISTRIBUTED_EVENTS_ENABLED:  parseBool(process.env.DISTRIBUTED_EVENTS_ENABLED,  defaults.DISTRIBUTED_EVENTS_ENABLED),
    DISTRIBUTED_METRICS_ENABLED: parseBool(process.env.DISTRIBUTED_METRICS_ENABLED, defaults.DISTRIBUTED_METRICS_ENABLED),
  };
}

/**
 * Apply the active rollout mode to process.env so every downstream reader of
 * the individual flags sees the correct value. Call once at boot AND once
 * before each planner request (cheap — string assignments).
 *
 * Idempotent. Emits `planner_rollout_mode_active` when the mode changes.
 */
export function applyActiveRolloutMode(): PlannerFeatureFlags {
  const mode = getActiveRolloutMode();
  const flags = getActiveFeatureFlags();
  if (_lastLoggedMode !== mode) {
    _lastLoggedMode = mode;
    logger.info('planner_rollout_mode_active', { mode, flags });
  }
  return flags;
}

/**
 * Is the rollout mode an EXPLICIT operator decision?
 *
 * This is what decides whether the mode profile governs a flag. It matters
 * because the six consumers each carry their own long-standing default (the
 * pool, bucket and streaming flags default ON; the rest default OFF), and
 * those predate the rollout-mode profiles. `legacy` — the value used when
 * PLANNER_ROLLOUT_MODE is unset — turns all six OFF, so treating an absent
 * mode as a decision would silently disable distributed pooling and provider
 * bucketing for ALL AI traffic, not just the planner: aiGatewayCore consumes
 * both.
 *
 * So an absent mode means "no opinion", and each consumer keeps its own
 * default. Setting PLANNER_ROLLOUT_MODE is the operator opting in.
 */
export function isRolloutModeExplicit(): boolean {
  const raw = String(process.env.PLANNER_ROLLOUT_MODE ?? '').toLowerCase().trim();
  return raw !== '' && KNOWN_MODES.includes(raw as PlannerRolloutMode);
}

/**
 * Resolve ONE planner rollout flag, explicitly, at the point of use.
 *
 * This replaces the mechanism it supersedes: applyActiveRolloutMode used to
 * copy the resolved flags into process.env so downstream readers would see
 * them. Production hardens process.env as a readonly proxy whose set-trap
 * returns false, which throws under strict mode — that write crashed
 * POST /api/campaigns/ai/plan with a 500 and took campaign planning with it.
 * (The same failure mode was already hit and guarded in creatorRenderFonts.)
 *
 * Resolution order, unchanged in meaning:
 *   1. an explicit per-flag env var always wins;
 *   2. otherwise the mode profile, when the operator has set one;
 *   3. otherwise the consumer's own default.
 *
 * The rollout decision is now data returned to the caller rather than global
 * process state, so no mutation is required and nothing is hidden behind a
 * try/catch.
 */
export function resolvePlannerFlag(
  key: keyof PlannerFeatureFlags,
  consumerDefault: boolean,
): boolean {
  const explicit = process.env[key];
  if (explicit !== undefined) return parseBool(explicit, consumerDefault);
  if (isRolloutModeExplicit()) return getActiveFeatureFlags()[key];
  return consumerDefault;
}

/**
 * Background poller that syncs `PLANNER_ROLLOUT_MODE` from the rollout
 * orchestrator state in Redis. Lets a single operator decision propagate
 * to every instance without a redeploy. Idempotent.
 *
 * Failure mode: when Redis is unreachable, the poller is a no-op — the
 * existing `process.env.PLANNER_ROLLOUT_MODE` value (the deploy-time
 * default) keeps applying.
 */
let _syncTimer: ReturnType<typeof setInterval> | null = null;

export function startPlannerRolloutSync(): void {
  if (_syncTimer) return;
  const intervalMs = Math.max(1000, Number(process.env.PLANNER_ROLLOUT_SYNC_MS || 5_000));
  const tick = async (): Promise<void> => {
    try {
      const { getEffectiveRolloutMode } =
        require('./plannerRolloutOrchestrator') as typeof import('./plannerRolloutOrchestrator');
      const desired = await getEffectiveRolloutMode();
      if (desired && desired !== process.env.PLANNER_ROLLOUT_MODE) {
        const previous = process.env.PLANNER_ROLLOUT_MODE;
        process.env.PLANNER_ROLLOUT_MODE = desired;
        logger.info('planner_rollout_sync_applied', {
          previous_mode: previous ?? 'unset',
          new_mode: desired,
          source: 'orchestrator',
        });
        // Force re-emit of `planner_rollout_mode_active` on next call.
        _lastLoggedMode = null;
      }
    } catch {
      /* poller never throws */
    }
  };
  _syncTimer = setInterval(tick, intervalMs);
  // Unref so the timer doesn't keep the process alive at shutdown.
  try { (_syncTimer as any).unref?.(); } catch { /* noop */ }
  // Initial tick so the first request sees the orchestrator state without waiting.
  void tick();
  logger.info('planner_rollout_sync_started', { interval_ms: intervalMs });
}

export function stopPlannerRolloutSync(): void {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
}
