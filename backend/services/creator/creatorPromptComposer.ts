/**
 * Creator Image Prompt Composer (Phases 1–7 quality hardening).
 *
 * Replaces the single flat prompt string the renderer previously built
 * with a structured 10-layer pipeline:
 *
 *   1. campaign intent
 *   2. platform context
 *   3. asset type
 *   4. brand identity
 *   5. product identity
 *   6. visual direction (SaaS creative-direction template)
 *   7. realism directives
 *   8. composition directives
 *   9. negative / suppression directives
 *  10. rendering-quality directives
 *
 * Pure (no DB, no fetch). Deterministic given the same inputs. Returns
 * both the structured layers and a final flat prompt string the
 * existing image provider call can consume without further changes.
 */

import { resolvePurposeStrategy } from './purposeStrategyRegistry';
import {
  type GovernanceExplainabilityMetadata,
  type GovernancePromptContext,
  governanceContextHasAnyDirective,
} from './strategyGovernancePromptContext';

/* ── Input contract ─────────────────────────────────────────────────── */

export type CreatorPromptBrandKit = {
  companyName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  palette?: string[];
  accentColor?: string;
  typography?: { fontFamily?: string };
  tone?: string;
  industry?: string;
  domain?: string;
};

export type CreatorPromptProductContext = {
  productName?: string;
  productCategory?: string;
  screenshotUrls?: string[];
  dashboardDescription?: string;
  uiKeywords?: string[];
};

export type CreatorPromptInput = {
  title: string;
  body: string;
  eyebrow: string;
  attachmentMode?: string | null;
  subtypeHint?: { promptLine?: string } | null;
  brandKit?: CreatorPromptBrandKit | null;
  productContext?: CreatorPromptProductContext | null;
  audience?: string;
  platform?: string;
  objective?: string;
  tagline?: string;
  brandMode?: 'brand-aware' | 'neutral' | string | null;
  /** Content type / asset type as known to the renderer (image / banner / brand_card / supporting_image). */
  contentType?: string | null;
  /**
   * Purpose-driven generation strategy key (e.g. 'promotional-image',
   * 'story-carousel', 'stats'). Looked up in the PurposeStrategyRegistry;
   * when present, the matching strategy materially influences prompt
   * directives, composition hierarchy, scene selection, branding
   * intensity, typography weight, CTA intensity, slide-arc generation
   * (carousel), and information architecture (infographic).
   * Null / absent → fall back to the existing prompt composition path.
   */
  purposeKey?: string | null;
  /**
   * Creator Governance → Prompt Composer Integration — Phase 1+2.
   * Optional governance prompt context. When present and the
   * resolved industry is regulated, the composer adds a `governance`
   * layer carrying compliance directives that the LLM should follow.
   * Additive only — no existing prompt sections are removed. Null /
   * absent / industry='none' → strict no-op (zero change in composed
   * prompt vs. prior behavior).
   */
  governance?: GovernancePromptContext | null;
};

export type CreatorPromptLayers = {
  campaign: string[];
  asset: string[];
  brand: string[];
  product: string[];
  visualDirection: string[];
  realism: string[];
  composition: string[];
  negative: string[];
  quality: string[];
  /**
   * Purpose-strategy layer. Populated when the input carries a
   * purposeKey that resolves in the PurposeStrategyRegistry. Contains
   * the strategy's prompt directives + scene-selection hints. Empty
   * array when no strategy matched.
   */
  purpose: string[];
  /**
   * Creator Governance → Prompt Composer Integration — Phase 2.
   * Compliance directives derived from the resolved
   * strategyGovernancePolicy. Empty array when no industry policy
   * applies (industry='none') or no governance context was supplied.
   */
  governance: string[];
};

export type CreatorComposedPrompt = {
  layers: CreatorPromptLayers;
  prompt: string;
  brandGrounded: boolean;
  productGrounded: boolean;
  creativeDirection: CreativeDirectionTemplate;
  qualityFlags: string[];
  /** Premium variant was selected. */
  premium: boolean;
  /** Multimodal references collected from the input. */
  references: ReferenceImage[];
  /**
   * Purpose strategy that was applied (if any). Surface in preview
   * metadata as "Generated As: <generatedAsLabel>" and "Why this
   * structure was chosen: <whyChosen>".
   */
  purposeStrategy: {
    id: string;
    generatedAsLabel: string;
    whyChosen: string;
    densityBias: string;
    brandingIntensity: string;
    typographyWeight: string;
    ctaIntensity: string;
    slideArcRoles: string[] | null;
    informationArchitecturePattern: string | null;
  } | null;
  /**
   * Creator Governance → Prompt Composer Integration — Phase 5.
   * Explainability metadata describing which governance signals the
   * composer applied. Always present; carries `industry='none'` +
   * `warningsApplied: 0` when no policy was active.
   *
   * Callers surface this on `generation_metadata.governance` so the
   * post-execution UI + audit log can show exactly what compliance
   * guidance shaped the asset.
   */
  governance: GovernanceExplainabilityMetadata;
};

export type ReferenceImagePurpose =
  | 'logo'
  | 'favicon'
  | 'dashboard'
  | 'ui_surface'
  | 'product_screenshot'
  | 'style_reference'
  | 'composition_reference'
  | 'realism_reference';

export type ReferenceImage = {
  url: string;
  purpose: ReferenceImagePurpose;
  /** Free-text hint passed to the provider when capability allows. */
  hint?: string;
};

/* ── SaaS creative-direction templates ──────────────────────────────── */

