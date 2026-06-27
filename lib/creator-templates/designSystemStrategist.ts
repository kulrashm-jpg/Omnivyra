/**
 * Design System Strategist — pure deterministic scoring (no AI, no DB, no fetch).
 *
 * Recommends the most appropriate Template Collection(s) for a campaign by
 * scoring each collection against a StrategyContext assembled from EXISTING
 * canonical sources (company context, brand voice, industry, campaign goal,
 * audience, platform mix, campaign type). Every reason comes from a scoring rule
 * — never an LLM. Ordering is stable (score desc, then id asc): no randomness.
 *
 * Reuses the collection model (families/resolution) and the recommendation
 * metadata templates already carry (recommendedUseCases / aspectSupport /
 * difficulty / keywords). No duplicate recommendation engine, no new context.
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import { type TemplateCollection, type TemplateResolver, collectionFamilies } from './collection';

/** Plain input DTO mapped from existing canonical sources (NOT a new model). */
export interface StrategyContext {
  objective?: string;        // campaign goal/objective (e.g. 'product_launch','hiring')
  campaignType?: string;     // campaign type label
  industry?: string;         // e.g. 'saas','ecommerce'
  audience?: string;         // e.g. 'executive','developers'
  platformMix?: string[];    // e.g. ['linkedin','instagram'] (order = dominance)
  companyMaturity?: string;  // 'startup' | 'growth' | 'enterprise'
  visualStyle?: string;      // preferred visual style (from brand)
  requiredFamilies?: TemplateAssetFamily[];
  /** Optional prior usage score per collection id (historical compatibility). */
  historicalCompatibility?: Record<string, number>;
  /** Optional measured-analytics reasons per collection id (deterministic). */
  performanceReasons?: Record<string, string[]>;
}

export interface ScoredCollection {
  collectionId: string;
  score: number;
  reasons: string[];
  matchedFamilies: TemplateAssetFamily[];
}

const PLATFORM_ASPECTS: Record<string, string[]> = {
  linkedin: ['1:1', '4:5'],
  instagram: ['1:1', '4:5'],
  facebook: ['1:1', '4:5'],
  twitter: ['16:9', '1:1'],
  x: ['16:9', '1:1'],
  youtube: ['16:9'],
  pinterest: ['4:5', '2:3'],
};

function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').trim().split(' ').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}
function lc(s: unknown): string { return typeof s === 'string' ? s.toLowerCase() : ''; }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => lc(x)).filter(Boolean) : []; }

interface MemberSignals {
  templates: CreatorTemplate[];
  haystack: string;          // lowercased searchable text across collection + members
  useCases: string[];
  aspectSupport: string[];
  difficulties: string[];
  typographies: Set<string>;
  densities: Set<string>;
}

function gatherSignals(c: TemplateCollection, resolve: TemplateResolver): MemberSignals {
  const templates = c.templateIds.map(resolve).filter((t): t is CreatorTemplate => t !== null);
  const useCases: string[] = [];
  const aspectSupport: string[] = [];
  const difficulties: string[] = [];
  const keywords: string[] = [];
  const typographies = new Set<string>();
  const densities = new Set<string>();
  for (const t of templates) {
    const m = (t.metadata ?? {}) as Record<string, unknown>;
    useCases.push(...arr(m.recommendedUseCases));
    aspectSupport.push(...arr(m.aspectSupport));
    keywords.push(...arr(m.keywords));
    if (typeof m.difficulty === 'string') difficulties.push(lc(m.difficulty));
    if (t.visualLanguage.typographyWeight) typographies.add(t.visualLanguage.typographyWeight);
    if (t.visualLanguage.densityBias) densities.add(t.visualLanguage.densityBias);
  }
  const haystack = [
    lc(c.name), lc(c.category), lc(c.brandStyle), ...arr(c.tags), ...useCases, ...keywords,
  ].join(' ');
  return { templates, haystack, useCases, aspectSupport, difficulties, typographies, densities };
}

/**
 * Score a collection for a campaign. Deterministic: same inputs → same score +
 * reasons (reasons appended in fixed rule order).
 */
