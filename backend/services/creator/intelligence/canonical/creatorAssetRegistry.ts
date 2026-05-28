/**
 * Canonical Creator Asset Registry — Step-13 single source of truth.
 * ──────────────────────────────────────────────────────────────────────────
 * Eliminates the long-standing drift between asset_family / asset_type /
 * DB enums / governance registry / scheduler eligibility / platform
 * capability / adapter registry. EVERY creator-asset decision should
 * derive from this ONE table instead of scattered conditionals.
 *
 * Reconciled against the deployed truth:
 *   - lib/shared/creatorGovernanceRegistry  (formats, aliases, human-prod)
 *   - is_valid_creator_daily_content_payload (DB asset_type + payload shape)
 *   - creatorAdapterRegistry                 (image/carousel/video adapters)
 *   - Step-7/9 scheduler-boundary behavior   (image/carousel immediate;
 *     reel/video after upload; creator_post never in the isolated lane)
 *
 * PURE: no DB, no scheduler, no clock, no random. Deterministic.
 * ADDITIVE: importing this changes nothing until callers opt in. The
 * `rendering_capability` field is DESCRIPTIVE (none|future_image|
 * future_video) — it has no 'enabled' state, so nothing here enables
 * rendering; render pipelines are a later phase.
 */

export type CanonicalAssetKey =
  | 'image'
  | 'carousel'
  | 'infographic'
  | 'story'
  | 'reel'
  | 'short'
  | 'video'
  | 'creator_post';

/** Families the DB constraint + adapters speak. */
export type CanonicalAssetFamily =
  | 'image'
  | 'carousel'
  | 'video'
  | 'post_with_asset';

export type GovernanceClassification =
  | 'autonomous'           // AI/human producible, scheduler-immediate
  | 'attachment_required'  // human production, schedulable AFTER upload
  | 'text_like';           // not a BOLT-Creator scheduler-bound asset

export type SchedulerEligibility = 'immediate' | 'after_upload' | 'never';

export type CanonicalAdapterKey = 'image' | 'carousel' | 'video';

/**
 * Step-R0 registry extension. DESCRIPTIVE ONLY — there is deliberately
 * NO "enabled" member, so widening this enum cannot enable rendering.
 *   none         → never rendered (text_like)
 *   future_image → image-modality rendering will apply in a later phase
 *   future_video → video-modality rendering will apply in a later phase
 * No runtime path gates on this value (verified Step-R0); changing it is
 * metadata-only and behavior-preserving.
 */
export type RenderingCapability = 'none' | 'future_image' | 'future_video';

export interface PayloadShapeContract {
  /** The asset_payload key the deployed constraint requires. */
  required_key: string;
  json_type: 'object' | 'array';
}

/**
 * Render strategy for the orchestrator (Phase 3 unification).
 *   queue   — multi-slide / heavy → enqueueDurableCreatorRenderJob
 *   inline  — single visual → renderAsset() synchronous
 *   skipped — attachment-required or text-like; no auto-render
 */
export type RenderStrategy = 'queue' | 'inline' | 'skipped';

/**
 * Writer-flow source eligibility (Phase 1 unification). A canonical
 * asset may be attachable from post writers, thread writers, both, or
 * neither. Derived selectors use this to produce POST_CREATOR_ASSET_TYPES
 * and THREAD_CREATOR_ASSET_TYPES without parallel hardcoded arrays.
 */
export type WriterSourceKey = 'post' | 'thread';

