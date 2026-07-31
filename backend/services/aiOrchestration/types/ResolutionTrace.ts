/**
 * ResolutionTrace.ts — the Resolution Trace CONTRACT (AI-ORCH 2B.1B).
 *
 * Defines the SHAPE of an execution-resolution trace — the HOW: the ordered
 * sequence of decisions the (future) Configuration Resolver made to turn a
 * capability request into a concrete execution plan.
 *
 * CONTRACT ONLY. This file declares types. It:
 *   - generates NO traces,
 *   - persists NO traces,
 *   - is imported by NOTHING in 2B.1B (dormant).
 * A later phase (the resolver / observability) will produce values of these types;
 * nothing here runs or changes behavior.
 *
 * Cross-references (all persisted catalogs / columns already exist):
 *   - `decisionCode` → ai_resolution_decision_codes.code   (WHAT was decided)
 *   - `reasonCode`   → ai_resolution_reason_codes.code      (WHY it was decided)
 *   - `source`       → usage_events.resolution_source        (WHERE it came from)
 */

/**
 * Precedence layer a configuration was resolved from. Mirrors
 * usage_events.resolution_source and the binding scopes.
 */
export type ResolutionSource =
  | 'capability_override'
  | 'org_default'
  | 'capability_default'
  | 'platform_default'
  | 'legacy_hardcoded';

/**
 * One step in a resolution trace. Every field except `sequence`/`step` is optional
 * so a step can carry as little or as much explanation as it has.
 */
export interface ResolutionTraceStep {
  /** 0-based position of this step within the trace (ordering is significant). */
  sequence: number;
  /** Human-readable label for the step (e.g. 'resolve binding', 'select model'). */
  step: string;
  /** WHAT was decided — a `ai_resolution_decision_codes.code`. */
  decisionCode?: string;
  /** WHY — a `ai_resolution_reason_codes.code`. */
  reasonCode?: string;
  /** WHERE the configuration came from. */
  source?: ResolutionSource;
  /** Placeholder values + context for the decision/reason message templates. */
  metadata?: Record<string, unknown>;
  /** Optional wall-clock cost of this step, for future performance diagnostics. */
  durationMs?: number;
}

/**
 * A full resolution trace: the ordered list of steps that produced an execution
 * plan. Purely descriptive — a trace never influences a decision.
 */
export interface ResolutionTrace {
  /** Steps in resolution order (each carries its own `sequence`). */
  steps: ResolutionTraceStep[];
  /** Optional total resolution time across all steps. */
  totalDurationMs?: number;
}
