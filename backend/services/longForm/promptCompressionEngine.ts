/**
 * promptCompressionEngine.ts
 *
 * Phase 5.3 — Deterministic prompt compression.
 *
 * Phase 4's execution strategy dropped boilerplate via Boolean toggles
 * (drop_avoid_patterns / drop_factual_integrity / ...). That was
 * heuristic — same toggles always remove the same blocks regardless of
 * how much budget pressure actually exists. This module replaces those
 * heuristics with a deterministic compression pipeline that:
 *
 *   1. Segments the prompt into named blocks (identity, anti_generic,
 *      doctrine, ICP_framing, capability, terminology, avoid_patterns,
 *      factual_integrity, grounded_constraints, evidence_anchors,
 *      strategic_assignment, hard_rules).
 *   2. Ranks each block by load-bearingness (identity = highest priority
 *      to PRESERVE; doctrine = lowest priority to PRESERVE).
 *   3. Drops blocks in priority order until the token budget is met OR
 *      the compression mode allows.
 *   4. Returns the compressed prompt + an audit trail (removed segments,
 *      preserved segments, token reduction, semantic loss estimate).
 *
 * Compression modes (from least → most aggressive):
 *   - NONE        no compression
 *   - LIGHT       drop only verbose duplicated boilerplate
 *   - MODERATE    drop boilerplate + avoid_patterns + terminology
 *   - AGGRESSIVE  drop everything except identity + strategic anchors +
 *                 grounding evidence + assignment
 *   - SURVIVAL    identity-only one-liner + section_goal + word target
 */

// ── Public types ─────────────────────────────────────────────────────────────

export type PromptCompressionMode =
  | 'NONE'
  | 'LIGHT'
  | 'MODERATE'
  | 'AGGRESSIVE'
  | 'SURVIVAL';

export type PromptSegmentKind =
  | 'identity'              // PRESERVE FIRST
  | 'strategic_differentiators'
  | 'icp_context'
  | 'assignment_anchors'
  | 'grounding_evidence'
  | 'hard_rules'
  | 'capability_emphasis'
  | 'strategic_anchors'
  | 'anti_generic'          // COMPRESSIBLE
  | 'doctrine'
  | 'avoid_patterns'
  | 'terminology'
  | 'factual_integrity'
  | 'grounded_constraints'
  | 'formatting_guidance'
  | 'examples'
  | 'other';

export interface PromptSegment {
  kind: PromptSegmentKind;
  /** Human-readable label shown in audit trail. */
  label: string;
  body: string;
  /** Estimated tokens (chars / 4). */
  tokens: number;
}

export interface CompressedPromptResult {
  compressedPrompt: string;
  mode: PromptCompressionMode;
  removedSegments: Array<{ kind: PromptSegmentKind; label: string; tokens: number }>;
  preservedSegments: Array<{ kind: PromptSegmentKind; label: string; tokens: number }>;
  /** Original tokens minus final tokens. */
  tokenReduction: number;
  /** Final token estimate after compression. */
  finalTokens: number;
  /** Original token estimate before compression. */
  originalTokens: number;
  /**
   * 0..100 — a rough estimate of how much semantic content was lost.
   * 0 means "no compression"; 100 means "SURVIVAL mode" (most context gone).
   */
  semanticLossEstimate: number;
  reasoning: string[];
}

// ── Phase 7.6 — CompressionEvent (propagation contract) ─────────────────────
//
// Emitted per compression invocation so downstream observers can populate
// `operationalExplainability.compressionReasoning[]` without re-deriving
// state from telemetry.

export interface CompressionEvent {
  /** Section the compression ran for (null for non-section prompts). */
  sectionIndex: number | null;
  /** Which call site triggered compression. */
  trigger:
    | 'first_attempt'
    | 'compact_retry'
    | 'emergency_reduction'
    | 'minimal_recovery'
    | 'timeout_recovery';
  mode: PromptCompressionMode;
  originalTokens: number;
  finalTokens: number;
  tokenReduction: number;
  reductionPct: number;
  semanticLossEstimate: number;
  droppedSegmentLabels: string[];
  preservedSegmentLabels: string[];
  reasoning: string[];
  timestamp: string;
}

