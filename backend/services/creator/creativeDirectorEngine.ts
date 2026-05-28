/**
 * Creative Director Engine (Phases 1, 4, 5).
 *
 * Deterministic planner. Takes campaign intent + audience + platform
 * + brand + product signals and produces a `CreativeDirectionPlan`
 * that downstream orchestration (variant exploration, aesthetic
 * ranking, art-direction adaptation) reasons against.
 *
 * NO freeform AI / chain-of-thought / speculative reasoning. Pure
 * structured heuristics + ten reusable strategy profiles.
 *
 * Provider-agnostic. Pure (no DB, no fetch). Deterministic given the
 * same input → same plan.
 */

import type {
  CreativeDirectionTemplate,
  CreatorPromptBrandKit,
  CreatorPromptProductContext,
} from './creatorPromptComposer';

/* ── Strategy profile catalog ───────────────────────────────────────── */

export type CreativeStrategyId =
  | 'cinematic_editorial'
  | 'premium_product_launch'
  | 'ambient_workflow_realism'
  | 'executive_documentary'
  | 'modern_ai_editorial'
  | 'minimal_premium_ui'
  | 'ecosystem_storytelling'
  | 'editorial_growth_campaign'
  | 'product_in_context'
  | 'realistic_founder_storytelling';

export type RealismLevel = 'editorial' | 'documentary' | 'cinematic' | 'minimal';
export type VisualDensity = 'sparse' | 'balanced' | 'rich';
export type SubjectEmphasis = 'absent' | 'subtle' | 'central';

export type CreativeStrategyProfile = {
  id: CreativeStrategyId;
  emotionalTone: string;
  framingStyle: string;
  lightingDiscipline: string;
  realismLevel: RealismLevel;
  visualDensity: VisualDensity;
  humanEmphasis: SubjectEmphasis;
  productEmphasis: SubjectEmphasis;
  environmentBehavior: string;
  compositionBehavior: string;
  negativeConstraints: string;
  preferredTemplate: CreativeDirectionTemplate;
  /** Sibling templates used by the variant orchestrator for meaningful exploration. */
  variantTemplates: ReadonlyArray<CreativeDirectionTemplate>;
};