export type CreativeDirectionTemplate =
  | 'product_launch'
  | 'feature_reveal'
  | 'ai_innovation'
  | 'productivity_workflow'
  | 'executive_insight'
  | 'automation_orchestration'
  | 'editorial_modern_startup'
  | 'dashboard_centric'
  | 'clean_editorial_product'
  // Phase 5 — premium / cinematic variants. Selected when brand
  // grounding is strong AND the asset is meant for a high-stakes
  // campaign (launch / feature / brand campaign / hero).
  | 'cinematic_product_launch'
  | 'founder_storytelling'
  | 'editorial_feature_reveal'
  | 'ambient_productivity'
  | 'premium_ai_editorial'
  | 'product_ecosystem_visual'
  | 'minimal_product_hero'
  | 'realistic_workflow_scene'
  | 'premium_brand_campaign';

/**
 * Structured profile for each creative-direction template. Fields are
 * concatenated into the visual-direction layer in a deterministic order
 * so the provider sees consistent framing across templates.
 */
export type CreativeDirectionProfile = {
  lightingDirection: string;
  framingDiscipline: string;
  lensComposition: string;
  emotionalTone: string;
  environmentRealism: string;
  visualHierarchy: string;
  negativeConstraints: string;
};

/**
 * Each profile contributes seven structured directives. The composer
 * renders them as a contiguous block at the visual-direction layer.
 * Templates were designed to be MUTUALLY DISTINCT — no two share the
 * same lensComposition + environmentRealism combination.
 */
