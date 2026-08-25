/**
 * Persisted SYSTEM CreatorTemplates (CREATOR-126) — the canonical, load-directly
 * source for curated templates. Generated at BUILD time by
 * `scripts/bootstrap-system-templates.ts` (the only place the materializer — and
 * through it marketingSample — runs for the gallery). At app runtime the gallery
 * loads this static data directly: no runtime materialization, no marketingSample.
 *
 * Two artifacts back this:
 *   • system-templates.json          — the COMPLETE records (every CREATOR-124
 *                                       field), the source of truth for generation.
 *   • system-templates.gallery.json  — a LEAN projection (valid CreatorTemplate
 *                                       minus the heavy generation-only optional
 *                                       fields) loaded by the client gallery so it
 *                                       stays lean. THIS module exposes that one.
 */

import type { CreatorTemplate } from '../creator-templates/types';
import galleryData from '../../content/creator-templates/system-templates.gallery.json';
import { withDerivedAssetSlots } from '../creator-templates/templateAssetSlots';

/**
 * Lean, display-complete SYSTEM templates the Sample Gallery renders.
 *
 * Slots are derived HERE, where the pool is constructed, for the same reason
 * the in-code registry derives them at construction: this array is read
 * directly by the canonical pool builder as well as through the resolver, and a
 * curated design that reached one path without slots would accept no reference
 * images at all while its blueprint twin accepted several.
 */
export const CURATED_SYSTEM_TEMPLATES: CreatorTemplate[] =
  (galleryData as unknown as CreatorTemplate[]).map(withDerivedAssetSlots);