export const CREATIVE_STRATEGY_PROFILES: Record<CreativeStrategyId, CreativeStrategyProfile> = {
  cinematic_editorial: {
    id: 'cinematic_editorial',
    emotionalTone: 'restrained editorial confidence, magazine-grade composure',
    framingStyle: 'asymmetric magazine-cover composition with one decisive focal idea',
    lightingDiscipline: 'cinematic key light with one motivated source; deliberate shadow architecture',
    realismLevel: 'cinematic',
    visualDensity: 'sparse',
    humanEmphasis: 'subtle',
    productEmphasis: 'subtle',
    environmentBehavior: 'believable real environment with intentional materiality',
    compositionBehavior: 'one focal idea, intentional negative space, controlled depth',
    negativeConstraints: 'no marketing collage, no theatrical flourish, no brochure tropes',
    preferredTemplate: 'premium_brand_campaign',
    variantTemplates: ['cinematic_product_launch', 'editorial_modern_startup'],
  },
  premium_product_launch: {
    id: 'premium_product_launch',
    emotionalTone: 'cinematic premium-launch confidence — single decisive moment',
    framingStyle: 'anamorphic horizontal discipline, single hero element off-center',
    lightingDiscipline: 'directional key light, deliberate fall-off, subtle rim light',
    realismLevel: 'cinematic',
    visualDensity: 'sparse',
    humanEmphasis: 'absent',
    productEmphasis: 'central',
    environmentBehavior: 'atmospheric environment with natural ambient bounce',
    compositionBehavior: 'hero element + atmospheric depth + brand accent reflection',
    negativeConstraints: 'no marketing layout, no fake cinematic clichés, no secondary subjects',
    preferredTemplate: 'cinematic_product_launch',
    variantTemplates: ['product_launch', 'minimal_product_hero'],
  },
  ambient_workflow_realism: {
    id: 'ambient_workflow_realism',
    emotionalTone: 'quiet focus, real moment of work — never posed',
    framingStyle: 'documentary candid framing, off-center subject',
    lightingDiscipline: 'natural daylight or warm practical source, honest ambient bounce',
    realismLevel: 'documentary',
    visualDensity: 'balanced',
    humanEmphasis: 'subtle',
    productEmphasis: 'central',
    environmentBehavior: 'real workspace with lived-in detail, real surfaces, real reflections',
    compositionBehavior: 'hands or person → device → ambient workspace',
    negativeConstraints: 'no posed teamwork, no exaggerated energy, no clean stock-photo surfaces',
    preferredTemplate: 'ambient_productivity',
    variantTemplates: ['realistic_workflow_scene', 'productivity_workflow'],
  },
  executive_documentary: {
    id: 'executive_documentary',
    emotionalTone: 'reflective, decisive, documentary realism',
    framingStyle: 'asymmetric environmental portrait, subject in profile or off-center',
    lightingDiscipline: 'editorial atmospheric light, directional with shadow falloff',
    realismLevel: 'documentary',
    visualDensity: 'balanced',
    humanEmphasis: 'central',
    productEmphasis: 'subtle',
    environmentBehavior: 'real environment with context cues, lived-in detail',
    compositionBehavior: 'subject → environment → atmospheric light',
    negativeConstraints: 'no suit-and-smile portraits, no brochure poses, no corporate-photo tropes',
    preferredTemplate: 'founder_storytelling',
    variantTemplates: ['executive_insight', 'ambient_productivity'],
  },
  modern_ai_editorial: {
    id: 'modern_ai_editorial',
    emotionalTone: 'calm intelligence, modern AI-native sophistication — not sci-fi',
    framingStyle: 'magazine-grade asymmetric composition with intelligence motifs in depth',
    lightingDiscipline: 'restrained editorial light with one accent-color glow',
    realismLevel: 'editorial',
    visualDensity: 'sparse',
    humanEmphasis: 'absent',
    productEmphasis: 'subtle',
    environmentBehavior: 'real environment with restrained motif overlay; never abstract void',
    compositionBehavior: 'subject anchor → motif depth → accent glow',
    negativeConstraints: 'no neon, no holographic tropes, no Matrix-style data streams',
    preferredTemplate: 'premium_ai_editorial',
    variantTemplates: ['ai_innovation', 'editorial_modern_startup'],
  },
  minimal_premium_ui: {
    id: 'minimal_premium_ui',
    emotionalTone: 'premium magazine-spread restraint, intentional silence',
    framingStyle: 'minimal composition, single hero subject, generous negative space',
    lightingDiscipline: 'single deliberate source, sharp focused highlight, restrained shadow',
    realismLevel: 'minimal',
    visualDensity: 'sparse',
    humanEmphasis: 'absent',
    productEmphasis: 'central',
    environmentBehavior: 'real material on a calm surface, no decorative clutter',
    compositionBehavior: 'hero subject only; everything else is breathing room',
    negativeConstraints: 'no background graphics, no secondary subjects, no decorative props',
    preferredTemplate: 'minimal_product_hero',
    variantTemplates: ['clean_editorial_product', 'dashboard_centric'],
  },
  ecosystem_storytelling: {
    id: 'ecosystem_storytelling',
    emotionalTone: 'considered, connected, ecosystem confidence',
    framingStyle: 'multiple product touchpoints composed with restraint',
    lightingDiscipline: 'ambient brand lighting unifying surfaces + single key light',
    realismLevel: 'editorial',
    visualDensity: 'rich',
    humanEmphasis: 'subtle',
    productEmphasis: 'central',
    environmentBehavior: 'real device + real surface + real connecting environment',
    compositionBehavior: 'primary surface → secondary surface → ambient brand presence',
    negativeConstraints: 'no fake floating devices, no collage layouts, no connector graphics',
    preferredTemplate: 'product_ecosystem_visual',
    variantTemplates: ['dashboard_centric', 'premium_brand_campaign'],
  },
  editorial_growth_campaign: {
    id: 'editorial_growth_campaign',
    emotionalTone: 'premium, restrained, confident — magazine-cover discipline',
    framingStyle: 'asymmetric, decisive, one focal idea',
    lightingDiscipline: 'confident editorial light, one motivated source, controlled shadow',
    realismLevel: 'editorial',
    visualDensity: 'balanced',
    humanEmphasis: 'subtle',
    productEmphasis: 'subtle',
    environmentBehavior: 'believable real-world scene with intentional materiality',
    compositionBehavior: 'one focal idea + restrained ambient context',
    negativeConstraints: 'no marketing-collage layouts, no startup-poster tropes, no decorative clip-art',
    preferredTemplate: 'editorial_modern_startup',
    variantTemplates: ['premium_brand_campaign', 'editorial_feature_reveal'],
  },
  product_in_context: {
    id: 'product_in_context',
    emotionalTone: 'confident product surface — "this is the real thing"',
    framingStyle: 'real device on real surface, off-center, believable interaction',
    lightingDiscipline: 'ambient brand lighting around device + cool glow from surface',
    realismLevel: 'editorial',
    visualDensity: 'balanced',
    humanEmphasis: 'subtle',
    productEmphasis: 'central',
    environmentBehavior: 'real device housing, real surface, real ambient bounce',
    compositionBehavior: 'screen → device → environment',
    negativeConstraints: 'no fake floating UI, no obvious mockup textures, no readable placeholder text',
    preferredTemplate: 'dashboard_centric',
    variantTemplates: ['realistic_workflow_scene', 'clean_editorial_product'],
  },
  realistic_founder_storytelling: {
    id: 'realistic_founder_storytelling',
    emotionalTone: 'quiet, real, reflective — never posed',
    framingStyle: 'candid environmental portrait with foreground context cue',
    lightingDiscipline: 'natural directional light, documentary ambient',
    realismLevel: 'documentary',
    visualDensity: 'balanced',
    humanEmphasis: 'central',
    productEmphasis: 'subtle',
    environmentBehavior: 'real founder context with lived-in detail',
    compositionBehavior: 'subject → context cue (hands/notebook/device) → ambient environment',
    negativeConstraints: 'no suit-and-smile, no brochure poses, no glossy corporate clichés',
    preferredTemplate: 'founder_storytelling',
    variantTemplates: ['realistic_workflow_scene', 'executive_insight'],
  },
};

