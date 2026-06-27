/**
 * Template Recommendation Engine — canonical, deterministic, NO AI.
 *
 * Scores every candidate template against existing campaign context using a
 * weighted, fully-explainable model. Identical inputs → identical ranking
 * (final tiebreak: template id). Reuses the canonical contract + plannerContract
 * (contract compatibility) + discovery helpers (search corpus / density /
 * popularity) — no duplicate scoring logic, no new campaign fields, no
 * renderer/generation/template change. System AND user (registered) templates
 * participate identically.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import { templateSearchText, tokenize, templatePopularity, estimateTextDensity } from './discovery';
import { validatePlannedAsset, describeTemplatePlan, type PlannedAsset } from './plannerContract';

/** Deterministic campaign context — existing fields only; all optional. */
export interface RecommendationContext {
  assetFamily?: TemplateAssetFamily | null;
  contentType?: string | null;
  objective?: string | null;
  industry?: string | null;
  audience?: string | null;
  funnelStage?: string | null;
  platform?: string | null;
  /** 'short' | 'medium' | 'long' or a raw character/word count. */
  contentLength?: 'short' | 'medium' | 'long' | number | null;
  attachmentMode?: string | null;
  strategy?: string | null;
  plannerIntent?: PlannedAsset | null;
  /** templateId → prior performance (0..1), when already available. */
  performance?: Record<string, number> | null;
}

export interface DimensionScore {
  dimension: string;
  /** 0..1 raw fit for this dimension. */
  score: number;
  /** Relative importance. */
  weight: number;
  /** Deterministic, human-readable explanation. */
  reason: string;
}
export interface TemplateRecommendation {
  template: CreatorTemplate;
  /** 0..100 normalized weighted score. */
  score: number;
  /** 0..1 confidence (normalized top score). */
  confidence: number;
  dimensions: DimensionScore[];
  reasons: string[];
}
export interface RecommendationResult {
  recommended: TemplateRecommendation | null;
  top: TemplateRecommendation[];
  all: TemplateRecommendation[];
}

/* ── Deterministic mapping tables ─────────────────────────────────────── */

// Funnel stage → category/tag keywords (deterministic intent mapping).
const FUNNEL_KEYWORDS: Readonly<Record<string, string[]>> = {
  awareness: ['thought leadership', 'educational', 'brand', 'behind the scenes', 'statement', 'tips', 'story'],
  consideration: ['comparison', 'framework', 'case study', 'data', 'statistic', 'testimonial', 'myth', 'process'],
  decision: ['promotion', 'announcement', 'product', 'cta', 'event', 'sale', 'offer', 'launch'],
  retention: ['checklist', 'tips', 'faq', 'educational', 'lifecycle', 'roadmap'],
};
// Platform → supported aspect ratios (matches the renderer's platform geometry).
const PLATFORM_ASPECTS: Readonly<Record<string, string[]>> = {
  linkedin: ['landscape', 'square'], x: ['landscape'], twitter: ['landscape'], facebook: ['landscape', 'square'],
  reddit: ['landscape'], instagram: ['portrait', 'square'], threads: ['portrait', 'square'], pinterest: ['portrait'],
};

function meta(t: CreatorTemplate): Record<string, unknown> { return (t.metadata ?? {}) as Record<string, unknown>; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []; }
function overlapScore(haystack: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const hits = terms.filter((w) => haystack.includes(w)).length;
  return Math.min(1, hits / Math.min(3, terms.length));
}

/** Normalize a content-length hint to a target density. */
function lengthToDensity(len: RecommendationContext['contentLength']): 'minimal' | 'balanced' | 'heavy' | null {
  if (len == null) return null;
  if (typeof len === 'number') return len <= 130 ? 'minimal' : len <= 700 ? 'balanced' : 'heavy';
  if (len === 'short') return 'minimal';
  if (len === 'long') return 'heavy';
  if (len === 'medium') return 'balanced';
  return null;
}

/* ── Scorer ───────────────────────────────────────────────────────────── */

