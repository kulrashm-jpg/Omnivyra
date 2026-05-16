/**
 * External Video Runtime — human-production video attach + finalize.
 * ──────────────────────────────────────────────────────────────────────────
 * Registers an externally-produced video into the SHARED-MEDIA lineage
 * and finalizes per-platform reuse — reusing the existing Step-15/16
 * inheritance/override/finalize machinery (a video is just another
 * shared asset). NO AI rendering, no queues, no scheduler awareness.
 *
 * PURE: no DB/network/clock/RNG. The endpoint owns I/O and persists the
 * returned row shapes. Media-only — never reads/writes captions etc.
 */

import { computeDeterministicInputHash } from '../rendering/contracts';
import {
  resolveSharedMediaInheritance,
  finalizeSchedulerMedia,
  type InheritanceOverridePolicy,
  type PlatformOverrideKind,
} from './index';
import {
  isPlatformVideoCompatible,
  type ExternalVideoMeta,
} from './externalVideoCompatibility';

export type ExternalVideoProviderType =
  | 'upload' | 'youtube' | 'vimeo' | 'loom' | 'external_cdn';

export interface AttachExternalVideoInput {
  contentCoreId: string;
  organizationId: string;
  externalVideoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  providerType?: ExternalVideoProviderType;
  uploadedBy?: string | null;
  /** raw creator format (reel|short|video|creator_video). */
  assetType: string;
}

export interface AttachExternalVideoResult {
  /** Deterministic id ⇒ same url+core re-attach is idempotent (no dup
   *  lineage). */
  asset_id: string;
  external_video_row: Record<string, unknown>;
  core_asset_row: Record<string, unknown>;
  attachment_row: Record<string, unknown>;
  events: string[];
}

/** PHASE-1 pure attach: produce the (idempotent) lineage row shapes the
 *  endpoint upserts. asset_id is a stable hash of (core,url). */
export function buildExternalVideoAttachment(
  input: AttachExternalVideoInput,
): AttachExternalVideoResult {
  const url = String(input.externalVideoUrl || '').trim();
  if (!url) throw new Error('externalVideoUrl required');
  const assetId = `extvid:${computeDeterministicInputHash({ core: input.contentCoreId, url })}`;
  const provider = input.providerType ?? 'upload';

  return {
    asset_id: assetId,
    external_video_row: {
      content_core_id: input.contentCoreId,
      asset_id: assetId,
      external_video_url: url,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_seconds: input.durationSeconds ?? null,
      aspect_ratio: input.aspectRatio ?? null,
      provider_type: provider,
      uploaded_by: input.uploadedBy ?? null,
      organization_id: input.organizationId,
    },
    core_asset_row: {
      content_core_id: input.contentCoreId,
      asset_id: assetId,
      asset_type: input.assetType,
      canonical_asset_family: 'video',
      content_spec_hash: computeDeterministicInputHash({ url, dur: input.durationSeconds ?? 0, ar: input.aspectRatio ?? '' }),
      asset_url: url,
      organization_id: input.organizationId,
    },
    attachment_row: {
      content_core_id: input.contentCoreId,
      asset_id: assetId,
      attachment_role: 'primary',
      override_policy: 'inherit_all',
      compatibility_policy: 'registry',
    },
    events: ['external_video_attached'],
  };
}

export interface FinalizeVideoRowInput {
  intentType: string | null | undefined;
  platform: string;
  assetType: string;
  attachment: {
    asset_id: string;
    asset_url: string | null;
    override_policy: InheritanceOverridePolicy;
  } | null;
  videoMeta: ExternalVideoMeta;
  overrides?: Record<string, { kind: PlatformOverrideKind; asset_id?: string; asset_url?: string | null; thumbnail_url?: string | null }>;
  existingUploadedUrl?: string | null;
}

export interface FinalizeVideoRowResult {
  applied: boolean;
  finalized: { platform: string; media_url: string | null; media_source: string } | null;
  content_patch: { uploaded_media_url: string | null; thumbnail_url?: string | null } | null;
  reused: boolean;
  events: string[];
  reason?: string;
}

/**
 * PHASE-3/4/7 per-row finalize for a SHARED external video. Fail-closed
 * video compatibility (duration/aspect/platform) BEFORE any attach.
 * Reuses the shared inheritance resolver + scheduler-safe flattening so
 * scheduler still receives ONLY a finalized url. Creator-only.
 */
export function finalizeRowSharedVideo(
  input: FinalizeVideoRowInput,
): FinalizeVideoRowResult {
  const SKIP: FinalizeVideoRowResult = {
    applied: false, finalized: null, content_patch: null, reused: false, events: [],
  };
  if (String(input.intentType ?? '') !== 'creator') return { ...SKIP, reason: 'not_creator' };
  if (!input.attachment) return { ...SKIP, reason: 'no_attachment' };
  const platform = String(input.platform ?? '').trim().toLowerCase();
  if (!platform) return { ...SKIP, reason: 'no_platform' };

  // PHASE-2 fail-closed video compatibility BEFORE resolution.
  const compat = isPlatformVideoCompatible(platform, input.assetType, input.videoMeta);
  if (!compat.compatible) {
    return {
      applied: false,
      finalized: { platform, media_url: null, media_source: 'incompatible' },
      content_patch: null, reused: false,
      events: ['incompatible_video_skipped'], reason: compat.reason ?? 'incompatible',
    };
  }

  const overrides = input.overrides ?? {};
  const resolved = resolveSharedMediaInheritance({
    // Use the REAL asset type (reel/short/video) so the canonical
    // resolver applies the correct per-format platform support. The
    // video-specific duration/aspect gate already ran fail-closed above.
    assetType: input.assetType,
    sharedAssetId: input.attachment.asset_id,
    targetPlatforms: [platform],
    overridePolicy: input.attachment.override_policy,
    compatibilityPolicy: 'registry',
    overrides,
  });
  const res = resolved.resolutions[0];
  if (!res) return { ...SKIP, reason: 'unresolved' };

  const urlFor = (assetId: string | null): string | null => {
    if (!assetId) return null;
    if (assetId === input.attachment!.asset_id) return input.attachment!.asset_url;
    for (const ov of Object.values(overrides)) {
      if (ov.asset_id === assetId && ov.asset_url) return ov.asset_url;
    }
    return null;
  };
  const finalized = finalizeSchedulerMedia([res], urlFor)[0]!;
  const ovThumb = overrides[platform]?.thumbnail_url ?? null;

  const events: string[] = ['shared_video_inherited'];
  if (res.source === 'overridden_replaced' || res.source === 'overridden_disabled') {
    events.push('video_override_applied');
  }

  // Reuse: identical inherited url already on the row ⇒ no duplicate.
  if (
    res.source === 'inherited' &&
    finalized.media_url &&
    input.existingUploadedUrl &&
    input.existingUploadedUrl === finalized.media_url
  ) {
    events.push('shared_video_reused');
    return { applied: false, finalized, content_patch: null, reused: true, events };
  }

  if (finalized.media_url == null) {
    return {
      applied: true, finalized,
      content_patch: { uploaded_media_url: null },
      reused: false, events,
    };
  }
  return {
    applied: true, finalized,
    content_patch: {
      uploaded_media_url: finalized.media_url,
      ...(ovThumb ? { thumbnail_url: ovThumb } : {}),
    },
    reused: false, events,
  };
}
