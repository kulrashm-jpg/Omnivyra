/**
 * Creative Aesthetic Ranking (Phase 3).
 *
 * Deterministic, weighted, 12-dimension scoring of a composed prompt
 * variant against the plan that produced it. Builds on the prior
 * 6-category quality ranker by adding plan-aware alignment dimensions
 * (emotional resonance, brand fit, SaaS campaign quality, premium feel).
 *
 * NO image-content analysis, NO CV, NO ML. Pure prompt-text heuristic
 * + alignment-to-plan checks. Used to pick the strongest variant out
 * of the orchestrator's set BEFORE the provider call.
 */

import type { CreatorComposedPrompt } from './creatorPromptComposer';
import type {
  CreativeDirectionPlan,
  CreativeStrategyId,
  EmotionalDirection,
} from './creativeDirectorEngine';
import { CREATIVE_STRATEGY_PROFILES } from './creativeDirectorEngine';

/* ── Score model ────────────────────────────────────────────────────── */

export type AestheticDimension =
  | 'realism_quality'
  | 'campaign_quality'
  | 'visual_hierarchy'
  | 'emotional_resonance'
  | 'composition_discipline'
  | 'brand_fit'
  | 'product_authenticity'
  | 'human_realism'
  | 'visual_clarity'
  | 'premium_feel'
  | 'artifact_risk'
  | 'saas_campaign_quality';

/**
 * Weights sum to 100. Tuned so that the failure modes that historically
 * produce "AI stock photo" outputs cost more (campaign quality, premium
 * feel, brand fit, SaaS campaign quality) than per-prompt mechanical
 * categories (visual clarity, hierarchy).
 */
const DIMENSION_WEIGHTS: Record<AestheticDimension, number> = {
  realism_quality:          12,
  campaign_quality:         12,
  visual_hierarchy:          7,
  emotional_resonance:       10,
  composition_discipline:    9,
  brand_fit:                 10,
  product_authenticity:      8,
  human_realism:             8,
  visual_clarity:            5,
  premium_feel:              9,
  artifact_risk:             5,
  saas_campaign_quality:     5,
};

export type AestheticRankResult = {
  totalScore: number;
  dimensionScores: Record<AestheticDimension, number>;
  strengths: AestheticDimension[];
  weaknesses: AestheticDimension[];
  rankingReason: string;
  /** Bucket band — convenient for dashboards. */
  bucket: 'premium' | 'good' | 'acceptable' | 'weak' | 'low';
};

/* ── Marker tables ──────────────────────────────────────────────────── */

const REALISM_MARKERS = ['editorial', 'cinematic', 'authentic', 'candid', 'natural', 'believable', 'documentary'];
const SUPPRESSION_MARKERS = ['stock-photo', 'plastic skin', 'malformed hands', 'random unrelated people', 'corporate-team posing', 'fake business handshake'];
const COMPOSITION_MARKERS = ['off-center', 'asymmetric', 'negative space', 'depth of field', 'focal hierarchy', 'one motivated source'];
const HIERARCHY_MARKERS = ['→', 'focal hierarchy', 'visual hierarchy', 'foreground', 'background depth', 'middle depth'];
const HUMAN_REALISM_MARKERS = ['documentary realism', 'natural hand', 'natural posture', 'realistic eye', 'candid interaction', 'imperfect natural posture'];
const PREMIUM_MARKERS = ['premium', 'magazine', 'editorial', 'cinematic', 'restrained', 'considered', 'magazine-grade'];
const SAAS_MARKERS = ['saas', 'product surface', 'dashboard', 'workspace', 'launch', 'feature', 'workflow', 'orchestration'];
const CAMPAIGN_MARKERS = ['campaign', 'launch', 'reveal', 'editorial', 'magazine-cover', 'editorial campaign'];