/* ── Plan output contract ───────────────────────────────────────────── */

export type EmotionalDirection = 'cinematic' | 'documentary' | 'editorial' | 'minimal' | 'intelligence' | 'ecosystem';
export type CompositionStrategy = 'hero' | 'ambient' | 'ecosystem' | 'portrait' | 'minimal' | 'hierarchical';
export type FramingStrategy = 'asymmetric_magazine' | 'documentary_candid' | 'environmental_portrait' | 'minimal_hero' | 'multi_surface';
export type SubjectPriority = 'product_first' | 'human_first' | 'environment_first' | 'balanced';
export type HumanPresenceMode = 'absent' | 'subtle' | 'central';
export type RealismProfile = 'editorial' | 'documentary' | 'cinematic' | 'minimal';
export type VisualNarrative = 'launch' | 'reveal' | 'workflow' | 'leadership' | 'innovation' | 'ecosystem' | 'campaign' | 'product';

export type CreativeDirectionPlan = {
  strategyProfile: CreativeStrategyId;
  emotionalDirection: EmotionalDirection;
  compositionStrategy: CompositionStrategy;
  realismProfile: RealismProfile;
  visualNarrative: VisualNarrative;
  artDirectionStyle: string;
  framingStrategy: FramingStrategy;
  subjectPriority: SubjectPriority;
  environmentStyle: string;
  humanPresenceMode: HumanPresenceMode;
  visualDensity: VisualDensity;
  premiumBias: boolean;
  /** Audit trail — signals that drove this plan. */
  rationale: string[];
};

/* ── Plan input contract ────────────────────────────────────────────── */

export type CreativeDirectionInput = {
  campaignIntent?: string | null;
  audience?: string | null;
  platform?: string | null;
  contentType?: string | null;
  brandKit?: CreatorPromptBrandKit | null;
  productContext?: CreatorPromptProductContext | null;
  /** When provided, the planner reuses the brand's preferred strategy for continuity (Phase 8). */
  brandMemory?: {
    preferredStrategy?: CreativeStrategyId | null;
  } | null;
};

/* ── Helpers ────────────────────────────────────────────────────────── */

