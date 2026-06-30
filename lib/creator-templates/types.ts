/**
 * Creator Template Foundation — domain model (Phase: Template Foundation).
 *
 * A Creator Template is a first-class, family-scoped product object that owns:
 *   identity, name, asset family, category, preview, visual language,
 *   supported form fields (FormDefinition), a rendering contract, version,
 *   status, and ownership.
 *
 * IMPORTANT (this phase): the RenderingContract is a THIN mapping onto the
 * EXISTING generation-pipeline inputs (purpose_key / subtype /
 * infographic_layout / attachment_mode / frame_count). No rendering-engine
 * change is introduced. A template configures the FORM and rides through to
 * the existing `/api/command-center/creator-content/generate` route via the
 * already-present `creator_card.template_id` seam.
 *
 * Each asset family (image / carousel / infographic) owns its OWN templates,
 * categories, forms and contracts. There is NO template sharing between
 * families — only the product flow is shared.
 *
 * Pure types + data only — safe to import from both client (pages) and
 * server (API routes). No DB, no fetch, no Node built-ins.
 */

import type { InfographicStyleSchema } from './infographicStyle';
import type { ImageStyleSchema } from './imageStyle';
import type { CarouselStyleSchema } from './carouselStyle';
import type { SemanticBlock, InfographicComposition } from './styleVariants';

export type TemplateAssetFamily = 'image' | 'carousel' | 'infographic';

export type TemplateStatus = 'draft' | 'published';

/**
 * Ownership provenance. Only `system` is populated in this phase; `user` and
 * `ai` are reserved for the persistence phase (deliberately deferred).
 */
export type TemplateOwnership = 'system' | 'user' | 'ai';

/**
 * Form input control rendered for a field. Keeps the form generic — the page
 * renders fields from data, never hard-codes per-template UI.
 */
export type TemplateFieldControl = 'text' | 'textarea';

/**
 * AI-assist affordances available per field. AI only ever POPULATES the field
 * value (manual entry, paste, generate, rewrite) — it never adds, removes, or
 * mutates the form itself.
 */
export interface TemplateFieldAiAssist {
  /** Manual typing is always supported; kept explicit for symmetry. */
  manual: boolean;
  /** Paste / copy-paste is supported. */
  paste: boolean;
  /** "Generate" produces a fresh value for this field. */
  generate: boolean;
  /** "Rewrite" rewrites the current value of this field. */
  rewrite: boolean;
  /** "Expand" lengthens / adds detail to the current value. */
  expand?: boolean;
  /** "Shorten" condenses the current value. */
  shorten?: boolean;
  /** "Improve" polishes the current value without changing its meaning. */
  improve?: boolean;
}

/** The user-invoked field-assist actions. */
export type TemplateFieldAssistAction = 'generate' | 'rewrite' | 'expand' | 'shorten' | 'improve';

export const TEMPLATE_FIELD_ASSIST_ACTIONS: readonly TemplateFieldAssistAction[] = [
  'generate',
  'rewrite',
  'expand',
  'shorten',
  'improve',
];

/**
 * A single declarative form field. The `key` is the canonical field key the
 * Creator page reads/writes; the renderer maps it onto the existing payload
 * (overlay_text.* for image text, slides[] for carousel, sections[] for
 * infographic).
 */
export interface TemplateField {
  /** Canonical field key (e.g. 'headline', 'subheadline', 'cta', 'quote'). */
  key: string;
  /** Highly-visible, self-explanatory label shown to the user. */
  label: string;
  /** Input control. */
  control: TemplateFieldControl;
  /** Required fields block generation until filled. */
  required: boolean;
  /**
   * Helper text rendered under the label so users cannot miss what the field
   * is for (e.g. "This text is rendered onto the image").
   */
  helperText?: string;
  /** Soft max length surfaced to the user; also a hint for AI-assist. */
  maxLength?: number;
  /** Placeholder shown in the empty input. */
  placeholder?: string;
  /** Per-field AI-assist affordances. */
  aiAssist: TemplateFieldAiAssist;
}

/**
 * Repeatable slide group for carousel templates. The user first chooses a
 * slide count from `countOptions`; the form then renders `defaultCount`-many
 * slide blocks, each exposing `fields`.
 */
export interface TemplateSlideGroup {
  countOptions: number[];
  defaultCount: number;
  /** Per-slide fields (e.g. slide title + slide body). */
  fields: TemplateField[];
}

/**
 * Structured section group for infographic templates. Different infographic
 * categories expose different structured inputs (stats → metric+description,
 * process → step+description, timeline → year+description, …).
 */
