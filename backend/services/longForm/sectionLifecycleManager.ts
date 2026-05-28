/**
 * sectionLifecycleManager.ts
 *
 * Phase 4.2 — Deterministic section lifecycle orchestration.
 *
 * Section generation previously behaved like loosely connected retries with
 * no canonical state. This module gives each section a strict lifecycle
 * with allowed transitions, retry causes, and an audit trail the
 * orchestrator can return verbatim in diagnostics.
 *
 * The lifecycle is intentionally side-effect free — the manager records
 * transitions but does NOT call generators or validators. The orchestrator
 * is the operator.
 */

export enum SectionLifecycleState {
  PLANNED = 'PLANNED',
  GENERATED = 'GENERATED',
  VALIDATING = 'VALIDATING',
  FAILED_ALIGNMENT = 'FAILED_ALIGNMENT',
  FAILED_FACTUAL = 'FAILED_FACTUAL',
  FAILED_CONTINUITY = 'FAILED_CONTINUITY',
  FAILED_REPETITION = 'FAILED_REPETITION',
  FAILED_ASSIGNMENT = 'FAILED_ASSIGNMENT',
  FAILED_TIMEOUT = 'FAILED_TIMEOUT',
  RETRYING = 'RETRYING',
  RECOVERED = 'RECOVERED',
  ACCEPTED = 'ACCEPTED',
  ABANDONED = 'ABANDONED',
}

export type FailureCategory =
  | 'alignment'
  | 'factual'
  | 'continuity'
  | 'genericity'
  | 'repetition'
  | 'assignment'
  | 'timeout'
  | 'unknown';

export type AcceptanceReason =
  | 'first_pass_clean'
  | 'recovered_after_retry'
  | 'recovered_after_alignment_fix'
  | 'recovered_after_factual_fix'
  | 'recovered_after_repetition_fix'
  | 'budget_exhausted_keeping_best'
  | 'shipped_despite_warnings';

export type AbandonmentReason =
  | 'retry_budget_exhausted'
  | 'no_improvement_across_attempts'
  | 'catastrophic_failure'
  | 'timeout_threshold_breached'
  | 'recovery_strategy_unavailable';

export interface SectionTransitionEntry {
  attempt: number;
  from: SectionLifecycleState;
  to: SectionLifecycleState;
  reason: string;
  failureCategory?: FailureCategory;
  recoveryAction?: string;
  scoreSnapshot?: Record<string, number | undefined>;
  timestamp: string;
}

export interface SectionLifecycleHistoryEntry {
  sectionIndex: number;
  sectionTitle: string;
  finalState: SectionLifecycleState;
  finalAttempt: number;
  acceptanceReason?: AcceptanceReason;
  abandonmentReason?: AbandonmentReason;
  failureCategoriesEncountered: FailureCategory[];
  recoveryActionsApplied: string[];
  transitions: SectionTransitionEntry[];
  /** Stable identifier for regeneration lineage tracking. */
  regenerationLineageId: string;
  startedAt: string;
  finishedAt?: string;
}

// ── Allowed transitions ──────────────────────────────────────────────────────
//
// The lifecycle is strict but generous: any FAILED_* state can move into
// RETRYING (when budget permits) or ABANDONED (when budget is exhausted).
// VALIDATING is the brief between-state where the orchestrator is running
// gates; GENERATED is the post-LLM, pre-validation state.

const ALLOWED_TRANSITIONS: Record<SectionLifecycleState, SectionLifecycleState[]> = {
  [SectionLifecycleState.PLANNED]: [
    SectionLifecycleState.GENERATED,
    SectionLifecycleState.FAILED_TIMEOUT,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.GENERATED]: [
    SectionLifecycleState.VALIDATING,
    SectionLifecycleState.ACCEPTED,
  ],
  [SectionLifecycleState.VALIDATING]: [
    SectionLifecycleState.ACCEPTED,
    SectionLifecycleState.FAILED_ALIGNMENT,
    SectionLifecycleState.FAILED_FACTUAL,
    SectionLifecycleState.FAILED_CONTINUITY,
    SectionLifecycleState.FAILED_REPETITION,
    SectionLifecycleState.FAILED_ASSIGNMENT,
  ],
  [SectionLifecycleState.FAILED_ALIGNMENT]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.FAILED_FACTUAL]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.FAILED_CONTINUITY]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.FAILED_REPETITION]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.FAILED_ASSIGNMENT]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.FAILED_TIMEOUT]: [
    SectionLifecycleState.RETRYING,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.RETRYING]: [
    SectionLifecycleState.GENERATED,
    SectionLifecycleState.FAILED_TIMEOUT,
    SectionLifecycleState.ABANDONED,
  ],
  [SectionLifecycleState.RECOVERED]: [
    SectionLifecycleState.ACCEPTED,
  ],
  [SectionLifecycleState.ACCEPTED]: [],
  [SectionLifecycleState.ABANDONED]: [],
};

// ── Manager ─────────────────────────────────────────────────────────────────

export class SectionLifecycleManager {
  private entries = new Map<number, SectionLifecycleHistoryEntry>();

