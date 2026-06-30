/**
 * Curated template gallery provider (CREATOR-125) — the Sample Gallery's data
 * source, now SYSTEM CreatorTemplates instead of marketingSample.
 *
 * It reads the fully-materialized curated templates (CREATOR-124) and applies the
 * SAME goal-affinity selection `marketingSample.listSamplesForGoal` applied —
 * filter by the goal's visual categories, fall back to the full pool when the
 * scoped set is too small — so the gallery's count/order/goal behaviour stays
 * byte-identical. No new derivation: the templates are consumed as-is.
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';
import { CURATED_SYSTEM_TEMPLATES } from './curatedSystemTemplates';
import { goalCategoriesFor } from './goalAffinity';

/**
 * Per-family pool — a plain filter over the PERSISTED SYSTEM templates (CREATOR-126).
 * No runtime materialization, no marketingSample: the templates are loaded as static
 * data and only filtered by family here.
 */
const poolCache = new Map<string, CreatorTemplate[]>();
function curatedPool(family?: TemplateAssetFamily): CreatorTemplate[] {
  const key = family ?? '*';
  let pool = poolCache.get(key);
  if (!pool) {
    pool = family ? CURATED_SYSTEM_TEMPLATES.filter((t) => t.assetFamily === family) : CURATED_SYSTEM_TEMPLATES;
    poolCache.set(key, pool);
  }
  return pool;
}

/**
 * Curated SYSTEM templates for a goal + family, mirroring `listSamplesForGoal`:
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