export function buildCompressionEvent(input: {
  sectionIndex: number | null;
  trigger: CompressionEvent['trigger'];
  result: CompressedPromptResult;
}): CompressionEvent {
  const reductionPct = input.result.originalTokens > 0
    ? Math.round(((input.result.originalTokens - input.result.finalTokens) / input.result.originalTokens) * 100)
    : 0;
  return {
    sectionIndex: input.sectionIndex,
    trigger: input.trigger,
    mode: input.result.mode,
    originalTokens: input.result.originalTokens,
    finalTokens: input.result.finalTokens,
    tokenReduction: input.result.tokenReduction,
    reductionPct,
    semanticLossEstimate: input.result.semanticLossEstimate,
    droppedSegmentLabels: input.result.removedSegments.map((s) => s.label),
    preservedSegmentLabels: input.result.preservedSegments.map((s) => s.label),
    reasoning: input.result.reasoning,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convenience: derive the right `CompressionEvent.trigger` from the
 * Phase 4.5 SectionExecutionStrategy mode.
 */
export function triggerFromExecutionStrategy(strategy: string | undefined): CompressionEvent['trigger'] {
  switch (strategy) {
    case 'COMPACT_RETRY':       return 'compact_retry';
    case 'EMERGENCY_REDUCTION': return 'emergency_reduction';
    case 'MINIMAL_RECOVERY':    return 'minimal_recovery';
    case 'NORMAL':              return 'first_attempt';
    default:                    return 'first_attempt';
  }
}

// ── Priorities ───────────────────────────────────────────────────────────────
//
// PRESERVE FIRST  — never dropped, even in SURVIVAL (except where we
//                   collapse identity to a one-liner).
// COMPRESSIBLE    — dropped in priority order based on mode.
//
// Number = drop-order priority. Lower number = dropped first.

const DROP_ORDER: Record<PromptSegmentKind, number> = {
  // PRESERVE FIRST (negative → never dropped)
  identity: -100,
  strategic_differentiators: -90,
  icp_context: -80,
  assignment_anchors: -70,
  grounding_evidence: -60,
  hard_rules: -50,
  capability_emphasis: -40,
  strategic_anchors: -30,

  // COMPRESSIBLE — dropped in this order:
  formatting_guidance: 10,     // dropped first under LIGHT
  examples: 20,
  doctrine: 30,
  avoid_patterns: 40,          // dropped at LIGHT+
  terminology: 50,             // dropped at MODERATE+
  anti_generic: 60,            // dropped at AGGRESSIVE+
  factual_integrity: 70,       // dropped at AGGRESSIVE+
  grounded_constraints: 80,    // dropped at AGGRESSIVE+
  other: 90,
};

const MODE_THRESHOLD: Record<PromptCompressionMode, number> = {
  NONE: -1,            // drop nothing
  LIGHT: 20,           // drop kinds with order <= 20  (formatting, examples)
  MODERATE: 50,        // + doctrine, avoid_patterns, terminology
  AGGRESSIVE: 80,      // + anti_generic, factual_integrity, grounded_constraints
  SURVIVAL: 99,        // + other (everything except PRESERVE FIRST list)
};

const MODE_SEMANTIC_LOSS: Record<PromptCompressionMode, number> = {
  NONE: 0,
  LIGHT: 8,
  MODERATE: 25,
  AGGRESSIVE: 50,
  SURVIVAL: 78,
};

// ── Segment helpers ──────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function makeSegment(kind: PromptSegmentKind, label: string, body: string): PromptSegment {
  const trimmed = body.replace(/\n{3,}/g, '\n\n').trimEnd();
  return { kind, label, body: trimmed, tokens: estimateTokens(trimmed) };
}

// ── Mode selection ───────────────────────────────────────────────────────────

export interface SelectCompressionModeInput {
  totalInputTokens: number;
  /** Model input limit. */
  modelInputLimit: number;
  /** Output budget tokens that must coexist with input. */
  outputBudgetTokens: number;
  /** Number of timeout failures observed on THIS section. */
  timeoutFailures: number;
  /** Whether previous attempt was timeout. */
  previousAttemptTimedOut: boolean;
  /** Whether we are in the per-section retry loop (attempt > 1). */
  isRetry: boolean;
}

/**
 * Pick a compression mode based on input pressure + retry context.
 *   - 2+ timeouts on this section → SURVIVAL
 *   - 1 timeout + retry           → AGGRESSIVE
 *   - input+output > 70% of limit → AGGRESSIVE
 *   - retry without timeout       → MODERATE
 *   - input > 50% of limit        → LIGHT
 *   - else                        → NONE
 */
export function selectCompressionMode(input: SelectCompressionModeInput): PromptCompressionMode {
  if (input.timeoutFailures >= 2) return 'SURVIVAL';
  const totalBudget = input.totalInputTokens + input.outputBudgetTokens;
  const limit = input.modelInputLimit;
  if (input.previousAttemptTimedOut) return 'AGGRESSIVE';
  if (limit > 0 && totalBudget / limit > 0.7) return 'AGGRESSIVE';
  if (input.isRetry) return 'MODERATE';
  if (limit > 0 && input.totalInputTokens / limit > 0.5) return 'LIGHT';
  return 'NONE';
}

// ── Compression ──────────────────────────────────────────────────────────────

export interface CompressPromptInput {
  segments: PromptSegment[];
  mode: PromptCompressionMode;
  /**
   * Optional final-token target. When set, compression continues even
   * past the mode threshold until budget is met (within the priority
   * envelope: PRESERVE FIRST blocks are never touched).
   */
  targetTokens?: number;
}

export function compressPrompt(input: CompressPromptInput): CompressedPromptResult {
  const reasoning: string[] = [];
  const threshold = MODE_THRESHOLD[input.mode];
  const original = input.segments.reduce((sum, s) => sum + s.tokens, 0);
  reasoning.push(`Mode=${input.mode}; original tokens=${original}.`);

  // Step 1: drop segments whose drop-order is at or below the mode threshold.
  let kept: PromptSegment[] = input.segments.filter((s) => DROP_ORDER[s.kind] > threshold);
  let dropped: PromptSegment[] = input.segments.filter((s) => DROP_ORDER[s.kind] <= threshold);

  // Step 2: SURVIVAL mode collapses identity to a one-liner.
  if (input.mode === 'SURVIVAL') {
    kept = kept.map((s) => {
      if (s.kind === 'identity') {
        const oneLine = collapseIdentityToOneLine(s.body);
        return makeSegment('identity', s.label, oneLine);
      }
      return s;
    });
    reasoning.push('SURVIVAL: identity collapsed to one-liner.');
  }

  // Step 3: if a target was supplied and we're still over budget, drop
  // additional COMPRESSIBLE segments by drop-order ascending.
  if (typeof input.targetTokens === 'number') {
    const currentSum = (): number => kept.reduce((s, x) => s + x.tokens, 0);
    while (currentSum() > input.targetTokens) {
      // Find lowest-priority remaining COMPRESSIBLE (DROP_ORDER >= 0).
      let weakestIdx = -1;
      let weakestOrder = -1;
      for (let i = 0; i < kept.length; i += 1) {
        const order = DROP_ORDER[kept[i].kind];
        if (order >= 0 && order > weakestOrder) {
          weakestOrder = order;
          weakestIdx = i;
        }
      }
      if (weakestIdx === -1) break; // only PRESERVE FIRST left
      const removed = kept.splice(weakestIdx, 1)[0];
      dropped.push(removed);
      reasoning.push(`Dropped "${removed.label}" (kind=${removed.kind}) to meet token target.`);
    }
  }

  const finalTokens = kept.reduce((sum, s) => sum + s.tokens, 0);
  const compressedPrompt = kept.map((s) => s.body).join('\n\n');

  return {
    compressedPrompt,
    mode: input.mode,
    removedSegments: dropped.map((s) => ({ kind: s.kind, label: s.label, tokens: s.tokens })),
    preservedSegments: kept.map((s) => ({ kind: s.kind, label: s.label, tokens: s.tokens })),
    tokenReduction: Math.max(0, original - finalTokens),
    finalTokens,
    originalTokens: original,
    semanticLossEstimate: Math.min(100, MODE_SEMANTIC_LOSS[input.mode] + (original > 0 ? Math.round(((original - finalTokens) / original) * 10) : 0)),
    reasoning,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function collapseIdentityToOneLine(identityBody: string): string {
  // Identity blocks open with "You are the in-house content strategist for X."
  // Reduce to that opening line + the audience.
  const lines = identityBody.split('\n').filter((l) => l.trim().length > 0);
  const opener = lines.find((l) => /content strategist for/i.test(l)) ?? lines[0] ?? identityBody;
  const audienceLine = lines.find((l) => /^YOUR AUDIENCE:/i.test(l));
  return [opener, audienceLine].filter(Boolean).join(' ').slice(0, 240);
}

/** Test-only: expose drop order for assertions. */
export function __getDropOrderForTests(): Record<PromptSegmentKind, number> {
  return { ...DROP_ORDER };
}