const EMOTIONAL_KEYWORDS: Record<EmotionalDirection, string[]> = {
  cinematic: ['cinematic', 'atmospheric', 'anamorphic', 'rim light'],
  documentary: ['documentary', 'candid', 'lived-in', 'natural light'],
  editorial: ['editorial', 'magazine', 'restrained', 'considered'],
  minimal: ['minimal', 'restraint', 'breathing room', 'magazine-spread'],
  intelligence: ['intelligence motif', 'accent glow', 'restrained dark', 'ai-native'],
  ecosystem: ['ecosystem', 'multiple', 'touchpoints', 'connected'],
};

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function countPresent(haystack: string, needles: ReadonlyArray<string>): number {
  const p = haystack.toLowerCase();
  let n = 0;
  for (const m of needles) if (p.includes(m.toLowerCase())) n++;
  return n;
}

function pct(present: number, required: number): number {
  if (required <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((present / required) * 100)));
}

/* ── Dimension scorers ──────────────────────────────────────────────── */

function scoreRealism(prompt: string): number {
  return pct(countPresent(prompt, REALISM_MARKERS), 5);
}

function scoreCampaign(prompt: string, plan: CreativeDirectionPlan): number {
  let s = pct(countPresent(prompt, CAMPAIGN_MARKERS), 3);
  // Plan alignment bonus — campaign-style intent narratives produce
  // higher campaign scores when their markers actually surface.
  if (plan.visualNarrative === 'launch' || plan.visualNarrative === 'reveal' || plan.visualNarrative === 'campaign') {
    if (countPresent(prompt, ['launch', 'reveal', 'magazine-cover']) >= 1) s = Math.min(100, s + 10);
  }
  return s;
}

function scoreVisualHierarchy(prompt: string): number {
  return pct(countPresent(prompt, HIERARCHY_MARKERS), 3);
}

function scoreEmotionalResonance(prompt: string, plan: CreativeDirectionPlan): number {
  const targetKeywords = EMOTIONAL_KEYWORDS[plan.emotionalDirection];
  return pct(countPresent(prompt, targetKeywords), Math.min(3, targetKeywords.length));
}

function scoreCompositionDiscipline(prompt: string): number {
  return pct(countPresent(prompt, COMPOSITION_MARKERS), 4);
}

function scoreBrandFit(composed: CreatorComposedPrompt): number {
  if (composed.brandGrounded) return 100;
  if (composed.layers.brand.length > 0) return 50;
  return 20;
}

function scoreProductAuthenticity(composed: CreatorComposedPrompt, productContextExpected: boolean): number {
  if (!productContextExpected) return 100;
  if (composed.productGrounded) return 100;
  if (composed.layers.product.length > 0) return 45;
  return 0;
}

function scoreHumanRealism(prompt: string, plan: CreativeDirectionPlan): number {
  // When the plan suppresses humans, the dimension is judged on whether
  // the prompt avoids human-trap markers rather than on whether it
  // contains human-realism markers.
  if (plan.humanPresenceMode === 'absent') {
    const traps = countPresent(prompt, ['corporate-team posing', 'fake startup', 'business handshake']);
    return traps === 0 ? 100 : Math.max(0, 100 - traps * 30);
  }
  return pct(countPresent(prompt, HUMAN_REALISM_MARKERS), 3);
}

function scoreVisualClarity(prompt: string): number {
  // Clarity = composition + hierarchy markers present + no clutter markers.
  const c = countPresent(prompt, COMPOSITION_MARKERS);
  const h = countPresent(prompt, HIERARCHY_MARKERS);
  const clutter = countPresent(prompt, ['collage', 'busy', 'cluttered', 'decorative graphics']);
  let s = pct(c + h, 5);
  if (clutter > 0) s = Math.max(0, s - 20 * clutter);
  return s;
}

function scorePremiumFeel(prompt: string, plan: CreativeDirectionPlan): number {
  let s = pct(countPresent(prompt, PREMIUM_MARKERS), 3);
  if (plan.premiumBias) s = Math.min(100, s + 15);
  return s;
}

function scoreArtifactRisk(prompt: string, priorOcrFlags?: ReadonlyArray<string>): number {
  // Higher = LOWER risk (better). Suppression markers reduce risk; prior-
  // attempt artifact flags increase it.
  let s = pct(countPresent(prompt, SUPPRESSION_MARKERS), 4);
  if (priorOcrFlags) {
    for (const f of priorOcrFlags) {
      if (f.includes('cta_phrase') || f.includes('visible_text')) s = Math.max(0, s - 25);
      if (f.includes('fake_glyphs')) s = Math.max(0, s - 25);
    }
  }
  return s;
}

