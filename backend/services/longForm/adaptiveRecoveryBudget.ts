/**
 * adaptiveRecoveryBudget.ts
 *
 * Phase 4.1 — Replaces the fixed `repairedSections.length >= 3` cap with
 * a budget that adapts to article complexity, failure mix, severity,
 * retry effectiveness, and elapsed time.
 *
 * Inputs feed deterministic budget math (no LLM, no I/O) so the budget
 * is reproducible from the same orchestrator state.
 *
 * Returned shape:
 *   maxRepairs                 — overall ceiling on selective repairs
 *   maxRetriesPerSection       — soft cap that overlays the orchestrator's
 *                                per-section attempt counter
 *   earlyStopThreshold         — pass-rate that stops repairs early
 *   diminishingReturnThreshold — improvement-delta that stops the loop
 *   escalationStrategy         — how to escalate when budget thins
 */

export type IssueCategory =
  | 'alignment'
  | 'factual'
  | 'continuity'
  | 'genericity'
  | 'repetition'
  | 'assignment'
  | 'unknown';

export type IssueSeverity = 'low' | 'moderate' | 'severe' | 'catastrophic';

export type EscalationStrategy =
  | 'STANDARD'           // normal selective repairs, contract-driven hints
  | 'CHEAP_ALIGNMENT'    // alignment-only failures → cheap, fast retries
  | 'TARGETED_REPETITION'// repetition-only failures → only flagged sections
  | 'EARLY_ABORT'        // catastrophic state → stop and ship
  | 'COMPACT_RECOVERY';  // many failures + thin time budget → compress prompts

export interface AdaptiveRecoveryBudget {
  maxRepairs: number;
  maxRetriesPerSection: number;
  earlyStopThreshold: number;            // 0..1 — pass-rate above which to stop
  diminishingReturnThreshold: number;    // minimum improvement delta to keep iterating
  escalationStrategy: EscalationStrategy;
  reasoning: string[];                   // human-readable trace for diagnostics
}

export interface ComputeAdaptiveRecoveryBudgetInput {
  total_sections: number;
  failed_sections: number;
  /** Map issue categories to count of sections affected. */
  severity_distribution: Partial<Record<IssueSeverity, number>>;
  /** Sections grouped by which validator(s) flagged them. */
  issue_categories: Partial<Record<IssueCategory, number>>;
  /** Average across attempted retries — `improved` boolean rate, 0..1. */
  retry_improvement_rate?: number;
  content_type: string;
  /** Elapsed time so far (ms) — used to detect we're approaching deadlines. */
  generation_duration_ms: number;
  /** Optional hard cap from caller (e.g. STRICT mode). */
  hardCeiling?: number;
}

// ── Budget math ──────────────────────────────────────────────────────────────

function categoryCount(input: ComputeAdaptiveRecoveryBudgetInput, cat: IssueCategory): number {
  return input.issue_categories[cat] ?? 0;
}

function severityCount(input: ComputeAdaptiveRecoveryBudgetInput, sev: IssueSeverity): number {
  return input.severity_distribution[sev] ?? 0;
}

function isAlignmentOnly(input: ComputeAdaptiveRecoveryBudgetInput): boolean {
  const total = (Object.values(input.issue_categories) as number[]).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0) return false;
  const alignment = categoryCount(input, 'alignment');
  return alignment === total;
}

function isRepetitionOnly(input: ComputeAdaptiveRecoveryBudgetInput): boolean {
  const total = (Object.values(input.issue_categories) as number[]).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0) return false;
  const repetition = categoryCount(input, 'repetition');
  return repetition === total;
}

function isCatastrophic(input: ComputeAdaptiveRecoveryBudgetInput): boolean {
  if (input.total_sections === 0) return false;
  const catastrophicShare = severityCount(input, 'catastrophic') / input.total_sections;
  const severeShare = severityCount(input, 'severe') / input.total_sections;
  if (catastrophicShare >= 0.5) return true;
  if (input.failed_sections / input.total_sections >= 0.75 && severeShare >= 0.4) return true;
  return false;
}

const DURATION_PRESSURE_MS = 180_000;    // beyond 3 min, budget shrinks
const DURATION_HARD_LIMIT_MS = 300_000;  // beyond 5 min, force early abort

