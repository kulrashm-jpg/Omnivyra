/**
 * sectionExecutionStrategy.ts
 *
 * Phase 4.5 — Timeout-resilient section execution.
 *
 * Timeouts are now a top failure source for the planned-engine path.
 * This module turns timeout handling from a per-call accident into an
 * explicit policy with four modes:
 *
 *   - NORMAL              full prompt, full word target, baseline timeout
 *   - COMPACT_RETRY       trim boilerplate, keep strategic anchors, shorter timeout
 *   - EMERGENCY_REDUCTION shrink evidence requirements, reduce word target ~40%
 *   - MINIMAL_RECOVERY    ship a structural shell — identity + outline only,
 *                         used only when budget is exhausted
 *
 * The orchestrator picks a mode based on retry history and timeout
 * telemetry. The section generator consumes the mode to prune its
 * system prompt and adjust max_tokens / timeout before the model call.
 */

import type { SectionGenerationContract } from './longFormRecommendationTypes';
// Phase 8.1 — Runtime stabilizer (per-content-type overrides applied at runtime).
import { getContentTypeStabilizer } from './contentTypeStabilizers';
import { hasActiveAction as hasActiveHealingAction } from './selfHealingCoordinator';

export type SectionExecutionStrategy =
  | 'NORMAL'
  | 'COMPACT_RETRY'
  | 'EMERGENCY_REDUCTION'
  | 'MINIMAL_RECOVERY';

export interface SectionExecutionDirectives {
  strategy: SectionExecutionStrategy;
  /** Recommended `max_tokens` override. */
  maxTokens: number;
  /** Recommended provider timeout ms — fed to the gateway. */
  timeoutMs: number;
  /** Prompt pruning toggles consumed by the section generator. */
  promptPruning: {
    dropFactualIntegritySection: boolean;
    dropGroundedConstraintsSection: boolean;
    dropAvoidPatterns: boolean;
    dropTerminologyEmphasis: boolean;
    truncateIdentityLockToOneLine: boolean;
    skipStrategicAssignment: boolean;
  };
  /** Word target override (some modes intentionally shrink the ask). */
  wordTargetOverride?: number;
  /** Diagnostic reason for the chosen mode. */
  reasoning: string;
}

export interface ChooseExecutionStrategyInput {
  contract: SectionGenerationContract;
  attempt: number;
  /** Total consecutive timeout failures observed for THIS section so far. */
  timeoutFailureCount: number;
  /** Whether the previous attempt timed out specifically. */
  previousAttemptTimedOut: boolean;
  /** Total elapsed time on this section (ms). */
  sectionElapsedMs: number;
  /** Optional escalation hint from the recovery coordinator. */
  recoveryEscalationStrategy?:
    | 'STANDARD'
    | 'CHEAP_ALIGNMENT'
    | 'TARGETED_REPETITION'
    | 'EARLY_ABORT'
    | 'COMPACT_RECOVERY';
  /**
   * Phase 7.4 — Planner-emitted per-section profile (target_words /
   * timeout_budget_ms / compression_risk / grounding_density /
   * strategic_density / retry_risk). When provided, the strategy
   * picker prefers these values over the contract's static fields.
   */
  sectionGenerationProfile?: {
    target_words: number;
    timeout_budget_ms: number;
    compression_risk: 'low' | 'moderate' | 'high';
    grounding_density: number;
    strategic_density: number;
    retry_risk: number;
  };
}

const BASELINE_TIMEOUT_MS_SMALL = 90_000;
const BASELINE_TIMEOUT_MS_NORMAL = 180_000;
const BASELINE_TIMEOUT_MS_LARGE = 240_000;

function sizeBaseline(wordTarget: number): number {
  if (wordTarget <= 250) return BASELINE_TIMEOUT_MS_SMALL;
  if (wordTarget <= 700) return BASELINE_TIMEOUT_MS_NORMAL;
  return BASELINE_TIMEOUT_MS_LARGE;
}