const TEMPLATE_PROFILES: Record<CreativeDirectionTemplate, CreativeDirectionProfile> = {
  product_launch: {
    lightingDirection: 'One motivated brand-accent key light from a single off-camera source, soft falloff, natural ambient bounce.',
    framingDiscipline: 'Single hero element off-center with intentional negative space; magazine-cover composition rules.',
    lensComposition: '50mm-equivalent perspective, shallow depth of field on the focal subject, calm background depth.',
    emotionalTone: 'Confident, restrained, premium SaaS launch confidence — not theatrical.',
    environmentRealism: 'Believable studio or contextual scene with subtle imperfections in surfaces and lighting.',
    visualHierarchy: 'One focal subject, one supporting context cue, generous breathing room.',
    negativeConstraints: 'No marketing collage, no multiple competing subjects, no rendered tagline text.',
  },
  feature_reveal: {
    lightingDirection: 'Selective accent light on the focal capability; ambient calm backdrop.',
    framingDiscipline: 'Single feature or interface element framed deliberately, surrounded by restrained negative space.',
    lensComposition: 'Macro or product-photography perspective; honest depth, not exaggerated bokeh.',
    emotionalTone: 'Clear, deliberate, "look at this single capability".',
    environmentRealism: 'Believable surface or device housing the feature — never a floating UI in void.',
    visualHierarchy: 'Feature → ambient context → brand accent.',
    negativeConstraints: 'No fake UI text, no decorative shapes, no "discover more" graphics.',
  },
  ai_innovation: {
    lightingDirection: 'Low-contrast, refined dark palette with one accent-color glow as the only light source.',
    framingDiscipline: 'Off-center subject with intelligent motif (data form, soft geometry) as background depth, never foreground noise.',
    lensComposition: 'Slightly cinematic wide perspective; deep environment with controlled depth.',
    emotionalTone: 'Calm, modern, AI-native — not sci-fi cliché.',
    environmentRealism: 'Believable scene grounded in real-world physics, with restrained intelligence motifs.',
    visualHierarchy: 'Subject → motif → accent glow → ambient depth.',
    negativeConstraints: 'No neon overload, no holographic clichés, no fake matrix-style data streams.',
  },
  productivity_workflow: {
    lightingDirection: 'Natural daylight or warm tungsten as the dominant source; soft window or lamp ambience.',
    framingDiscipline: 'Candid workspace framing, asymmetric, with off-center human or device.',
    lensComposition: '35mm-equivalent documentary perspective, honest depth, lived-in environment.',
    emotionalTone: 'Quiet focus, real moment of work — never posed energy.',
    environmentRealism: 'Believable desk, real laptop or device, real notebooks/coffee/objects.',
    visualHierarchy: 'Person or device → workspace context → ambient light.',
    negativeConstraints: 'No posed-team shots, no exaggerated smiles, no stock-photo office crowds.',
  },
  executive_insight: {
    lightingDirection: 'Editorial atmospheric light — directional, with deliberate shadow falloff.',
    framingDiscipline: 'Asymmetric environmental portrait; subject off-center or in profile.',
    lensComposition: '85mm-equivalent editorial portrait perspective, honest skin texture, candid framing.',
    emotionalTone: 'Reflective, decisive, documentary realism.',
    environmentRealism: 'Real environment with context cues — not a generic background.',
    visualHierarchy: 'Subject → environment → atmospheric light.',
    negativeConstraints: 'No suit-and-smile portraits, no brochure poses, no corporate-photo tropes.',
  },
  automation_orchestration: {
    lightingDirection: 'Brand-accent gradient lighting with depth; no flat infographic flatness.',
    framingDiscipline: 'Conceptual flow suggested through depth and gradient, never literal flowchart geometry.',
    lensComposition: 'Wide perspective with multiple depth planes; abstract foreground hint.',
    emotionalTone: 'Effortless, intelligent, behind-the-scenes orchestration.',
    environmentRealism: 'Believable abstract environment grounded in light and depth, not vector art.',
    visualHierarchy: 'Abstract flow motif → ambient brand gradient → restrained focal anchor.',
    negativeConstraints: 'No literal arrows, no flowcharts, no node-edge diagrams.',
  },
  editorial_modern_startup: {
    lightingDirection: 'Confident editorial light, one motivated source, controlled shadow.',
    framingDiscipline: 'Asymmetric, decisive, one focal idea — Stripe / Linear / Notion launch image discipline.',
    lensComposition: '35-50mm-equivalent editorial perspective, honest depth.',
    emotionalTone: 'Premium, restrained, confident — not corporate brochure.',
    environmentRealism: 'Believable real-world scene with intentional materiality.',
    visualHierarchy: 'One focal idea, restrained ambient context.',
    negativeConstraints: 'No marketing-collage layouts, no startup-poster tropes, no decorative clip-art.',
  },
  dashboard_centric: {
    lightingDirection: 'Ambient brand lighting around the device screen; cool glow from the surface itself.',
    framingDiscipline: 'Real device on a real surface, off-center, with believable hand or environmental interaction.',
    lensComposition: '50mm-equivalent product-context perspective, honest depth, screen sharp.',
    emotionalTone: 'Confident product surface, "this is the real thing".',
    environmentRealism: 'Real device housing, real surface, real ambient bounce.',
    visualHierarchy: 'Screen → device → environment.',
    negativeConstraints: 'No fake floating UI, no obvious mockup textures, no readable placeholder text.',
  },
  clean_editorial_product: {
    lightingDirection: 'Soft directional light with deliberate shadows; magazine-product photography discipline.',
    framingDiscipline: 'Minimal composition, one focal subject, intentional negative space.',
    lensComposition: '50-85mm product photography perspective, calm depth.',
    emotionalTone: 'Premium, magazine-spread restraint.',
    environmentRealism: 'Real materials, real surfaces, honest textures.',
    visualHierarchy: 'Single product subject → ambient context → restrained brand accent.',
    negativeConstraints: 'No decorative clutter, no collage, no flat infographic background.',
  },
  // ── Phase 5 — premium variants. Selected when the asset is a hero
  // surface, brand grounding is strong, or the campaign objective
  // explicitly signals a premium moment. Each profile is more
  // cinematic, more editorial, or more product-focused than its
  // baseline counterpart above.
  cinematic_product_launch: {
    lightingDirection: 'Cinematic key light from a single directional source; deliberate fall-off; subtle rim light if a device or human anchors the scene.',
    framingDiscipline: 'Anamorphic-style horizontal composition discipline, single hero element off-center, deep negative space, atmospheric depth.',
    lensComposition: 'Cinematic 35mm-equivalent perspective with controlled depth and natural lens character.',
    emotionalTone: 'Cinematic premium-launch confidence — single decisive moment.',
    environmentRealism: 'Real environment with intentional atmospheric haze or natural ambient bounce.',
    visualHierarchy: 'Hero element → atmospheric depth → brand accent reflection.',
    negativeConstraints: 'No marketing layout, no theatrical flourish, no fake cinematic clichés.',
  },
  founder_storytelling: {
    lightingDirection: 'Natural directional light, environmental ambient — documentary discipline.',
    framingDiscipline: 'Candid environmental portrait, subject off-center, intentional foreground cue (hands, notebook, device).',
    lensComposition: '50-85mm documentary portrait perspective, honest skin texture, natural eye focus.',
    emotionalTone: 'Quiet, real, reflective — never posed.',
    environmentRealism: 'Real founder-context environment with lived-in detail.',
    visualHierarchy: 'Subject → context cue → ambient environment.',
    negativeConstraints: 'No suit-and-smile, no brochure poses, no glossy corporate portrait clichés.',
  },
  editorial_feature_reveal: {
    lightingDirection: 'Editorial accent light on the focal capability; magazine-grade ambient backdrop.',
    framingDiscipline: 'Single feature framed as a magazine product detail, intentional negative space.',
    lensComposition: 'Macro or short-tele editorial perspective, calm depth.',
    emotionalTone: 'Considered, deliberate, "this single capability matters".',
    environmentRealism: 'Believable product surface with material honesty.',
    visualHierarchy: 'Feature → ambient context → brand accent.',
    negativeConstraints: 'No decorative graphics, no fake UI text, no floating element clichés.',
  },
  ambient_productivity: {
    lightingDirection: 'Natural ambient daylight, soft directional shadows, warm tonal balance.',
    framingDiscipline: 'Quiet workspace composition, asymmetric, with breathing room.',
    lensComposition: '35mm-equivalent ambient perspective; honest depth, ambient bokeh.',
    emotionalTone: 'Calm, focused, unobtrusive — a real moment of work.',
    environmentRealism: 'Real workspace with real objects, real reflections, real surface wear.',
    visualHierarchy: 'Device or notebook → ambient workspace → diffuse natural light.',
    negativeConstraints: 'No posed productivity tropes, no exaggerated startup energy.',
  },
  premium_ai_editorial: {
    lightingDirection: 'Restrained editorial light with one accent-color glow; refined dark or low-contrast palette.',
    framingDiscipline: 'Magazine-grade asymmetric composition with intelligence motifs in depth, never foreground noise.',
    lensComposition: 'Cinematic perspective with controlled depth and considered foreground geometry.',
    emotionalTone: 'Calm intelligence, modern AI-native sophistication — not sci-fi.',
    environmentRealism: 'Real environment with restrained motif overlay; never fully abstract void.',
    visualHierarchy: 'Subject anchor → motif depth → accent glow.',
    negativeConstraints: 'No neon, no holographic tropes, no Matrix-style data streams.',
  },
  product_ecosystem_visual: {
    lightingDirection: 'Ambient brand lighting unifying multiple product surfaces; single key light to anchor depth.',
    framingDiscipline: 'Multiple product touchpoints (device + surface + ambient context), composed with restraint.',
    lensComposition: 'Wide-to-mid perspective showing ecosystem context; controlled depth across all surfaces.',
    emotionalTone: 'Considered, connected, ecosystem confidence.',
    environmentRealism: 'Real device + real surface + real connecting environment.',
    visualHierarchy: 'Primary product surface → secondary surface → ambient brand presence.',
    negativeConstraints: 'No fake floating devices, no collage layouts, no decorative connector graphics.',
  },
  minimal_product_hero: {
    lightingDirection: 'Single deliberate light source; sharp focused highlight, soft falloff into restrained shadow.',
    framingDiscipline: 'Minimal composition, single hero subject, generous negative space, intentional silhouette.',
    lensComposition: '85mm-equivalent product-magazine perspective, calm shallow depth.',
    emotionalTone: 'Premium magazine-spread restraint, intentional silence.',
    environmentRealism: 'Real material on a calm surface; no decorative clutter.',
    visualHierarchy: 'Hero subject only; everything else is breathing room.',
    negativeConstraints: 'No background graphics, no secondary subjects, no decorative props.',
  },
  realistic_workflow_scene: {
    lightingDirection: 'Natural directional light from a window or practical source; honest ambient bounce.',
    framingDiscipline: 'Documentary candid framing, subject off-center, foreground cue grounds the scene.',
    lensComposition: '35mm-equivalent documentary perspective with honest depth.',
    emotionalTone: 'Real moment of work — quiet, focused, believable.',
    environmentRealism: 'Real workspace with lived-in detail, real device, real hands engaging the surface.',
    visualHierarchy: 'Hands or person → device → ambient workspace context.',
    negativeConstraints: 'No posed teamwork shots, no exaggerated startup energy, no over-clean surfaces.',
  },
  premium_brand_campaign: {
    lightingDirection: 'Editorial directional light; one motivated source with considered shadow architecture.',
    framingDiscipline: 'Magazine-cover discipline, one focal idea, decisive asymmetric composition.',
    lensComposition: '35-50mm editorial perspective with controlled depth.',
    emotionalTone: 'Premium brand confidence — restrained, considered, magazine-grade.',
    environmentRealism: 'Real environment with intentional materiality and lived-in detail.',
    visualHierarchy: 'One decisive focal idea → ambient brand context → restrained accent.',
    negativeConstraints: 'No marketing-collage layouts, no brochure tropes, no decorative clutter.',
  },
};

