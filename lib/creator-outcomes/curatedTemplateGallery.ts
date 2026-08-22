/**
 * Curated template gallery provider (CREATOR-125) — the Sample Gallery's data
 * source, now SYSTEM CreatorTemplates instead of marketingSample.
 *
 * PHASE-1 (audit B4): the pool is now THE CANONICAL POOL rather than the raw
 * curated registry, so this surface describes the same taxonomy as the template
 * gallery, `/api/creator-templates`, recommendation and collections. The
 * goal-affinity selection itself is unchanged (filter by the goal's visual
 * categories, fall back to the full pool when the scoped set is too small).
 *
 * Card count is preserved: deduplication folds a curated card into its
 * structural canonical AND transfers the showcase preview onto it, so every
 * previously-previewable outcome is still previewable — just once.
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';
import { canonicalTemplatesFor } from './canonicalTemplatePool';
import { goalCategoriesFor } from './goalAffinity';

const FAMILIES: readonly TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

/**
 * Per-family pool over the CANONICAL system templates.
 *
 * This surface is preview-first (one dominant showcase image per outcome), so
 * it scopes to templates that actually have a preview — which is exactly the
 * set it showed before deduplication, and keeps preview-less structural
 * templates out of a gallery that cannot render them.
 */
const poolCache = new Map<string, CreatorTemplate[]>();
function curatedPool(family?: TemplateAssetFamily): CreatorTemplate[] {
  const key = family ?? '*';
  let pool = poolCache.get(key);
  if (!pool) {
    const base = family ? canonicalTemplatesFor(family) : FAMILIES.flatMap((f) => canonicalTemplatesFor(f));
    pool = base.filter((t) => Boolean(t.preview?.thumbnailUrl));
    poolCache.set(key, pool);
  }
  return pool;
}

/** The full preview-bearing canonical pool (optionally scoped to one family). */
export function listCuratedTemplates(family?: TemplateAssetFamily): CreatorTemplate[] {
  return [...curatedPool(family)];
}

/**
 * Canonical SYSTEM templates for a goal + family, mirroring `listSamplesForGoal`:
 * scope to the goal's affined visual categories, but fall back to the full pool
 * when fewer than 4 match (or the goal has no mapping).
 */
export function listCuratedTemplatesForGoal(
  goalId: string | null | undefined,
  family?: TemplateAssetFamily,
): CreatorTemplate[] {
  const pool = curatedPool(family);
  const cats = goalCategoriesFor(goalId);
  const scoped = cats.length ? pool.filter((t) => cats.includes(t.designFamily ?? '')) : pool;
  return scoped.length >= 4 ? scoped : pool;
}