  private stableId(sectionIndex: number, title: string): string {
    return `lin_${sectionIndex}_${title.replace(/\s+/g, '_').slice(0, 40)}_${Date.now().toString(36).slice(-6)}`;
  }

  startSection(sectionIndex: number, sectionTitle: string): SectionLifecycleHistoryEntry {
    const entry: SectionLifecycleHistoryEntry = {
      sectionIndex,
      sectionTitle,
      finalState: SectionLifecycleState.PLANNED,
      finalAttempt: 1,
      failureCategoriesEncountered: [],
      recoveryActionsApplied: [],
      transitions: [],
      regenerationLineageId: this.stableId(sectionIndex, sectionTitle),
      startedAt: new Date().toISOString(),
    };
    this.entries.set(sectionIndex, entry);
    return entry;
  }

  transition(
    sectionIndex: number,
    to: SectionLifecycleState,
    options: {
      attempt: number;
      reason: string;
      failureCategory?: FailureCategory;
      recoveryAction?: string;
      scoreSnapshot?: Record<string, number | undefined>;
    },
  ): { ok: true } | { ok: false; reason: string } {
    const entry = this.entries.get(sectionIndex);
    if (!entry) return { ok: false, reason: 'section_not_started' };
    const from = entry.finalState;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      // Soft fail — record the transition with a marker so we can surface
      // illegal transitions in diagnostics without crashing generation.
      entry.transitions.push({
        attempt: options.attempt,
        from,
        to,
        reason: `ILLEGAL_TRANSITION: ${options.reason}`,
        failureCategory: options.failureCategory,
        recoveryAction: options.recoveryAction,
        scoreSnapshot: options.scoreSnapshot,
        timestamp: new Date().toISOString(),
      });
      return { ok: false, reason: `illegal_transition_${from}_to_${to}` };
    }
    entry.transitions.push({
      attempt: options.attempt,
      from,
      to,
      reason: options.reason,
      failureCategory: options.failureCategory,
      recoveryAction: options.recoveryAction,
      scoreSnapshot: options.scoreSnapshot,
      timestamp: new Date().toISOString(),
    });
    entry.finalState = to;
    entry.finalAttempt = Math.max(entry.finalAttempt, options.attempt);
    if (options.failureCategory && !entry.failureCategoriesEncountered.includes(options.failureCategory)) {
      entry.failureCategoriesEncountered.push(options.failureCategory);
    }
    if (options.recoveryAction && !entry.recoveryActionsApplied.includes(options.recoveryAction)) {
      entry.recoveryActionsApplied.push(options.recoveryAction);
    }
    return { ok: true };
  }

  accept(sectionIndex: number, attempt: number, reason: AcceptanceReason): void {
    const entry = this.entries.get(sectionIndex);
    if (!entry) return;
    if (entry.finalState !== SectionLifecycleState.ACCEPTED) {
      this.transition(sectionIndex, SectionLifecycleState.ACCEPTED, {
        attempt,
        reason: `accepted: ${reason}`,
      });
    }
    entry.acceptanceReason = reason;
    entry.finishedAt = new Date().toISOString();
  }

  abandon(sectionIndex: number, attempt: number, reason: AbandonmentReason, contextualReason: string): void {
    const entry = this.entries.get(sectionIndex);
    if (!entry) return;
    if (entry.finalState !== SectionLifecycleState.ABANDONED) {
      this.transition(sectionIndex, SectionLifecycleState.ABANDONED, {
        attempt,
        reason: `abandoned: ${contextualReason}`,
      });
    }
    entry.abandonmentReason = reason;
    entry.finishedAt = new Date().toISOString();
  }

  getHistory(): SectionLifecycleHistoryEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.sectionIndex - b.sectionIndex);
  }

  getSection(sectionIndex: number): SectionLifecycleHistoryEntry | undefined {
    return this.entries.get(sectionIndex);
  }
}

/**
 * Convenience: classify a governance failure_reasons[] from
 * `plannedEngineStabilityTelemetry.SectionGovernancePayload` into the
 * dominant lifecycle failure state.
 */
export function classifyFailureToLifecycleState(
  failureReasons: readonly string[],
): SectionLifecycleState | null {
  if (failureReasons.length === 0) return null;
  // Priority order: timeout > factual > alignment > continuity/genericity >
  // repetition > assignment. Higher-priority failures preempt lower ones in
  // a single attempt's classification.
  if (failureReasons.includes('timeout')) return SectionLifecycleState.FAILED_TIMEOUT;
  if (failureReasons.includes('factual')) return SectionLifecycleState.FAILED_FACTUAL;
  if (failureReasons.includes('company_alignment')) return SectionLifecycleState.FAILED_ALIGNMENT;
  if (failureReasons.includes('continuity') || failureReasons.includes('genericity')) return SectionLifecycleState.FAILED_CONTINUITY;
  if (failureReasons.includes('semantic_repetition')) return SectionLifecycleState.FAILED_REPETITION;
  if (failureReasons.includes('strategic_assignment_consumption')) return SectionLifecycleState.FAILED_ASSIGNMENT;
  return SectionLifecycleState.FAILED_ALIGNMENT;
}