export interface TemplateSectionGroup {
  /** Group kind. `repeatable` lets the user add/remove sections. */
  kind: 'fixed' | 'repeatable';
  /** Minimum sections (repeatable) / exact count (fixed = min). */
  min: number;
  /** Maximum sections for repeatable groups. */
  max: number;
  /** Human label for one section (e.g. "Statistic", "Step", "Milestone"). */
  sectionLabel: string;
  /** Per-section fields. */
  fields: TemplateField[];
}

/**
 * The declarative form a template exposes. The Creator page renders this
 * instead of a fixed form. Exactly one of {flat fields}, {slides}, {sections}
 * is the primary driver per family, but `fields` may also carry shared
 * top-level fields (e.g. a CTA) alongside slides/sections.
 */
export interface TemplateFormDefinition {
  /** Flat, always-visible fields (image text fields, shared CTA, …). */
  fields: TemplateField[];
  /** Carousel slide group (carousel family only). */
  slides?: TemplateSlideGroup;
  /** Infographic section group (infographic family only). */
  sections?: TemplateSectionGroup;
}

/**
 * RenderingContract — the ONLY thing the (future) renderer should consume.
 *
 * This phase maps it onto EXISTING pipeline inputs so NO rendering change is
 * required: the resolver projects these fields onto the `creator_card` the
 * generate route already understands.
 */
export interface TemplateRenderingContract {
  renderingContractVersion: string;
  family: TemplateAssetFamily;
  /** Maps onto creator_card.purpose_key (existing purpose-strategy registry). */
  purposeKey?: string | null;
  /** Maps onto creator_card.subtype (existing image subtype hints). */
  subtype?: string | null;
  /** Maps onto creator_card.infographic_layout (existing infographic layouts). */
  infographicLayout?: string | null;
  /** Maps onto creator_card.attachment_mode (text-in-image vs clean visual). */
  attachmentMode?: 'embedded_copy' | 'supporting_visual';
  /**
   * Maps onto creator_card.writer_asset_type — selects the existing renderer
   * lane. Image templates that embed text use a TEXT-CAPABLE lane ('banner':
   * composites the deterministic headline/subheadline/CTA overlay); logo-only /
   * no-text image templates use 'supporting_image' (clean visual, zero-text
   * governance). Without this, a standalone image defaults to 'supporting_image'
   * whose governance forbids on-image text, so the text never renders.
   */
  writerAssetType?: 'supporting_image' | 'banner' | 'infographic' | 'carousel' | 'brand_card';
  /** Default slide/frame count for carousel templates. */
  frameCount?: number | null;
}

/** Visual-language summary surfaced in the gallery + preview (non-binding hints). */
export interface TemplateVisualLanguage {
  densityBias?: 'minimal' | 'balanced' | 'dense';
  brandingIntensity?: 'subtle' | 'balanced' | 'strong';
  typographyWeight?: 'support' | 'lead' | 'feature';
  /** Sample accent colors used by the live gallery preview. */
  accent?: string;
  surface?: string;
}

/** Preview assets. `thumbnailUrl` is a real rendered example when available. */
/** Sample copy used by the live gallery preview (one outcome's content). */
export interface PreviewSampleContent {
  headline?: string;
  subheadline?: string;
  cta?: string;
  quote?: string;
  author?: string;
  slides?: string[];
  sections?: Array<{ label: string; value: string }>;
}

export interface TemplatePreview {
  /**
   * Real rendered example produced by the renderer. Null until the
   * thumbnail-render job runs (deferred to the persistence phase). The gallery
   * renders a high-fidelity live preview from `visualLanguage` + sample copy
   * in the interim — never a placeholder/wireframe.
   */
  thumbnailUrl: string | null;
  sampleAssetUrl: string | null;
  /** Short sample copy used by the live gallery preview. */
  sample: PreviewSampleContent & {
    /**
     * Optional authored multi-outcome examples — each is ONLY sample content
     * (+ an optional context label). Preview metadata ONLY; never read by the
     * renderer and never influences generation. When absent, the gallery
     * derives deterministic example outcomes from this sample.
     */
    examples?: Array<PreviewSampleContent & { label?: string }>;
  };
}

/**
 * CREATOR-123 — structured generation instructions migrated from
 * `marketingSample.GenerationDNA`. Carried ON the template so the renderer and
 * prompt-assembler can read design intelligence from the TEMPLATE rather than
 * deriving it through a `blueprint_id` lookup. The fields mirror the existing
 * `GenerationDNA` exactly so a seeded SYSTEM template reproduces the curated
 * sample byte-for-byte. Optional + additive: nothing reads it until the runtime
 * read-switch lands, so the model extension is inert by itself.
 */