/** Render a structured profile into a flat directive block. */
function renderProfile(profile: CreativeDirectionProfile): string[] {
  return [
    `Lighting: ${profile.lightingDirection}`,
    `Framing: ${profile.framingDiscipline}`,
    `Lens & composition: ${profile.lensComposition}`,
    `Emotional tone: ${profile.emotionalTone}`,
    `Environment realism: ${profile.environmentRealism}`,
    `Visual hierarchy: ${profile.visualHierarchy}`,
    `Negative constraints: ${profile.negativeConstraints}`,
  ];
}

function selectCreativeDirection(
  input: CreatorPromptInput,
  options?: { premium?: boolean; brandPreference?: CreativeDirectionTemplate | null },
): CreativeDirectionTemplate {
  // Phase 9 — if the visual brand memory has a successful prior
  // template for this brand AND the current request looks like the
  // same surface type, prefer it for visual continuity.
  if (options?.brandPreference) {
    return options.brandPreference;
  }
  const t = lower(input.contentType ?? input.eyebrow);
  const objective = lower(input.objective);
  const hasUi = Boolean(input.productContext?.screenshotUrls?.length || input.productContext?.dashboardDescription);
  const hasProductName = Boolean(input.productContext?.productName);
  const hasMultipleProducts = Array.isArray(input.productContext?.screenshotUrls) && (input.productContext?.screenshotUrls?.length ?? 0) > 1;
  const premium = Boolean(options?.premium);

  // Premium variants — selected when brand grounding is strong AND
  // the surface is a high-stakes campaign anchor.
  if (premium && (objective.includes('launch') || objective.includes('introduce'))) return 'cinematic_product_launch';
  if (premium && (objective.includes('feature') || objective.includes('reveal'))) return 'editorial_feature_reveal';
  if (premium && (objective.includes('ai') || objective.includes('intelligence') || objective.includes('model'))) return 'premium_ai_editorial';
  if (premium && (objective.includes('automation') || objective.includes('workflow') || objective.includes('orchestrat'))) return 'ambient_productivity';
  if (premium && (objective.includes('executive') || objective.includes('founder') || objective.includes('leader'))) return 'founder_storytelling';
  if (premium && hasMultipleProducts) return 'product_ecosystem_visual';
  if (premium && hasProductName && !hasUi) return 'minimal_product_hero';
  if (premium && hasUi) return 'realistic_workflow_scene';
  if (premium && t === 'brand_card') return 'premium_brand_campaign';

  // Baseline templates
  if (objective.includes('launch') || objective.includes('introduce')) return 'product_launch';
  if (objective.includes('feature') || objective.includes('reveal')) return 'feature_reveal';
  if (objective.includes('ai') || objective.includes('intelligence') || objective.includes('model')) return 'ai_innovation';
  if (objective.includes('automation') || objective.includes('workflow') || objective.includes('orchestrat')) return 'productivity_workflow';
  if (objective.includes('executive') || objective.includes('founder') || objective.includes('leader')) return 'executive_insight';
  if (hasUi) return 'dashboard_centric';
  if (hasProductName) return 'clean_editorial_product';
  if (t === 'brand_card') return 'editorial_modern_startup';
  if (t === 'banner') return 'product_launch';
  return 'editorial_modern_startup';
}

/* ── Realism + negative directives (shared across templates) ─────────── */

const REALISM_DIRECTIVES: string[] = [
  'Bias toward authentic editorial photography over rendered illustration.',
  'Use cinematic lighting with one motivated source; allow natural shadow falloff and ambient bounce.',
  'Render natural skin texture, micro-imperfections, believable eye detail, and asymmetric facial geometry when humans appear.',
  'Use shallow depth of field appropriate to the scene; keep depth honest, not exaggerated.',
  'Prefer candid framing and asymmetric composition; subjects should be off-center and intentionally placed.',
  'Allow subtle film-like texture and natural noise — avoid hyper-clean digital sheen.',
  'Ground every scene in a believable environment with lived-in detail and real-world physics.',
  // Phase 6 — human realism intensification.
  'When humans appear, render documentary realism: candid interaction, imperfect natural posture, subtle emotion, realistic eye focus, natural hand positioning, and believable device handling.',
  'Show people engaging with their environment — never staring at the camera in posed configurations.',
  'Render realistic hands with correct anatomy, natural finger positioning, and believable contact with devices or objects.',
];