export function scoreCollection(c: TemplateCollection, context: StrategyContext, resolve: TemplateResolver): ScoredCollection {
  const s = gatherSignals(c, resolve);
  const families = collectionFamilies(c, resolve);
  const reasons: string[] = [];
  let score = 0;

  // 1) Objective / campaign goal.
  const objective = lc(context.objective) || lc(context.campaignType);
  if (objective) {
    const obj = objective.replace(/[_-]+/g, ' ');
    const hit = s.haystack.includes(obj) || obj.split(' ').some((w) => w.length > 3 && s.haystack.includes(w));
    if (hit) { score += 25; reasons.push(`Best for ${humanize(context.objective || context.campaignType || '')}`); }
  }

  // 2) Visual consistency — members truly share one design language.
  if (s.templates.length >= 2 && s.typographies.size === 1 && s.densities.size === 1) {
    score += 15; reasons.push('Strong visual consistency');
  }

  // 3) Industry / positioning.
  const industry = lc(context.industry);
  if (industry && s.haystack.includes(industry)) {
    score += 20; reasons.push(`Matches ${humanize(context.industry!)} positioning`);
  }

  // 4) Platform fit (dominant platform of the mix).
  const dominant = (context.platformMix ?? []).map(lc).find(Boolean);
  if (dominant && PLATFORM_ASPECTS[dominant]) {
    const want = new Set(PLATFORM_ASPECTS[dominant]);
    if (s.aspectSupport.some((a) => want.has(a))) {
      score += 15; reasons.push(`Optimized for ${humanize(dominant)}-heavy campaigns`);
    }
  }

  // 5) Audience.
  const audience = lc(context.audience);
  if (audience && (s.haystack.includes(audience) || s.useCases.some((u) => u.includes(audience)))) {
    score += 15; reasons.push(`Fits ${humanize(context.audience!)} audience`);
  }

  // 6) Visual-style preference.
  const visual = lc(context.visualStyle);
  if (visual && lc(c.brandStyle) === visual) {
    score += 10; reasons.push(`Matches ${humanize(c.brandStyle)} brand style`);
  }

  // 7) Maturity ↔ template difficulty.
  const maturity = lc(context.companyMaturity);
  if (maturity && s.difficulties.length) {
    const wantDifficulty = maturity === 'enterprise' ? 'advanced' : maturity === 'startup' ? 'beginner' : 'intermediate';
    if (s.difficulties.includes(wantDifficulty)) { score += 8; reasons.push(`Suited to ${humanize(maturity)} maturity`); }
  }

  // 8) Completeness — covers all required (or all three) families.
  const required = context.requiredFamilies?.length ? context.requiredFamilies : (['image', 'carousel', 'infographic'] as TemplateAssetFamily[]);
  const covers = required.every((f) => families.includes(f));
  if (covers && families.length >= required.length) { score += 12; reasons.push('Complete multi-format system'); }

  // 9) Historical compatibility — REAL measured performance (when provided).
  const hist = context.historicalCompatibility?.[c.id];
  if (typeof hist === 'number' && hist > 0) { score += Math.min(20, Math.round(hist)); reasons.push('Proven in past campaigns'); }

  // 10) Measured-analytics reasons (e.g. "Best performing", "High CTR on
  //     LinkedIn") — appended deterministically; scoring already credited via
  //     historical compatibility, so no double-count here.
  for (const r of context.performanceReasons?.[c.id] ?? []) {
    if (!reasons.includes(r)) reasons.push(r);
  }

  return { collectionId: c.id, score, reasons, matchedFamilies: families };
}

/**
 * Recommend collections for a campaign — stable order (score desc, id asc).
 * `limit` caps results; 0/undefined returns all. Collections with score 0 are
 * still returned (so manual selection always has the full set) but rank last.
 */
export function recommendCollections(
  collections: TemplateCollection[],
  context: StrategyContext,
  resolve: TemplateResolver,
  limit = 0,
): ScoredCollection[] {
  const scored = collections.map((c) => scoreCollection(c, context, resolve));
  scored.sort((a, b) => (b.score - a.score) || (a.collectionId < b.collectionId ? -1 : a.collectionId > b.collectionId ? 1 : 0));
  return limit > 0 ? scored.slice(0, limit) : scored;
}
