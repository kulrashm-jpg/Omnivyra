/**
 * Look precedence (PR5 — the selected look drives the image).
 *
 * The look ("How should it look?") and the curated sample (blueprint) are rows of
 * the SAME registry, picked on two different screens. Before this module the
 * sample silently won: it fed the blueprint prompt, the blueprint colour and the
 * showcase reference image, while the look the user picked last was carried as
 * one line among fifty — or dropped in transit.
 *
 * Rule: when a look is picked (and the asset family can render it) the look IS
 * the style. Every `blueprint_*` field is re-derived from the look; the sample
 * only matters when no look was picked. The sample id is kept, as
 * `sample_blueprint_id`, for the audit trail only.
 *
 * Pure + deterministic. No look → the card is returned unchanged (same object).
 */

import { blueprintCreatorCardFields, resolveBlueprintRuntime } from './blueprintRuntimeBridge';
import { sanitizeGuidedChoices } from '../content/guidedCreativeDirection';
import type { TemplateAssetFamily } from '../creator-templates/types';

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The asset family a creator_card is for (banner / slider collapse onto their family). */
export function lookFamilyForCreatorCard(card: Record<string, unknown> | null | undefined): TemplateAssetFamily {
  const raw = String(obj(card).creator_content_asset_type || obj(card).asset_type || '').trim().toLowerCase();
  if (raw === 'carousel' || raw === 'slider' || raw === 'pdf') return 'carousel';
  if (raw === 'infographic') return 'infographic';
  return 'image';
}

/** The look the user picked on this card, if the card's family can render it. */
export function selectedLookIdFromCreatorCard(
  card: Record<string, unknown> | null | undefined,
  family?: TemplateAssetFamily,
): string | null {
  const guided = obj(obj(card).guided_creative);
  const raw = typeof guided.visual_direction_id === 'string' ? guided.visual_direction_id.trim() : '';
  if (!raw) return null;
  const sanitized = sanitizeGuidedChoices({ visualDirectionId: raw }, family ?? lookFamilyForCreatorCard(card));
  return sanitized.visualDirectionId ?? null;
}

/**
 * Re-derive every `blueprint_*` field from the selected look. The previous
 * blueprint id (the curated sample) survives only as `sample_blueprint_id`.
 */
export function applyLookPrecedenceToCreatorCard(
  card: Record<string, unknown>,
  options?: { sampleBlueprintId?: string | null },
): Record<string, unknown> {
  const lookId = selectedLookIdFromCreatorCard(card);
  if (!lookId || !resolveBlueprintRuntime(lookId)) return card;
  const sample = (typeof card.blueprint_id === 'string' && card.blueprint_id.trim())
    || (typeof options?.sampleBlueprintId === 'string' && options.sampleBlueprintId.trim())
    || null;
  if (sample === lookId && card.blueprint_color_primary !== undefined) return card;
  const withoutBlueprint = Object.fromEntries(Object.entries(card).filter(([k]) => !k.startsWith('blueprint_')));
  return {
    ...withoutBlueprint,
    ...blueprintCreatorCardFields(lookId),
    ...(sample && sample !== lookId ? { sample_blueprint_id: sample } : {}),
  };
}