export interface TemplateGenerationDNA {
  composition: string;
  hierarchy: string;
  typography: string;
  colorLanguage: { primary: string; surface: string; contrast: 'high' | 'soft' };
  photography: string;
  illustration: string;
  spacing: string;
  lighting: string;
  camera: string;
  contrast: 'high' | 'soft';
  renderingStyle: string;
  shapeLanguage: string;
  promptModifiers: string;
  negativePromptModifiers: string;
}

/** A first-class Creator Template. */
export interface CreatorTemplate {
  id: string;
  assetFamily: TemplateAssetFamily;
  name: string;
  /** Category within the family (a "Template Category"). */
  category: string;
  description: string;
  preview: TemplatePreview;
  visualLanguage: TemplateVisualLanguage;
  formDefinition: TemplateFormDefinition;
  renderingContract: TemplateRenderingContract;
  /**
   * Family-specific VISUAL-LANGUAGE detail. Populated for the infographic
   * family (colors, typography, spacing, card/connector/icon/chart/decoration
   * style); the resolver supplies `DEFAULT_INFOGRAPHIC_STYLE` when a template
   * leaves it undefined. Image/carousel carry their own detailed schemas
   * (`imageStyle` / `carouselStyle`). Never carries content.
   */
  infographicStyle?: InfographicStyleSchema;
  /** Image family VISUAL-LANGUAGE detail (resolver defaults to `DEFAULT_IMAGE_STYLE`). */
  imageStyle?: ImageStyleSchema;
  /** Carousel family VISUAL-LANGUAGE detail (resolver defaults to `DEFAULT_CAROUSEL_STYLE`). */
  carouselStyle?: CarouselStyleSchema;
  version: number;
  status: TemplateStatus;
  ownership: TemplateOwnership;
  tags: string[];
  metadata: Record<string, unknown>;
  /**
   * CREATOR-123 — canonical DESIGN INTELLIGENCE, migrated from the
   * `marketingSample`/`blueprint_id` facade so that every selectable design
   * (curated SYSTEM, AI, user) carries it on ONE model. All optional + additive:
   * the runtime still reads `blueprint_id` today and only consults these once the
   * read-switch lands (a separate, gated phase), so existing behavior is
   * byte-identical. Populated for curated SYSTEM templates by the seeder.
   */
  /** Visual category (`marketingSample.designSystem` / blueprint `visualCategory`). */
  designFamily?: string;
  /** Structured generation DNA (was `marketingSample.generationDNA`). */
  generationDNA?: TemplateGenerationDNA;
  /** Declared semantic block structure (was `semanticStructureForBlueprint`). */
  semanticStructure?: SemanticBlock[];
  /** Layout/columns/density/hero geometry (was `infographicCompositionForBlueprint`). */
  composition?: InfographicComposition;
  /** Regions held constant between sample and customer asset (was `lockedRegions`). */
  lockedRegions?: string[];
  /** Regions swapped for the customer's content (was `editableRegions`). */
  editableRegions?: string[];
  /** Immutable-vs-adaptable adaptation rules (was `generationDNA.adaptation`). */
  adaptation?: { immutable: string[]; adaptable: string[] };
  /**
   * Optional per-template OVERRIDE of which Creator workflow stages this template
   * REQUIRES. The canonical resolver (`resolveStageRequirements`) layers this on
   * top of the asset-type contract + system default — Template > Asset > Default.
   * Omitted fields inherit lower-priority defaults; an omitted object inherits
   * everything (today's behavior: all stages optional/skippable).
   */
  stageRequirements?: CreatorStageRequirementOverride;
}

/** Which optional Creator workflow stages a template/asset REQUIRES (override shape). */
export interface CreatorStageRequirementOverride {
  /** When true, the Blueprint stage runs even if a skip is requested. */
  requiresBlueprint?: boolean;
  /** When true, the Content Ingestion stage runs even if a skip is requested. */
  requiresContentIngestion?: boolean;
}

/** A category bucket within one family, as surfaced to the gallery. */
export interface TemplateCategory {
  key: string;
  label: string;
  family: TemplateAssetFamily;
}

export const CREATOR_TEMPLATE_CONTRACT_VERSION = 'creator-template-v1';

export const TEMPLATE_ASSET_FAMILIES: readonly TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

export function isTemplateAssetFamily(value: unknown): value is TemplateAssetFamily {
  return value === 'image' || value === 'carousel' || value === 'infographic';
}

/** Default AI-assist set for a free-text content field (all actions enabled). */
export function defaultAiAssist(): TemplateFieldAiAssist {
  return { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true };
}
