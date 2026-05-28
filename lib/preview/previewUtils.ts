/**
 * Shared preview utilities (Phase 4 unification).
 *
 * Lightweight helpers consumed across preview surfaces (renderers,
 * dispatchers, payload builders) and creator runtime (BOLT worker,
 * BOLT pipeline). Centralizes:
 *
 *   - platform-key normalization
 *   - attachment URL resolution
 *   - media-bundle URL extraction
 *   - attachment → CreatorAttachment projection
 *
 * Pure, no React, no DB. Safe to import from both client and server
 * surfaces.
 */

import type { CreatorAttachment } from '../../components/thread/ThreadSequencePreview';

/* ── Platform normalization ─────────────────────────────────────────── */

/**
 * Canonical platform-key normalization. Lowercases, trims, and
 * tolerates null / undefined / non-string inputs.
 *
 * `twitter` and `x` are kept as distinct keys at this layer — callers
 * that want them unified do so via the platform card config / renderer
 * dispatcher tables, which both map `twitter` → X renderer.
 */
export function normalizePlatformKey(input: unknown): string {
  return String(input ?? '').toLowerCase().trim();
}

/* ── Attachment URL resolution ──────────────────────────────────────── */

/**
 * Single source of truth for "which URL renders this attachment?"
 * Mirrors the legacy resolver used independently by
 * UnifiedTextPreview, ThreadSequencePreview, and the writer
 * attachment projection helpers.
 *
 *   1. `previewUrl` (when non-empty after trim)
 *   2. `thumbnailUrl` (when non-empty after trim)
 *   3. null
 */
export function pickAttachmentPreviewUrl(attachment: Partial<CreatorAttachment> | null | undefined): string | null {
  if (!attachment) return null;
  if (typeof attachment.previewUrl === 'string' && attachment.previewUrl.trim()) return attachment.previewUrl;
  if (typeof attachment.thumbnailUrl === 'string' && attachment.thumbnailUrl.trim()) return attachment.thumbnailUrl;
  return null;
}

/** Collect renderable preview URLs across an array of attachments. */
export function collectAttachmentPreviewUrls(attachments: ReadonlyArray<Partial<CreatorAttachment>> | null | undefined): string[] {
  if (!attachments) return [];
  return attachments
    .map(pickAttachmentPreviewUrl)
    .filter((u): u is string => Boolean(u));
}

/* ── Media-bundle URL extraction (creator-runtime side) ─────────────── */

/**
 * Extract URLs from a canonical creator output's `asset_payload.media_bundle`.
 * Tolerates string/array/null shapes. Used by:
 *   - creator queue worker BOLT branch (row mutation)
 *   - creator pipeline runtime (final aggregate accounting)
 *   - orchestrator (internal merge)
 */
export function extractCreatorMediaUrls(output: { asset_payload?: unknown } | null | undefined): string[] {
  if (!output) return [];
  const payload = isObject(output.asset_payload) ? output.asset_payload as Record<string, unknown> : {};
  const mediaBundle = isObject(payload.media_bundle) ? payload.media_bundle as Record<string, unknown> : {};
  const url = typeof mediaBundle.url === 'string' ? mediaBundle.url : '';
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.map(String) : [];
  return [url, ...files].map((s) => s.trim()).filter(Boolean);
}

/* ── Writer attachment projection ───────────────────────────────────── */

/**
 * Shape produced by the writer's local-state `WriterAttachedAsset`
 * (lib/content/writerCreatorAssetLaunch.ts). Kept structural so the
 * projection works without importing that type here (the writer module
 * is client-side; this util is dual-environment).
 */
export type WriterAttachedAssetLike = {
  id: string;
  creatorType?: string;
  title?: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  attachmentMode?: 'embedded_copy' | 'supporting_visual' | string;
};

/**
 * Project a writer-state attachment into the canonical CreatorAttachment
 * shape consumed by all preview surfaces. Mirrors the projection
 * previously inlined in ShortformResultPage and ThreadResultView.
 */
export function projectWriterAttachment(asset: WriterAttachedAssetLike): CreatorAttachment {
  const mode = asset.attachmentMode === 'embedded_copy' || asset.attachmentMode === 'supporting_visual'
    ? asset.attachmentMode
    : undefined;
  const mediaKind = asset.previewKind === 'image' || asset.previewKind === 'video' || asset.previewKind === 'gif'
    ? asset.previewKind
    : undefined;
  return {
    id: asset.id,
    assetId: asset.id,
    assetType: asset.creatorType,
    title: asset.title,
    previewUrl: typeof asset.url === 'string' && asset.url.trim() ? asset.url : undefined,
    thumbnailUrl: Array.isArray(asset.files) && asset.files[0] ? String(asset.files[0]) : undefined,
    attachmentMode: mode,
    mediaKind,
  };
}

/* ── Object / array guards ──────────────────────────────────────────── */

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/* ── Media-type inference ───────────────────────────────────────────── */

const VISUAL_MEDIA_CONTENT_TYPES = new Set(['reel', 'short', 'video', 'story', 'image', 'carousel']);

export type NormalizedMediaType = 'image' | 'video' | 'carousel' | 'reel' | 'story' | 'none';

/**
 * Canonical content-type → media-type resolver. Single rule used by
 * every preview payload builder so renderers see the same media-type
 * for a given content type regardless of entry surface.
 */
export function inferMediaType(contentType: string, mediaUrls: ReadonlyArray<string>): NormalizedMediaType {
  const ct = (contentType || '').toLowerCase().trim();
  if (VISUAL_MEDIA_CONTENT_TYPES.has(ct)) {
    if (ct === 'reel' || ct === 'short' || ct === 'video') return 'video';
    if (ct === 'carousel') return 'carousel';
    if (ct === 'story') return 'story';
    return 'image';
  }
  if (mediaUrls.length > 0) return 'image';
  return 'none';
}
