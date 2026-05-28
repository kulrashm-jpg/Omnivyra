/**
 * Enterprise Brand Governance + Creative Consistency Enforcement
 * (Phases 2, 4, 7).
 *
 * Validates a composed prompt against:
 *   - the brand kit (palette discipline, logo usage discipline, tone)
 *   - the campaign visual DNA (emotional tone, realism profile,
 *     composition family, human/product presence policy)
 *   - the per-asset creative plan
 *   - the aesthetic rank result
 *
 * Emits structured violations + warnings, a 0-100 governance score,
 * a brand-alignment confidence, and an explicit retryStrategy hint
 * the orchestrator can act on. NEVER silently rewrites the prompt;
 * governance only INFORMS the renderer's retry path.
 *
 * Pure, deterministic. No CV / ML / image analysis.
 */

import type { CreatorComposedPrompt, CreatorPromptBrandKit } from './creatorPromptComposer';
import type { CreativeDirectionPlan } from './creativeDirectorEngine';
import type { AestheticRankResult } from './creativeAestheticRanking';
import type { CampaignVisualDNA } from './campaignCoherenceEngine';

/* ── Output contract ────────────────────────────────────────────────── */

export type GovernanceCategory =
  | 'palette_discipline'
  | 'logo_usage'
  | 'realism_consistency'
  | 'emotional_tone_consistency'
  | 'visual_density_consistency'
  | 'typography_philosophy'
  | 'product_authenticity'
  | 'forbidden_style'
  | 'off_brand_visual_pattern'
  | 'composition_family_consistency'
  | 'human_presence_consistency'
  | 'stock_photo_bias';

export type GovernanceSeverity = 'warning' | 'error' | 'reject';

export type GovernanceViolation = {
  category: GovernanceCategory;
  severity: GovernanceSeverity;
  description: string;
  recommendedAction: string;
};

export type RetryStrategy =
  | 'tighten_palette'
  | 'tighten_realism'
  | 'reduce_stock_bias'
  | 'increase_product_grounding'
  | 'switch_emotional_tone'
  | 'enforce_composition_family'
  | 'suppress_human_presence'
  | 'tighten_brand_signals'
  | 'none';

export type GovernanceResult = {
  governanceScore: number;
  governanceViolations: ReadonlyArray<GovernanceViolation>;
  governanceWarnings: ReadonlyArray<GovernanceViolation>;
  brandAlignmentConfidence: number;
  rejectGeneration: boolean;
  retryStrategy: RetryStrategy;
  retryRationale: string | null;
};

/* ── Heuristic marker tables ────────────────────────────────────────── */

const FORBIDDEN_STYLE_MARKERS = [
  'cartoon', 'cgi animation', 'anime', 'pixar style', '3d render game',
  'low poly', 'oil painting', 'watercolor illustration',
];

const STOCK_PHOTO_RISK_MARKERS = [
  'group of smiling',
  'team of professionals',
  'business handshake',
  'office worker smiling',
  'corporate stock',
];

