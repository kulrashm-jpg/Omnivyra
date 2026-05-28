/**
 * adaptiveSectionSizing.ts
 *
 * Phase 5.4 — `computeAdaptiveSectionSize()`.
 *
 * Static word targets ignore the fact that complex, grounded, high-retry,
 * or post-timeout sections all need DIFFERENT sizing. This module makes
 * the size decision explicit and deterministic.
 *
 * Inputs (all optional except baselineWordTarget + contentType):
 *   topicComplexity      — 0..1; higher = denser concepts to cover
 *   groundingDensity     — count of approved fragments relevant to topic
 *   retryHistoryCount    — prior retries on this section
 *   timeoutRisk          — 0..1; cumulative measure from history
 *   contentType          — string; some types prefer longer (whitepaper)
 *                          or shorter (newsletter, story) sections
 *   narrativeDensity     — 0..1; higher = more story arc, prefer longer
 *
 * Behavior:
 *   - complex+grounded   → smaller (the model has more to anchor on; depth
 *                          per word goes UP, total words go DOWN)
 *   - high-risk retries  → smaller (compress so we can finish)
 *   - high narrative     → larger (stable arc benefits from room)
 *   - newsletter/story   → shorter floor; whitepaper longer ceiling
 */

import type { LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';

export interface AdaptiveSectionSizeInput {
  baselineWordTarget: number;
  contentType: string;
  topicComplexity?: number;       // 0..1
  groundingDensity?: number;      // count of approved fragments
  retryHistoryCount?: number;     // attempts on this section so far
  timeoutRisk?: number;           // 0..1
  narrativeDensity?: number;      // 0..1
}

export interface AdaptiveSectionSize {
  /** Final word target after adaptation. */
  wordTarget: number;
  /** Delta from baseline. */
  delta: number;
  /** Multiplier applied (final / baseline). */
  multiplier: number;
  /** Human-readable trace of decisions. */
  reasoning: string[];
  /** Convenience: recommended timeoutMs scaled to size. */
  recommendedTimeoutMs: number;
}

// ── Content-type floors/ceilings ──────────────────────────────────────────────

interface ContentTypeBounds {
  floor: number;
  ceiling: number;
  preferredCenter: number;
}

const CONTENT_TYPE_BOUNDS: Record<string, ContentTypeBounds> = {
  blog:       { floor: 120, ceiling: 700,  preferredCenter: 320 },
  article:    { floor: 150, ceiling: 700,  preferredCenter: 360 },
  whitepaper: { floor: 220, ceiling: 900,  preferredCenter: 480 },
  guide:      { floor: 180, ceiling: 850,  preferredCenter: 420 },
  newsletter: { floor: 80,  ceiling: 380,  preferredCenter: 200 },
  story:      { floor: 100, ceiling: 450,  preferredCenter: 240 },
  'case-study': { floor: 150, ceiling: 700, preferredCenter: 340 },
};

function boundsFor(contentType: string): ContentTypeBounds {
  return CONTENT_TYPE_BOUNDS[contentType]
    ?? CONTENT_TYPE_BOUNDS.blog;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function computeAdaptiveSectionSize(input: AdaptiveSectionSizeInput): AdaptiveSectionSize {
  const baseline = Math.max(60, input.baselineWordTarget);
  const bounds = boundsFor(input.contentType);
  const reasoning: string[] = [];
  let multiplier = 1.0;

  // ── Topic complexity → reduce when complex+grounded. ───────────────────
  const complexity = clamp01(input.topicComplexity);
  const density = Math.max(0, input.groundingDensity ?? 0);
  if (complexity >= 0.7 && density >= 4) {
    multiplier *= 0.78;
    reasoning.push(`Complex (${complexity.toFixed(2)}) + grounded (${density} fragments) → reduce 22%.`);
  } else if (complexity >= 0.7) {
    multiplier *= 0.88;
    reasoning.push(`Complex topic (${complexity.toFixed(2)}) without dense grounding → reduce 12%.`);
  } else if (complexity <= 0.3 && density >= 4) {
    multiplier *= 1.06;
    reasoning.push(`Simple topic with grounding → modest expansion (+6%).`);
  }

  // ── Retry history → shrink with each retry. ─────────────────────────────
  const retries = Math.max(0, input.retryHistoryCount ?? 0);
  if (retries === 1) {
    multiplier *= 0.92;
    reasoning.push(`1 prior retry → shrink 8%.`);
  } else if (retries === 2) {
    multiplier *= 0.82;
    reasoning.push(`2 prior retries → shrink 18%.`);
  } else if (retries >= 3) {
    multiplier *= 0.68;
    reasoning.push(`${retries} prior retries → shrink 32%.`);
  }

  // ── Timeout risk → shrink. ──────────────────────────────────────────────
  const tr = clamp01(input.timeoutRisk);
  if (tr >= 0.7) {
    multiplier *= 0.75;
    reasoning.push(`High timeout risk (${tr.toFixed(2)}) → shrink 25%.`);
  } else if (tr >= 0.4) {
    multiplier *= 0.88;
    reasoning.push(`Moderate timeout risk (${tr.toFixed(2)}) → shrink 12%.`);
  }

  // ── Narrative density → expand for stable arc. ──────────────────────────
  const narrative = clamp01(input.narrativeDensity);
  if (narrative >= 0.7) {
    multiplier *= 1.12;
    reasoning.push(`High narrative density (${narrative.toFixed(2)}) → expand 12%.`);
  }

  // Apply multiplier + clamp to content-type bounds.
  const target = Math.round(baseline * multiplier);
  const clamped = Math.min(bounds.ceiling, Math.max(bounds.floor, target));
  if (clamped !== target) {
    reasoning.push(`Clamped from ${target} to ${clamped} via ${input.contentType} bounds [${bounds.floor}..${bounds.ceiling}].`);
  }

  // Timeout scales linearly with size (roughly).
  const recommendedTimeoutMs = Math.min(240_000, Math.max(60_000, Math.round(clamped * 250)));

  return {
    wordTarget: clamped,
    delta: clamped - baseline,
    multiplier: Number((clamped / baseline).toFixed(3)),
    reasoning,
    recommendedTimeoutMs,
  };
}

// ── Heuristics: estimate complexity / narrative density from a plan section ──

export interface PlanSectionEstimateInput {
  sectionTitle: string;
  keyPoints?: string[];
  requiresOpinionatedInsight?: boolean;
  requiresDirectAnswer?: boolean;
  frameworkRole?: string;
}

export function estimateTopicComplexity(input: PlanSectionEstimateInput): number {
  const points = input.keyPoints ?? [];
  // Complexity = density of distinct concepts. We approximate via key-point
  // count + framework_role presence + opinionated-insight requirement.
  let score = 0;
  if (points.length >= 5) score += 0.4;
  else if (points.length >= 3) score += 0.25;
  else if (points.length >= 1) score += 0.15;
  if (input.requiresOpinionatedInsight) score += 0.2;
  if (input.requiresDirectAnswer) score += 0.1;
  if (input.frameworkRole && input.frameworkRole !== 'none') score += 0.2;
  // Title length heuristic — longer titles tend to be denser.
  if (input.sectionTitle.length >= 60) score += 0.15;
  return Math.min(1, score);
}

export function estimateNarrativeDensity(input: PlanSectionEstimateInput): number {
  // Narrative density rises with framework presence + opinionated requirement.
  let score = 0;
  if (input.frameworkRole === 'introduce' || input.frameworkRole === 'apply') score += 0.4;
  if (input.requiresOpinionatedInsight) score += 0.25;
  if (input.requiresDirectAnswer) score += 0.1;
  if ((input.keyPoints?.length ?? 0) >= 4) score += 0.15;
  return Math.min(1, score);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Re-export the content-type union purely for callers that want to assert.
export type { LongFormContentType };
