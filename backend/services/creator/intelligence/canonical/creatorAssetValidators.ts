/**
 * Canonical Creator Asset — Phase-7 fail-closed validators.
 * ──────────────────────────────────────────────────────────────────────────
 * Every assertion derives from CREATOR_ASSET_REGISTRY. They THROW (fail
 * closed) so an unreconciled / drifted asset can never silently slip
 * through a cutover. Pure: no DB, no scheduler, no clock.
 */

import {
  getCreatorAsset,
  normalizeCreatorAsset,
  resolveCanonicalAdapterKey,
  CREATOR_ASSET_REGISTRY,
} from './creatorAssetRegistry';
import type {
  CreatorAssetDefinition,
  CanonicalAssetKey,
} from './creatorAssetRegistry';

export class CanonicalAssetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CanonicalAssetError';
  }
}

/** Resolve or fail closed. */
export function assertCanonicalAsset(input: unknown): CreatorAssetDefinition {
  const def = getCreatorAsset(input);
  if (!def) {
    throw new CanonicalAssetError(
      'UNKNOWN_CANONICAL_ASSET',
      `No canonical asset for "${String(input)}" — refuse to proceed (drift guard)`,
    );
  }
  return def;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Asserts an asset_payload matches the canonical payload-shape contract
 * for the asset — the SAME predicate the deployed
 * is_valid_creator_daily_content_payload enforces per asset_type.
 */
export function assertPayloadShape(input: unknown, assetPayload: unknown): void {
  const def = assertCanonicalAsset(input);
  const { required_key, json_type } = def.payload_shape_contract;
  if (!isPlainObject(assetPayload)) {
    throw new CanonicalAssetError(
      'PAYLOAD_NOT_OBJECT',
      `asset_payload must be an object for ${def.canonical_key}`,
    );
  }
  const v = (assetPayload as Record<string, unknown>)[required_key];
  const ok = json_type === 'array' ? Array.isArray(v) : isPlainObject(v);
  if (!ok) {
    throw new CanonicalAssetError(
      'PAYLOAD_SHAPE_VIOLATION',
      `${def.canonical_key} requires asset_payload.${required_key} as ${json_type}`,
    );
  }
}

/** Scheduler-bound lane safety: only `immediate` assets may auto-enter
 *  scheduling (image/carousel-family). after_upload/never → throw. */
export function assertSchedulerImmediate(input: unknown): void {
  const def = assertCanonicalAsset(input);
  if (def.scheduler_eligibility !== 'immediate') {
    throw new CanonicalAssetError(
      'SCHEDULER_NOT_IMMEDIATE',
      `${def.canonical_key} is "${def.scheduler_eligibility}" — not eligible for the immediate scheduler lane`,
    );
  }
}

/** Creator/Text isolation guard — refuses text_like assets. */
export function assertNotTextContaminated(input: unknown): void {
  const def = assertCanonicalAsset(input);
  if (def.governance_classification === 'text_like') {
    throw new CanonicalAssetError(
      'TEXT_CONTAMINATION',
      `${def.canonical_key} is text_like — not a BOLT-Creator scheduler-bound asset`,
    );
  }
}

/** Phase-4: every canonical asset MUST resolve to an adapter strategy. */
export function assertAdapterStrategy(input: unknown): void {
  const def = assertCanonicalAsset(input);
  if (resolveCanonicalAdapterKey(def.canonical_key) === null) {
    throw new CanonicalAssetError(
      'NO_ADAPTER_STRATEGY',
      `${def.canonical_key} has no resolvable adapter strategy`,
    );
  }
}

/**
 * Phase-7 internal-consistency audit of the whole registry. Returns the
 * list of issues (empty = fully reconciled). Used by tests + a future
 * boot-time assertion. Deterministic.
 */
export function validateCanonicalReconciliation(): string[] {
  const issues: string[] = [];
  const VALID_FAMILIES = new Set(['image', 'carousel', 'video', 'post_with_asset']);
  const VALID_DB_ENUM = new Set(['image', 'carousel', 'video', 'post_with_asset', 'thread_with_asset']);
  const PAYLOAD_BY_DB: Record<string, { key: string; type: 'object' | 'array' }> = {
    image: { key: 'visual_descriptor', type: 'object' },
    carousel: { key: 'slides', type: 'array' },
    video: { key: 'scenes', type: 'array' },
    post_with_asset: { key: 'caption_blueprint', type: 'object' },
    thread_with_asset: { key: 'caption_blueprint', type: 'object' },
  };
  const seenAlias = new Map<string, CanonicalAssetKey>();

  for (const key of Object.keys(CREATOR_ASSET_REGISTRY) as CanonicalAssetKey[]) {
    const d = CREATOR_ASSET_REGISTRY[key];
    if (d.canonical_key !== key) issues.push(`${key}: canonical_key mismatch`);
    if (!VALID_FAMILIES.has(d.canonical_asset_family)) issues.push(`${key}: bad family ${d.canonical_asset_family}`);
    if (!VALID_DB_ENUM.has(d.db_enum_asset_type)) issues.push(`${key}: bad db_enum ${d.db_enum_asset_type}`);
    const expected = PAYLOAD_BY_DB[d.db_enum_asset_type];
    if (expected && (expected.key !== d.payload_shape_contract.required_key
        || expected.type !== d.payload_shape_contract.json_type)) {
      issues.push(`${key}: payload contract drifts from db_enum ${d.db_enum_asset_type}`);
    }
    if (d.requires_human_production && d.scheduler_eligibility === 'immediate') {
      issues.push(`${key}: human-production asset cannot be scheduler-immediate`);
    }
    // Step-R0: rendering_capability is descriptive only. Valid set has
    // NO 'enabled' member, so this can never enable rendering. Fail
    // closed on any out-of-vocabulary value, and assert family↔modality
    // coherence (image-family must not be future_video, etc).
    if (!['none', 'future_image', 'future_video'].includes(d.rendering_capability)) {
      issues.push(`${key}: invalid rendering_capability "${d.rendering_capability}"`);
    }
    if (d.rendering_capability === 'future_video' && d.canonical_asset_family !== 'video') {
      issues.push(`${key}: future_video must be a video-family asset`);
    }
    if (d.rendering_capability === 'future_image'
        && !['image', 'carousel'].includes(d.canonical_asset_family)) {
      issues.push(`${key}: future_image must be an image/carousel-family asset`);
    }
    if (d.canonical_asset_family === 'post_with_asset' && d.rendering_capability !== 'none') {
      issues.push(`${key}: text_like/post_with_asset must remain rendering 'none'`);
    }
    if (resolveCanonicalAdapterKey(key) === null) issues.push(`${key}: no adapter strategy`);
    // Alias uniqueness — an alias must map to exactly one canonical key.
    for (const rt of [key, ...d.runtime_asset_types]) {
      const prev = seenAlias.get(rt);
      if (prev && prev !== key) issues.push(`alias "${rt}" maps to both ${prev} and ${key}`);
      seenAlias.set(rt, key);
      if (normalizeCreatorAsset(rt) !== key) issues.push(`alias "${rt}" does not normalize to ${key}`);
    }
  }
  return issues;
}