export function computeAdaptiveRecoveryBudget(
  input: ComputeAdaptiveRecoveryBudgetInput,
): AdaptiveRecoveryBudget {
  const reasoning: string[] = [];

  // ── Hard guards ────────────────────────────────────────────────────────
  if (input.failed_sections === 0) {
    reasoning.push('No failed sections; budget is zero (clean article).');
    return {
      maxRepairs: 0,
      maxRetriesPerSection: 0,
      earlyStopThreshold: 1.0,
      diminishingReturnThreshold: 1.0,
      escalationStrategy: 'STANDARD',
      reasoning,
    };
  }
  if (input.generation_duration_ms >= DURATION_HARD_LIMIT_MS) {
    reasoning.push(`Duration ${input.generation_duration_ms}ms exceeds hard limit ${DURATION_HARD_LIMIT_MS}ms — early abort.`);
    return {
      maxRepairs: 0,
      maxRetriesPerSection: 0,
      earlyStopThreshold: 0,
      diminishingReturnThreshold: 1.0,
      escalationStrategy: 'EARLY_ABORT',
      reasoning,
    };
  }
  if (isCatastrophic(input)) {
    reasoning.push('Catastrophic failure distribution detected — limit repairs to 1 and ship best-of.');
    return {
      maxRepairs: 1,
      maxRetriesPerSection: 1,
      earlyStopThreshold: 0,
      diminishingReturnThreshold: 8,
      escalationStrategy: 'EARLY_ABORT',
      reasoning,
    };
  }

  // ── Baseline budget — proportional to section count + failure mix ─────
  // Floor: 1 repair (we always allow at least one).
  // Ceiling: half of total sections, but never more than failed_sections,
  // and never more than the caller-supplied hardCeiling.
  const proportional = Math.ceil(input.total_sections / 2);
  let maxRepairs = Math.min(proportional, input.failed_sections);

  // ── Alignment-only → generous, cheap retries ───────────────────────────
  if (isAlignmentOnly(input)) {
    maxRepairs = Math.min(input.failed_sections, Math.max(2, Math.ceil(input.total_sections * 0.6)));
    reasoning.push(`Alignment-only failures → expand budget to ${maxRepairs} (cheap retries).`);
  }

  // ── Repetition-only → targeted, max 2 selective repairs ────────────────
  if (isRepetitionOnly(input)) {
    maxRepairs = Math.min(maxRepairs, 2);
    reasoning.push(`Repetition-only failures → cap at 2 targeted regenerations.`);
  }

  // ── Duration pressure → shrink ──────────────────────────────────────────
  if (input.generation_duration_ms >= DURATION_PRESSURE_MS) {
    const before = maxRepairs;
    maxRepairs = Math.max(1, Math.floor(maxRepairs / 2));
    reasoning.push(`Duration ${input.generation_duration_ms}ms exceeds pressure threshold; shrink ${before} → ${maxRepairs}.`);
  }

  // ── Retry effectiveness ────────────────────────────────────────────────
  // If past retries have improved fewer than 25% of attempts, we are
  // probably wasting cycles. Reduce budget. Conversely, if improvements
  // are landing, keep iterating.
  const retryEffective = input.retry_improvement_rate ?? 0.5;
  if (retryEffective < 0.25 && maxRepairs > 1) {
    const before = maxRepairs;
    maxRepairs = Math.max(1, maxRepairs - 1);
    reasoning.push(`Retry improvement rate ${retryEffective.toFixed(2)} below 0.25 — reduce ${before} → ${maxRepairs}.`);
  }

  // ── Hard ceiling override ─────────────────────────────────────────────
  if (typeof input.hardCeiling === 'number' && input.hardCeiling >= 0) {
    if (maxRepairs > input.hardCeiling) {
      reasoning.push(`Hard ceiling ${input.hardCeiling} clamps ${maxRepairs}.`);
      maxRepairs = input.hardCeiling;
    }
  }

  // ── Per-section retries ───────────────────────────────────────────────
  // Default 2 attempts per section, escalate to 3 for alignment-only (it
  // tends to land with one extra pass), reduce to 1 when budget pressure
  // is high.
  let maxRetriesPerSection = 2;
  if (isAlignmentOnly(input)) maxRetriesPerSection = 3;
  if (input.generation_duration_ms >= DURATION_PRESSURE_MS) maxRetriesPerSection = Math.min(maxRetriesPerSection, 1);

  // ── Early-stop + diminishing-return thresholds ───────────────────────
  // earlyStopThreshold: stop if pass-rate exceeds this (we're at a good
  // article).
  // diminishingReturnThreshold: stop if last retry didn't improve scores
  // by at least this many points.
  const earlyStopThreshold = 0.92;
  const diminishingReturnThreshold = isAlignmentOnly(input) ? 1 : 3;

  // ── Escalation strategy ───────────────────────────────────────────────
  let escalationStrategy: EscalationStrategy = 'STANDARD';
  if (isAlignmentOnly(input)) escalationStrategy = 'CHEAP_ALIGNMENT';
  else if (isRepetitionOnly(input)) escalationStrategy = 'TARGETED_REPETITION';
  if (input.generation_duration_ms >= DURATION_PRESSURE_MS) escalationStrategy = 'COMPACT_RECOVERY';

  return {
    maxRepairs,
    maxRetriesPerSection,
    earlyStopThreshold,
    diminishingReturnThreshold,
    escalationStrategy,
    reasoning,
  };
}
