/**
 * Composition Asset Reference — how a canonical asset is USED.
 *
 * Phase 43 established what a file IS (`canonical_media_assets`): tenant-owned,
 * stable identity, reusable. It carries no usage semantics, deliberately. This
 * module is the other half of that decision — the typed relationship that says
 * how one asset is used in one composition.
 *
 *   ASSET      = what the file is        (canonical_media_assets)
 *   REFERENCE  = how it is used here     (composition_asset_references)
 *
 * The split is what makes reuse possible. One uploaded photograph can be the
 * subject of composition 1, the background of composition 2 and an overlay in
 * composition 3, without duplicating a single byte:
 *
 *   Asset A ──┬── Composition 1 → subject    → condition
 *             ├── Composition 2 → background → condition
 *             └── Composition 3 → overlay    → compose
 *
 * CONTRACT ONLY. Nothing routes on this yet: the provider seam
 * (creatorMultimodalReferences / generateProviderImage / images.edit) is
 * untouched, and no existing flow reads these rows. A later phase consumes it.
 */

import type { ReferenceImagePurpose } from '../../backend/services/creator/creatorPromptComposer';

/* ── Mode ───────────────────────────────────────────────────────────────────
 *
 * The single most important distinction the provider spike surfaced. These are
 * NOT styles and NOT cosmetic labels — they are different guarantees, and they
 * eventually route to different machinery:
 *
 *   compose    the supplied pixels are preserved and placed deterministically.
 *              No generative reinterpretation. This is what a brand mark or a
 *              legally-exact logo requires.
 *
 *   condition  the asset becomes model input. Generative reinterpretation is
 *              permitted and expected; there is NO identity or pixel-exact
 *              guarantee. "Use this photo of our founder" lands here.
 *
 * Collapsing them would let a user ask for "my logo" and silently receive a
 * reinterpreted one, which is precisely the failure this type prevents.
 */
export const COMPOSITION_ASSET_MODES = ['compose', 'condition'] as const;
export type CompositionAssetMode = (typeof COMPOSITION_ASSET_MODES)[number];

/* ── Purpose ────────────────────────────────────────────────────────────────
 *
 * ONE vocabulary, not two. The provider already has a purpose type
 * (`ReferenceImagePurpose`, 8 values describing brand/product reference roles).
 * Rather than fork a parallel enum that would immediately drift, the
 * composition vocabulary is a SUPERSET of it: every provider purpose is a legal
 * composition purpose, plus the four roles a user actually chooses when they
 * upload something, which the provider vocabulary cannot express.
 *
 * `PROVIDER_PURPOSE_EXHAUSTIVE` below makes drift a COMPILE ERROR rather than a
 * silent divergence — see the note there.
 */

/** Roles that describe how a user intends their own upload to be used. */
export const COMPOSITION_ONLY_PURPOSES = [
  /** The thing the creative is ABOUT — a person, the hero object. */
  'subject',
  /** The scene behind the composition. */
  'background',
  /** Laid over the composition; the natural `compose`-mode role. */
  'overlay',
  /** A real product photograph — distinct from `product_screenshot`, which is UI. */
  'product',
] as const;

export type CompositionOnlyPurpose = (typeof COMPOSITION_ONLY_PURPOSES)[number];

/** The provider's existing vocabulary, mirrored for runtime validation. */
export const PROVIDER_PURPOSES = [
  'logo',
  'favicon',
  'dashboard',
  'ui_surface',
  'product_screenshot',
  'style_reference',
  'composition_reference',
  'realism_reference',
] as const;

/**
 * Drift guard, enforced by the compiler.
 *
 * A `Record<ReferenceImagePurpose, true>` cannot be satisfied unless every
 * member of the provider union appears here. Add a value to
 * `ReferenceImagePurpose` and this stops compiling until PROVIDER_PURPOSES is
 * updated to match — which is what keeps this a superset rather than a fork.
 */
const PROVIDER_PURPOSE_EXHAUSTIVE: Record<ReferenceImagePurpose, true> = {
  logo: true,
  favicon: true,
  dashboard: true,
  ui_surface: true,
  product_screenshot: true,
  style_reference: true,
  composition_reference: true,
  realism_reference: true,
};
/** Referenced so the guard is not elided as unused. */
export const PROVIDER_PURPOSE_COUNT = Object.keys(PROVIDER_PURPOSE_EXHAUSTIVE).length;