/* ── Per-category checks ────────────────────────────────────────────── */

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function checkPaletteDiscipline(input: {
  prompt: string;
  brandKit: CreatorPromptBrandKit | null | undefined;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  const palette = input.dna?.visualDNA.paletteDiscipline?.length
    ? input.dna.visualDNA.paletteDiscipline
    : input.brandKit?.palette;
  if (!palette || palette.length === 0) return null;
  const promptLower = lower(input.prompt);
  // Soft check — the palette IS in the prompt if any hex appears
  // verbatim. When brand palette is supplied AND the prompt doesn't
  // mention any of its colors, the brand discipline signal is weak.
  const anyPresent = palette.some((c) => promptLower.includes(c.toLowerCase()));
  if (anyPresent) return null;
  return {
    category: 'palette_discipline',
    severity: 'warning',
    description: 'Brand palette colors are not referenced in the prompt.',
    recommendedAction: 'Inject brand palette as ambient color discipline.',
  };
}

function checkLogoUsage(input: {
  prompt: string;
  brandKit: CreatorPromptBrandKit | null | undefined;
}): GovernanceViolation | null {
  if (!input.brandKit?.logoUrl) return null;
  const promptLower = lower(input.prompt);
  // Look for the tasteful-placement directive markers the composer
  // emits when a logo is present.
  const hasTastefulPlacement = promptLower.includes('subtly')
    && (promptLower.includes('brand mark') || promptLower.includes('logo'))
    && promptLower.includes('never as a corner watermark');
  if (hasTastefulPlacement) return null;
  // Look for problematic patterns the composer should never emit but
  // a custom caller might.
  if (promptLower.includes('watermark') || promptLower.includes('large logo')) {
    return {
      category: 'logo_usage',
      severity: 'error',
      description: 'Prompt references watermark-style logo placement.',
      recommendedAction: 'Replace with tasteful-placement directive.',
    };
  }
  return {
    category: 'logo_usage',
    severity: 'warning',
    description: 'Brand logo is present in brand kit but tasteful-placement directive is missing from the prompt.',
    recommendedAction: 'Strengthen brand layer so the composer emits the tasteful-placement line.',
  };
}

function checkRealismConsistency(input: {
  rank: AestheticRankResult;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  if (input.rank.dimensionScores.realism_quality < 50) {
    return {
      category: 'realism_consistency',
      severity: 'error',
      description: 'Realism-quality dimension scored below 50 — the prompt likely allows synthetic/AI-stock output.',
      recommendedAction: 'Tighten realism directives; bias toward documentary or cinematic editorial.',
    };
  }
  return null;
}

function checkEmotionalToneConsistency(input: {
  plan: CreativeDirectionPlan;
  dna: CampaignVisualDNA | null | undefined;
  rank: AestheticRankResult;
}): GovernanceViolation | null {
  if (input.dna && input.dna.visualDNA.emotionalTone !== input.plan.emotionalDirection) {
    return {
      category: 'emotional_tone_consistency',
      severity: 'error',
      description: `Per-asset plan emotional direction "${input.plan.emotionalDirection}" diverges from campaign DNA tone "${input.dna.visualDNA.emotionalTone}".`,
      recommendedAction: 'Re-project the asset plan from campaign DNA.',
    };
  }
  if (input.rank.dimensionScores.emotional_resonance < 50) {
    return {
      category: 'emotional_tone_consistency',
      severity: 'warning',
      description: 'Emotional-resonance dimension scored below 50 — plan tone is present but not strongly anchored in the prompt.',
      recommendedAction: 'Strengthen emotional-direction markers in the visual-direction layer.',
    };
  }
  return null;
}

function checkVisualDensityConsistency(input: {
  plan: CreativeDirectionPlan;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  if (input.dna && input.dna.visualDNA.visualDensity !== input.plan.visualDensity) {
    return {
      category: 'visual_density_consistency',
      severity: 'warning',
      description: `Per-asset density "${input.plan.visualDensity}" diverges from campaign DNA density "${input.dna.visualDNA.visualDensity}".`,
      recommendedAction: 'Inherit visual density from campaign DNA.',
    };
  }
  return null;
}

function checkTypographyPhilosophy(input: {
  prompt: string;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  // The text-ban contract is the load-bearing typography signal — when
  // a prompt LACKS the explicit "no visible text" line, governance flags
  // a risk that the provider will render fake UI / fake labels / fake
  // captions, which is the most common typography-philosophy failure.
  const promptLower = lower(input.prompt);
  if (!promptLower.includes('strictly avoid all visible text')) {
    return {
      category: 'typography_philosophy',
      severity: 'error',
      description: 'Prompt is missing the canonical text-ban directive.',
      recommendedAction: 'Re-emit through the composer which always appends the text-ban footer.',
    };
  }
  return null;
}

function checkProductAuthenticity(input: {
  composed: CreatorComposedPrompt;
  rank: AestheticRankResult;
}): GovernanceViolation | null {
  if (input.rank.dimensionScores.product_authenticity < 45) {
    return {
      category: 'product_authenticity',
      severity: 'error',
      description: 'Product-authenticity dimension scored very low — the prompt expected product grounding but failed to anchor it.',
      recommendedAction: 'Add product context or downgrade strategy to a non-product-centric profile.',
    };
  }
  return null;
}

function checkForbiddenStyle(input: { prompt: string }): GovernanceViolation | null {
  const promptLower = lower(input.prompt);
  const hits = FORBIDDEN_STYLE_MARKERS.filter((m) => promptLower.includes(m));
  if (hits.length === 0) return null;
  return {
    category: 'forbidden_style',
    severity: 'reject',
    description: `Prompt contains forbidden style markers: ${hits.join(', ')}.`,
    recommendedAction: 'Reject and re-compose with realism directives intact.',
  };
}

function checkStockPhotoBias(input: {
  prompt: string;
  rank: AestheticRankResult;
}): GovernanceViolation | null {
  const promptLower = lower(input.prompt);
  const hits = STOCK_PHOTO_RISK_MARKERS.filter((m) => promptLower.includes(m));
  // Two sources: explicit marker presence OR a low artifact_risk score
  // (which means suppression directives weren't strong enough).
  if (hits.length > 0) {
    return {
      category: 'stock_photo_bias',
      severity: 'error',
      description: `Prompt contains stock-photo-trap markers: ${hits.join(', ')}.`,
      recommendedAction: 'Strengthen negative-directive layer; re-emit through composer.',
    };
  }
  if (input.rank.dimensionScores.artifact_risk < 50) {
    return {
      category: 'stock_photo_bias',
      severity: 'warning',
      description: 'Artifact-risk dimension low — suppression directives may be diluted by other content.',
      recommendedAction: 'Re-compose with stronger suppression layer.',
    };
  }
  return null;
}

function checkCompositionFamilyConsistency(input: {
  plan: CreativeDirectionPlan;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  if (input.dna && input.dna.visualDNA.compositionFamily !== input.plan.compositionStrategy) {
    return {
      category: 'composition_family_consistency',
      severity: 'error',
      description: `Per-asset composition "${input.plan.compositionStrategy}" diverges from campaign DNA composition family "${input.dna.visualDNA.compositionFamily}".`,
      recommendedAction: 'Re-project the asset plan from campaign DNA before composing.',
    };
  }
  return null;
}

function checkHumanPresenceConsistency(input: {
  plan: CreativeDirectionPlan;
  dna: CampaignVisualDNA | null | undefined;
}): GovernanceViolation | null {
  if (input.dna && input.dna.visualDNA.humanPresencePolicy !== input.plan.humanPresenceMode) {
    return {
      category: 'human_presence_consistency',
      severity: 'warning',
      description: `Per-asset human presence "${input.plan.humanPresenceMode}" diverges from campaign DNA policy "${input.dna.visualDNA.humanPresencePolicy}".`,
      recommendedAction: 'Inherit human-presence policy from campaign DNA.',
    };
  }
  return null;
}

/* ── Retry-strategy selector ────────────────────────────────────────── */

function selectRetryStrategy(violations: ReadonlyArray<GovernanceViolation>): { strategy: RetryStrategy; rationale: string | null } {
  // Reject-tier wins.
  const rejecting = violations.find((v) => v.severity === 'reject');
  if (rejecting) {
    return { strategy: 'tighten_realism', rationale: rejecting.description };
  }
  // Error-tier next, in priority order.
  const errors = violations.filter((v) => v.severity === 'error');
  for (const v of errors) {
    switch (v.category) {
      case 'palette_discipline': return { strategy: 'tighten_palette', rationale: v.description };
      case 'realism_consistency': return { strategy: 'tighten_realism', rationale: v.description };
      case 'stock_photo_bias': return { strategy: 'reduce_stock_bias', rationale: v.description };
      case 'product_authenticity': return { strategy: 'increase_product_grounding', rationale: v.description };
      case 'emotional_tone_consistency': return { strategy: 'switch_emotional_tone', rationale: v.description };
      case 'composition_family_consistency': return { strategy: 'enforce_composition_family', rationale: v.description };
      case 'human_presence_consistency': return { strategy: 'suppress_human_presence', rationale: v.description };
      case 'logo_usage': return { strategy: 'tighten_brand_signals', rationale: v.description };
      case 'typography_philosophy': return { strategy: 'tighten_realism', rationale: v.description };
      default: continue;
    }
  }
  return { strategy: 'none', rationale: null };
}

/* ── Score aggregation ──────────────────────────────────────────────── */

const SEVERITY_PENALTY: Record<GovernanceSeverity, number> = {
  warning: 5,
  error: 15,
  reject: 100,
};

const CATEGORY_WEIGHT: Record<GovernanceCategory, number> = {
  palette_discipline: 8,
  logo_usage: 6,
  realism_consistency: 14,
  emotional_tone_consistency: 12,
  visual_density_consistency: 6,
  typography_philosophy: 10,
  product_authenticity: 10,
  forbidden_style: 18,
  off_brand_visual_pattern: 8,
  composition_family_consistency: 10,
  human_presence_consistency: 6,
  stock_photo_bias: 14,
};

function aggregateScore(violations: ReadonlyArray<GovernanceViolation>): number {
  let penalty = 0;
  for (const v of violations) {
    const w = CATEGORY_WEIGHT[v.category] ?? 5;
    const sev = SEVERITY_PENALTY[v.severity] ?? 5;
    // Normalize by category weight to keep score 0-100 bounded.
    penalty += (w * sev) / 100;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/* ── Public entry point ─────────────────────────────────────────────── */

export type GovernanceEvaluationInput = {
  composed: CreatorComposedPrompt;
  plan: CreativeDirectionPlan;
  rank: AestheticRankResult;
  brandKit?: CreatorPromptBrandKit | null;
  dna?: CampaignVisualDNA | null;
};

export function evaluateBrandGovernance(input: GovernanceEvaluationInput): GovernanceResult {
  const prompt = input.composed.prompt;

  const checks: Array<GovernanceViolation | null> = [
    checkPaletteDiscipline({ prompt, brandKit: input.brandKit, dna: input.dna }),
    checkLogoUsage({ prompt, brandKit: input.brandKit }),
    checkRealismConsistency({ rank: input.rank, dna: input.dna }),
    checkEmotionalToneConsistency({ plan: input.plan, dna: input.dna, rank: input.rank }),
    checkVisualDensityConsistency({ plan: input.plan, dna: input.dna }),
    checkTypographyPhilosophy({ prompt, dna: input.dna }),
    checkProductAuthenticity({ composed: input.composed, rank: input.rank }),
    checkForbiddenStyle({ prompt }),
    checkStockPhotoBias({ prompt, rank: input.rank }),
    checkCompositionFamilyConsistency({ plan: input.plan, dna: input.dna }),
    checkHumanPresenceConsistency({ plan: input.plan, dna: input.dna }),
  ];

  const found = checks.filter((v): v is GovernanceViolation => v !== null);
  const violations = found.filter((v) => v.severity === 'error' || v.severity === 'reject');
  const warnings = found.filter((v) => v.severity === 'warning');

  const governanceScore = aggregateScore(found);
  const rejectGeneration = found.some((v) => v.severity === 'reject');
  const { strategy, rationale } = selectRetryStrategy(found);

  // Brand-alignment confidence = governance score discounted by the
  // absence of explicit brand signals.
  let brandAlignmentConfidence = governanceScore;
  if (!input.brandKit || (!input.brandKit.companyName && !input.brandKit.industry)) {
    brandAlignmentConfidence = Math.min(brandAlignmentConfidence, 60);
  }

  return {
    governanceScore,
    governanceViolations: violations,
    governanceWarnings: warnings,
    brandAlignmentConfidence,
    rejectGeneration,
    retryStrategy: strategy,
    retryRationale: rationale,
  };
}

/* ── Phase 4 — Campaign consistency scoring across multiple assets ──── */

export type CampaignConsistencyInput = {
  dna: CampaignVisualDNA;
  assetPlans: ReadonlyArray<CreativeDirectionPlan>;
  assetRanks: ReadonlyArray<AestheticRankResult>;
};

export type CampaignConsistencyResult = {
  campaignConsistencyScore: number;
  coherenceViolations: ReadonlyArray<string>;
  recommendedCorrections: ReadonlyArray<string>;
  regenerationRequired: boolean;
};

export function scoreCampaignConsistency(input: CampaignConsistencyInput): CampaignConsistencyResult {
  const violations: string[] = [];
  const corrections: string[] = [];
  const n = input.assetPlans.length;
  if (n === 0) {
    return {
      campaignConsistencyScore: 100,
      coherenceViolations: [],
      recommendedCorrections: [],
      regenerationRequired: false,
    };
  }

  let driftPenalty = 0;
  for (let i = 0; i < n; i++) {
    const plan = input.assetPlans[i];
    if (plan.emotionalDirection !== input.dna.visualDNA.emotionalTone) {
      driftPenalty += 12;
      violations.push(`asset_${i}:emotional_direction_drift:${plan.emotionalDirection} (DNA: ${input.dna.visualDNA.emotionalTone})`);
      corrections.push(`Re-project asset ${i} plan from DNA emotional tone.`);
    }
    if (plan.realismProfile !== input.dna.visualDNA.realismProfile) {
      driftPenalty += 10;
      violations.push(`asset_${i}:realism_profile_drift:${plan.realismProfile} (DNA: ${input.dna.visualDNA.realismProfile})`);
      corrections.push(`Re-project asset ${i} plan from DNA realism profile.`);
    }
    if (plan.compositionStrategy !== input.dna.visualDNA.compositionFamily) {
      driftPenalty += 8;
      violations.push(`asset_${i}:composition_drift:${plan.compositionStrategy} (DNA: ${input.dna.visualDNA.compositionFamily})`);
      corrections.push(`Re-project asset ${i} composition from DNA family.`);
    }
    if (plan.humanPresenceMode !== input.dna.visualDNA.humanPresencePolicy) {
      driftPenalty += 6;
      violations.push(`asset_${i}:human_presence_drift:${plan.humanPresenceMode} (DNA: ${input.dna.visualDNA.humanPresencePolicy})`);
      corrections.push(`Inherit human-presence policy from DNA for asset ${i}.`);
    }
    if (plan.visualDensity !== input.dna.visualDNA.visualDensity) {
      driftPenalty += 4;
      violations.push(`asset_${i}:visual_density_drift:${plan.visualDensity} (DNA: ${input.dna.visualDNA.visualDensity})`);
    }
    const rank = input.assetRanks[i];
    if (rank && rank.totalScore < 55) {
      driftPenalty += 8;
      violations.push(`asset_${i}:aesthetic_rank_below_acceptable:${rank.totalScore}`);
      corrections.push(`Regenerate asset ${i} via governance-aware retry.`);
    }
  }

  // Normalize drift by asset count so larger campaigns don't trip the
  // regenerate threshold from sheer volume.
  const normalized = driftPenalty / Math.max(1, n);
  const campaignConsistencyScore = Math.max(0, Math.min(100, Math.round(100 - normalized)));
  const regenerationRequired = campaignConsistencyScore < 60;

  return {
    campaignConsistencyScore,
    coherenceViolations: violations,
    recommendedCorrections: corrections,
    regenerationRequired,
  };
}