function scoreSaasCampaignQuality(prompt: string, plan: CreativeDirectionPlan): number {
  const baseline = pct(countPresent(prompt, SAAS_MARKERS), 3);
  const strategyAlignmentBonus = plan.strategyProfile.includes('product')
    || plan.strategyProfile.includes('ecosystem')
    || plan.strategyProfile.includes('workflow')
    || plan.strategyProfile.includes('ui') ? 10 : 0;
  return Math.min(100, baseline + strategyAlignmentBonus);
}

/* ── Public entry point ─────────────────────────────────────────────── */

export function rankCreativeAesthetic(input: {
  composed: CreatorComposedPrompt;
  plan: CreativeDirectionPlan;
  productContextExpected?: boolean;
  priorAttemptOcrFlags?: ReadonlyArray<string>;
}): AestheticRankResult {
  const prompt = input.composed.prompt;
  const productExpected = Boolean(input.productContextExpected);

  const dimensionScores: Record<AestheticDimension, number> = {
    realism_quality:        scoreRealism(prompt),
    campaign_quality:       scoreCampaign(prompt, input.plan),
    visual_hierarchy:       scoreVisualHierarchy(prompt),
    emotional_resonance:    scoreEmotionalResonance(prompt, input.plan),
    composition_discipline: scoreCompositionDiscipline(prompt),
    brand_fit:              scoreBrandFit(input.composed),
    product_authenticity:   scoreProductAuthenticity(input.composed, productExpected),
    human_realism:          scoreHumanRealism(prompt, input.plan),
    visual_clarity:         scoreVisualClarity(prompt),
    premium_feel:           scorePremiumFeel(prompt, input.plan),
    artifact_risk:          scoreArtifactRisk(prompt, input.priorAttemptOcrFlags),
    saas_campaign_quality:  scoreSaasCampaignQuality(prompt, input.plan),
  };

  let totalScore = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS) as [AestheticDimension, number][]) {
    totalScore += (dimensionScores[dim] / 100) * weight;
  }
  const score = Math.round(totalScore);

  const strengths: AestheticDimension[] = [];
  const weaknesses: AestheticDimension[] = [];
  for (const [dim, value] of Object.entries(dimensionScores) as [AestheticDimension, number][]) {
    if (value >= 85) strengths.push(dim);
    if (value < 55) weaknesses.push(dim);
  }

  let bucket: AestheticRankResult['bucket'];
  if (score >= 85) bucket = 'premium';
  else if (score >= 70) bucket = 'good';
  else if (score >= 55) bucket = 'acceptable';
  else if (score >= 40) bucket = 'weak';
  else bucket = 'low';

  const reason = strengths.length > 0
    ? `Strong in ${strengths.slice(0, 3).join(', ')}${weaknesses.length > 0 ? `; weak in ${weaknesses.slice(0, 2).join(', ')}` : ''}.`
    : weaknesses.length > 0
      ? `Weak in ${weaknesses.slice(0, 3).join(', ')}.`
      : 'Balanced across all dimensions.';

  return {
    totalScore: score,
    dimensionScores,
    strengths,
    weaknesses,
    rankingReason: reason,
    bucket,
  };
}

/* ── Multi-variant winner selection ─────────────────────────────────── */

export type RankedVariant<V> = {
  variant: V;
  rank: AestheticRankResult;
};

export function pickWinningVariant<V>(
  ranked: ReadonlyArray<RankedVariant<V>>,
): { winner: RankedVariant<V>; runners: RankedVariant<V>[] } {
  if (ranked.length === 0) throw new Error('pickWinningVariant: no variants to rank');
  const sorted = [...ranked].sort((a, b) => b.rank.totalScore - a.rank.totalScore);
  return {
    winner: sorted[0],
    runners: sorted.slice(1),
  };
}
