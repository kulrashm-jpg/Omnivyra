/**
 * Template Auto-Selection — canonical, deterministic glue over the existing
 * recommendation engine (CAMPAIGN-006). NO new recommendation system, no
 * renderer/generation/template/gallery change. Decides the active selection
 * (explicit user choice always wins; otherwise preselect the top recommendation)
 * and provides the planning-input signature that gates re-evaluation so cosmetic
 * editor changes never re-recommend.
 */

import type { CreatorTemplate } from './types';
import {
  recommendTemplatesForContext,
  type RecommendationContext,
  type RecommendationResult,
  type TemplateRecommendation,
} from './templateRecommendation';

export type SelectionSource = 'user' | 'recommended' | 'none';

export interface AutoSelection {
  templateId: string | null;
  source: SelectionSource;
  recommendation: TemplateRecommendation | null;
  result: RecommendationResult;
}

/**
 * Deterministic signature of the PLANNING inputs that should trigger
 * re-recommendation (asset family, content type, objective, funnel stage,
 * platform, strategy, industry, audience). Cosmetic/editor-only fields are
 * excluded by construction, so editing copy never re-recommends.
 */
export function recommendationInputKey(ctx: RecommendationContext): string {
  return [ctx.assetFamily, ctx.contentType, ctx.objective, ctx.funnelStage, ctx.platform, ctx.strategy, ctx.industry, ctx.audience]
    .map((x) => String(x ?? '').trim().toLowerCase())
    .join('|');
}

/** True when the planning context materially changed (re-recommend), per the key. */
export function planningContextChanged(prev: RecommendationContext | null, next: RecommendationContext): boolean {
  return prev == null || recommendationInputKey(prev) !== recommendationInputKey(next);
}

/**
 * Resolve the active selection. An explicit, still-valid user selection ALWAYS
 * wins (never overwritten); otherwise the highest-ranked recommendation is
 * auto-preselected. Pure + deterministic.
 */
export function resolveAutoSelection(input: {
  templates: readonly CreatorTemplate[];
  context: RecommendationContext;
  /** The user's explicit selection (persisted), if any. */
  userSelectedId?: string | null;
}): AutoSelection {
  const result = recommendTemplatesForContext(input.templates, input.context);
  const userId = String(input.userSelectedId ?? '').trim();
  if (userId && input.templates.some((t) => t.id === userId)) {
    const rec = result.all.find((r) => r.template.id === userId) ?? null;
    return { templateId: userId, source: 'user', recommendation: rec, result };
  }
  const top = result.recommended;
  return { templateId: top?.template.id ?? null, source: top ? 'recommended' : 'none', recommendation: top, result };
}
