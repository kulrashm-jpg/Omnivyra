/**
 * Output quality ranking + adaptive retry directives (Phases 7-8).
 *
 * Lightweight heuristic scoring of a composed prompt. NO CV pipeline,
 * NO image analysis, NO ML training. Inputs are the composer's
 * structured output (`CreatorComposedPrompt`) plus optional signals
 * the renderer collects from the provider (OCR result flags, render
 * geometry, etc.). Output is:
 *
 *   - a 0-100 quality score
 *   - a set of category flags driving adaptive retry
 *   - a structured retry directive when score < threshold
 *
 * The retry directive is consumed by the renderer to mutate the
 * composer input before re-running — never an identical rerun.
 */

import type {
  CreativeDirectionTemplate,
  CreatorComposedPrompt,
  CreatorPromptInput,
} from './creatorPromptComposer';

/* ── Score model ────────────────────────────────────────────────────── */

export type QualityCategory =
  | 'brand_grounding'
  | 'realism_conditioning'
  | 'composition_discipline'
  | 'ui_authenticity'
  | 'human_realism'
  | 'artifact_suppression';

/**
 * Weights sum to 100. Brand + realism + composition are the highest
 * stake categories because they drive the strongest "this looks like
 * an AI stock photo" failure mode. UI authenticity is conditional on
 * the surface — it scores high by default when no UI grounding is
 * expected, low when product context exists but couldn't be reflected.
 */
const CATEGORY_WEIGHTS: Record<QualityCategory, number> = {
  brand_grounding: 20,
  realism_conditioning: 20,
  composition_discipline: 20,
  ui_authenticity: 15,
  human_realism: 15,
  artifact_suppression: 10,
};

export type QualityScore = {
  score: number;
  categoryScores: Record<QualityCategory, number>;
  flags: string[];
  /** Score interpretation buckets — drive dashboards + retry. */
  bucket: 'premium' | 'good' | 'acceptable' | 'weak' | 'low';
};

const REALISM_REQUIRED_MARKERS = ['editorial', 'cinematic', 'authentic', 'candid', 'natural', 'believable', 'documentary'];
const SUPPRESSION_REQUIRED_MARKERS = ['stock-photo', 'plastic skin', 'malformed hands', 'random unrelated people', 'corporate-team posing'];
const HUMAN_REALISM_MARKERS = ['documentary realism', 'natural hand', 'natural posture', 'realistic eye', 'candid interaction'];
const COMPOSITION_MARKERS = ['off-center', 'asymmetric', 'negative space', 'depth of field', 'focal hierarchy'];

function countPresent(haystack: string, needles: string[]): number {
  const lower = haystack.toLowerCase();
  let n = 0;
  for (const needle of needles) if (lower.includes(needle.toLowerCase())) n++;
  return n;
}

function pct(present: number, required: number): number {
  if (required <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((present / required) * 100)));
}

export function scoreCreatorPromptQuality(input: {
  composed: CreatorComposedPrompt;
  /** Whether the surface is expected to carry product/UI grounding. */
  productContextExpected?: boolean;
  /** Optional OCR / artifact flags from a prior render attempt — used
   *  to detect artifact incidence on RETRY. */
  priorAttemptOcrFlags?: string[];
}): QualityScore {
  const prompt = input.composed.prompt;

  // Brand grounding: composer already exposes a boolean; lift it to
  // 100 when grounded, 40 when the asset wasn't writer-attached
  // (legacy/standalone), 20 when brand signals were available but
  // didn't meet the threshold.
  const brandGroundingScore = input.composed.brandGrounded
    ? 100
    : input.composed.layers.brand.length > 0 ? 40 : 20;

  // Realism conditioning: count how many of the 7 required realism
  // markers actually made it into the prompt.
  const realismScore = pct(countPresent(prompt, REALISM_REQUIRED_MARKERS), Math.min(5, REALISM_REQUIRED_MARKERS.length));

  // Composition discipline: structural markers from the visual
  // direction + composition layer.
  const compositionScore = pct(countPresent(prompt, COMPOSITION_MARKERS), 3);

  // UI authenticity: when product context is expected, score on
  // product-grounded boolean. When not expected (no product context),
  // pass by default (100) — UI grounding can't be judged.
  const uiAuthScore = input.productContextExpected
    ? (input.composed.productGrounded ? 100 : input.composed.layers.product.length > 0 ? 40 : 0)
    : 100;

  // Human realism: count human-bias markers. This is a STYLE rather
  // than presence check — the prompt should bias toward realism
  // whether or not humans actually appear in the scene.
  const humanRealismScore = pct(countPresent(prompt, HUMAN_REALISM_MARKERS), 3);

  // Artifact suppression: count suppression markers in the prompt.
  // Also subtract penalty for any artifact flag the renderer
  // surfaced from a PRIOR attempt (used by retry orchestration).
  let artifactScore = pct(countPresent(prompt, SUPPRESSION_REQUIRED_MARKERS), 4);
  if (Array.isArray(input.priorAttemptOcrFlags)) {
    for (const flag of input.priorAttemptOcrFlags) {
      if (flag.includes('cta_phrase') || flag.includes('visible_text')) artifactScore = Math.max(0, artifactScore - 25);
      if (flag.includes('fake_glyphs')) artifactScore = Math.max(0, artifactScore - 25);
    }
  }

  const categoryScores: Record<QualityCategory, number> = {
    brand_grounding: brandGroundingScore,
    realism_conditioning: realismScore,
    composition_discipline: compositionScore,
    ui_authenticity: uiAuthScore,
    human_realism: humanRealismScore,
    artifact_suppression: artifactScore,
  };

  let totalScore = 0;
  for (const [key, weight] of Object.entries(CATEGORY_WEIGHTS) as [QualityCategory, number][]) {
    totalScore += (categoryScores[key] / 100) * weight;
  }
  const score = Math.round(totalScore);

  const flags: string[] = [];
  for (const [category, value] of Object.entries(categoryScores) as [QualityCategory, number][]) {
    if (value < 50) flags.push(`low_${category}`);
  }

  let bucket: QualityScore['bucket'] = 'good';
  if (score >= 85) bucket = 'premium';
  else if (score >= 70) bucket = 'good';
  else if (score >= 55) bucket = 'acceptable';
  else if (score >= 40) bucket = 'weak';
  else bucket = 'low';

  return { score, categoryScores, flags, bucket };
}

