/**
 * Performance Intelligence — Confidence Calibration Service.
 *
 * Pre-drill calibration: makes the report safer when data is thin and
 * downgrades wording when statistical confidence is low. Three surfaces:
 *
 *   1. classifyConfidenceTier(input) — returns one of four UI tiers:
 *        - confirmed       (high signal volume + agreement)
 *        - directional     (medium signal — usable but not certain)
 *        - hypothesis      (low signal — frame as something to test)
 *        - weak_data       (below the volume floor — surface for visibility,
 *                           do NOT recommend execution)
 *
 *   2. softenLanguage(text, tier) — replaces overconfident verbs in a
 *      recommendation message/reason when the tier is weak. Turns
 *      "Will reduce drop-off by 30%" into "Could help reduce drop-off
 *      (sample is small — verify with a focused test)."
 *
 *   3. dampenPriorityWeight(priority, tier, sampleSize) — returns a
 *      0..1 multiplier the mapper applies to ranking. Weak-data items
 *      can never outrank confirmed ones even when their nominal priority
 *      is "high".
 *
 * No DB writes. Constants are tunable in this single file so the team can
 * recalibrate after the first internal drill without touching consumers.
 */

export type ConfidenceTier = 'confirmed' | 'directional' | 'hypothesis' | 'weak_data';
export type LanguageModifier = 'confident' | 'softened' | 'tentative' | 'directional_only';

// ─── Volume floors ───────────────────────────────────────────────────────────
//
// Sessions / impressions thresholds below which we refuse to label something
// as "confirmed". Conservative on purpose — first-drill reports should
// under-claim, not over-claim.
export const SAMPLE_FLOORS = {
  weakData:    20,    // below this → 'weak_data' tier regardless of other signals
  hypothesis:  100,   // 20-99 → at most 'hypothesis'
  directional: 500,   // 100-499 → at most 'directional'
  // ≥500 sessions/impressions can reach 'confirmed' if other inputs agree
} as const;

const CONFIDENCE_RANK: Record<string, number> = {
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
  confirmed: 4,
  directional: 3,
  hypothesis: 2,
  weak_data: 1,
};

export interface ClassifyConfidenceInput {
  /** Upstream confidence label ('high'|'medium'|'low'|'none' OR 'confirmed'|…). */
  upstreamConfidence?: string | null;
  /** Sessions / impressions / clicks observed for the underlying signal. */
  sampleSize?: number | null;
  /** Severity of the underlying observation (used to gate hypothesis vs directional). */
  severity?: 'high' | 'medium' | 'low' | null;
  /**
   * When true, ANY classification is forced to at most 'directional' regardless
   * of sample size. Used by the GSC path during early ingestion.
   */
  freshnessStale?: boolean;
}

/**
 * Map upstream confidence + sample size + severity → calibration tier.
 *
 * Rules:
 *   - sampleSize < weakData floor → always 'weak_data'
 *   - sampleSize < hypothesis floor → max 'hypothesis'
 *   - sampleSize < directional floor → max 'directional'
 *   - upstream='high' + sample ≥ directional + severity != 'low' → 'confirmed'
 *   - freshnessStale → cap at 'directional'
 *   - default → 'directional'
 */
export function classifyConfidenceTier(input: ClassifyConfidenceInput): ConfidenceTier {
  const sample = Number(input.sampleSize ?? 0);
  const upstream = String(input.upstreamConfidence ?? '').toLowerCase();
  const severity = input.severity ?? 'medium';

  if (!Number.isFinite(sample) || sample < SAMPLE_FLOORS.weakData) return 'weak_data';

  let tierCap: ConfidenceTier = 'confirmed';
  if (sample < SAMPLE_FLOORS.hypothesis) tierCap = 'hypothesis';
  else if (sample < SAMPLE_FLOORS.directional) tierCap = 'directional';
  else if (input.freshnessStale) tierCap = 'directional';

  // Upstream signal influence — but never above the cap.
  let candidate: ConfidenceTier;
  if (upstream === 'high' || upstream === 'confirmed') candidate = 'confirmed';
  else if (upstream === 'medium' || upstream === 'directional') candidate = 'directional';
  else if (upstream === 'low' || upstream === 'hypothesis') candidate = 'hypothesis';
  else candidate = 'directional';

  // Low-severity weak signals always demote to hypothesis.
  if (severity === 'low' && candidate === 'confirmed') candidate = 'directional';
  if (severity === 'low' && candidate === 'directional') candidate = 'hypothesis';

  return rankAtMost(candidate, tierCap);
}

function rankAtMost(a: ConfidenceTier, b: ConfidenceTier): ConfidenceTier {
  return (CONFIDENCE_RANK[a] ?? 0) <= (CONFIDENCE_RANK[b] ?? 0) ? a : b;
}

/**
 * Map confidence tier → language modifier the consumer applies when softening.
 */
export function languageModifierForTier(tier: ConfidenceTier): LanguageModifier {
  if (tier === 'confirmed') return 'confident';
  if (tier === 'directional') return 'softened';
  if (tier === 'hypothesis') return 'tentative';
  return 'directional_only';
}

// ─── Language softener ──────────────────────────────────────────────────────
//
// Replaces strong verbs with softer alternatives when the tier doesn't
// support certainty. Word-boundary regex; case-insensitive. Returns the
// modified text plus a boolean indicating whether a replacement happened.