const NEGATIVE_DIRECTIVES_BASE: string[] = [
  'Strictly avoid stock-photo aesthetics, corporate-team posing, generic smiling office workers, and fake business handshakes.',
  'Strictly avoid plastic skin, uncanny smiles, hyper-symmetrical faces, and identikit faces.',
  'Strictly avoid centered hero-subject poster compositions and rigid symmetry.',
  'Strictly avoid oversaturated AI lighting, neon overload, and unrealistic colored fog.',
  'Strictly avoid random unrelated people, generic SaaS clip-art tropes, and brochure-style layouts.',
  'Strictly avoid malformed hands, extra fingers, distorted anatomy, low-detail eyes, and warped typography in any sign or surface.',
  // Phase 6 — human-pose suppression.
  'Strictly avoid corporate-team posing, exaggerated startup-photo energy, brochure body language, and fake startup-team tropes.',
  'Strictly avoid AI-symmetry in faces and groups; AI-over-perfect skin; rendered teeth that look identical across people.',
  // Fake-brand suppression — the image generator otherwise invents
  // placeholder company names ("Onanwe", "Acme", "Nexora", etc.) inside
  // dashboards, screens, business cards, or device mockups. Any UI prop
  // that appears in the scene must have its branding kept abstract.
  'Strictly avoid inventing any fictional brand names, company names, app titles, product names, or logotypes anywhere in the image — including on dashboards, screens, monitors, laptops, phones, business cards, badges, signage, packaging, or paper.',
  'Strictly avoid drawing any readable wordmark, monogram, lettermark, or pictorial logo on UI elements, devices, screens, or props; do not place text, labels, captions, or numbers on screens or interfaces.',
  'If a screen, dashboard, app, or interface appears in the scene, render it as soft abstract shapes, gradients, blurred bars, or anonymized geometry with NO recognizable text, NO chart labels, NO brand glyphs, and NO sample company names.',
];

const QUALITY_DIRECTIVES: string[] = [
  'Render at production quality with sharp focus on the intended subject and natural depth elsewhere.',
  'Resolve fine detail, fabric, materials, and surface reflections with realism — no plastic or rubbery materials.',
  'Color discipline takes priority over saturation; preserve a calm, premium palette that supports brand recognition.',
];

/* ── Helpers ────────────────────────────────────────────────────────── */

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function lower(value: unknown): string {
  return clean(value).toLowerCase();
}

function compactJoin(values: ReadonlyArray<string | null | undefined>, sep = ', '): string {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).join(sep);
}

/* ── Per-layer builders ─────────────────────────────────────────────── */

function buildCampaignLayer(input: CreatorPromptInput): string[] {
  const out: string[] = [];
  if (input.objective) out.push(`Campaign objective: ${clean(input.objective)}.`);
  if (input.audience) out.push(`Target audience: ${clean(input.audience)}.`);
  if (input.platform) out.push(`Platform intent: ${clean(input.platform)} — match its native visual language without imitating its UI.`);
  if (input.tagline) out.push(`Tagline influence (do NOT render as text): ${clean(input.tagline)}.`);
  return out;
}

function buildAssetLayer(input: CreatorPromptInput): string[] {
  const out: string[] = [];
  const type = clean(input.eyebrow || input.contentType || 'image');
  out.push(`Asset type: ${type}.`);
  out.push(`Visual subject to depict (NEVER render the words themselves on the image): ${clean(input.title)}.`);
  if (input.body) out.push(`Express through objects, people, environment, color, and composition only: ${clean(input.body)}.`);
  if (input.subtypeHint?.promptLine) out.push(clean(input.subtypeHint.promptLine));
  return out.filter(Boolean);
}

function buildBrandLayer(input: CreatorPromptInput): { lines: string[]; grounded: boolean } {
  const kit = input.brandKit;
  if (!kit) return { lines: [], grounded: false };
  const isBrandAware = input.brandMode === 'brand-aware' || (input.brandMode == null && Boolean(kit.companyName));
  if (!isBrandAware) return { lines: [], grounded: false };

  const lines: string[] = [];
  let groundingScore = 0;

  if (kit.companyName) {
    lines.push(`Brand identity: ${kit.companyName} — visualize the brand's personality without naming or labeling it.`);
    groundingScore++;
  }
  if (kit.industry) {
    lines.push(`Industry context: ${kit.industry}. Use industry-appropriate environment, props, and people without resorting to stock-industry stereotypes.`);
    groundingScore++;
  }
  if (kit.tone) {
    lines.push(`Brand tone: ${kit.tone}. Let tone drive lighting, framing, and palette intensity.`);
    groundingScore++;
  }

  const palette = (kit.palette ?? []).filter(Boolean).slice(0, 5);
  if (palette.length > 0) {
    lines.push(`Brand palette (use as ambient color discipline, NOT decorative blocks): ${palette.join(', ')}.`);
    groundingScore++;
  }
  if (kit.accentColor) {
    lines.push(`Brand accent color: ${kit.accentColor}. Use sparingly as a single motivated highlight — accent light, accent surface, or accent reflection.`);
    groundingScore++;
  }

  if (kit.logoUrl) {
    // Tasteful placement rules — no watermark spam, no fake-product-page mockups.
    lines.push('A brand mark MAY appear subtly in the scene (etched on a device, embroidered on apparel, or as ambient reflected light) — never as a corner watermark, never blown up, never repeated.');
    groundingScore++;
  }
  if (kit.domain) {
    lines.push(`Brand domain reference (for atmosphere, NOT rendered text): ${kit.domain}.`);
  }

  return { lines, grounded: groundingScore >= 3 };
}