export interface CreatorAssetDefinition {
  canonical_key: CanonicalAssetKey;
  canonical_asset_family: CanonicalAssetFamily;
  /** Governance/runtime format strings + legacy/platform aliases that
   *  normalize to this canonical asset. */
  runtime_asset_types: string[];
  /** asset_type written to daily_content_plans + validated by
   *  is_valid_creator_daily_content_payload. */
  db_enum_asset_type: string;
  governance_classification: GovernanceClassification;
  scheduler_eligibility: SchedulerEligibility;
  requires_human_production: boolean;
  /** Step-R0: descriptive future-render modality. No 'enabled' state
   *  exists, so this never enables rendering (no behavior change). */
  rendering_capability: RenderingCapability;
  /** Reconciled in-app platform view (normalized keys). The deployed
   *  is_valid_creator_platform_asset_combo remains the final authority
   *  at insert time — this is the pre-flight/UX gate, not a substitute. */
  platform_support: string[];
  /** Concrete adapter strategy. `null` ⇒ no first-class adapter; use
   *  `resolveCanonicalAdapterKey` for the safe fallback. */
  adapter_mapping: CanonicalAdapterKey | null;
  payload_shape_contract: PayloadShapeContract;
  /**
   * Phase 1 unification — writer-side presentational subtypes that map
   * TO this canonical entry. e.g. canonical `image` exposes
   * supporting_image / banner / brand_card to the writer. Empty means
   * the canonical asset is not attachable from a writer.
   *
   * The writer-side type union (`WriterCreatorAssetType`) is now
   * derived from the union of these arrays; adding a subtype here
   * propagates to writer eligibility, attachment validation, and route
   * resolution without parallel arrays.
   */
  writer_attachment_subtypes: string[];
  /**
   * Phase 1 unification — which writer sources may attach this asset.
   * Empty ⇒ not writer-attachable. Used by selectors
   * `getPostAllowedAssetTypes` / `getThreadAllowedAssetTypes`.
   */
  writer_source_eligibility: WriterSourceKey[];
  /**
   * Phase 3 unification — render dispatch strategy. The orchestrator
   * uses this single field to decide queue vs inline render across all
   * three flows (Direct, BOLT, queue processor). Eliminates the prior
   * asymmetry where Direct queued multi-slide while BOLT rendered
   * everything inline.
   */
  render_strategy: RenderStrategy;
}

