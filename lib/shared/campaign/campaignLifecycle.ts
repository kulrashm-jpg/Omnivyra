/**
 * CAMPAIGN-IMPL-003 — Deterministic campaign lifecycle & execution trace.
 *
 * The canonical state machine + trace vocabulary that makes campaign generation
 * fully explainable. Pure, dependency-free, client+server-safe. It COMPOSES with
 * the IMPL-002 reconciliation in `plannerDiagnostics.ts` (which owns the
 * invariant `planned === generated + dropped.length`); this module adds:
 *
 *   1. a permanent per-item lifecycle STATE with deterministic transitions,
 *   2. an inspectable per-item execution TRACE (assignment → … → publishing),
 *   3. a regeneration-before-drop policy, and
 *   4. planner METRICS (success %, integrity %, regeneration stats).
 *
 * It introduces NO new campaign architecture, no Master-Idea, no historical
 * uniqueness — it only observes and records what the existing planner does.
 */

import type { DropReasonCode, DroppedItem, PlannerReconciliation } from './plannerDiagnostics';

// ──────────────────────────────────────────────────────────────────────────
// 1. Lifecycle states — every planned item lands in exactly one of these.
// ──────────────────────────────────────────────────────────────────────────

export type ContentLifecycleState =
  | 'PLANNED'     // the user requested it (Σ format_frequency)
  | 'VALIDATED'   // passed pre-allocation business-rule + shape validation
  | 'ALLOCATED'   // assigned to a platform + slot
  | 'GENERATING'  // AI generation in flight
  | 'GENERATED'   // content produced + persisted
  | 'ADAPTED'     // platform-adapted variant produced (creator/multi-platform)
  | 'SCHEDULED'   // materialized into the scheduling pipeline
  | 'PUBLISHED'   // live on the platform
  | 'FAILED'      // a stage failed; may retry back into GENERATING
  | 'DROPPED';    // permanently removed, ALWAYS with a structured reason

/** The two terminal states — no transition may leave them. */
export const TERMINAL_STATES: readonly ContentLifecycleState[] = ['PUBLISHED', 'DROPPED'];

/**
 * Deterministic transition map: from-state → the ONLY states it may move to.
 * Any transition not listed here is illegal (a planner bug), which
 * `assertTransition` surfaces without throwing.
 */
export const LIFECYCLE_TRANSITIONS: Record<ContentLifecycleState, readonly ContentLifecycleState[]> = Object.freeze({
  PLANNED:    ['VALIDATED', 'DROPPED'],
  VALIDATED:  ['ALLOCATED', 'DROPPED'],
  ALLOCATED:  ['GENERATING', 'DROPPED'],
  GENERATING: ['GENERATED', 'FAILED', 'DROPPED'],
  GENERATED:  ['ADAPTED', 'SCHEDULED', 'DROPPED'],
  ADAPTED:    ['SCHEDULED', 'DROPPED'],
  SCHEDULED:  ['PUBLISHED', 'FAILED', 'DROPPED'],
  PUBLISHED:  [],
  FAILED:     ['GENERATING', 'DROPPED'], // retry re-enters generation; else drop
  DROPPED:    [],
});

