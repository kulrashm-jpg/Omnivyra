/**
 * Variant Experiment Tracker.
 *
 * Bounded in-memory lifecycle tracker for variant experiments. The
 * planner registers an experiment when it produces a `top_3` or
 * `experiment` fan-out; downstream callers transition the experiment
 * through:
 *
 *     created → generated → published → engaged → completed
 *
 * NO database. NO schema change. State lives in a bounded LRU keyed
 * by company so multi-tenant memory pressure stays bounded.
 *
 * The dashboard endpoint reads via `listExperiments` to surface
 * active + completed experiments per scope.
 */

import {
  type VariantExecutionMode,
} from './variantExecutionContract';

const MAX_EXPERIMENTS_PER_ORG = 500;
const MAX_ORGS = 200;

/* ── State machine ─────────────────────────────────────────────── */

export type ExperimentLifecycleState =
  | 'created'
  | 'generated'
  | 'published'
  | 'engaged'
  | 'completed';

const LIFECYCLE_ORDER: ReadonlyArray<ExperimentLifecycleState> = [
  'created',
  'generated',
  'published',
  'engaged',
  'completed',
];

function lifecycleIndex(state: ExperimentLifecycleState): number {
  return LIFECYCLE_ORDER.indexOf(state);
}

/* ── Records ───────────────────────────────────────────────────── */

export type ExperimentAssetRecord = {
  variant_id: string;
  variant_family: string;
  /** Provided by the renderer/caller after generation completes. */
  asset_id: string | null;
  /** Provided by the publisher after publish completes. */
  scheduled_post_id: string | null;
  /** Most recent lifecycle state for THIS asset, distinct from the
   *  experiment-level state below. */
  state: ExperimentLifecycleState;
};

/**
 * Tracking type — distinguishes a full experiment run (true A/B fan-out
 * with winner attribution semantics) from a lightweight bookkeeping
 * entry recorded for non-experiment modes so health surfaces can
 * report on ALL generation activity (Final Corrective Pass — P2-4).
 *
 *   - 'experiment' — full experiment fan-out; counted for A/B winner
 *                    semantics + experiment-health summary.
 *   - 'tracking'   — lightweight bookkeeping for single_variant /
 *                    best_variant / top_3_variants modes; surfaced in
 *                    diagnostics but NEVER folded into winner / A/B
 *                    analytics.
 */
export type ExperimentTrackingType = 'experiment' | 'tracking';

export type ExperimentRecord = {
  experiment_id: string;
  company_id: string;
  campaign_id: string | null;
  strategy_id: string;
  mode: VariantExecutionMode;
  /** Final Corrective Pass — distinguishes true experiments from
   *  lightweight bookkeeping entries (defaults to 'experiment' for
   *  backward compatibility with already-recorded rows). */
  tracking_type: ExperimentTrackingType;
  /** Variants the planner produced for this experiment. */
  assets: ExperimentAssetRecord[];
  /** Aggregate lifecycle — derived from the slowest asset (so the
   *  experiment doesn't show 'completed' while assets still trail). */
  state: ExperimentLifecycleState;
  /** Free-form caller-supplied correlation id. */
  correlation_id: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ── Storage ───────────────────────────────────────────────────── */

type OrgBuffer = {
  experiments: Map<string, ExperimentRecord>;
  lastTouchedAt: number;
};

const orgBuffers = new Map<string, OrgBuffer>();

function pruneOrgsIfFull(): void {
  if (orgBuffers.size <= MAX_ORGS) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of orgBuffers.entries()) {
    if (v.lastTouchedAt < oldestTs) {
      oldestTs = v.lastTouchedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) orgBuffers.delete(oldestKey);
}

function getOrCreateBuffer(companyId: string): OrgBuffer {
  const key = companyId.trim().toLowerCase();
  let buf = orgBuffers.get(key);
  if (!buf) {
    buf = { experiments: new Map(), lastTouchedAt: Date.now() };
    orgBuffers.set(key, buf);
    pruneOrgsIfFull();
  }
  buf.lastTouchedAt = Date.now();
  return buf;
}

function pruneExperimentsIfFull(buf: OrgBuffer): void {
  if (buf.experiments.size <= MAX_EXPERIMENTS_PER_ORG) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, exp] of buf.experiments.entries()) {
    const ts = Date.parse(exp.createdAt);
    if (Number.isFinite(ts) && ts < oldestTs) {
      oldestTs = ts;
      oldestKey = k;
    }
  }
  if (oldestKey) buf.experiments.delete(oldestKey);
}

