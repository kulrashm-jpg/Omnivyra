/**
 * AI Template Intent — the ONLY artifact the AI produces.
 *
 * The AI never emits a CreatorTemplate, a rendering contract, or any rendering
 * primitive. It emits a constrained, validated TEMPLATE INTENT (design
 * preferences in a closed vocabulary). The deterministic compiler
 * (`aiTemplateCompiler.ts`) is the sole producer of canonical CreatorTemplates.
 *
 * This module is pure (no AI, no DB): the intent schema, a deterministic
 * normaliser/validator, and a keyword deriver that doubles as (a) the offline
 * fallback when the LLM is unavailable and (b) the structural example the LLM is
 * asked to fill.
 */

import type { TemplateAssetFamily } from './types';

export const ASSET_FAMILIES = ['image', 'carousel', 'infographic'] as const;
export const VISUAL_STYLES = ['luxury', 'bold', 'minimal', 'playful', 'corporate', 'editorial', 'technical'] as const;
export const DENSITIES = ['minimal', 'balanced', 'dense'] as const;
export const TYPOGRAPHY_PREFS = ['support', 'lead', 'feature'] as const;
export const EMPHASES = ['headline', 'data', 'quote', 'cta', 'balanced'] as const;
export const DECORATIONS = ['none', 'subtle', 'rich'] as const;
export const IMAGE_TREATMENTS = ['embedded_text', 'clean_visual'] as const;
export const AI_CAPABILITIES = ['headline', 'rewrite', 'expand', 'shorten', 'tone'] as const;

export type VisualStyle = typeof VISUAL_STYLES[number];
export type Density = typeof DENSITIES[number];
export type TypographyPref = typeof TYPOGRAPHY_PREFS[number];
export type Emphasis = typeof EMPHASES[number];
export type Decoration = typeof DECORATIONS[number];
export type ImageTreatment = typeof IMAGE_TREATMENTS[number];
export type AiCapability = typeof AI_CAPABILITIES[number];

/** The constrained design intent — NO rendering primitives. */
export interface TemplateIntent {
  assetFamily: TemplateAssetFamily;
  name: string;
  description: string;
  category: string;
  visualStyle: VisualStyle;
  density: Density;
  typographyPreference: TypographyPref;
  emphasis: Emphasis;
  decorationPreference: Decoration;
  /** Image family only — text baked in, or a clean text-free visual. */
  imageTreatment: ImageTreatment;
  recommendedFields: string[];
  useCases: string[];
  aspectPreferences: string[];
  aiCapabilities: AiCapability[];
  /** Optional brand accent (hex). Compiler defaults from the visual style. */
  accent?: string;
}

export interface IntentValidationResult {
  ok: boolean;
  intent: TemplateIntent;
  errors: string[];
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
function strArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).slice(0, max);
}
function cleanStr(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function titleCase(s: string): string {
  return s.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).map((w) => w ? w[0]!.toUpperCase() + w.slice(1) : w).join(' ');
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Normalise + validate a raw (possibly AI-produced) intent. Coerces every field
 * into the closed vocabulary (invalid → deterministic default) so the compiler
 * always receives a well-formed intent. `ok` is false only when essentials
 * (a usable name) are missing.
 */
export function validateTemplateIntent(raw: unknown): IntentValidationResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const assetFamily = pick<TemplateAssetFamily>(r.assetFamily, ASSET_FAMILIES, 'image');
  let name = cleanStr(r.name, 80);
  if (!name) { name = ''; errors.push('Intent is missing a template name.'); }
  const visualStyle = pick(r.visualStyle, VISUAL_STYLES, 'corporate');

  const intent: TemplateIntent = {
    assetFamily,
    name: name || 'AI Template',
    description: cleanStr(r.description, 240) || `${titleCase(visualStyle)} ${assetFamily} template.`,
    category: cleanStr(r.category, 60) || titleCase(visualStyle),
    visualStyle,
    density: pick(r.density, DENSITIES, 'balanced'),
    typographyPreference: pick(r.typographyPreference, TYPOGRAPHY_PREFS, 'lead'),
    emphasis: pick(r.emphasis, EMPHASES, assetFamily === 'infographic' ? 'data' : 'headline'),
    decorationPreference: pick(r.decorationPreference, DECORATIONS, 'subtle'),
    imageTreatment: pick(r.imageTreatment, IMAGE_TREATMENTS, 'embedded_text'),
    recommendedFields: strArray(r.recommendedFields, 12),
    useCases: strArray(r.useCases, 8),
    aspectPreferences: strArray(r.aspectPreferences, 6),
    aiCapabilities: strArray(r.aiCapabilities, AI_CAPABILITIES.length).filter((c): c is AiCapability => (AI_CAPABILITIES as readonly string[]).includes(c)),
    accent: typeof r.accent === 'string' && HEX.test(r.accent) ? r.accent : undefined,
  };

  return { ok: errors.length === 0, intent, errors };
}

