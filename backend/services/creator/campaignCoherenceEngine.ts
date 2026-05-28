/**
 * Campaign Coherence Engine (Phase 1).
 *
 * Establishes and maintains a CAMPAIGN-LEVEL visual DNA so multiple
 * assets generated for the same campaign feel intentionally orchestrated
 * — same palette behavior, same emotional tone, same composition
 * family, same realism profile.
 *
 * Provider-agnostic. Pure (no DB, no fetch). Deterministic given the
 * same input. Reads + writes campaign DNA through the
 * `campaignVisualMemory` cache so subsequent renders for the same
 * campaign inherit the DNA.
 *
 * The DNA is a CONSTRAINT envelope that downstream planning,
 * orchestration, and governance respect — not a replacement for the
 * creative-director engine. The director still chooses per-asset
 * strategy; the DNA narrows the legal lane.
 */

import type {
  CreativeStrategyId,
  CreativeDirectionPlan,
  RealismLevel,
  VisualDensity,
  SubjectEmphasis,
  EmotionalDirection,
  CompositionStrategy,
} from './creativeDirectorEngine';
import {
  CREATIVE_STRATEGY_PROFILES,
  planCreativeDirection,
} from './creativeDirectorEngine';
import type {
  CreativeDirectionTemplate,
  CreatorPromptBrandKit,
  CreatorPromptProductContext,
} from './creatorPromptComposer';
import {
  getCampaignVisualDNA,
  storeCampaignVisualDNA,
} from './campaignVisualMemory';

/* ── Campaign visual DNA ────────────────────────────────────────────── */

export type CampaignVisualDNA = {
  campaignId: string;
  /** The strategy family that anchored this campaign's identity. */
  strategyFamily: CreativeStrategyId;
  /** Templates that align with this DNA — orchestrator picks variants from this set only. */
  approvedTemplates: ReadonlyArray<CreativeDirectionTemplate>;
  /** Shared visual rules. */
  visualDNA: {
    paletteDiscipline: ReadonlyArray<string>;
    emotionalTone: EmotionalDirection;
    realismProfile: RealismLevel;
    compositionFamily: CompositionStrategy;
    lightingDiscipline: string;
    typographyPhilosophy: string;
    environmentPhilosophy: string;
    humanPresencePolicy: SubjectEmphasis;
    productPresencePolicy: SubjectEmphasis;
    visualDensity: VisualDensity;
    coherenceKeywords: ReadonlyArray<string>;
  };
  /** Campaign-wide platform adaptation defaults (overrides applied per-asset). */
  platformAdaptationRules: Record<string, string>;
  establishedAt: string;
  lastUpdatedAt: string;
  /** Asset count under this DNA — informational. */
  assetCount: number;
  /** Audit trail. */
  rationale: ReadonlyArray<string>;
};

/* ── Public entry: get-or-establish ─────────────────────────────────── */

export type PlanOrFetchCampaignDNAInput = {
  campaignId: string | null | undefined;
  campaignIntent?: string | null;
  audience?: string | null;
  platform?: string | null;
  contentType?: string | null;
  brandKit?: CreatorPromptBrandKit | null;
  productContext?: CreatorPromptProductContext | null;
};

export type PlanOrFetchResult = {
  dna: CampaignVisualDNA;
  /** True when this call ESTABLISHED the DNA; false when it was reused. */
  established: boolean;
};

/**
 * If the campaign already has a stored DNA → return it (continuity).
 * Otherwise plan one from the inputs + store it for future assets.
 */
export function planOrFetchCampaignDNA(input: PlanOrFetchCampaignDNAInput): PlanOrFetchResult | null {
  if (!input.campaignId) return null;

  const existing = getCampaignVisualDNA(input.campaignId);
  if (existing) {
    return { dna: existing, established: false };
  }

  // Seed plan via the creative director engine so DNA derives from the
  // same strategy selection logic per-asset planning uses. Then lift
  // the plan's knobs into a campaign-scoped DNA envelope.
  const seedPlan = planCreativeDirection({
    campaignIntent: input.campaignIntent ?? null,
    audience: input.audience ?? null,
    platform: input.platform ?? null,
    contentType: input.contentType ?? null,
    brandKit: input.brandKit ?? null,
    productContext: input.productContext ?? null,
  });

  const dna = buildDNAFromSeed({
    campaignId: input.campaignId,
    plan: seedPlan,
    brandKit: input.brandKit ?? null,
  });

  const stored = storeCampaignVisualDNA({ campaignId: input.campaignId, dna });
  return { dna: stored, established: true };
}

/* ── DNA construction ───────────────────────────────────────────────── */

