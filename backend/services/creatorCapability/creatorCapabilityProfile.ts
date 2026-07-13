/**
 * creatorCapabilityProfile.ts — the canonical Creator Capability Profile (PMF-004 §2).
 *
 * ONE declarative profile per Content Creator asset type. The platform runtime
 * EXECUTES the profile (config + orchestration) instead of a bespoke per-type flow —
 * adding a new asset type becomes "add a profile", not "write another execution
 * flow". The profile selects the existing prompts/layout via `assetType` (prompt
 * selection behind the profile, §7) and references the existing asset pipeline as
 * the generation backend. It changes no prompt and no generation behavior.
 */

export type CreatorCapabilityId =
  | 'IMAGE' | 'CAROUSEL' | 'INFOGRAPHIC' | 'BANNER' | 'PDF'
  | 'PRESENTATION' | 'SOCIAL_GRAPHIC' | 'THUMBNAIL';

export interface CreatorCapabilityProfile {
  id: CreatorCapabilityId;
  /** The asset type the existing pipeline understands (selects prompts/layout/renderer). */
  assetType: string;
  /** CKC knowledge requirements (domains via the consumer + confidence/freshness/mode). */
  knowledge: {
    consumer: string;
    minConfidence?: number;
    maxAgeMs?: number;
    mode?: 'summary' | 'full' | 'compressed';
  };
  /** Deterministic planning steps (layout/plan) referenced by name (existing pipeline). */
  planningStrategy: string[];
  /** Layout selection strategy (existing pipeline). */
  layoutStrategy: string;
  /** Deterministic validation steps (existing governance/diagnostics). */
  validationStrategy: string[];
  /** Brand governance rules applied (existing governance). */
  brandRules: string[];
  /** Asset pipeline rules (render/store/version/metadata). */
  assetRules: string[];
  /** Output contract id (AIC). */
  outputContract: string;
  preferredModels: string[];
  fallbackModels: string[];
  timeoutMs: number;
  retryPolicy: { maxRetries: number };
  approvalRequirements: { required: boolean; reviewStage?: string | null };
  featureFlags: { runtimeFlag: string };
  /** multiStep drives AIA vs direct-AIC (§5). inline = runs in-request. */
  executionMetadata: { multiStep: boolean; inline: boolean; assetReview: boolean };
}

const VALIDATION = ['brand_governance', 'variant_diagnostics', 'capability_check'];
const BRAND = ['brand_colors', 'logo_placement', 'brand_voice'];
const ASSET = ['render', 'store', 'version', 'metadata', 'publishing_prep'];

function profile(id: CreatorCapabilityId, assetType: string, overrides: Partial<CreatorCapabilityProfile> = {}): CreatorCapabilityProfile {
  return {
    id, assetType,
    knowledge: { consumer: 'CONTENT_CREATOR', mode: 'summary', ...(overrides.knowledge ?? {}) },
    planningStrategy: overrides.planningStrategy ?? ['layout_plan'],
    layoutStrategy: overrides.layoutStrategy ?? 'auto',
    validationStrategy: overrides.validationStrategy ?? VALIDATION,
    brandRules: overrides.brandRules ?? BRAND,
    assetRules: overrides.assetRules ?? ASSET,
    outputContract: overrides.outputContract ?? 'creator_asset',
    preferredModels: overrides.preferredModels ?? ['gpt-4o-mini'],
    fallbackModels: overrides.fallbackModels ?? [],
    timeoutMs: overrides.timeoutMs ?? 120_000,
    retryPolicy: overrides.retryPolicy ?? { maxRetries: 0 },
    approvalRequirements: overrides.approvalRequirements ?? { required: false, reviewStage: null },
    featureFlags: overrides.featureFlags ?? { runtimeFlag: 'CREATOR_RUNTIME' },
    executionMetadata: overrides.executionMetadata ?? { multiStep: false, inline: true, assetReview: false },
  };
}

const REGISTRY_INTERNAL: Record<CreatorCapabilityId, CreatorCapabilityProfile> = {
  IMAGE:          profile('IMAGE', 'image'),
  CAROUSEL:       profile('CAROUSEL', 'carousel', { planningStrategy: ['slide_plan', 'layout_plan'], executionMetadata: { multiStep: true, inline: true, assetReview: false } }),
  INFOGRAPHIC:    profile('INFOGRAPHIC', 'infographic', { planningStrategy: ['data_plan', 'layout_plan'] }),
  BANNER:         profile('BANNER', 'banner'),
  PDF:            profile('PDF', 'pdf', { timeoutMs: 240_000, executionMetadata: { multiStep: true, inline: true, assetReview: false } }),
  PRESENTATION:   profile('PRESENTATION', 'presentation', { timeoutMs: 300_000, planningStrategy: ['deck_plan', 'layout_plan'], executionMetadata: { multiStep: true, inline: false, assetReview: true }, approvalRequirements: { required: false, reviewStage: 'deck_review' } }),
  SOCIAL_GRAPHIC: profile('SOCIAL_GRAPHIC', 'social_graphic'),
  THUMBNAIL:      profile('THUMBNAIL', 'thumbnail'),
};

export const CREATOR_PROFILES: Readonly<Record<CreatorCapabilityId, CreatorCapabilityProfile>> = REGISTRY_INTERNAL;
export const CREATOR_CAPABILITY_IDS = Object.keys(REGISTRY_INTERNAL) as CreatorCapabilityId[];

export function resolveCreatorProfile(id: CreatorCapabilityId): CreatorCapabilityProfile | null {
  return REGISTRY_INTERNAL[id] ?? null;
}

/** Resolve the profile whose asset type matches (the migration wiring key). Tolerant of aliases. */
export function profileForAssetType(assetType: string): CreatorCapabilityProfile | null {
  const key = String(assetType || '').toLowerCase().replace(/[\s-]+/g, '_');
  const direct = CREATOR_CAPABILITY_IDS.map((id) => REGISTRY_INTERNAL[id]).find((p) => p.assetType === key);
  if (direct) return direct;
  // Common aliases → canonical asset types.
  const ALIAS: Record<string, CreatorCapabilityId> = {
    img: 'IMAGE', picture: 'IMAGE', photo: 'IMAGE',
    slides: 'CAROUSEL', carousel_post: 'CAROUSEL',
    deck: 'PRESENTATION', slide_deck: 'PRESENTATION',
    social: 'SOCIAL_GRAPHIC', social_post: 'SOCIAL_GRAPHIC',
    thumb: 'THUMBNAIL', cover: 'THUMBNAIL',
    document: 'PDF',
  };
  const aliased = ALIAS[key];
  return aliased ? REGISTRY_INTERNAL[aliased] : null;
}
