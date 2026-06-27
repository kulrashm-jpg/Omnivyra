/**
 * Creator Template Discovery & Recommendation Engine — pure + deterministic.
 *
 * Consumes ONLY the existing template library + its metadata (keywords,
 * difficulty, recommendedUseCases, aspectSupport, category, tags,
 * visualLanguage). No generation, no rendering, no template changes. Every
 * function is deterministic: identical inputs → identical ordering (final
 * tiebreak is always the stable template id).
 *
 * Client- and server-safe.
 */

import type { CreatorTemplate } from './types';
import { variantKeyForTemplate } from './styleVariants';

export type TextDensity = 'minimal' | 'balanced' | 'heavy';

/** The canonical style-variant key assigned to a template (TEMPLATE-013…015),
 *  resolved from its own asset family. Single source — never recomputed. */
export function templateVariantKey(t: CreatorTemplate): string {
  return variantKeyForTemplate(t.id, t.assetFamily);
}

/** Humanize a variant key for display (e.g. 'executive-report' → 'Executive Report'). */
export function variantLabel(key: string): string {
  return key.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Distinct style-variant keys present across a family's templates (sorted),
 *  for the gallery's Style Variant filter. Deterministic. */
export function listStyleVariants(templates: readonly CreatorTemplate[]): string[] {
  return Array.from(new Set(templates.map(templateVariantKey))).sort();
}

export interface DiscoveryContext {
  industry?: string | null;
  maturity?: 'early' | 'growth' | 'mature' | null;
  objective?: string | null;
  campaignGoal?: string | null;
  audience?: string | null;
  /** Free-text from the current Creator inputs (topic/summary/etc.). */
  currentInputs?: string | null;
  /** Template ids the user recently generated from (most-recent first). */
  recentlyUsedIds?: string[];
  /** Favorited template ids. */
  favoriteIds?: string[];
}

export interface ScoredTemplate {
  template: CreatorTemplate;
  score: number;
  /** Human-readable reasons the template was recommended (deterministic). */
  reasons: string[];
}

export type TemplateBadge =
  | { kind: 'beginner'; label: 'Beginner' }
  | { kind: 'popular'; label: 'Most Popular' }
  | { kind: 'recommended'; label: 'Recommended' }
  | { kind: 'variant'; label: string }
  | { kind: 'platform'; label: string }
  | { kind: 'objective'; label: string }
  | { kind: 'density'; label: 'Minimal Text' | 'Balanced' | 'Text Heavy' };

/* ── Helpers ─────────────────────────────────────────────────────────── */

function meta(t: CreatorTemplate): Record<string, unknown> {
  return (t.metadata ?? {}) as Record<string, unknown>;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : [];
}
function searchable(t: CreatorTemplate): string {
  const m = meta(t);
  return [t.name, t.category, t.description, String(m.searchText ?? ''), ...t.tags, ...strArr(m.keywords), ...strArr(m.recommendedUseCases)]
    .join(' ')
    .toLowerCase();
}
function tokens(s: string | null | undefined): string[] {
  return String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

/** Canonical lowercased search corpus for a template (name/category/description/
 *  tags/keywords/use-cases). Single source — reused by search + recommendation. */
export function templateSearchText(t: CreatorTemplate): string {
  return searchable(t);
}
/** Tokenize free text into the recommendation/search token set. */
export function tokenize(s: string | null | undefined): string[] {
  return tokens(s);
}

/* ── Text density (deterministic, from the form definition) ──────────── */

export function estimateTextDensity(t: CreatorTemplate): TextDensity {
  const fd = t.formDefinition;
  const flat = fd.fields.reduce((n, f) => n + (f.maxLength ?? 40), 0);
  const slideUnit = (fd.slides?.fields.reduce((n, f) => n + (f.maxLength ?? 40), 0) ?? 0) * (fd.slides?.defaultCount ?? 0);
  const sectionUnit = (fd.sections?.fields.reduce((n, f) => n + (f.maxLength ?? 40), 0) ?? 0) * (fd.sections?.max ?? 0);
  const total = flat + slideUnit + sectionUnit;
  if (total <= 130) return 'minimal';
  if (total <= 700) return 'balanced';
  return 'heavy';
}

/* ── Deterministic popularity (no live telemetry — derived from metadata) ── */

const CATEGORY_WEIGHT: Readonly<Record<string, number>> = {
  Promotional: 5, Educational: 5, Statement: 4, Product: 4, Announcement: 4, Data: 4,
  'Thought Leadership': 4, Quote: 3, Testimonial: 3, Banner: 3, Framework: 3, Comparison: 3,
};
const DIFFICULTY_WEIGHT: Readonly<Record<string, number>> = { easy: 3, intermediate: 2, advanced: 1 };

/** Stable popularity score in a fixed range. Deterministic, telemetry-free. */
export function templatePopularity(t: CreatorTemplate): number {
  const m = meta(t);
  const cat = CATEGORY_WEIGHT[t.category] ?? 2;
  const diff = DIFFICULTY_WEIGHT[String(m.difficulty ?? 'intermediate')] ?? 2;
  return cat * 10 + diff;
}

function byPopularityThenId(a: CreatorTemplate, b: CreatorTemplate): number {
  const d = templatePopularity(b) - templatePopularity(a);
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

/** "Popular" view — deterministic popularity ordering. */
export function popularTemplates(templates: readonly CreatorTemplate[]): CreatorTemplate[] {
  return [...templates].sort(byPopularityThenId);
}

/* ── Recommendations (deterministic scoring) ─────────────────────────── */

export function recommendTemplates(templates: readonly CreatorTemplate[], context: DiscoveryContext = {}): ScoredTemplate[] {
  const industry = tokens(context.industry);
  const objective = tokens([context.objective, context.campaignGoal].filter(Boolean).join(' '));
  const audience = tokens(context.audience);
  const inputs = tokens(context.currentInputs);
  const recent = new Set(context.recentlyUsedIds ?? []);

  const scored = templates.map((t) => {
    const text = searchable(t);
    const m = meta(t);
    let score = templatePopularity(t) / 10; // small popularity floor
    const reasons: string[] = [];

    if (industry.length && industry.some((w) => text.includes(w))) { score += 8; reasons.push(`Recommended for ${context.industry}`); }
    if (objective.length && objective.some((w) => text.includes(w))) { score += 10; reasons.push(`Recommended for ${context.objective || context.campaignGoal}`); }
    if (audience.length && audience.some((w) => text.includes(w))) { score += 4; reasons.push(`Fits ${context.audience}`); }
    if (inputs.length) { const hits = inputs.filter((w) => text.includes(w)).length; if (hits > 0) { score += Math.min(6, hits * 2); reasons.push('Matches your current inputs'); } }

    // Maturity → difficulty affinity.
    const diff = String(m.difficulty ?? 'intermediate');
    if (context.maturity === 'early' && diff === 'easy') { score += 3; reasons.push('Simple to start'); }
    if (context.maturity === 'mature' && diff === 'advanced') { score += 3; reasons.push('Depth for mature teams'); }

    if (recent.has(t.id)) { score += 2; reasons.push('You used this recently'); }

    return { template: t, score, reasons };
  });

  return scored.sort((a, b) => {
    const d = b.score - a.score;
    if (d !== 0) return d;
    return byPopularityThenId(a.template, b.template);
  });
}

/* ── Advanced search ─────────────────────────────────────────────────── */

export interface SearchFilters {
  category?: string | null;
  difficulty?: string | null;
  aspect?: string | null;
  density?: TextDensity | null;
  /** visualLanguage typographyWeight / densityBias / brandingIntensity term. */
  style?: string | null;
  /** Canonical style-variant key (TEMPLATE-013…015), e.g. 'editorial'. */
  variant?: string | null;
  objective?: string | null;
  industryTag?: string | null;
}

export function searchTemplates(templates: readonly CreatorTemplate[], query: string, filters: SearchFilters = {}): CreatorTemplate[] {
  const qTokens = tokens(query);
  const filtered = templates.filter((t) => {
    const m = meta(t);
    if (filters.category && t.category !== filters.category) return false;
    if (filters.difficulty && String(m.difficulty) !== filters.difficulty) return false;
    if (filters.aspect && !strArr(m.aspectSupport).includes(filters.aspect.toLowerCase())) return false;
    if (filters.density && estimateTextDensity(t) !== filters.density) return false;
    if (filters.style) {
      const styleText = `${t.visualLanguage.densityBias ?? ''} ${t.visualLanguage.typographyWeight ?? ''} ${t.visualLanguage.brandingIntensity ?? ''}`.toLowerCase();
      if (!styleText.includes(filters.style.toLowerCase())) return false;
    }
    if (filters.variant && templateVariantKey(t) !== filters.variant) return false;
    if (filters.objective && !searchable(t).includes(filters.objective.toLowerCase())) return false;
    if (filters.industryTag && !searchable(t).includes(filters.industryTag.toLowerCase())) return false;
    return true;
  });

  if (qTokens.length === 0) return filtered.sort(byPopularityThenId);

  const scored = filtered
    .map((t) => {
      const text = searchable(t);
      const hits = qTokens.filter((w) => text.includes(w)).length;
      // Name matches weigh more.
      const nameHits = qTokens.filter((w) => t.name.toLowerCase().includes(w)).length;
      return { t, relevance: hits + nameHits * 2 };
    })
    .filter((x) => x.relevance > 0);

  return scored
    .sort((a, b) => (b.relevance - a.relevance) || byPopularityThenId(a.t, b.t))
    .map((x) => x.t);
}

/* ── Related templates (deterministic similarity) ────────────────────── */

export function relatedTemplates(template: CreatorTemplate, all: readonly CreatorTemplate[], limit = 4): CreatorTemplate[] {
  const tagSet = new Set(template.tags.map((x) => x.toLowerCase()));
  const md = meta(template);
  const scored = all
    .filter((t) => t.id !== template.id && t.assetFamily === template.assetFamily)
    .map((t) => {
      let s = 0;
      if (t.category === template.category) s += 3;
      const om = meta(t);
      for (const tag of t.tags) if (tagSet.has(tag.toLowerCase())) s += 1;
      if (String(om.difficulty) === String(md.difficulty)) s += 1;
      if (t.visualLanguage.densityBias === template.visualLanguage.densityBias) s += 1;
      if (t.visualLanguage.typographyWeight === template.visualLanguage.typographyWeight) s += 1;
      if (estimateTextDensity(t) === estimateTextDensity(template)) s += 1;
      return { t, s };
    });
  return scored
    .sort((a, b) => (b.s - a.s) || byPopularityThenId(a.t, b.t))
    .slice(0, limit)
    .map((x) => x.t);
}

/* ── Badges (deterministic) ──────────────────────────────────────────── */

export function deriveBadges(t: CreatorTemplate, opts: { popularRank?: number; objective?: string | null; recommended?: boolean; showVariant?: boolean } = {}): TemplateBadge[] {
  const m = meta(t);
  const badges: TemplateBadge[] = [];
  if (opts.recommended) badges.push({ kind: 'recommended', label: 'Recommended' });
  if (opts.showVariant) badges.push({ kind: 'variant', label: variantLabel(templateVariantKey(t)) });
  if (String(m.difficulty) === 'easy') badges.push({ kind: 'beginner', label: 'Beginner' });
  if (typeof opts.popularRank === 'number' && opts.popularRank < 5) badges.push({ kind: 'popular', label: 'Most Popular' });
  const aspect = strArr(m.aspectSupport);
  if (aspect.includes('landscape')) badges.push({ kind: 'platform', label: 'Best for LinkedIn' });
  else if (aspect.includes('portrait')) badges.push({ kind: 'platform', label: 'Best for Instagram' });
  if (opts.objective && searchable(t).includes(opts.objective.toLowerCase())) badges.push({ kind: 'objective', label: `Best for ${opts.objective}` });
  const density = estimateTextDensity(t);
  badges.push({ kind: 'density', label: density === 'minimal' ? 'Minimal Text' : density === 'heavy' ? 'Text Heavy' : 'Balanced' });
  return badges;
}

/* ── Quick compare (read-only projection) ────────────────────────────── */

export interface TemplateComparison {
  id: string;
  name: string;
  category: string;
  visualLanguage: CreatorTemplate['visualLanguage'];
  fieldCount: number;
  aspectSupport: string[];
  recommendedUseCases: string[];
  density: TextDensity;
  difficulty: string;
}

export function compareTemplate(t: CreatorTemplate): TemplateComparison {
  const m = meta(t);
  const fd = t.formDefinition;
  const fieldCount = fd.fields.length + (fd.slides?.fields.length ?? 0) + (fd.sections?.fields.length ?? 0);
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    visualLanguage: t.visualLanguage,
    fieldCount,
    aspectSupport: strArr(m.aspectSupport),
    recommendedUseCases: strArr(m.recommendedUseCases),
    density: estimateTextDensity(t),
    difficulty: String(m.difficulty ?? 'intermediate'),
  };
}