function buildProductLayer(input: CreatorPromptInput): { lines: string[]; grounded: boolean } {
  const prod = input.productContext;
  if (!prod) return { lines: [], grounded: false };
  const lines: string[] = [];
  let groundingScore = 0;

  if (prod.productName) {
    lines.push(`Product reference: ${clean(prod.productName)}. The product should feel present in the scene — on a device, in a workflow, or implied by the environment.`);
    groundingScore++;
  }
  if (prod.productCategory) {
    lines.push(`Product category: ${clean(prod.productCategory)}. Ground the visual in a believable real-world use context for this category.`);
    groundingScore++;
  }
  if (prod.dashboardDescription) {
    lines.push(`Product surface context: ${clean(prod.dashboardDescription)}. If a screen appears, suggest this product surface abstractly — believable UI structure without rendered readable text.`);
    groundingScore += 2;
  }
  if (Array.isArray(prod.screenshotUrls) && prod.screenshotUrls.length > 0) {
    lines.push('A device screen MAY show a believable interface inspired by the actual product UI — never copy literal text, but match the visual cadence, density, and layout discipline of the real surface.');
    groundingScore += 2;
  }
  if (Array.isArray(prod.uiKeywords) && prod.uiKeywords.length > 0) {
    lines.push(`Product UI vibe keywords: ${prod.uiKeywords.slice(0, 6).join(', ')}.`);
    groundingScore++;
  }

  return { lines, grounded: groundingScore >= 3 };
}

function buildVisualDirectionLayer(template: CreativeDirectionTemplate): string[] {
  return renderProfile(TEMPLATE_PROFILES[template]);
}

/** Public lookup for a template's structured profile. */
export function getCreativeDirectionProfile(template: CreativeDirectionTemplate): CreativeDirectionProfile {
  return TEMPLATE_PROFILES[template];
}

function buildCompositionLayer(input: CreatorPromptInput): string[] {
  const supportingVisual = input.attachmentMode === 'supporting_visual';
  if (supportingVisual) {
    return [
      'Compose the entire frame as the final creative — no reserved overlay space, no anticipated text layer.',
      'Lead with one clear focal subject, intentional foreground/background separation, and decisive color discipline.',
      'The image must communicate without any accompanying caption text.',
    ];
  }
  return [
    'Leave the left and lower-left of the frame visually calm for a deterministic text overlay composited later.',
    'Push the focal subject to the right or middle depth; keep the typography region clean of busy detail.',
    'Express CTA direction through composition, gaze, and focal hierarchy — never through rendered text.',
  ];
}

function buildQualityLayer(input: CreatorPromptInput): string[] {
  const lines = [...QUALITY_DIRECTIVES];
  if (input.platform) {
    lines.push(`Compose at production resolution suitable for ${clean(input.platform)} — sharp on phone, sharp on desktop.`);
  }
  return lines;
}

/* ── Quality governance (lightweight heuristics) ────────────────────── */

const REQUIRED_REALISM_MARKERS = ['editorial', 'cinematic', 'authentic', 'candid', 'natural', 'believable'];
const REQUIRED_SUPPRESSION_MARKERS = ['stock-photo', 'plastic skin', 'malformed hands', 'random unrelated people'];

function evaluateQualityHeuristics(prompt: string, brandGrounded: boolean, productGrounded: boolean): string[] {
  const flags: string[] = [];
  const p = prompt.toLowerCase();
  let realismHits = 0;
  for (const m of REQUIRED_REALISM_MARKERS) if (p.includes(m)) realismHits++;
  if (realismHits < 3) flags.push('realism_directives_insufficient');
  let suppressionHits = 0;
  for (const m of REQUIRED_SUPPRESSION_MARKERS) if (p.includes(m)) suppressionHits++;
  if (suppressionHits < 2) flags.push('suppression_directives_insufficient');
  if (!brandGrounded) flags.push('brand_grounding_weak');
  // Product grounding is optional (not every asset has product context); the
  // flag is informational so dashboards can quantify product-aware coverage.
  if (!productGrounded) flags.push('product_grounding_absent');
  return flags;
}

/* ── Public entry point ─────────────────────────────────────────────── */

export type ComposeOptions = {
  /** Bias the selector toward premium variants. */
  premium?: boolean;
  /** Reuse a prior successful template for this brand (Phase 9). */
  brandPreference?: CreativeDirectionTemplate | null;
  /** Override the visual-direction template entirely (Phase 8 retry). */
  forceTemplate?: CreativeDirectionTemplate;
};

function collectReferenceImages(input: CreatorPromptInput): ReferenceImage[] {
  const refs: ReferenceImage[] = [];
  const kit = input.brandKit;
  if (kit?.logoUrl && /^https?:\/\//.test(kit.logoUrl)) {
    refs.push({ url: kit.logoUrl, purpose: 'logo', hint: 'subtle brand mark — never watermark, never blown up' });
  }
  if (kit?.faviconUrl && /^https?:\/\//.test(kit.faviconUrl)) {
    refs.push({ url: kit.faviconUrl, purpose: 'favicon', hint: 'icon-grade brand mark for ambient reflection only' });
  }
  const prod = input.productContext;
  if (Array.isArray(prod?.screenshotUrls)) {
    for (const url of prod!.screenshotUrls!) {
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        refs.push({ url, purpose: 'product_screenshot', hint: 'imitate visual cadence, density, and layout discipline — never copy literal text' });
      }
    }
  }
  return refs;
}

