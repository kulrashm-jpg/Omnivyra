/**
 * Centralized planner budget governance.
 *
 * The campaign planner runs a sequence of phases (drafting → parsing →
 * validation → alignment → refinement). Each individual phase already has a
 * local timeout (`DRAFTING_BUDGET_MS`, `ALIGNMENT_BUDGET_MS`,
 * `REPAIR_BUDGET_MS`). This module enforces a *cumulative* cap on top of
 * those locals so a worst-case stacking of every per-phase budget can't blow
 * a full planner request past its overall wall-clock limit.
 *
 * It also exposes a remaining-budget query so optional phases can decline
 * to start when the wall clock is almost gone. Phases are ranked by
 * essentialness:
 *
 *   priority 1: drafting          (must run — without it there is no plan)
 *   priority 2: parsing           (must run — without it the draft is unusable)
 *   priority 3: minimal validation (must run — protects downstream)
 *   priority 4: alignment         (optional — quality signal)
 *   priority 5: refinement        (optional — language polish)
 *
 * `shouldRunOptionalPhase(phase)` returns false when remaining budget < the
 * estimated cost of that phase, so refinement is the first thing to drop.
 *
 * The module is intentionally per-request and per-process — there is no
 * cross-instance coordination here. A separate process running its own
 * planner has its own budget.
 */

import { logger } from './logger';
import { getRequestContext } from './requestContext';

/** Phase identifiers, ordered from most-essential to most-skippable. */
export type PlannerPhase =
  | 'drafting'
  | 'parsing'
  | 'validation'
  | 'alignment'
  | 'refinement';

const PHASE_PRIORITY: Record<PlannerPhase, number> = {
  drafting:   1,
  parsing:    2,
  validation: 3,
  alignment:  4,
  refinement: 5,
};

/** Approximate cost of each optional phase, in milliseconds. Used by
 *  `shouldRunOptionalPhase` to decide whether to even start a phase when the
 *  remaining wall-clock budget is short. Conservative — better to skip a
 *  phase than to start it and timeout mid-call. */
const PHASE_ESTIMATED_MS: Record<PlannerPhase, number> = {
  drafting:   30_000,
  parsing:    1_000,
  validation: 500,
  alignment:  10_000,
  refinement: 8_000,
};

const DEFAULT_TOTAL_BUDGET_MS = 180_000;

export interface PlannerBudgetSnapshot {
  totalBudgetMs: number;
  elapsedMs: number;
  remainingMs: number;
  exceeded: boolean;
  completedPhases: PlannerPhase[];
  skippedPhases: PlannerPhase[];
}

export class PlannerBudget {
  readonly totalBudgetMs: number;
  readonly startedAt: number;
  readonly campaignId: string;

  private completedPhases: Set<PlannerPhase> = new Set();
  private skippedPhases: Set<PlannerPhase> = new Set();
  private exceededLogged = false;

  constructor(opts: { campaignId: string; totalBudgetMs?: number }) {
    this.campaignId = opts.campaignId;
    const fromEnv = Number(process.env.PLANNER_TOTAL_BUDGET_MS || DEFAULT_TOTAL_BUDGET_MS);
    const requested = opts.totalBudgetMs ?? fromEnv;
    this.totalBudgetMs = Math.max(1000, Number.isFinite(requested) ? requested : DEFAULT_TOTAL_BUDGET_MS);
    this.startedAt = Date.now();
  }

  /** Milliseconds elapsed since the budget started. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Milliseconds remaining before the global budget is exceeded. Floored at 0. */
  remainingMs(): number {
    return Math.max(0, this.totalBudgetMs - this.elapsedMs());
  }

  /** True once the global budget has been exhausted. Logs a single warning
   *  on first observation; subsequent observations stay silent so the alert
   *  channel doesn't spam. */
  isExceeded(): boolean {
    const exceeded = this.elapsedMs() >= this.totalBudgetMs;
    if (exceeded && !this.exceededLogged) {
      this.exceededLogged = true;
      logger.warn('planner_total_budget_exceeded', {
        request_id: getRequestContext().requestId,
        campaign_id: this.campaignId,
        total_budget_ms: this.totalBudgetMs,
        elapsed_ms: this.elapsedMs(),
        completed_phases: Array.from(this.completedPhases),
      });
    }
    return exceeded;
  }

  /**
   * Should an OPTIONAL phase run, given the remaining budget?
   *
   * Returns true unconditionally for essential phases (drafting / parsing /
   * validation) since skipping them produces no usable artifact.
   *
   * For optional phases (alignment / refinement), returns true only when the
   * remaining budget covers the phase's estimated cost AND a small safety
   * margin (1s) for downstream wrap-up. Refinement is the highest-priority
   * skip because it adds polish, not correctness.
   */
  shouldRunOptionalPhase(phase: PlannerPhase): boolean {
    // Essential phases are always allowed to attempt.
    if (PHASE_PRIORITY[phase] <= 3) return true;
    if (this.isExceeded()) return false;
    const remaining = this.remainingMs();
    const required = PHASE_ESTIMATED_MS[phase] + 1000;
    return remaining >= required;
  }

  /**
   * Compute a phase-local budget that respects the global ceiling.
   * Returns min(requestedBudgetMs, remainingMs). Useful for shaping a phase's
   * own AbortController setTimeout — never wait longer than the global budget
   * still allows.
   */
  phaseBudgetMs(requestedBudgetMs: number): number {
    const remaining = this.remainingMs();
    return Math.max(0, Math.min(requestedBudgetMs, remaining));
  }

  markPhaseCompleted(phase: PlannerPhase): void {
    this.completedPhases.add(phase);
    this.skippedPhases.delete(phase);
  }

  markPhaseSkipped(phase: PlannerPhase, reason?: string): void {
    if (this.completedPhases.has(phase)) return;
    this.skippedPhases.add(phase);
    logger.info('planner_phase_skipped', {
      request_id: getRequestContext().requestId,
      campaign_id: this.campaignId,
      phase,
      reason: reason ?? 'budget_constraint',
      remaining_ms: this.remainingMs(),
      total_budget_ms: this.totalBudgetMs,
    });
  }

  snapshot(): PlannerBudgetSnapshot {
    return {
      totalBudgetMs: this.totalBudgetMs,
      elapsedMs: this.elapsedMs(),
      remainingMs: this.remainingMs(),
      exceeded: this.elapsedMs() >= this.totalBudgetMs,
      completedPhases: Array.from(this.completedPhases),
      skippedPhases: Array.from(this.skippedPhases),
    };
  }
}