const SOFTEN_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // "will increase X" → "could help increase X"
  { pattern: /\bwill\s+(increase|improve|boost|drive|reduce|lift)\b/gi, replacement: 'could help $1' },
  // "must X" → "consider X"
  { pattern: /\bmust\s+/gi, replacement: 'consider ' },
  // "should X immediately" → "should X" (drop urgency intensifier)
  { pattern: /\b(should\s+\w+)\s+immediately\b/gi, replacement: '$1' },
  // "guaranteed" → "likely"
  { pattern: /\bguaranteed\b/gi, replacement: 'likely' },
  // "always" → "often"
  { pattern: /\balways\b/gi, replacement: 'often' },
  // "proven to X" → "likely to X"
  { pattern: /\bproven\s+to\s+/gi, replacement: 'likely to ' },
  // "biggest" → "notable"
  { pattern: /\bbiggest\b/gi, replacement: 'notable' },
];

const TENTATIVE_PREFIXES: Record<LanguageModifier, string | null> = {
  confident: null,
  softened: null,
  tentative: 'Worth testing: ',
  directional_only: 'Early signal only — ',
};

const SUFFIX_BY_MODIFIER: Record<LanguageModifier, string | null> = {
  confident: null,
  softened: null,
  tentative: ' (sample is limited — confirm with a focused experiment).',
  directional_only: ' Volume is too small to act on confidently; surface for awareness only.',
};

export interface SoftenedText {
  text: string;
  modified: boolean;
  modifier: LanguageModifier;
}

/**
 * Soften a recommendation message for a confidence tier. Idempotent — running
 * twice on the same text doesn't double-apply the prefix/suffix.
 */
export function softenLanguage(text: string, tier: ConfidenceTier): SoftenedText {
  const modifier = languageModifierForTier(tier);
  if (modifier === 'confident' || modifier === 'softened') {
    let out = String(text ?? '');
    let modified = false;
    if (modifier === 'softened') {
      for (const { pattern, replacement } of SOFTEN_REPLACEMENTS) {
        const next = out.replace(pattern, replacement);
        if (next !== out) modified = true;
        out = next;
      }
    }
    return { text: out, modified, modifier };
  }
  // 'tentative' / 'directional_only' — apply prefix + suffix once.
  let out = String(text ?? '').trim();
  for (const { pattern, replacement } of SOFTEN_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  const prefix = TENTATIVE_PREFIXES[modifier] ?? '';
  const suffix = SUFFIX_BY_MODIFIER[modifier] ?? '';
  if (prefix && !out.toLowerCase().startsWith(prefix.toLowerCase())) {
    out = `${prefix}${out.charAt(0).toLowerCase()}${out.slice(1)}`;
  }
  if (suffix && !out.endsWith(suffix.trim())) {
    out = out.replace(/[.!?]?$/u, '') + suffix;
  }
  return { text: out, modified: true, modifier };
}

// ─── Priority dampening ──────────────────────────────────────────────────────
//
// Multiplier applied to the priority rank in the mapper's ranking step.
// Confirmed: 1.0 — no change. Directional: 0.75. Hypothesis: 0.5.
// Weak data: 0.2 — high-priority weak items can still surface but never
// outrank a medium-priority confirmed item.

const DAMPING_BY_TIER: Record<ConfidenceTier, number> = {
  confirmed: 1.0,
  directional: 0.75,
  hypothesis: 0.5,
  weak_data: 0.2,
};

export function dampenPriorityWeight(
  basePriorityRank: number, // 1..3 (low..high)
  tier: ConfidenceTier,
  sampleSize?: number | null,
): number {
  const damp = DAMPING_BY_TIER[tier];
  // Sample-size sub-modifier — 0..0.15 boost when sample is healthy.
  const sample = Number(sampleSize ?? 0);
  const boost = sample >= SAMPLE_FLOORS.directional ? 0.15
    : sample >= SAMPLE_FLOORS.hypothesis ? 0.05
    : 0;
  return basePriorityRank * damp + boost;
}

/**
 * Tier → human label rendered as a chip in the report HTML and the UI.
 */
export function tierLabel(tier: ConfidenceTier): string {
  if (tier === 'confirmed') return 'Confirmed';
  if (tier === 'directional') return 'Directional';
  if (tier === 'hypothesis') return 'Hypothesis';
  return 'Weak data';
}

/**
 * Tier → CSS color class the report HTML uses for the confidence ribbon.
 */
export function tierColorClass(tier: ConfidenceTier): string {
  if (tier === 'confirmed') return 'perf-confidence-confirmed';
  if (tier === 'directional') return 'perf-confidence-directional';
  if (tier === 'hypothesis') return 'perf-confidence-hypothesis';
  return 'perf-confidence-weak';
}

/**
 * One-liner describing the tier for evaluators reading the report.
 */
export function tierExplanation(tier: ConfidenceTier): string {
  if (tier === 'confirmed') return 'Volume + signal alignment support acting on this finding now.';
  if (tier === 'directional') return 'Useful direction; verify before scaling the change.';
  if (tier === 'hypothesis') return 'Worth testing on a small surface; not yet proven.';
  return 'Sample size is too small to recommend execution; surfaced for visibility only.';
}
