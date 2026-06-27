/**
 * AI Template Compiler — the SOLE producer of CreatorTemplates from intent.
 *
 * Deterministic + pure: given a validated TemplateIntent it derives the
 * canonical CreatorTemplate (visual language, supported fields, rendering
 * contract, metadata, discovery metadata, sample copy) using fixed rules. No
 * LLM runs here. It reuses the existing blank scaffold (`cloneTemplate(null,…)`)
 * so the output is identical in shape to a hand-built user template — same
 * model, same renderer, same validation, same gallery.
 */

import type { CreatorTemplate, TemplateField } from './types';
import type { TemplateIntent, VisualStyle } from './aiTemplateIntent';
import { cloneTemplate } from './userTemplate';
import { buildStoryBlueprintMetadata } from './storyBlueprint';

interface StyleRule {
  accent: string;
  surface: string;
  brandingIntensity: 'subtle' | 'balanced' | 'strong';
}

// Deterministic visual-language palette per intent style (closed vocabulary).
const STYLE_RULES: Record<VisualStyle, StyleRule> = {
  luxury: { accent: '#c8a24b', surface: '#0a0a0a', brandingIntensity: 'strong' },
  bold: { accent: '#ef4444', surface: '#0b1220', brandingIntensity: 'strong' },
  minimal: { accent: '#64748b', surface: '#0f172a', brandingIntensity: 'subtle' },
  playful: { accent: '#ec4899', surface: '#1e1b4b', brandingIntensity: 'balanced' },
  corporate: { accent: '#2563eb', surface: '#0b1220', brandingIntensity: 'balanced' },
  editorial: { accent: '#0ea5e9', surface: '#111827', brandingIntensity: 'subtle' },
  technical: { accent: '#22d3ee', surface: '#0b1220', brandingIntensity: 'balanced' },
};

function difficultyFor(intent: TemplateIntent): 'beginner' | 'intermediate' | 'advanced' {
  if (intent.density === 'dense') return 'advanced';
  if (intent.density === 'minimal') return 'beginner';
  return 'intermediate';
}

function sampleFor(intent: TemplateIntent): CreatorTemplate['preview']['sample'] {
  const lead = intent.useCases[0] ?? intent.name;
  if (intent.assetFamily === 'carousel') {
    const slides = [intent.name, ...intent.useCases].filter(Boolean).slice(0, 5);
    return { slides: slides.length ? slides : [intent.name, 'Point one', 'Point two'] };
  }
  if (intent.assetFamily === 'infographic') {
    const sections = (intent.useCases.length ? intent.useCases : ['Growth', 'Adoption', 'Retention'])
      .slice(0, 4)
      .map((label, i) => ({ label, value: `${(i + 2) * 17}%` }));
    return { headline: intent.name, sections };
  }
  // image
  if (intent.emphasis === 'quote') return { quote: intent.name, author: lead };
  return { headline: intent.name, subheadline: lead, cta: intent.emphasis === 'cta' ? 'Learn more' : '' };
}

export interface CompileOptions {
  id: string;
  ownerUserId: string;
  teamId?: string | null;
  now?: string;
}

/**
 * Compile a validated intent into a canonical CreatorTemplate. Deterministic:
 * the same intent + options always yields the same template.
 */
export function compileTemplateIntent(intent: TemplateIntent, opts: CompileOptions): CreatorTemplate {
  const t = cloneTemplate(null, intent.assetFamily, {
    id: opts.id,
    ownerUserId: opts.ownerUserId,
    teamId: opts.teamId ?? null,
    name: intent.name,
    now: opts.now,
  });
  const style = STYLE_RULES[intent.visualStyle];

  t.category = intent.category;
  t.description = intent.description;

  // ── Visual language (gallery preview + renderer style hints) ──
  t.visualLanguage = {
    densityBias: intent.density,
    typographyWeight: intent.typographyPreference,
    brandingIntensity: style.brandingIntensity,
    accent: intent.accent ?? style.accent,
    surface: style.surface,
  };

  // ── Rendering contract — deterministic per family + intent (no LLM) ──
  if (intent.assetFamily === 'image') {
    const clean = intent.imageTreatment === 'clean_visual';
    t.renderingContract = {
      ...t.renderingContract,
      attachmentMode: clean ? 'supporting_visual' : 'embedded_copy',
      writerAssetType: clean ? 'supporting_image' : 'banner',
    };
  } else if (intent.assetFamily === 'infographic') {
    t.renderingContract = { ...t.renderingContract, infographicLayout: t.renderingContract.infographicLayout ?? 'stats' };
  }

  // ── Supported fields — mark recommended fields required, wire AI assist ──
  const recommended = new Set(intent.recommendedFields);
  const caps = new Set(intent.aiCapabilities);
  const applyField = (f: TemplateField) => {
    if (recommended.has(f.key)) f.required = true;
    f.aiAssist = {
      ...f.aiAssist,
      generate: caps.has('headline'),
      rewrite: caps.has('rewrite'),
      expand: caps.has('expand'),
      shorten: caps.has('shorten'),
    };
  };
  t.formDefinition.fields.forEach(applyField);
  if (t.formDefinition.slides) t.formDefinition.slides.fields.forEach(applyField);
  if (t.formDefinition.sections) t.formDefinition.sections.fields.forEach(applyField);

  // ── Sample copy so the gallery + preview render has content ──
  t.preview = { ...t.preview, sample: sampleFor(intent) };

  // ── Metadata (user + discovery + AI provenance) ──
  const meta = t.metadata as Record<string, unknown>;
  meta.recommendedUseCases = intent.useCases;
  meta.difficulty = difficultyFor(intent);
  meta.aspectSupport = intent.aspectPreferences;
  meta.aiCapabilities = intent.aiCapabilities;
  meta.keywords = Array.from(new Set([intent.visualStyle, intent.emphasis, ...intent.useCases.map((u) => u.toLowerCase())]));
  meta.generatedByAi = true;
  meta.templateIntent = intent;

  t.tags = Array.from(new Set([...(t.tags ?? []), 'ai-generated', intent.visualStyle]));

  // Deterministic Story Blueprint metadata (narrative structure → metadata only;
  // AI → Story Blueprint → Visual Style → Template, compiler still the producer).
  const blueprint = buildStoryBlueprintMetadata(t);
  meta.storyBlueprint = blueprint.storyBlueprint;
  meta.communicationGoal = blueprint.communicationGoal;
  meta.narrativeFlow = blueprint.narrativeFlow;
  meta.recommendedCampaignGoals = blueprint.recommendedCampaignGoals;
  meta.recommendedPlatforms = blueprint.recommendedPlatforms;
  meta.recommendedAudiences = blueprint.recommendedAudiences;
  meta.primarySlideStructure = blueprint.primarySlideStructure;

  return t;
}