/* ── Deterministic keyword deriver (offline fallback + LLM example) ───── */

function matches(p: string, re: RegExp): boolean { return re.test(p); }

/**
 * Derive a structured intent from a natural-language prompt using deterministic
 * keyword heuristics. Used as the fallback when the LLM is unavailable AND as
 * the worked example the LLM is shown — so AI and fallback share one schema.
 */
export function deriveIntentFromPrompt(prompt: string, familyHint?: TemplateAssetFamily | null): TemplateIntent {
  const p = (prompt || '').toLowerCase();

  const assetFamily: TemplateAssetFamily = familyHint
    ?? (matches(p, /carousel|slides?|swipe|thread/) ? 'carousel'
      : matches(p, /infographic|stats?|metrics?|data viz|chart|numbers/) ? 'infographic'
        : 'image');

  const visualStyle: VisualStyle =
    matches(p, /luxury|premium|elegant|high.?end|sophisticat/) ? 'luxury'
      : matches(p, /bold|striking|punch|loud|vibrant/) ? 'bold'
        : matches(p, /minimal|clean|simple|understated/) ? 'minimal'
          : matches(p, /playful|fun|friendly|quirky/) ? 'playful'
            : matches(p, /editorial|magazine|story|narrative/) ? 'editorial'
              : matches(p, /technical|developer|engineering|saas|api/) ? 'technical'
                : 'corporate';

  const density: Density = matches(p, /dense|detailed|rich|packed|data/) ? 'dense'
    : matches(p, /minimal|clean|sparse|airy/) ? 'minimal' : 'balanced';

  const typographyPreference: TypographyPref = matches(p, /bold|large|hero|headline|feature/) ? 'feature'
    : matches(p, /subtle|quiet|small/) ? 'support' : 'lead';

  const emphasis: Emphasis = assetFamily === 'infographic' ? 'data'
    : matches(p, /quote|testimonial|customer/) ? 'quote'
      : matches(p, /announce|launch|hiring|promo|offer|sale|cta/) ? 'cta'
        : 'headline';

  const decorationPreference: Decoration = matches(p, /luxury|playful|vibrant|rich|ornate/) ? 'rich'
    : matches(p, /minimal|clean|flat/) ? 'none' : 'subtle';

  const imageTreatment: ImageTreatment = matches(p, /no text|clean visual|logo only|text.?free|photo only/) ? 'clean_visual' : 'embedded_text';

  const useCases: string[] = [];
  if (matches(p, /announce|launch/)) useCases.push('Product announcement');
  if (matches(p, /hiring|recruit|job/)) useCases.push('Hiring / recruiting');
  if (matches(p, /thought leadership|insight|opinion/)) useCases.push('Thought leadership');
  if (matches(p, /metrics?|stats?|results|growth/)) useCases.push('Metrics & results');
  if (matches(p, /promo|sale|offer|discount/)) useCases.push('Promotion');
  if (!useCases.length) useCases.push(assetFamily === 'infographic' ? 'Data storytelling' : 'Brand content');

  const aspectPreferences = assetFamily === 'image' ? ['1:1', '4:5']
    : assetFamily === 'carousel' ? ['4:5', '1:1'] : ['4:5', '1:1'];

  const name = titleCase(prompt.replace(/^(create|make|design|build|i want|generate)\b[: ]*/i, '').replace(/\b(a|an|the)\b/gi, '')) || 'AI Template';

  return {
    assetFamily,
    name,
    description: `${titleCase(visualStyle)} ${assetFamily} template${useCases[0] ? ` for ${useCases[0].toLowerCase()}` : ''}.`,
    category: titleCase(visualStyle),
    visualStyle,
    density,
    typographyPreference,
    emphasis,
    decorationPreference,
    imageTreatment,
    recommendedFields: assetFamily === 'carousel' ? ['title', 'body'] : assetFamily === 'infographic' ? ['headline', 'metric', 'description'] : ['headline', 'subheadline', 'cta'],
    useCases,
    aspectPreferences,
    aiCapabilities: ['headline', 'rewrite', 'expand'],
  };
}