export function chooseSectionExecutionStrategy(
  input: ChooseExecutionStrategyInput,
): SectionExecutionDirectives {
  // Phase 7.4 — Prefer planner-emitted profile values over the static
  // contract. When the planner adapted the section (smaller because
  // grounded, larger because narrative, …) the runtime should follow.
  const profile = input.sectionGenerationProfile;
  const rawWordTarget = profile?.target_words ?? input.contract.wordTarget ?? 350;
  // Phase 9.1 — `reduce_section_sizing` self-healing action shrinks all
  // subsequent sizing/budget calculations for this content type.
  const healingShrinkSection = hasActiveHealingAction('reduce_section_sizing', input.contract.contentType);
  const wt = healingShrinkSection ? Math.max(140, Math.round(rawWordTarget * 0.85)) : rawWordTarget;

  // Phase 8.1 — Runtime stabilizer overlay. Applies per-content-type
  // timeout caps and compression bias on top of profile-driven values.
  const runtimeStabilizer = getContentTypeStabilizer(input.contract.contentType).runtime;
  const profileTimeoutCeiling = profile?.timeout_budget_ms;
  const baselineTimeoutRaw = profileTimeoutCeiling
    ? Math.min(profileTimeoutCeiling, sizeBaseline(wt))
    : sizeBaseline(wt);
  const baselineTimeout = Math.min(baselineTimeoutRaw, runtimeStabilizer.timeoutBudgetCapMs);

  const tokenBaseline = Math.min(5000, Math.max(1600, Math.round(wt * 3.2)));
  const groundingHeavy = (profile?.grounding_density ?? 0) >= 4;
  const strategicHeavy = (profile?.strategic_density ?? 0) >= 0.65;
  const narrativeHeavy = (profile?.strategic_density ?? 0) < 0.4;
  const highRetryRisk = (profile?.retry_risk ?? 0) >= 0.6;
  // Phase 8.1: compression_risk = profile's value upgraded by stabilizer bias.
  const baseCompressionRisk = profile?.compression_risk ?? 'moderate';
  const stabilizerCompressionRisk: 'low' | 'moderate' | 'high' =
    runtimeStabilizer.compressionAggressivenessBias === 'tighter'
      ? (baseCompressionRisk === 'low' ? 'moderate' : 'high')
      : runtimeStabilizer.compressionAggressivenessBias === 'looser'
        ? (baseCompressionRisk === 'high' ? 'moderate' : baseCompressionRisk === 'moderate' ? 'low' : 'low')
        : baseCompressionRisk;
  // Phase 9.1 — Active self-healing actions further tighten compression
  // for this section's content type.
  const healingCompressionBias = hasActiveHealingAction('increase_compression_bias', input.contract.contentType);
  const compressionRisk: 'low' | 'moderate' | 'high' =
    healingCompressionBias
      ? (stabilizerCompressionRisk === 'low' ? 'moderate' : 'high')
      : stabilizerCompressionRisk;

  // ── MINIMAL_RECOVERY ───────────────────────────────────────────────────
  // Triggered when: 2+ timeouts on this section, OR coordinator explicitly
  // requests it. Strip almost everything except identity + outline.
  if (input.timeoutFailureCount >= 2 || input.recoveryEscalationStrategy === 'EARLY_ABORT') {
    return {
      strategy: 'MINIMAL_RECOVERY',
      maxTokens: Math.min(2000, Math.round(wt * 2.5)),
      timeoutMs: Math.min(baselineTimeout, 90_000),
      wordTargetOverride: Math.max(120, Math.round(wt * 0.4)),
      promptPruning: {
        dropFactualIntegritySection: true,
        dropGroundedConstraintsSection: true,
        dropAvoidPatterns: true,
        dropTerminologyEmphasis: true,
        truncateIdentityLockToOneLine: true,
        skipStrategicAssignment: true,
      },
      reasoning: `MINIMAL_RECOVERY: ${input.timeoutFailureCount} timeouts on this section; ship structural shell.`,
    };
  }

  // ── EMERGENCY_REDUCTION ────────────────────────────────────────────────
  // Triggered when previous attempt timed out, OR recovery coordinator
  // says COMPACT_RECOVERY. Reduce word target ~40% and shrink boilerplate.
  if (input.previousAttemptTimedOut || input.recoveryEscalationStrategy === 'COMPACT_RECOVERY') {
    return {
      strategy: 'EMERGENCY_REDUCTION',
      maxTokens: Math.min(tokenBaseline, Math.round(wt * 2.2)),
      timeoutMs: Math.min(baselineTimeout, 120_000),
      wordTargetOverride: Math.max(180, Math.round(wt * 0.6)),
      promptPruning: {
        dropFactualIntegritySection: false,
        dropGroundedConstraintsSection: true,
        dropAvoidPatterns: true,
        dropTerminologyEmphasis: false,
        truncateIdentityLockToOneLine: false,
        skipStrategicAssignment: false,
      },
      reasoning: 'EMERGENCY_REDUCTION: previous attempt timed out; reduce word target and shrink boilerplate.',
    };
  }

  // ── Phase 7.4: high-retry-risk forces compact-first even on first attempt ─
  // The planner flagged this section as likely to need retries (complex
  // grounding, high strategic density, …). Front-load the compact path so
  // the first attempt has slack.
  if (input.attempt === 1 && highRetryRisk) {
    return {
      strategy: 'COMPACT_RETRY',
      maxTokens: tokenBaseline,
      timeoutMs: baselineTimeout,
      promptPruning: {
        dropFactualIntegritySection: false,
        dropGroundedConstraintsSection: false,
        dropAvoidPatterns: true,
        dropTerminologyEmphasis: !narrativeHeavy,
        truncateIdentityLockToOneLine: false,
        skipStrategicAssignment: false,
      },
      reasoning: `COMPACT_RETRY (preemptive): planner flagged high retry_risk ${profile?.retry_risk?.toFixed(2)}; trim boilerplate up-front.`,
    };
  }

  // ── COMPACT_RETRY ──────────────────────────────────────────────────────
  // Triggered on any retry (attempt > 1) when no timeout history. We trim
  // the lowest-value boilerplate (avoid_patterns + grounded constraints if
  // no profile) but keep word target unchanged.
  if (input.attempt > 1) {
    return {
      strategy: 'COMPACT_RETRY',
      maxTokens: tokenBaseline,
      timeoutMs: baselineTimeout,
      promptPruning: {
        dropFactualIntegritySection: false,
        // Phase 7.4: grounding-heavy sections preserve grounded constraints
        // even on retry; narrative-heavy can drop them.
        dropGroundedConstraintsSection: !groundingHeavy && narrativeHeavy,
        dropAvoidPatterns: true,
        // Phase 7.4: strategic-heavy sections preserve terminology emphasis.
        dropTerminologyEmphasis: !strategicHeavy,
        truncateIdentityLockToOneLine: false,
        skipStrategicAssignment: false,
      },
      reasoning: `COMPACT_RETRY: retry attempt ${input.attempt}; trim avoid_patterns boilerplate${groundingHeavy ? ' (grounding preserved)' : ''}${strategicHeavy ? ' (terminology preserved)' : ''}.`,
    };
  }

  // ── NORMAL ─────────────────────────────────────────────────────────────
  // Phase 7.4: when planner profile says compression_risk is HIGH, even
  // first attempts shave avoid_patterns + terminology — without this we
  // burn budget on low-value boilerplate.
  const compressionHigh = compressionRisk === 'high';
  return {
    strategy: 'NORMAL',
    maxTokens: tokenBaseline,
    timeoutMs: baselineTimeout,
    promptPruning: {
      dropFactualIntegritySection: false,
      dropGroundedConstraintsSection: false,
      dropAvoidPatterns: compressionHigh,
      dropTerminologyEmphasis: compressionHigh && !strategicHeavy,
      truncateIdentityLockToOneLine: false,
      skipStrategicAssignment: false,
    },
    reasoning: compressionHigh
      ? `NORMAL (compression_risk=high): trim avoid_patterns${!strategicHeavy ? ' + terminology' : ''} on first attempt.`
      : 'NORMAL: first attempt, no timeout history.',
  };
}

// ── Telemetry payload ──────────────────────────────────────────────────────

export interface LongFormSectionTimeoutPayload {
  event: 'LONGFORM_SECTION_TIMEOUT';
  company_id: string | null;
  content_type: string;
  section_index: number;
  attempt_number: number;
  model: string;
  operation: string;
  word_target: number;
  prompt_tokens_estimate?: number;
  output_budget_tokens: number;
  timeout_ms: number;
  completion_phase: 'request_send' | 'awaiting_response' | 'streaming' | 'unknown';
  provider_latency_ms?: number;
  strategy: SectionExecutionStrategy;
  timestamp: string;
}

export function emitSectionTimeoutTelemetry(input: Omit<LongFormSectionTimeoutPayload, 'event' | 'timestamp'>): void {
  const payload: LongFormSectionTimeoutPayload = {
    event: 'LONGFORM_SECTION_TIMEOUT',
    ...input,
    timestamp: new Date().toISOString(),
  };
  console.warn(`[longform-timeout] ${JSON.stringify(payload)}`);
}