function lower(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

function hasAnySignal(haystack: string, needles: ReadonlyArray<string>): boolean {
  if (!haystack) return false;
  return needles.some((n) => haystack.includes(n));
}

function countBrandSignals(kit: CreatorPromptBrandKit | null | undefined): number {
  if (!kit) return 0;
  let n = 0;
  if (kit.companyName) n++;
  if (kit.industry) n++;
  if (kit.tone) n++;
  if (Array.isArray(kit.palette) && kit.palette.length > 0) n++;
  if (kit.accentColor) n++;
  if (kit.logoUrl) n++;
  return n;
}

function countProductSignals(prod: CreatorPromptProductContext | null | undefined): number {
  if (!prod) return 0;
  let n = 0;
  if (prod.productName) n++;
  if (prod.productCategory) n++;
  if (prod.dashboardDescription) n++;
  if (Array.isArray(prod.screenshotUrls) && prod.screenshotUrls.length > 0) n++;
  if (Array.isArray(prod.uiKeywords) && prod.uiKeywords.length > 0) n++;
  return n;
}

/* ── Strategy selection ─────────────────────────────────────────────── */

function selectStrategyProfile(input: CreativeDirectionInput): { id: CreativeStrategyId; rationale: string[] } {
  const rationale: string[] = [];
  const intent = lower(input.campaignIntent);
  const audience = lower(input.audience);
  const ctype = lower(input.contentType);
  const hasUi = Boolean(input.productContext?.dashboardDescription || (input.productContext?.screenshotUrls?.length ?? 0) > 0);
  const hasMultiSurface = (input.productContext?.screenshotUrls?.length ?? 0) > 1;
  const brandSignals = countBrandSignals(input.brandKit);
  const productSignals = countProductSignals(input.productContext);

  // Brand-memory reuse — Phase 8 continuity short-circuit.
  if (input.brandMemory?.preferredStrategy && CREATIVE_STRATEGY_PROFILES[input.brandMemory.preferredStrategy]) {
    rationale.push(`brand_memory_continuity:${input.brandMemory.preferredStrategy}`);
    return { id: input.brandMemory.preferredStrategy, rationale };
  }

  // Intent-driven selection. Highest specificity wins.
  if (hasAnySignal(intent, ['ai', 'intelligence', 'model', 'ml'])) {
    rationale.push('intent_signal:ai_innovation');
    return { id: 'modern_ai_editorial', rationale };
  }
  if (hasAnySignal(intent, ['founder', 'leader', 'executive', 'story', 'behind the scenes'])) {
    rationale.push('intent_signal:leadership_story');
    return { id: 'realistic_founder_storytelling', rationale };
  }
  if (hasAnySignal(intent, ['automation', 'workflow', 'orchestrat'])) {
    rationale.push('intent_signal:workflow');
    return { id: 'ambient_workflow_realism', rationale };
  }
  if (hasAnySignal(intent, ['ecosystem', 'integrate', 'connected', 'platform'])) {
    rationale.push('intent_signal:ecosystem');
    return { id: 'ecosystem_storytelling', rationale };
  }
  if (hasAnySignal(intent, ['launch', 'introduce', 'announce', 'reveal'])) {
    if (brandSignals >= 3) {
      rationale.push('intent_signal:launch + brand_grounded');
      return { id: 'premium_product_launch', rationale };
    }
    rationale.push('intent_signal:launch (base)');
    return { id: 'editorial_growth_campaign', rationale };
  }
  if (hasAnySignal(intent, ['feature', 'capability', 'showcase'])) {
    rationale.push('intent_signal:feature');
    return { id: 'editorial_growth_campaign', rationale };
  }

  // Product-context-driven selection.
  if (hasMultiSurface) {
    rationale.push('product_signal:multi_surface');
    return { id: 'ecosystem_storytelling', rationale };
  }
  if (hasUi) {
    rationale.push('product_signal:ui_present');
    return { id: 'product_in_context', rationale };
  }
  if (productSignals >= 2 && brandSignals >= 3) {
    rationale.push('product+brand_signal:premium_minimal');
    return { id: 'minimal_premium_ui', rationale };
  }

  // Content-type defaults.
  if (ctype === 'brand_card' || ctype === 'banner') {
    rationale.push(`content_type_default:${ctype}`);
    return { id: brandSignals >= 3 ? 'cinematic_editorial' : 'editorial_growth_campaign', rationale };
  }

  // Audience-driven nudge for editorial vs documentary.
  if (hasAnySignal(audience, ['founder', 'executive', 'leader', 'ceo', 'cto'])) {
    rationale.push('audience_signal:leadership');
    return { id: 'executive_documentary', rationale };
  }

  rationale.push('default:editorial_growth_campaign');
  return { id: 'editorial_growth_campaign', rationale };
}

/* ── Knob derivation ────────────────────────────────────────────────── */

function deriveEmotionalDirection(profile: CreativeStrategyProfile): EmotionalDirection {
  switch (profile.realismLevel) {
    case 'cinematic': return 'cinematic';
    case 'documentary': return 'documentary';
    case 'minimal': return 'minimal';
    case 'editorial':
    default: return 'editorial';
  }
}

function deriveCompositionStrategy(profile: CreativeStrategyProfile): CompositionStrategy {
  if (profile.id === 'minimal_premium_ui') return 'minimal';
  if (profile.id === 'ecosystem_storytelling') return 'ecosystem';
  if (profile.id === 'executive_documentary' || profile.id === 'realistic_founder_storytelling') return 'portrait';
  if (profile.id === 'ambient_workflow_realism') return 'ambient';
  if (profile.id === 'product_in_context') return 'hierarchical';
  return 'hero';
}

function deriveFramingStrategy(profile: CreativeStrategyProfile): FramingStrategy {
  if (profile.id === 'cinematic_editorial' || profile.id === 'editorial_growth_campaign') return 'asymmetric_magazine';
  if (profile.id === 'ambient_workflow_realism') return 'documentary_candid';
  if (profile.id === 'executive_documentary' || profile.id === 'realistic_founder_storytelling') return 'environmental_portrait';
  if (profile.id === 'minimal_premium_ui') return 'minimal_hero';
  if (profile.id === 'ecosystem_storytelling') return 'multi_surface';
  return 'asymmetric_magazine';
}

function deriveSubjectPriority(profile: CreativeStrategyProfile): SubjectPriority {
  if (profile.humanEmphasis === 'central') return 'human_first';
  if (profile.productEmphasis === 'central' && profile.humanEmphasis === 'absent') return 'product_first';
  if (profile.productEmphasis === 'central') return 'product_first';
  if (profile.humanEmphasis === 'subtle' && profile.productEmphasis === 'subtle') return 'balanced';
  return 'environment_first';
}

function deriveVisualNarrative(intent: string, profile: CreativeStrategyProfile): VisualNarrative {
  const i = lower(intent);
  if (hasAnySignal(i, ['launch', 'introduce', 'announce'])) return 'launch';
  if (hasAnySignal(i, ['feature', 'reveal', 'showcase'])) return 'reveal';
  if (hasAnySignal(i, ['workflow', 'automation', 'orchestrat'])) return 'workflow';
  if (hasAnySignal(i, ['founder', 'leader', 'executive', 'story'])) return 'leadership';
  if (hasAnySignal(i, ['ai', 'intelligence', 'model'])) return 'innovation';
  if (profile.id === 'ecosystem_storytelling') return 'ecosystem';
  if (profile.id === 'minimal_premium_ui' || profile.id === 'product_in_context') return 'product';
  return 'campaign';
}

/* ── Public entry point ─────────────────────────────────────────────── */

export function planCreativeDirection(input: CreativeDirectionInput): CreativeDirectionPlan {
  const { id: profileId, rationale } = selectStrategyProfile(input);
  const profile = CREATIVE_STRATEGY_PROFILES[profileId];
  const brandSignals = countBrandSignals(input.brandKit);
  const premiumBias = brandSignals >= 3;
  if (premiumBias) rationale.push('premium_bias:brand_grounded');

  return {
    strategyProfile: profileId,
    emotionalDirection: deriveEmotionalDirection(profile),
    compositionStrategy: deriveCompositionStrategy(profile),
    realismProfile: profile.realismLevel,
    visualNarrative: deriveVisualNarrative(input.campaignIntent ?? '', profile),
    artDirectionStyle: `${profile.framingStyle} · ${profile.lightingDiscipline}`,
    framingStrategy: deriveFramingStrategy(profile),
    subjectPriority: deriveSubjectPriority(profile),
    environmentStyle: profile.environmentBehavior,
    humanPresenceMode: profile.humanEmphasis,
    visualDensity: profile.visualDensity,
    premiumBias,
    rationale,
  };
}

/** Public lookup for the strategy profile chosen by a plan. */
export function getStrategyProfile(id: CreativeStrategyId): CreativeStrategyProfile {
  return CREATIVE_STRATEGY_PROFILES[id];
}