/* ── Adaptive retry directives ─────────────────────────────────────── */

export type RetryDirective = {
  shouldRetry: boolean;
  reason: string;
  /** Composer-input mutations to apply on the next attempt. */
  inputMutations: Partial<CreatorPromptInput>;
  /** Composer option overrides to apply on the next attempt. */
  optionOverrides: {
    premium?: boolean;
    forceTemplate?: CreativeDirectionTemplate;
  };
};

const PREMIUM_FALLBACK: Record<CreativeDirectionTemplate, CreativeDirectionTemplate> = {
  product_launch: 'cinematic_product_launch',
  feature_reveal: 'editorial_feature_reveal',
  ai_innovation: 'premium_ai_editorial',
  productivity_workflow: 'ambient_productivity',
  executive_insight: 'founder_storytelling',
  automation_orchestration: 'premium_ai_editorial',
  editorial_modern_startup: 'premium_brand_campaign',
  dashboard_centric: 'realistic_workflow_scene',
  clean_editorial_product: 'minimal_product_hero',
  // Premium templates already at the top — fall back to a sibling
  // variant on a second retry instead of looping.
  cinematic_product_launch: 'premium_brand_campaign',
  founder_storytelling: 'executive_insight',
  editorial_feature_reveal: 'feature_reveal',
  ambient_productivity: 'realistic_workflow_scene',
  premium_ai_editorial: 'ai_innovation',
  product_ecosystem_visual: 'dashboard_centric',
  minimal_product_hero: 'clean_editorial_product',
  realistic_workflow_scene: 'ambient_productivity',
  premium_brand_campaign: 'editorial_modern_startup',
};

/**
 * Decide whether a retry is warranted and what mutations to apply to
 * the composer input so the second attempt is meaningfully different.
 *
 * The retry caller is expected to invoke `composeCreatorImagePrompt`
 * a second time with the merged input + options before re-calling
 * the provider. The renderer never loops more than once on quality
 * (single adaptive retry — production cost discipline).
 */
export function computeRetryDirective(input: {
  score: QualityScore;
  composed: CreatorComposedPrompt;
  threshold?: number;
}): RetryDirective {
  const threshold = input.threshold ?? 60;
  if (input.score.score >= threshold) {
    return {
      shouldRetry: false,
      reason: 'quality_above_threshold',
      inputMutations: {},
      optionOverrides: {},
    };
  }

  const mutations: Partial<CreatorPromptInput> = {};
  const overrides: RetryDirective['optionOverrides'] = {};

  // Strengthen brand grounding if it scored low.
  if (input.score.categoryScores.brand_grounding < 50) {
    mutations.brandMode = 'brand-aware';
  }

  // Promote to premium variants if realism / composition were weak,
  // OR rotate to the fallback sibling if we were already premium.
  if (input.score.categoryScores.realism_conditioning < 60
      || input.score.categoryScores.composition_discipline < 60) {
    if (input.composed.premium) {
      // Already premium — rotate to a sibling.
      overrides.forceTemplate = PREMIUM_FALLBACK[input.composed.creativeDirection];
    } else {
      overrides.premium = true;
    }
  }

  // Suppress stock-photo bias more aggressively by re-running with
  // the current input — the composer always emits the negative
  // directive block, so this mainly serves as a marker for the
  // dashboard. No prompt-level mutation needed.

  return {
    shouldRetry: true,
    reason: `quality_below_threshold:${input.score.bucket}:${input.score.flags.join(',')}`,
    inputMutations: mutations,
    optionOverrides: overrides,
  };
}
