/**
 * Render-metadata projection of the user's look (PR5 — the selected look drives
 * the image).
 *
 * The look rides on `creator_card.guided_creative.visual_direction_id`, and the
 * renderer reads it from `media_bundle.metadata` — but the execution engine
 * copied neither `creator_card` nor `guided_creative` onto that metadata, so the
 * look was dropped in transit and the renderer always saw "no look". This is
 * the one projection the engine spreads onto render metadata.
 *
 * Also returns the look-derived `blueprint_id` / `blueprint_color_primary` (only
 * when a look is set), so the infographic accent, the workspace reference and
 * every other `blueprint_*` reader follow the look rather than the sample.
 *
 * Pure. No look and no subset fields → `{ guided_creative: null, creator_card: {}, look_variation: null }`.
 */

import { applyLookPrecedenceToCreatorCard, selectedLookIdFromCreatorCard } from '../../../lib/creator-outcomes/lookPrecedence';

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The creator_card keys the renderer reads (purpose key, brand mode, the look). */
const RENDER_CARD_KEYS = ['subtype', 'purpose_key', 'brand_mode', 'guided_creative', 'look_variation'] as const;

export function buildCreatorLookRenderMetadata(creatorCard: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const card = obj(creatorCard);
  const guided = obj(card.guided_creative);
  const lookVariation = obj(card.look_variation);
  const subset: Record<string, unknown> = {};
  for (const key of RENDER_CARD_KEYS) {
    const value = card[key];
    if (value === undefined || value === null || value === '') continue;
    subset[key] = value;
  }
  const out: Record<string, unknown> = {
    guided_creative: Object.keys(guided).length > 0 ? guided : null,
    creator_card: subset,
    look_variation: Object.keys(lookVariation).length > 0 ? lookVariation : null,
  };
  const lookId = selectedLookIdFromCreatorCard(card);
  if (lookId) {
    const effective = applyLookPrecedenceToCreatorCard(card);
    const blueprintId = str(effective.blueprint_id);
    if (blueprintId === lookId) {
      out.blueprint_id = blueprintId;
      out.blueprint_color_primary = str(effective.blueprint_color_primary);
      out.sample_blueprint_id = str(effective.sample_blueprint_id) ?? (str(card.blueprint_id) !== lookId ? str(card.blueprint_id) : null);
    }
  }
  return out;
}

/** The blueprint id the copy prompt should assemble directives from: the look when set, else the sample. */
export function effectiveBlueprintIdForCreatorCard(creatorCard: Record<string, unknown> | null | undefined): string | null {
  const card = obj(creatorCard);
  const lookId = selectedLookIdFromCreatorCard(card);
  if (lookId) {
    const effective = applyLookPrecedenceToCreatorCard(card);
    if (str(effective.blueprint_id) === lookId) return lookId;
  }
  return str(card.blueprint_id);
}