/* ── Public API ────────────────────────────────────────────────── */

let seq = 0;

/**
 * Register a new experiment. The planner calls this when fan-out
 * produces > 1 variant decision OR when `mode === 'experiment'`.
 *
 * `experiment_id` is generated server-side. Callers MAY supply a
 * `correlation_id` to bind back to the originating request.
 */
export function registerExperiment(input: {
  companyId: string;
  campaignId?: string | null;
  strategyId: string;
  mode: VariantExecutionMode;
  variantIds: ReadonlyArray<{ variant_id: string; variant_family: string }>;
  correlationId?: string | null;
  /** Final Corrective Pass — tracking_type defaults to 'experiment'
   *  for back-compat. Non-experiment modes pass 'tracking' so the
   *  entry is visible to health surfaces without contaminating
   *  experiment-only analytics. */
  trackingType?: ExperimentTrackingType;
}): ExperimentRecord {
  if (!input.companyId) throw new Error('companyId required');
  const now = new Date().toISOString();
  const experimentId = `exp_${Date.now().toString(36)}_${(++seq).toString(36)}`;
  const record: ExperimentRecord = {
    experiment_id: experimentId,
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    strategy_id: input.strategyId,
    mode: input.mode,
    tracking_type: input.trackingType ?? 'experiment',
    assets: input.variantIds.map((v) => ({
      variant_id: v.variant_id,
      variant_family: v.variant_family,
      asset_id: null,
      scheduled_post_id: null,
      state: 'created',
    })),
    state: 'created',
    correlation_id: input.correlationId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const buf = getOrCreateBuffer(input.companyId);
  buf.experiments.set(experimentId, record);
  pruneExperimentsIfFull(buf);
  // Final Corrective Pass — diagnostic persistence (best-effort).
  try {
    const { mirrorExperimentRecord } =
      require('./variantDiagnosticsRedisPersistence') as typeof import('./variantDiagnosticsRedisPersistence');
    void mirrorExperimentRecord(record);
  } catch {
    // No-op.
  }
  // Phase 7 — audit log for experiment creation. Best-effort, never blocks.
  try {
    const { auditExperimentCreated } = require('./variantAuditEvents') as typeof import('./variantAuditEvents');
    auditExperimentCreated({
      companyId: input.companyId,
      experimentId,
      strategyId: input.strategyId,
      mode: input.mode,
      variantCount: record.assets.length,
    });
  } catch {
    // No-op.
  }
  return cloneExperiment(record);
}

/**
 * Advance the lifecycle of a specific (experiment, variant) pair.
 * The lifecycle is monotonic — calling with an EARLIER state is a
 * no-op so out-of-order callbacks can't regress the aggregate.
 *
 * Optionally attaches the asset_id / scheduled_post_id when the
 * caller has them at hand.
 */
export function transitionExperimentAsset(input: {
  companyId: string;
  experimentId: string;
  variantId: string;
  state: ExperimentLifecycleState;
  assetId?: string | null;
  scheduledPostId?: string | null;
}): ExperimentRecord | null {
  if (!input.companyId || !input.experimentId || !input.variantId) return null;
  const buf = orgBuffers.get(input.companyId.trim().toLowerCase());
  if (!buf) return null;
  const exp = buf.experiments.get(input.experimentId);
  if (!exp) return null;
  let touched = false;
  for (const asset of exp.assets) {
    if (asset.variant_id !== input.variantId) continue;
    const currIdx = lifecycleIndex(asset.state);
    const nextIdx = lifecycleIndex(input.state);
    if (nextIdx >= currIdx) {
      asset.state = input.state;
      touched = true;
    }
    if (typeof input.assetId === 'string' && input.assetId.length > 0) {
      asset.asset_id = input.assetId;
      touched = true;
    }
    if (typeof input.scheduledPostId === 'string' && input.scheduledPostId.length > 0) {
      asset.scheduled_post_id = input.scheduledPostId;
      touched = true;
    }
  }
  if (touched) {
    // Aggregate state = slowest asset's state.
    let slowestIdx = LIFECYCLE_ORDER.length - 1;
    for (const asset of exp.assets) {
      const idx = lifecycleIndex(asset.state);
      if (idx < slowestIdx) slowestIdx = idx;
    }
    exp.state = LIFECYCLE_ORDER[Math.max(0, slowestIdx)];
    exp.updatedAt = new Date().toISOString();
    // Final Corrective Pass — diagnostic persistence (best-effort).
    try {
      const { mirrorExperimentRecord } =
        require('./variantDiagnosticsRedisPersistence') as typeof import('./variantDiagnosticsRedisPersistence');
      void mirrorExperimentRecord(exp);
    } catch {
      // No-op.
    }
  }
  return cloneExperiment(exp);
}

/**
 * Mark every asset of an experiment as `completed`. Used by the
 * dashboard / scheduled cleanup to retire experiments. Idempotent.
 */
export function completeExperiment(input: {
  companyId: string;
  experimentId: string;
}): ExperimentRecord | null {
  if (!input.companyId || !input.experimentId) return null;
  const buf = orgBuffers.get(input.companyId.trim().toLowerCase());
  if (!buf) return null;
  const exp = buf.experiments.get(input.experimentId);
  if (!exp) return null;
  for (const asset of exp.assets) asset.state = 'completed';
  exp.state = 'completed';
  exp.updatedAt = new Date().toISOString();
  // Phase 7 — audit log for experiment completion. Best-effort.
  try {
    const { auditExperimentCompleted } = require('./variantAuditEvents') as typeof import('./variantAuditEvents');
    auditExperimentCompleted({
      companyId: input.companyId,
      experimentId: exp.experiment_id,
      strategyId: exp.strategy_id,
    });
  } catch {
    // No-op.
  }
  return cloneExperiment(exp);
}

/* ── Read API ──────────────────────────────────────────────────── */

export type ListExperimentsScope = {
  companyId: string;
  campaignId?: string | null;
  strategyId?: string | null;
  state?: ExperimentLifecycleState | 'active' | 'all';
  /** Final Corrective Pass — filter by tracking type. Omitted = all. */
  trackingType?: ExperimentTrackingType | 'all';
};

/**
 * List experiments for a scope. `state` filter:
 *   - omitted / 'all'   → every recorded experiment
 *   - 'active'          → any non-completed experiment
 *   - specific state    → exactly that state
 */
export function listExperiments(scope: ListExperimentsScope): ExperimentRecord[] {
  if (!scope.companyId) return [];
  const buf = orgBuffers.get(scope.companyId.trim().toLowerCase());
  if (!buf) return [];
  const out: ExperimentRecord[] = [];
  for (const exp of buf.experiments.values()) {
    if (scope.campaignId && exp.campaign_id !== scope.campaignId) continue;
    if (scope.strategyId && exp.strategy_id !== scope.strategyId) continue;
    if (scope.state && scope.state !== 'all') {
      if (scope.state === 'active') {
        if (exp.state === 'completed') continue;
      } else if (exp.state !== scope.state) {
        continue;
      }
    }
    if (scope.trackingType && scope.trackingType !== 'all'
        && exp.tracking_type !== scope.trackingType) continue;
    out.push(cloneExperiment(exp));
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function getExperiment(input: {
  companyId: string;
  experimentId: string;
}): ExperimentRecord | null {
  if (!input.companyId || !input.experimentId) return null;
  const buf = orgBuffers.get(input.companyId.trim().toLowerCase());
  if (!buf) return null;
  const exp = buf.experiments.get(input.experimentId);
  return exp ? cloneExperiment(exp) : null;
}

/* ── Diagnostics + test surface ────────────────────────────────── */

export function experimentTrackerStats(): {
  orgCount: number;
  maxOrgs: number;
  maxExperimentsPerOrg: number;
  totalExperiments: number;
} {
  let total = 0;
  for (const buf of orgBuffers.values()) total += buf.experiments.size;
  return {
    orgCount: orgBuffers.size,
    maxOrgs: MAX_ORGS,
    maxExperimentsPerOrg: MAX_EXPERIMENTS_PER_ORG,
    totalExperiments: total,
  };
}

export function clearExperimentTracker(): void {
  orgBuffers.clear();
  seq = 0;
}

/* ── Internal helpers ──────────────────────────────────────────── */

function cloneExperiment(exp: ExperimentRecord): ExperimentRecord {
  return {
    ...exp,
    assets: exp.assets.map((a) => ({ ...a })),
  };
}

export { LIFECYCLE_ORDER };