/**
 * Premium-compatibility filter for creative-direction templates.
 * The premium variants (cinematic_*, editorial_*, premium_*, etc.)
 * are reserved for premium=true paths. When the prompt is non-premium,
 * filter the strategy's affinity list to non-premium templates only
 * so we never accidentally promote a low-brand prompt to a premium
 * template via the purpose-strategy affinity bias.
 */
function isTemplatePremiumCompatible(
  template: CreativeDirectionTemplate,
  premium: boolean,
): boolean {
  const PREMIUM_TEMPLATES = new Set<CreativeDirectionTemplate>([
    'cinematic_product_launch',
    'founder_storytelling',
    'editorial_feature_reveal',
    'ambient_productivity',
    'premium_ai_editorial',
    'product_ecosystem_visual',
    'minimal_product_hero',
    'realistic_workflow_scene',
    'premium_brand_campaign',
  ]);
  const isPremium = PREMIUM_TEMPLATES.has(template);
  return premium ? true : !isPremium;
}

export function composeCreatorImagePrompt(
  input: CreatorPromptInput,
  options?: ComposeOptions,
): CreatorComposedPrompt {
  const brand = buildBrandLayer(input);
  const product = buildProductLayer(input);
  // Premium auto-detect: strong brand grounding + a campaign-anchor
  // surface (banner / brand_card / image hero / launch objective)
  // promotes the selector to premium variants. Caller can override
  // with options.premium.
  const ctLow = lower(input.contentType ?? input.eyebrow);
  const autoPremium = brand.grounded && (
    ctLow === 'banner' || ctLow === 'brand_card' || ctLow === 'image'
  );
  const premium = options?.premium ?? autoPremium;

  // Resolve the purpose strategy from the registry. When present, its
  // creativeDirectionAffinity acts as a bias for the creative-direction
  // selector — preferred templates whose profile matches the purpose
  // intent are tried first; the existing selector logic remains the
  // tiebreaker when no affinity match is available.
  const purposeStrategy = resolvePurposeStrategy(input.contentType ?? input.eyebrow ?? '', input.purposeKey);
  const affinityTemplate = purposeStrategy
    ? purposeStrategy.creativeDirectionAffinity.find((t) => isTemplatePremiumCompatible(t, premium)) ?? null
    : null;
  const template = options?.forceTemplate
    ?? affinityTemplate
    ?? selectCreativeDirection(input, {
      premium,
      brandPreference: options?.brandPreference ?? null,
    });

  // Build the purpose layer — directives + scene-selection hints.
  // Empty array when no strategy resolved.
  const purposeLayerRaw: string[] = purposeStrategy
    ? [
        `Purpose strategy: ${purposeStrategy.generatedAsLabel} — ${purposeStrategy.whyChosen}`,
        ...purposeStrategy.promptDirectives,
        ...purposeStrategy.sceneSelectionHints,
        `Density discipline: ${purposeStrategy.densityBias}.`,
        `Branding intensity: ${purposeStrategy.brandingIntensity}.`,
        `Typography weight: ${purposeStrategy.typographyWeight}.`,
        // Supporting visuals are text-free: express the same strength as a
        // composition-only "conversion intensity" so the literal token "CTA"
        // never enters a supporting_visual prompt (the fail-closed governance
        // gate `supporting_visual_cta_prompt_leak` rejects any \bcta\b token,
        // including in suppression/strategy lines). embedded_copy is unchanged.
        ...(input.attachmentMode === 'supporting_visual'
          ? [`Conversion intensity: ${purposeStrategy.ctaIntensity}.`]
          : [`CTA intensity: ${purposeStrategy.ctaIntensity}.`]),
        ...(purposeStrategy.slideArc
          ? [`Slide arc (in order): ${purposeStrategy.slideArc.map((s) => s.role).join(' → ')}. Each slide must accomplish: ${purposeStrategy.slideArc.map((s) => `${s.role}: ${s.intent}`).join(' | ')}`]
          : []),
        ...(purposeStrategy.informationArchitecture
          ? [
              `Information architecture: ${purposeStrategy.informationArchitecture.pattern}.`,
              `Section blueprint: ${purposeStrategy.informationArchitecture.sectionBlueprint.join(' → ')}.`,
              `Hierarchy notes: ${purposeStrategy.informationArchitecture.hierarchyNotes}`,
            ]
          : []),
      ]
    : [];

  // Supporting visuals are governed text-free: the purpose strategy's
  // messaging/CTA-copy directives (whyChosen rationale, promptDirectives,
  // slide-arc intents) routinely carry the literal token "CTA", which the
  // fail-closed render gate rejects as `supporting_visual_cta_prompt_leak`.
  // Those lines describe COPY strategy, not what to draw, so they are
  // irrelevant to a clean visual — drop any CTA/button-bearing purpose line
  // for supporting_visual only. The token-free visual directives (scene,
  // density, branding, typography, conversion intensity, info architecture)
  // are retained. embedded_copy is unchanged.
  const purposeLayer: string[] = input.attachmentMode === 'supporting_visual'
    ? purposeLayerRaw.filter((line) => !/\b(cta|call to action|button)\b/i.test(line))
    : purposeLayerRaw;

  // Composition hints from the strategy augment (not replace) the
  // default composition layer so existing composition discipline is
  // preserved as a baseline.
  const compositionBase = buildCompositionLayer(input);
  const compositionLayer = purposeStrategy
    ? [...compositionBase, ...purposeStrategy.compositionHints]
    : compositionBase;

  // Creator Governance → Prompt Composer Integration — Phase 2+3+4.
  // Compliance directives — additive only. When no governance context
  // is supplied OR industry='none', the layer is empty and the
  // composed prompt is byte-identical to prior behavior.
  const governanceLayer = buildGovernanceLayer(input.governance ?? null);

  const layers: CreatorPromptLayers = {
    campaign: buildCampaignLayer(input),
    asset: buildAssetLayer(input),
    brand: brand.lines,
    product: product.lines,
    visualDirection: buildVisualDirectionLayer(template),
    realism: [...REALISM_DIRECTIVES],
    composition: compositionLayer,
    negative: [...NEGATIVE_DIRECTIVES_BASE],
    quality: buildQualityLayer(input),
    purpose: purposeLayer,
    governance: governanceLayer,
  };

  // Mode-shared header preserved verbatim from the prior implementation so
  // the provider's text-ban contract is unchanged. validateProviderImageTextSafety
  // matches on the substring 'strictly avoid all visible text'.
  const supportingVisual = input.attachmentMode === 'supporting_visual';
  const header = supportingVisual
    ? 'Create a production-ready editorial marketing visual that stands on its own as a complete social creative — not an ad poster, text layout, slide, or wireframe.'
    : 'Create a production-ready editorial marketing visual scene, not an ad poster, text layout, slide, or wireframe.';
  const textBanFooter = [
    'Strictly avoid all visible text: no words, letters, numbers, captions, signage, fake logos, UI text, action buttons, or tagline text.',
    'Strictly avoid inventing any fictional brand name, company name, app name, product name, or wordmark on any surface — including dashboards, screens, business cards, badges, packaging, or signage.',
    'If a screen, dashboard, paper, or object appears, keep ALL markings abstract and unreadable; render UI as soft shapes, blurred bars, and anonymized gradients with no readable glyphs.',
  ];

  const flat = [
    header,
    ...layers.campaign,
    ...layers.asset,
    // Purpose layer fires BEFORE brand/product/visual-direction so the
    // strategy intent frames everything that follows. When no
    // strategy resolved, the layer is empty and the existing
    // composition path is unchanged.
    ...layers.purpose,
    ...layers.brand,
    ...layers.product,
    ...layers.visualDirection,
    ...layers.realism,
    ...layers.composition,
    ...layers.quality,
    ...layers.negative,
    // Creator Governance → Prompt Composer Integration — Phase 2.
    // Governance directives fire AFTER the negative-directive base so
    // industry-specific cautions land alongside (not before) the
    // suppression discipline. Empty layer = no behavior change.
    ...layers.governance,
    ...textBanFooter,
  ].filter(Boolean).join('\n');

  const qualityFlags = evaluateQualityHeuristics(flat, brand.grounded, product.grounded);
  const references = collectReferenceImages(input);

  return {
    layers,
    prompt: flat,
    brandGrounded: brand.grounded,
    productGrounded: product.grounded,
    creativeDirection: template,
    qualityFlags,
    premium,
    references,
    purposeStrategy: purposeStrategy
      ? {
          id: purposeStrategy.id,
          generatedAsLabel: purposeStrategy.generatedAsLabel,
          whyChosen: purposeStrategy.whyChosen,
          densityBias: purposeStrategy.densityBias,
          brandingIntensity: purposeStrategy.brandingIntensity,
          typographyWeight: purposeStrategy.typographyWeight,
          ctaIntensity: purposeStrategy.ctaIntensity,
          slideArcRoles: purposeStrategy.slideArc ? purposeStrategy.slideArc.map((s) => s.role) : null,
          informationArchitecturePattern: purposeStrategy.informationArchitecture?.pattern ?? null,
        }
      : null,
    governance: buildGovernanceMetadata(input.governance ?? null, governanceLayer.length),
  };
}

