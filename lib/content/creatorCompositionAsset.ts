/**
 * Content Creator composition assets — the product-facing edge of the canonical
 * asset architecture.
 *
 * Phase 2A settled the persistence: `canonical_media_assets` is what a file IS,
 * `composition_asset_references` is how it is USED, and `CompositionAssetPurpose`
 * is the one persisted usage vocabulary. This module is the thin product layer
 * over that — it decides which of those purposes a Content Creator user is
 * actually offered, and how a Creator draft identifies itself as a composition.
 *
 * It introduces NO new vocabulary and NO new identity concept. Every value it
 * emits is an existing `CompositionAssetPurpose`, and the composition key is the
 * polymorphic (composition_type, composition_id) pair that
 * `composition_asset_references` was deliberately built around.
 *
 * Pure — no DB, no fetch, no Node built-ins. Safe on both sides.
 */

import type { CompositionAssetPurpose, CompositionAssetMode } from './compositionAssetReference';

/* ── Composition identity ───────────────────────────────────────────────────
 *
 * There is no canonical composition table, and Phase 2B deliberately does not
 * add one. `composition_asset_references` anticipated exactly this: its owner is
 * a TYPE plus an ID, the same way `creator_asset_attachments` identifies its
 * own owner, precisely because composition state still lives across
 * `creator_card` jsonb and `daily_content_plans.content`.
 *
 * So a Creator draft identifies itself with a stable token. The REFERENCE rows
 * are server-persisted and tenant-scoped; only the draft's own identifier is
 * held client-side, which is unavoidable while no server-side draft record
 * exists — and is why the asset survives navigation: the client re-reads its
 * references from the server by this key rather than caching the asset itself.
 */
export const CREATOR_COMPOSITION_TYPE = 'creator-composition';

/** sessionStorage key holding the draft token for one creator asset type. */
export function creatorCompositionKey(creatorType: string | null | undefined): string {
  return `creator_composition_id:${String(creatorType ?? 'unknown').trim() || 'unknown'}`;
}

/**
 * Mint a draft composition id. Mirrors the token shape
 * `CreatorAttachmentSession` already uses (`<scope>_<type>_<millis>`) so the two
 * are recognisably the same kind of thing.
 */
export function mintCreatorCompositionId(
  creatorType: string | null | undefined,
  now: number,
  entropy: string,
): string {
  const t = String(creatorType ?? 'unknown').trim() || 'unknown';
  return `creator_${t}_${now}_${entropy}`;
}

/* ── Usage vocabulary exposed to the user ───────────────────────────────────
 *
 * The persisted vocabulary has thirteen values. Six are offered here; the rest
 * stay persistable but unexposed, because they describe things the platform
 * derives rather than things a person choosing an upload means:
 *
 *   favicon · dashboard · ui_surface · product_screenshot
 *       collected automatically from the brand kit and product context by
 *       `collectReferenceImages`. A user uploading a file is not choosing these.
 *
 *   composition_reference · realism_reference
 *       provider-facing distinctions between "borrow this layout" and "match
 *       this level of realism". Offering three near-synonymous "reference"
 *       options would make the picker harder to answer correctly, so the single
 *       user-facing "Style reference" maps to `style_reference` — the one that
 *       means "use this for look and feel", which is what people intend when
 *       they hand over a reference image. The other two remain available to
 *       later phases that have a reason to distinguish them.
 *
 * `subject` and `product` are BOTH offered and are never collapsed: a photograph
 * of a person and a photograph of a product are different intents, and Phase 2B
 * takes that intent from the user rather than inferring it from the image.
 */
export interface CreatorAssetUsageOption {
  /** The persisted value. Always an existing CompositionAssetPurpose. */
  purpose: CompositionAssetPurpose;
  /** What the user reads. */
  label: string;
  /** One line explaining the choice, in the user's terms. */
  hint: string;
}

export const CREATOR_ASSET_USAGE_OPTIONS: readonly CreatorAssetUsageOption[] = Object.freeze([
  {
    purpose: 'subject',
    label: 'Main subject',
    hint: 'The person or thing this is about.',
  },
  {
    purpose: 'product',
    label: 'Product',
    hint: 'A product photo to feature.',
  },
  {
    purpose: 'background',
    label: 'Background',
    hint: 'The scene behind everything else.',
  },
  {
    purpose: 'logo',
    label: 'Logo',
    hint: 'A brand mark to place on the design.',
  },
  {
    purpose: 'supporting',
    label: 'Supporting image',
    hint: 'Sits alongside the subject without being it.',
  },
  {
    purpose: 'style_reference',
    label: 'Style reference',
    hint: 'Guide the look and feel, not the content.',
  },
] as const);

/** The purposes Content Creator offers, in display order. */
export const CREATOR_ASSET_USAGE_PURPOSES: readonly CompositionAssetPurpose[] =
  Object.freeze(CREATOR_ASSET_USAGE_OPTIONS.map((o) => o.purpose));

/** Is this purpose one Content Creator offers? (Persistable ≠ offered.) */
export function isCreatorAssetUsagePurpose(value: unknown): value is CompositionAssetPurpose {
  return typeof value === 'string'
    && (CREATOR_ASSET_USAGE_PURPOSES as readonly string[]).includes(value);
}

/** The option for a purpose, or null when it is persistable but not offered. */
export function creatorAssetUsageOption(
  purpose: CompositionAssetPurpose | string,
): CreatorAssetUsageOption | null {
  return CREATOR_ASSET_USAGE_OPTIONS.find((o) => o.purpose === purpose) ?? null;
}

/** The user-facing label for a purpose; falls back to the raw value. */
export function creatorAssetUsageLabel(purpose: CompositionAssetPurpose | string): string {
  return creatorAssetUsageOption(purpose)?.label ?? String(purpose);
}

/* ── Mode ───────────────────────────────────────────────────────────────────
 *
 * Content Creator writes `compose`: the user supplied these pixels and expects
 * to get them, not a reinterpretation of them. `condition` is the other
 * guarantee — the asset becomes model input and may be reimagined — and it is
 * NOT exposed as a toggle, because "may my logo come back different?" is not a
 * question to put in front of someone.
 *
 * Deriving mode from purpose (a logo composes, a style reference conditions) is
 * a generation-time decision and belongs with the provider wiring, not here.
 */
export const CREATOR_ASSET_DEFAULT_MODE: CompositionAssetMode = 'compose';