function scoreTemplate(t: CreatorTemplate, ctx: RecommendationContext): TemplateRecommendation {
  const text = templateSearchText(t);
  const m = meta(t);
  const dims: DimensionScore[] = [];
  const add = (dimension: string, score: number, weight: number, reason: string) => {
    if (weight > 0) dims.push({ dimension, score: Math.max(0, Math.min(1, score)), weight, reason });
  };

  // Asset-family compatibility (gate dimension when family is known).
  if (ctx.assetFamily) {
    const ok = t.assetFamily === ctx.assetFamily;
    add('assetFamily', ok ? 1 : 0, 0.18, ok ? `Matches the planned ${ctx.assetFamily} family` : `Wrong family (${t.assetFamily})`);
  }

  // Rendering-contract / planner compatibility (reuses the canonical validator).
  if (ctx.plannerIntent) {
    const v = validatePlannedAsset(t, { ...ctx.plannerIntent, templateId: t.id });
    add('contractCompatibility', v.ok ? 1 : 0, 0.20, v.ok ? 'Satisfies the planned slide/section/layout/CTA contract' : `Contract mismatch: ${v.errors[0] ?? 'incompatible'}`);
  }

  // Platform compatibility (aspect support vs platform geometry).
  if (ctx.platform) {
    const aspects = strArr(m.aspectSupport);
    const wanted = PLATFORM_ASPECTS[String(ctx.platform).toLowerCase()] ?? [];
    const fit = aspects.length === 0 || wanted.length === 0 ? 0.5 : (aspects.some((a) => wanted.includes(a)) ? 1 : 0.2);
    add('platform', fit, 0.12, fit >= 1 ? `Fits ${ctx.platform} aspect ratios` : fit > 0.4 ? `Acceptable on ${ctx.platform}` : `Sub-optimal aspect for ${ctx.platform}`);
  }

  // Objective fit.
  if (ctx.objective) {
    const s = overlapScore(text, tokenize(ctx.objective));
    add('objective', s, 0.16, s > 0 ? `Aligned with objective "${ctx.objective}"` : `No objective signal for "${ctx.objective}"`);
  }

  // Funnel-stage fit.
  if (ctx.funnelStage) {
    const kw = FUNNEL_KEYWORDS[String(ctx.funnelStage).toLowerCase()] ?? [];
    const hay = `${t.category.toLowerCase()} ${t.tags.join(' ').toLowerCase()} ${text}`;
    const s = overlapScore(hay, kw);
    add('funnelStage', s, 0.12, s > 0 ? `Suited to the ${ctx.funnelStage} stage` : `Not a typical ${ctx.funnelStage} format`);
  }

  // Strategy fit.
  if (ctx.strategy) {
    const s = overlapScore(text, tokenize(ctx.strategy));
    add('strategy', s, 0.10, s > 0 ? `Matches strategy "${ctx.strategy}"` : `No strategy signal`);
  }

  // Industry + audience tags.
  if (ctx.industry) {
    const s = overlapScore(text, tokenize(ctx.industry));
    add('industry', s, 0.08, s > 0 ? `Relevant to ${ctx.industry}` : `No industry signal`);
  }
  if (ctx.audience) {
    const s = overlapScore(text, tokenize(ctx.audience));
    add('audience', s, 0.08, s > 0 ? `Speaks to ${ctx.audience}` : `No audience signal`);
  }

  // Content-density fit.
  const targetDensity = lengthToDensity(ctx.contentLength);
  if (targetDensity) {
    const d = estimateTextDensity(t);
    const fit = d === targetDensity ? 1 : ((d === 'balanced' || targetDensity === 'balanced') ? 0.5 : 0);
    add('density', fit, 0.08, fit >= 1 ? `${d} density matches ${targetDensity} content` : `${d} density for ${targetDensity} content`);
  }

  // Historical performance (only when supplied).
  const perf = ctx.performance?.[t.id];
  if (typeof perf === 'number') {
    add('performance', Math.max(0, Math.min(1, perf)), 0.10, `Prior performance ${(Math.max(0, Math.min(1, perf)) * 100).toFixed(0)}%`);
  }

  // Small popularity floor (deterministic, telemetry-free) as a stable tiebreak.
  add('popularity', Math.min(1, templatePopularity(t) / 60), 0.04, 'Baseline popularity');

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0) || 1;
  const weighted = dims.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;
  const score = Math.round(weighted * 1000) / 10; // 0..100, 1dp
  const reasons = dims
    .filter((d) => d.score > 0 && d.dimension !== 'popularity')
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .map((d) => d.reason);

  return { template: t, score, confidence: Math.max(0, Math.min(1, weighted)), dimensions: dims, reasons };
}

/**
 * Rank templates for a campaign context. Deterministic; family is a hard filter
 * when supplied. Returns the recommended template, the top N, and the full
 * ranking — each with an explainable per-dimension breakdown.
 */
export function recommendTemplatesForContext(
  templates: readonly CreatorTemplate[],
  ctx: RecommendationContext,
  limit = 5,
): RecommendationResult {
  const candidates = ctx.assetFamily ? templates.filter((t) => t.assetFamily === ctx.assetFamily) : [...templates];
  const all = candidates
    .map((t) => scoreTemplate(t, ctx))
    .sort((a, b) => (b.score - a.score) || (templatePopularity(b.template) - templatePopularity(a.template)) || a.template.id.localeCompare(b.template.id));
  return { recommended: all[0] ?? null, top: all.slice(0, limit), all };
}