export function isTerminal(state: ContentLifecycleState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Bridge to the existing DB-facing content lifecycle (`CanonicalContentState` in
 * `contentLifecycle.ts`). The planner lifecycle is a SUPERSET at the planning
 * edge — it adds pre-persistence planner states (VALIDATED / ALLOCATED) and the
 * planner-only terminal DROPPED — so this maps each planner state onto the
 * nearest canonical content state (as a plain string to avoid an enum-value
 * import cycle). DROPPED has no canonical content equivalent (the row never
 * persists) and returns null. This keeps the two vocabularies aligned instead of
 * introducing a third competing one.
 */
export function toCanonicalContentState(state: ContentLifecycleState): string | null {
  switch (state) {
    case 'PLANNED':
    case 'VALIDATED':
    case 'ALLOCATED':
      return 'PLANNED';
    case 'GENERATING':
      return 'AI_GENERATING';
    case 'GENERATED':
    case 'ADAPTED':
      return 'READY_FOR_SCHEDULE';
    case 'SCHEDULED':
      return 'SCHEDULED';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'FAILED':
      return 'FAILED';
    case 'DROPPED':
      return null; // planner-only terminal — no persisted content row exists
    default:
      return null;
  }
}

/** True iff `to` is a legal next state from `from`. */
export function canTransition(from: ContentLifecycleState, to: ContentLifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Non-throwing transition guard. Returns whether the move is legal and logs an
 * illegal transition (a diagnostics failure must never break generation).
 */
export function assertTransition(
  from: ContentLifecycleState,
  to: ContentLifecycleState,
  log?: (message: string, meta: Record<string, unknown>) => void,
): boolean {
  const ok = canTransition(from, to);
  if (!ok && log) log('[lifecycle] ILLEGAL transition', { from, to });
  return ok;
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Execution trace — the inspectable per-stage record for one item.
// ──────────────────────────────────────────────────────────────────────────

/** The ordered pipeline stages every item flows through. */
export type PipelineStage =
  | 'assignment'
  | 'platform_selection'
  | 'generation'
  | 'adaptation'
  | 'scheduling'
  | 'publishing';

export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = Object.freeze([
  'assignment', 'platform_selection', 'generation', 'adaptation', 'scheduling', 'publishing',
]);

export interface TraceEntry {
  stage: PipelineStage;
  state: ContentLifecycleState;
  /** ISO timestamp; caller-supplied so this module stays clock-free/deterministic. */
  at?: string;
  detail?: string;
}

export interface ItemTrace {
  /** Stable identifier for the planned item (e.g. `week1::poll::linkedin::0`). */
  id: string;
  weekly_card?: string;
  content_type: string;
  platform: string | null;
  entries: TraceEntry[];
  final: ContentLifecycleState;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Planner metrics — measurable integrity/observability.
// ──────────────────────────────────────────────────────────────────────────

export interface PlannerMetrics {
  requested: number;
  generated: number;
  dropped: number;
  regenerated: number;
  average_regeneration_attempts: number;
  drop_reasons: Array<{ reason: DropReasonCode; count: number }>;
  /** generated / requested, 0–100. */
  generation_success_pct: number;
  /** 100 when the invariant holds exactly; degrades with the unattributed delta. */
  planner_integrity_pct: number;
}

export function computePlannerMetrics(
  reconciliation: PlannerReconciliation,
  regeneration: { regenerated: number; attempts: number[] } = { regenerated: 0, attempts: [] },
): PlannerMetrics {
  const { planned, generated, dropped } = reconciliation;
  const dropReasonCounts = new Map<DropReasonCode, number>();
  for (const d of dropped) dropReasonCounts.set(d.reason, (dropReasonCounts.get(d.reason) ?? 0) + 1);

  const attempts = regeneration.attempts ?? [];
  const avgAttempts = attempts.length > 0
    ? attempts.reduce((a, b) => a + b, 0) / attempts.length
    : 0;

  // Integrity: the invariant is planned === generated + dropped.length. Any
  // shortfall the planner could NOT attribute is the integrity gap.
  const accountedFor = generated + dropped.length;
  const unattributed = Math.abs(planned - accountedFor);
  const integrity = planned > 0 ? Math.max(0, 100 * (1 - unattributed / planned)) : 100;

  return {
    requested: planned,
    generated,
    dropped: dropped.length,
    regenerated: regeneration.regenerated ?? 0,
    average_regeneration_attempts: round2(avgAttempts),
    drop_reasons: [...dropReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    generation_success_pct: planned > 0 ? round2((100 * generated) / planned) : 0,
    planner_integrity_pct: round2(integrity),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Trace collector — the deterministic drop/regeneration recorder threaded
//    through a generation run. Silent loss is impossible: the only way to
//    remove an item is `.drop(...)`, which demands a structured reason.
// ──────────────────────────────────────────────────────────────────────────

export class PlannerTrace {
  private readonly drops: DroppedItem[] = [];
  private readonly traces = new Map<string, ItemTrace>();
  private regeneratedCount = 0;
  private readonly regenAttempts: number[] = [];

  /** Record a permanent drop. This is the ONLY sanctioned way to lose an item. */
  drop(item: DroppedItem): void {
    this.drops.push(item);
  }

  /** Append a stage entry to an item's trace (creating the trace on first touch). */
  record(id: string, entry: TraceEntry, meta?: { content_type?: string; platform?: string | null; weekly_card?: string }): void {
    let t = this.traces.get(id);
    if (!t) {
      t = {
        id,
        weekly_card: meta?.weekly_card,
        content_type: meta?.content_type ?? entry.stage,
        platform: meta?.platform ?? null,
        entries: [],
        final: entry.state,
      };
      this.traces.set(id, t);
    }
    t.entries.push(entry);
    t.final = entry.state;
  }

  /** Note that an item required `attempts` regeneration passes before succeeding. */
  regenerated(attempts: number): void {
    this.regeneratedCount += 1;
    this.regenAttempts.push(Math.max(1, Math.round(attempts)));
  }

  getDrops(): DroppedItem[] {
    return [...this.drops];
  }

  getTraces(): ItemTrace[] {
    return [...this.traces.values()];
  }

  getRegeneration(): { regenerated: number; attempts: number[] } {
    return { regenerated: this.regeneratedCount, attempts: [...this.regenAttempts] };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Regeneration-before-drop — try to produce a fresh candidate N times before
//    giving up. Deterministic: fixed attempt budget, explicit outcome.
// ──────────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_REGEN_ATTEMPTS = 2;

export interface RegenOutcome<T> {
  /** The accepted candidate, or null when every attempt was rejected. */
  result: T | null;
  /** How many generation passes ran (1 = first try accepted, no regeneration). */
  attempts: number;
  /** True when more than one pass was needed (i.e. a regeneration happened). */
  regenerated: boolean;
}

/**
 * Call `generate` up to `maxAttempts + 1` times, accepting the first candidate
 * for which `accept` returns true. Regenerate-instead-of-drop: only after the
 * attempt budget is exhausted does the caller drop the item.
 */
export async function regenerateBeforeDrop<T>(
  generate: (attempt: number) => Promise<T | null>,
  accept: (candidate: T) => boolean,
  maxAttempts: number = DEFAULT_MAX_REGEN_ATTEMPTS,
): Promise<RegenOutcome<T>> {
  const budget = Math.max(0, Math.round(maxAttempts));
  let attempts = 0;
  for (let i = 0; i <= budget; i += 1) {
    attempts += 1;
    const candidate = await generate(i);
    if (candidate != null && accept(candidate)) {
      return { result: candidate, attempts, regenerated: attempts > 1 };
    }
  }
  return { result: null, attempts, regenerated: attempts > 1 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