export type CompositionAssetPurpose = ReferenceImagePurpose | CompositionOnlyPurpose;

export const COMPOSITION_ASSET_PURPOSES: readonly CompositionAssetPurpose[] = [
  ...PROVIDER_PURPOSES,
  ...COMPOSITION_ONLY_PURPOSES,
];

/* ── The relationship ───────────────────────────────────────────────────────*/

export interface CompositionAssetReference {
  id: string;
  /**
   * Tenant anchor, and it must equal the referenced asset's company. The schema
   * enforces this structurally with a composite foreign key onto
   * (company_id, id) rather than trusting application code — a company cannot
   * reference another company's asset even by direct SQL.
   */
  companyId: string;
  /**
   * What owns this composition. There is no canonical composition table yet
   * (composition state is still spread across creator_card jsonb,
   * daily_content_plans.content and others), so the owner is identified the way
   * creator_asset_attachments already identifies its own: a type plus an id.
   */
  compositionType: string;
  compositionId: string;
  /** The canonical asset being used. Never a URL, never a storage path. */
  assetId: string;
  purpose: CompositionAssetPurpose;
  mode: CompositionAssetMode;
  /**
   * Ordering within a composition. Ties are permitted — reordering a list would
   * otherwise need temporary values to dodge a unique constraint — so the read
   * layer applies a TOTAL order of (ordinal, createdAt, id). Determinism is a
   * property of the read, and it is tested.
   */
  ordinal: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompositionAssetReferenceInput {
  companyId: string;
  compositionType: string;
  compositionId: string;
  assetId: string;
  purpose: CompositionAssetPurpose;
  mode: CompositionAssetMode;
  ordinal?: number;
}

/**
 * Single shape, not a discriminated union — the root tsconfig sets
 * `"strict": false`, under which narrowing on a boolean discriminant does not
 * hold. Same reasoning as the Phase 43 contract.
 */
export interface ReferenceValidationResult {
  ok: boolean;
  errors: string[];
}

export function isCompositionAssetMode(value: unknown): value is CompositionAssetMode {
  return typeof value === 'string' && (COMPOSITION_ASSET_MODES as readonly string[]).includes(value);
}

export function isCompositionAssetPurpose(value: unknown): value is CompositionAssetPurpose {
  return (
    typeof value === 'string' && (COMPOSITION_ASSET_PURPOSES as readonly string[]).includes(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate a reference payload, reporting every failure rather than the first. */
export function validateCompositionAssetReferenceInput(
  input: Partial<CompositionAssetReferenceInput> | null | undefined,
): ReferenceValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['input is required'] };
  }

  if (!isNonEmptyString(input.companyId)) errors.push('companyId is required');
  if (!isNonEmptyString(input.compositionType)) errors.push('compositionType is required');
  if (!isNonEmptyString(input.compositionId)) errors.push('compositionId is required');
  if (!isNonEmptyString(input.assetId)) errors.push('assetId is required');

  if (!isCompositionAssetPurpose(input.purpose)) {
    errors.push(`purpose must be one of: ${COMPOSITION_ASSET_PURPOSES.join(', ')}`);
  }
  if (!isCompositionAssetMode(input.mode)) {
    errors.push(`mode must be one of: ${COMPOSITION_ASSET_MODES.join(', ')}`);
  }

  if (input.ordinal !== undefined && input.ordinal !== null) {
    if (
      typeof input.ordinal !== 'number' ||
      !Number.isInteger(input.ordinal) ||
      input.ordinal < 0
    ) {
      errors.push('ordinal must be a non-negative integer when supplied');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The total order applied to a composition's references. Exported so callers
 * sort exactly the way the database read does, instead of re-deriving it.
 */
export function compareCompositionAssetReferences(
  a: Pick<CompositionAssetReference, 'ordinal' | 'createdAt' | 'id'>,
  b: Pick<CompositionAssetReference, 'ordinal' | 'createdAt' | 'id'>,
): number {
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
