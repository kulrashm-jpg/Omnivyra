/**
 * THE canonical system template pool builder (PHASE-1 / audit finding B4).
 *
 * This is the single place the two system registries are unioned and
 * deduplicated:
 *
 *   lib/creator-templates/systemTemplates.ts        — STRUCTURAL templates
 *   content/creator-templates/*.gallery.json        — CURATED STYLE templates
 *        (via ./curatedSystemTemplates)
 *
 * It lives in `creator-outcomes` because that is the only package that may
 * statically import the curated JSON: `creator-templates/index.ts` is the
 * public barrel and deliberately keeps that dependency lazy to avoid an import
 * cycle. Both sides consume THIS builder, so the gallery, the API,
 * recommendation, collections and outcome discovery cannot diverge.
 *
 * Pure + deterministic + memoised. Data only: it lists templates, it never
 * renders, generates, or mutates one.
 */

import { SYSTEM_TEMPLATES } from '../creator-templates/systemTemplates';
import {
  canonicalizeTemplates,
  type CanonicalizationResult,
} from '../creator-templates/canonicalTaxonomy';
import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';
import { CURATED_SYSTEM_TEMPLATES } from './curatedSystemTemplates';

const FAMILIES: readonly TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];

/** Raw union for a family: STRUCTURAL first, then CURATED (order preserved). */
function rawUnion(family: TemplateAssetFamily): CreatorTemplate[] {
  return [
    ...SYSTEM_TEMPLATES[family],
    ...CURATED_SYSTEM_TEMPLATES.filter((t) => t.assetFamily === family),
  ];
}

const cache = new Map<TemplateAssetFamily, CanonicalizationResult>();

/** The canonicalisation result for one family (memoised — inputs are static). */
export function canonicalPoolFor(family: TemplateAssetFamily): CanonicalizationResult {
  let hit = cache.get(family);
  if (!hit) {
    hit = canonicalizeTemplates(rawUnion(family));
    cache.set(family, hit);
  }
  return hit;
}

/** The deduplicated canonical templates for one family. */
export function canonicalTemplatesFor(family: TemplateAssetFamily): CreatorTemplate[] {
  return canonicalPoolFor(family).templates;
}

/** The deduplicated canonical templates across every family. */
export function allCanonicalTemplates(): CreatorTemplate[] {
  return FAMILIES.flatMap((f) => canonicalTemplatesFor(f));
}

/** legacyId → canonicalId across every family. */
export function canonicalAliasMap(): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const f of FAMILIES) Object.assign(merged, canonicalPoolFor(f).aliases);
  return Object.freeze(merged);
}