const ALL = ['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'pinterest', 'threads'];

export const CREATOR_ASSET_REGISTRY: Record<CanonicalAssetKey, CreatorAssetDefinition> = {
  image: {
    canonical_key: 'image',
    canonical_asset_family: 'image',
    runtime_asset_types: ['image', 'banner', 'graphic', 'visual', 'photo', 'supporting_image', 'brand_card'],
    db_enum_asset_type: 'image',
    governance_classification: 'autonomous',
    scheduler_eligibility: 'immediate',
    requires_human_production: false,
    rendering_capability: 'future_image',
    platform_support: ['linkedin', 'instagram', 'facebook', 'x', 'pinterest', 'threads'],
    adapter_mapping: 'image',
    payload_shape_contract: { required_key: 'visual_descriptor', json_type: 'object' },
    writer_attachment_subtypes: ['supporting_image', 'banner', 'brand_card'],
    writer_source_eligibility: ['post', 'thread'],
    render_strategy: 'inline',
  },
  carousel: {
    canonical_key: 'carousel',
    canonical_asset_family: 'carousel',
    runtime_asset_types: ['carousel', 'pdf', 'slider', 'slides', 'slide', 'deck', 'presentation'],
    db_enum_asset_type: 'carousel',
    governance_classification: 'autonomous',
    scheduler_eligibility: 'immediate',
    requires_human_production: false,
    rendering_capability: 'future_image',
    platform_support: ['linkedin', 'instagram', 'facebook', 'x'],
    adapter_mapping: 'carousel',
    payload_shape_contract: { required_key: 'slides', json_type: 'array' },
    writer_attachment_subtypes: ['carousel'],
    // Carousel is sequence-oriented and aligns with thread storytelling
    // only. Post flow stays single-attachment by contract; carousel must
    // not surface there. See validateAttachmentPayload for the matching
    // server-side guard.
    writer_source_eligibility: ['thread'],
    render_strategy: 'queue',
  },
  infographic: {
    canonical_key: 'infographic',
    canonical_asset_family: 'image',
    runtime_asset_types: ['infographic'],
    db_enum_asset_type: 'image',
    governance_classification: 'autonomous',
    scheduler_eligibility: 'immediate',
    requires_human_production: false,
    rendering_capability: 'future_image',
    platform_support: ['linkedin', 'instagram', 'facebook'],
    adapter_mapping: 'image',
    payload_shape_contract: { required_key: 'visual_descriptor', json_type: 'object' },
    writer_attachment_subtypes: ['infographic'],
    writer_source_eligibility: ['post', 'thread'],
    render_strategy: 'queue',
  },
  story: {
    canonical_key: 'story',
    canonical_asset_family: 'image',
    runtime_asset_types: ['story', 'stories'],
    db_enum_asset_type: 'image',
    governance_classification: 'autonomous',
    scheduler_eligibility: 'immediate',
    requires_human_production: false,
    rendering_capability: 'future_image',
    platform_support: ['instagram', 'facebook'],
    adapter_mapping: 'image',
    payload_shape_contract: { required_key: 'visual_descriptor', json_type: 'object' },
    writer_attachment_subtypes: [],
    writer_source_eligibility: [],
    render_strategy: 'inline',
  },
  reel: {
    canonical_key: 'reel',
    canonical_asset_family: 'video',
    runtime_asset_types: ['reel', 'reels', 'instagram_reels', 'instagram_reel', 'fb_reel'],
    db_enum_asset_type: 'video',
    governance_classification: 'attachment_required',
    scheduler_eligibility: 'after_upload',
    requires_human_production: true,
    rendering_capability: 'future_video',
    platform_support: ['instagram', 'facebook'],
    adapter_mapping: 'video',
    payload_shape_contract: { required_key: 'scenes', json_type: 'array' },
    writer_attachment_subtypes: [],
    writer_source_eligibility: [],
    render_strategy: 'skipped',
  },
  short: {
    canonical_key: 'short',
    canonical_asset_family: 'video',
    runtime_asset_types: ['short', 'shorts', 'youtube_short', 'youtube_shorts', 'tiktok'],
    db_enum_asset_type: 'video',
    governance_classification: 'attachment_required',
    scheduler_eligibility: 'after_upload',
    requires_human_production: true,
    rendering_capability: 'future_video',
    platform_support: ['tiktok', 'youtube', 'instagram'],
    adapter_mapping: 'video',
    payload_shape_contract: { required_key: 'scenes', json_type: 'array' },
    writer_attachment_subtypes: [],
    writer_source_eligibility: [],
    render_strategy: 'skipped',
  },
  video: {
    canonical_key: 'video',
    canonical_asset_family: 'video',
    runtime_asset_types: ['video'],
    db_enum_asset_type: 'video',
    governance_classification: 'attachment_required',
    scheduler_eligibility: 'after_upload',
    requires_human_production: true,
    rendering_capability: 'future_video',
    platform_support: ['youtube', 'linkedin', 'facebook'],
    adapter_mapping: 'video',
    payload_shape_contract: { required_key: 'scenes', json_type: 'array' },
    writer_attachment_subtypes: [],
    writer_source_eligibility: [],
    render_strategy: 'skipped',
  },
  creator_post: {
    canonical_key: 'creator_post',
    canonical_asset_family: 'post_with_asset',
    runtime_asset_types: ['creator_post', 'post_with_asset', 'thread_with_asset'],
    db_enum_asset_type: 'post_with_asset',
    // Not a BOLT-Creator scheduler-bound asset in the isolated lane
    // (Step-7 scheduler-binds image/carousel only). Modelled for
    // completeness + safe normalization, never auto-scheduled here.
    governance_classification: 'text_like',
    scheduler_eligibility: 'never',
    requires_human_production: false,
    rendering_capability: 'none',
    platform_support: ['linkedin', 'x', 'facebook', 'threads'],
    adapter_mapping: null, // no first-class adapter — see resolveCanonicalAdapterKey
    payload_shape_contract: { required_key: 'caption_blueprint', json_type: 'object' },
    writer_attachment_subtypes: [],
    writer_source_eligibility: [],
    render_strategy: 'skipped',
  },
};

/** Alias → canonical key. Built from the registry's runtime_asset_types
 *  plus the governance FORMAT_ALIASES + platform-ish aliases, reconciled.
 *  Deterministic; unknown input → null. */
const ALIAS_TO_CANONICAL: Record<string, CanonicalAssetKey> = (() => {
  const map: Record<string, CanonicalAssetKey> = {};
  for (const key of Object.keys(CREATOR_ASSET_REGISTRY) as CanonicalAssetKey[]) {
    map[key] = key;
    for (const rt of CREATOR_ASSET_REGISTRY[key].runtime_asset_types) {
      map[rt] = key;
    }
  }
  return map;
})();

function canon(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');
}

/**
 * PHASE-2 normalization. Resolves legacy / platform / runtime aliases to
 * exactly ONE canonical asset key. Deterministic; `null` for anything
 * unrecognized (callers fail closed). Examples:
 *   reels → reel · youtube_short → short · instagram_reels → reel ·
 *   slides → carousel · graphic → image · post_with_asset → creator_post
 */
export function normalizeCreatorAsset(input: unknown): CanonicalAssetKey | null {
  const k = canon(input);
  if (!k) return null;
  return ALIAS_TO_CANONICAL[k] ?? null;
}

export function getCreatorAsset(input: unknown): CreatorAssetDefinition | null {
  const key = normalizeCreatorAsset(input);
  return key ? CREATOR_ASSET_REGISTRY[key] : null;
}

/* ── PHASE-3 governance reconciliation ─────────────────────────────────── */

export function getCanonicalAssetFamily(input: unknown): CanonicalAssetFamily | null {
  return getCreatorAsset(input)?.canonical_asset_family ?? null;
}
export function getDbEnumAssetType(input: unknown): string | null {
  return getCreatorAsset(input)?.db_enum_asset_type ?? null;
}
export function getGovernanceClassification(input: unknown): GovernanceClassification | null {
  return getCreatorAsset(input)?.governance_classification ?? null;
}
/** Step-R0: descriptive future-render modality. Has NO 'enabled' state
 *  → callers cannot use it to turn rendering on. */
export function getRenderingCapability(input: unknown): RenderingCapability | null {
  return getCreatorAsset(input)?.rendering_capability ?? null;
}
/** Convenience: would this asset render as image/video later? Never
 *  implies rendering is enabled NOW. */
export function rendersAsImageLater(input: unknown): boolean {
  return getCreatorAsset(input)?.rendering_capability === 'future_image';
}
export function rendersAsVideoLater(input: unknown): boolean {
  return getCreatorAsset(input)?.rendering_capability === 'future_video';
}
/** Creator/Text isolation: text_like assets are NOT BOLT-Creator
 *  scheduler-bound. (creator_post is the only text_like canonical.) */
export function isTextLikeAsset(input: unknown): boolean {
  return getCreatorAsset(input)?.governance_classification === 'text_like';
}

/**
 * Human-production truth. Accepts MULTIPLE candidate signals (format,
 * asset_type, family) and returns true if ANY resolves to a
 * human-production canonical asset — preserving the historical
 * `fmt || asset_type === 'video'` OR-semantics while sourcing the answer
 * centrally (Phase-8 behavior-preserving).
 */
export function isHumanProductionAsset(...candidates: unknown[]): boolean {
  for (const c of candidates) {
    const def = getCreatorAsset(c);
    if (def?.requires_human_production) return true;
  }
  return false;
}

/* ── PHASE-5 scheduler eligibility ─────────────────────────────────────── */

export function getSchedulerEligibility(input: unknown): SchedulerEligibility | null {
  return getCreatorAsset(input)?.scheduler_eligibility ?? null;
}
/** Base capability: schedulable immediately (image/carousel-family).
 *  after_upload / never / unknown ⇒ false. The lifecycle layer still
 *  gates on production_status — this is the asset-level gate only. */
export function isSchedulerImmediate(input: unknown): boolean {
  return getCreatorAsset(input)?.scheduler_eligibility === 'immediate';
}
export function requiresMediaUploadBeforeSchedule(input: unknown): boolean {
  return getCreatorAsset(input)?.scheduler_eligibility === 'after_upload';
}

/* ── PHASE-4 adapter reconciliation ────────────────────────────────────── */

/**
 * Every canonical asset has a DEFINED adapter strategy. First-class
 * mapping when present; otherwise the safe family fallback so a future
 * cutover stays deterministic and never crashes:
 *   image-family   → 'image'
 *   carousel-family → 'carousel'
 *   video-family    → 'video'
 *   post_with_asset → 'image' (Step-13 spec: post_with_asset → image)
 */
export function resolveCanonicalAdapterKey(input: unknown): CanonicalAdapterKey | null {
  const def = getCreatorAsset(input);
  if (!def) return null;
  if (def.adapter_mapping) return def.adapter_mapping;
  switch (def.canonical_asset_family) {
    case 'image': return 'image';
    case 'carousel': return 'carousel';
    case 'video': return 'video';
    case 'post_with_asset': return 'image';
    default: return null;
  }
}

/* ── PHASE-6 platform capability ───────────────────────────────────────── */

/** Local platform normalization mirroring weekly-structure-helpers
 *  (twitter → x) so callers don't need to import that module. */
export function normalizeAssetPlatformKey(platform: unknown): string {
  const p = canon(platform).replace(/_/g, '');
  if (p === 'twitter') return 'x';
  if (p === 'instagramreels' || p === 'igreels') return 'instagram';
  if (p === 'youtubeshorts') return 'youtube';
  return canon(platform);
}
export function isPlatformSupported(input: unknown, platform: unknown): boolean {
  const def = getCreatorAsset(input);
  if (!def) return false;
  return def.platform_support.includes(normalizeAssetPlatformKey(platform));
}
export function getPlatformSupport(input: unknown): string[] {
  return getCreatorAsset(input)?.platform_support.slice() ?? [];
}

export { ALL as CANONICAL_KNOWN_PLATFORMS };

/* ── PHASE-7 derived selectors (registry as single source of truth) ───── */

const REGISTRY_ENTRIES = Object.values(CREATOR_ASSET_REGISTRY) as CreatorAssetDefinition[];

/**
 * Writer-side presentational subtype → canonical key. Inverted from the
 * `writer_attachment_subtypes` field on each canonical entry so the
 * mapping always reflects the canonical source.
 */
const WRITER_SUBTYPE_TO_CANONICAL: Record<string, CanonicalAssetKey> = (() => {
  const map: Record<string, CanonicalAssetKey> = {};
  for (const def of REGISTRY_ENTRIES) {
    for (const subtype of def.writer_attachment_subtypes) {
      map[subtype] = def.canonical_key;
    }
  }
  return map;
})();

/**
 * Every writer-attachable asset subtype derived from the canonical
 * registry. Replaces hand-maintained WRITER_CREATOR_ASSET_TYPES /
 * POST_CREATOR_ASSET_TYPES / THREAD_CREATOR_ASSET_TYPES arrays. Adding
 * a subtype on a canonical entry propagates here automatically.
 */
export function getWriterAllowedAssetTypes(): readonly string[] {
  const out: string[] = [];
  for (const def of REGISTRY_ENTRIES) {
    for (const subtype of def.writer_attachment_subtypes) {
      if (!out.includes(subtype)) out.push(subtype);
    }
  }
  return out;
}

export function getPostAllowedAssetTypes(): readonly string[] {
  const out: string[] = [];
  for (const def of REGISTRY_ENTRIES) {
    if (!def.writer_source_eligibility.includes('post')) continue;
    for (const subtype of def.writer_attachment_subtypes) {
      if (!out.includes(subtype)) out.push(subtype);
    }
  }
  return out;
}

export function getThreadAllowedAssetTypes(): readonly string[] {
  const out: string[] = [];
  for (const def of REGISTRY_ENTRIES) {
    if (!def.writer_source_eligibility.includes('thread')) continue;
    for (const subtype of def.writer_attachment_subtypes) {
      if (!out.includes(subtype)) out.push(subtype);
    }
  }
  return out;
}

/** Canonical assets the platform supports (derived from platform_support arrays). */
export function getCapabilitySupportedAssetTypes(platform: unknown): CanonicalAssetKey[] {
  const normalized = normalizeAssetPlatformKey(platform);
  if (!normalized) return [];
  return REGISTRY_ENTRIES
    .filter((def) => def.platform_support.includes(normalized))
    .map((def) => def.canonical_key);
}

/** Canonical assets that have an active adapter mapping (image/carousel/video). */
export function getRenderableCreatorTypes(): CanonicalAssetKey[] {
  return REGISTRY_ENTRIES
    .filter((def) => def.render_strategy !== 'skipped')
    .map((def) => def.canonical_key);
}

/** Canonical assets that expose at least one writer-attachable subtype. */
export function getAttachmentEligibleTypes(): CanonicalAssetKey[] {
  return REGISTRY_ENTRIES
    .filter((def) => def.writer_attachment_subtypes.length > 0)
    .map((def) => def.canonical_key);
}

/**
 * Look up the canonical key for a writer-side subtype. Returns null for
 * unknown subtypes (callers fail closed).
 */
export function getCanonicalForWriterSubtype(subtype: unknown): CanonicalAssetKey | null {
  const k = canon(subtype);
  return (WRITER_SUBTYPE_TO_CANONICAL[k] ?? null) as CanonicalAssetKey | null;
}

/**
 * Phase 3 unification — single render-strategy resolver consumed by the
 * orchestrator. Accepts canonical keys, runtime aliases, OR writer
 * subtypes; resolves through the registry so all three flows (Direct,
 * BOLT, queue) agree on queue vs inline vs skipped.
 */
export function resolveRenderStrategy(input: unknown): RenderStrategy {
  const canonKey = normalizeCreatorAsset(input);
  if (canonKey) return CREATOR_ASSET_REGISTRY[canonKey].render_strategy;
  const writerCanon = getCanonicalForWriterSubtype(input);
  if (writerCanon) return CREATOR_ASSET_REGISTRY[writerCanon].render_strategy;
  return 'skipped';
}

/**
 * Coerce a writer-side subtype to its canonical key. Falls back to
 * `normalizeCreatorAsset` for runtime aliases, then to null.
 */
export function resolveWriterOrCanonical(input: unknown): CanonicalAssetKey | null {
  const direct = normalizeCreatorAsset(input);
  if (direct) return direct;
  return getCanonicalForWriterSubtype(input);
}