function buildDNAFromSeed(input: {
  campaignId: string;
  plan: CreativeDirectionPlan;
  brandKit: CreatorPromptBrandKit | null;
}): CampaignVisualDNA {
  const profile = CREATIVE_STRATEGY_PROFILES[input.plan.strategyProfile];
  const rationale: string[] = [
    `seed_strategy:${input.plan.strategyProfile}`,
    ...input.plan.rationale,
  ];

  // Approved templates: the strategy's primary + its declared variants.
  // The orchestrator's variant exploration is restricted to this set so
  // every asset stays within the campaign's lane.
  const approved: CreativeDirectionTemplate[] = [
    profile.preferredTemplate,
    ...profile.variantTemplates,
  ];

  // Palette discipline — pull from brand kit when available; otherwise
  // capture the strategy's recommended palette vocabulary as freeform
  // keywords so prompts stay coherent even without explicit hex colors.
  const palette: string[] = Array.isArray(input.brandKit?.palette) && input.brandKit!.palette!.length > 0
    ? input.brandKit!.palette!.slice(0, 5)
    : [];
  if (palette.length === 0) {
    rationale.push('palette_discipline:keyword_only (no brand palette)');
  }

  // Coherence keywords distilled from the strategy profile — these
  // appear in every per-asset prompt under this DNA, anchoring the
  // visual language.
  const coherenceKeywords: string[] = [
    profile.emotionalTone.split(',')[0].trim(),
    profile.framingStyle.split(',')[0].trim(),
    profile.lightingDiscipline.split(',')[0].trim(),
  ].filter(Boolean);

  return {
    campaignId: input.campaignId,
    strategyFamily: input.plan.strategyProfile,
    approvedTemplates: approved,
    visualDNA: {
      paletteDiscipline: palette,
      emotionalTone: input.plan.emotionalDirection,
      realismProfile: input.plan.realismProfile,
      compositionFamily: input.plan.compositionStrategy,
      lightingDiscipline: profile.lightingDiscipline,
      typographyPhilosophy: deriveTypographyPhilosophy(input.plan.realismProfile),
      environmentPhilosophy: profile.environmentBehavior,
      humanPresencePolicy: profile.humanEmphasis,
      productPresencePolicy: profile.productEmphasis,
      visualDensity: profile.visualDensity,
      coherenceKeywords,
    },
    platformAdaptationRules: {},
    establishedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    assetCount: 0,
    rationale,
  };
}

function deriveTypographyPhilosophy(realism: RealismLevel): string {
  switch (realism) {
    case 'cinematic': return 'restrained editorial type, magazine-cover discipline, decisive hierarchy';
    case 'documentary': return 'subdued documentary type, minimal contrast, supporting role only';
    case 'minimal': return 'minimal type, sparse, generous breathing room';
    case 'editorial':
    default: return 'editorial type with intentional rhythm, balanced contrast';
  }
}

/* ── DNA-constrained planning ───────────────────────────────────────── */

/**
 * Project a per-asset creative plan from the campaign DNA. The plan's
 * knobs are inherited from the DNA; only the visual narrative may shift
 * per asset (e.g., one asset is the launch hero, another is a feature
 * reveal). Strategy + composition + realism + emphasis stay consistent.
 */
export function projectAssetPlanFromDNA(input: {
  dna: CampaignVisualDNA;
  campaignIntent?: string | null;
  audience?: string | null;
  platform?: string | null;
  contentType?: string | null;
  brandKit?: CreatorPromptBrandKit | null;
  productContext?: CreatorPromptProductContext | null;
}): CreativeDirectionPlan {
  // Use the director engine but force the strategy via the brandMemory
  // continuity hook so the planner's intent-based selector defers to
  // the DNA's strategy family.
  const plan = planCreativeDirection({
    campaignIntent: input.campaignIntent ?? null,
    audience: input.audience ?? null,
    platform: input.platform ?? null,
    contentType: input.contentType ?? null,
    brandKit: input.brandKit ?? null,
    productContext: input.productContext ?? null,
    brandMemory: { preferredStrategy: input.dna.strategyFamily },
  });

  // Reconcile any knob the DNA mandates that the per-asset plan might
  // have drifted on. Strategy family is the only field that may legally
  // diverge IF the planner refuses the DNA family (e.g., extreme audience
  // mismatch) — but the brandMemory continuity hook should pin it.
  return {
    ...plan,
    emotionalDirection: input.dna.visualDNA.emotionalTone,
    realismProfile: input.dna.visualDNA.realismProfile,
    compositionStrategy: input.dna.visualDNA.compositionFamily,
    humanPresenceMode: input.dna.visualDNA.humanPresencePolicy,
    visualDensity: input.dna.visualDNA.visualDensity,
    rationale: [...plan.rationale, `campaign_dna_projection:${input.dna.campaignId}`],
  };
}

/** Check whether a template aligns with the campaign DNA. */
export function isTemplateApprovedByDNA(
  dna: CampaignVisualDNA,
  template: CreativeDirectionTemplate,
): boolean {
  return dna.approvedTemplates.includes(template);
}
