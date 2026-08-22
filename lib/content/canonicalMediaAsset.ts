/**
 * Canonical Media Asset — the domain contract.
 *
 * One tenant-owned file with a stable identity that survives being reused
 * across many compositions. This is the canonical answer to a codebase that
 * had accumulated seven different representations of "an image" (media_files,
 * creator_assets, creator_asset_attachments, content_assets, cms_media_assets,
 * daily_content_plans.uploaded_media_url, MarketingBrief.files) with two
 * incompatible tenancy models and no reusable identity.
 *
 * ADDITIVE FOUNDATION. Nothing here replaces or redirects those; they continue
 * to work untouched. See the migration header for the full disambiguation.
 *
 * NO USAGE SEMANTICS — DELIBERATELY. There is no `usage`, `role`, `purpose`,
 * `subject`, `background`, `overlay` or `logo` field on this type, and adding
 * one would be a design error. The same photograph is the subject in one
 * composition, the background in another and a style reference in a third:
 * usage describes the RELATIONSHIP between an asset and a composition, not the
 * asset. The provider spike also established that usage ROUTES between
 * deterministic composition and generative conditioning, which makes it a
 * decision about a particular use, never a property of the file.
 *
 * Pure types + pure validators. No DB, no fetch, no Node built-ins — safe to
 * import from both client and server, matching this directory's convention.
 */

/**
 * Where the bytes came from. Every value maps to a flow that exists today;
 * none is speculative.
 */
export const MEDIA_ASSET_ORIGINS = ['upload', 'generated', 'stock', 'external'] as const;
export type MediaAssetOrigin = (typeof MEDIA_ASSET_ORIGINS)[number];

/**
 * The minimum lifecycle that stops a consumer treating a half-finished upload
 * as usable. The existing direct-upload path is two-step (stream to storage,
 * then finalize verifies with a range request), so a row can legitimately exist
 * before its bytes are known-good.
 *
 * Deliberately NOT the CREATOR_LIFECYCLE_STATES vocabulary: that tracks a
 * daily_content_plans row moving toward publication, not a file becoming
 * readable. Borrowing those names would conflate two different lifecycles.
 */
export const MEDIA_ASSET_LIFECYCLE_STATES = ['pending', 'ready', 'failed'] as const;
export type MediaAssetLifecycleState = (typeof MEDIA_ASSET_LIFECYCLE_STATES)[number];

/** Legal transitions. `ready` and `failed` are terminal. */
const ALLOWED_TRANSITIONS: Record<MediaAssetLifecycleState, readonly MediaAssetLifecycleState[]> = {
  pending: ['ready', 'failed'],
  ready: [],
  failed: [],
};

export interface CanonicalMediaAsset {
  /**
   * Stable identity. Independent of user, composition, template, campaign,
   * scheduled post, creator asset, URL and filename — each of which was found
   * serving as de-facto identity somewhere, and none of which survives reuse.
   */
  id: string;
  /** Tenant anchor. The ONLY authorization input. */
  companyId: string;
  /** Provenance only — who uploaded. Never an authorization input. */
  createdBy: string | null;

  /** The storage object's own stable identifier, preserved rather than replaced. */
  storageBucket: string;
  storagePath: string;

  mimeType: string;
  /** Nullable until the bytes are measured. Absent means absent — never guessed. */
  byteSize: number | null;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  /** Trace only. Explicitly not identity — filenames collide and change. */
  originalFilename: string | null;
  /** Where the bytes were fetched from, when they came from elsewhere. */
  sourceUrl: string | null;

  origin: MediaAssetOrigin;
  lifecycleState: MediaAssetLifecycleState;

  /** Trace/diagnostic only. Application semantics must not be encoded here. */
  metadata: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
}

/** The caller-supplied half. Identity, lifecycle and timestamps are assigned. */
export interface CanonicalMediaAssetInput {
  companyId: string;
  createdBy?: string | null;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  byteSize?: number | null;
  width?: number | null;
  height?: number | null;
  checksumSha256?: string | null;
  originalFilename?: string | null;
  sourceUrl?: string | null;
  origin: MediaAssetOrigin;
  metadata?: Record<string, unknown>;
}

/**
 * Single shape, not a discriminated union.
 *
 * `{ok:true} | {ok:false; errors}` is the natural modelling here, but this
 * repo's root tsconfig sets `"strict": false`, under which narrowing on a
 * boolean-literal discriminant does not hold — `validation.errors` after
 * `if (!validation.ok)` fails to compile with TS2339. That is a known,
 * recurring trap in this codebase, so the contract avoids depending on it:
 * `errors` is always present and is empty exactly when `ok` is true.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function isMediaAssetOrigin(value: unknown): value is MediaAssetOrigin {
  return typeof value === 'string' && (MEDIA_ASSET_ORIGINS as readonly string[]).includes(value);
}

export function isMediaAssetLifecycleState(value: unknown): value is MediaAssetLifecycleState {
  return (
    typeof value === 'string' &&
    (MEDIA_ASSET_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

/**
 * A pending asset is not usable. This is the whole reason the lifecycle exists,
 * so consumers get one obvious predicate instead of re-deriving the rule.
 */
export function isUsableMediaAsset(asset: Pick<CanonicalMediaAsset, 'lifecycleState'>): boolean {
  return asset.lifecycleState === 'ready';
}

/** Whether a lifecycle move is legal. Terminal states accept nothing. */
export function canTransitionMediaAsset(
  from: MediaAssetLifecycleState,
  to: MediaAssetLifecycleState,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Optional numeric fields must be positive when present. Absent stays absent. */
function validateOptionalPositive(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be a positive number when supplied`);
  }
}

/**
 * Validate a creation payload. Returns every failure rather than the first, so
 * a caller can surface a complete problem list in one pass.
 */
export function validateCanonicalMediaAssetInput(
  input: Partial<CanonicalMediaAssetInput> | null | undefined,
): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['input is required'] };
  }

  // Required — a canonical asset without a tenant, an object or a type is not
  // an asset, it is an orphan row.
  if (!isNonEmptyString(input.companyId)) errors.push('companyId is required');
  if (!isNonEmptyString(input.storageBucket)) errors.push('storageBucket is required');
  if (!isNonEmptyString(input.storagePath)) errors.push('storagePath is required');
  if (!isNonEmptyString(input.mimeType)) errors.push('mimeType is required');

  if (!isMediaAssetOrigin(input.origin)) {
    errors.push(`origin must be one of: ${MEDIA_ASSET_ORIGINS.join(', ')}`);
  }

  validateOptionalPositive(input.byteSize, 'byteSize', errors);
  validateOptionalPositive(input.width, 'width', errors);
  validateOptionalPositive(input.height, 'height', errors);

  if (
    input.metadata !== undefined &&
    (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata))
  ) {
    errors.push('metadata must be an object when supplied');
  }

  return { ok: errors.length === 0, errors };
}