/* ── Governance layer + metadata ─────────────────────────────────── */

/**
 * Build the additive governance prompt layer. Returns an empty array
 * when no governance context is supplied OR the resolved industry
 * carries no directives (industry='none'), preserving the prior
 * composed-prompt output byte-for-byte.
 *
 * Phase 2 — compliance directives are injected as-is, one per line.
 * Phase 4 — when the selected strategy is restricted, an extra
 * caution line is prepended.
 */
function buildGovernanceLayer(
  ctx: GovernancePromptContext | null,
): string[] {
  if (!ctx || !governanceContextHasAnyDirective(ctx)) return [];
  const out: string[] = [];
  if (ctx.industry !== 'none' && ctx.compliancePromptDirectives.length > 0) {
    out.push(`Compliance directives (${ctx.industry} industry policy, risk: ${ctx.riskLevel}):`);
    for (const directive of ctx.compliancePromptDirectives) out.push(directive);
  }
  if (ctx.selectedStrategyIsRestricted) {
    out.push(
      `Use extra caution because the selected strategy "${ctx.selectedStrategy ?? 'unknown'}" is governed by industry policy: ${ctx.selectedStrategyGovernanceReason ?? 'restricted by policy'}.`,
    );
  } else if (ctx.selectedStrategyIsDeprioritized) {
    out.push(
      `The selected strategy "${ctx.selectedStrategy ?? 'unknown'}" is deprioritized by industry policy: ${ctx.selectedStrategyGovernanceReason ?? 'deprioritized by policy'}. Apply the compliance directives above with extra discipline.`,
    );
  }
  return out;
}

/**
 * Build the explainability metadata exposed on the composed prompt.
 * Always present so downstream consumers can rely on a stable shape.
 */
function buildGovernanceMetadata(
  ctx: GovernancePromptContext | null,
  warningsApplied: number,
): CreatorComposedPrompt['governance'] {
  if (!ctx) {
    return {
      industry: 'none',
      riskLevel: 'none',
      selectedStrategy: null,
      warningsApplied: 0,
      selectedStrategyIsRestricted: false,
      selectedStrategyIsDeprioritized: false,
    };
  }
  return {
    industry: ctx.industry,
    riskLevel: ctx.riskLevel,
    selectedStrategy: ctx.selectedStrategy,
    warningsApplied,
    selectedStrategyIsRestricted: ctx.selectedStrategyIsRestricted,
    selectedStrategyIsDeprioritized: ctx.selectedStrategyIsDeprioritized,
  };
}
