/**
 * G6 — Canonical attachment payload contract.
 *
 * Single source of truth for the shape of "an asset attached to a post or
 * thread node" that the API contracts, preview components, scheduler
 * persistence, and publish adapters all agree on.
 *
 * BEFORE this module:
 *   - `components/thread/ThreadSequencePreview.tsx::CreatorAttachment` — UI
 *     shape with `previewUrl` / `thumbnailUrl` / `attachmentMode` / `mediaKind`
 *     sourced from `creator_asset_attachments`.
 *   - `scheduled_posts.media_urls` / `media_types` — flat parallel arrays
 *     stored per-row in the DB; what the adapters consume at publish time.
 *   - `scheduled_posts.creator_attachment_metadata` (JSONB) — publish-time
 *     snapshot of the relational asset state; written by the publisher, not
 *     read at preview time.
 *   - API request bodies — `mediaUrls` / `mediaTypes` / `creatorAttachments`
 *     at the post level only; no per-node carriage.
 *
 * This module defines the canonical shape and the two projection helpers
 * (to-DB-arrays, to-preview-attachment) so any surface that needs to convert
 * BETWEEN representations does it through one place. Adding a new platform
 * field or a new attachment kind requires touching only this file.
 *
 * Per-row vs per-node: the same shape works for single-row posts (root row
 * carries N attachments) and per-thread-node (each child row carries its own
 * N attachments). The orchestrator already publishes per-row via the
 * adapter's `media_urls` read, so per-node propagation only needs the
 * persistence layer to carry per-node arrays into each child row.
 */

export type CanonicalAttachmentKind = 'image' | 'video' | 'gif' | 'audio' | 'document' | 'other';

export type CanonicalAttachmentMode = 'supporting_visual' | 'embedded_copy';

/**
 * Canonical attachment shape. Carries enough for:
 *   - DB persistence (url + mime type → scheduled_posts.media_urls + media_types)
 *   - Preview rendering (preview/thumbnail URLs + kind)
 *   - Adapter consumption (url is the only field adapters strictly require)
 *   - Lineage to the relational owner (assetId pointing into creator_asset_attachments)
 */
export interface CanonicalAttachment {
  /** Stable identifier for this attachment within the post/node. */
  id: string;
  /** Reference into the relational asset owner (creator_asset_attachments.asset_id). */
  assetId: string;
  /** The URL the adapter publishes. Required for DB column projection. */
  url: string;
  /** MIME type (e.g. image/jpeg, video/mp4). Projected into media_types column. */
  mimeType?: string;
  /** Coarse kind for preview rendering decisions. */
  kind?: CanonicalAttachmentKind;
  /** Optional UI helpers — never read by the adapter. */
  previewUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  /** UX-only semantic flag. */
  attachmentMode?: CanonicalAttachmentMode;
}

/** Per-thread-node attachment list, ordered by `position` in the parent node. */
export interface CanonicalNodeAttachments {
  /** 0-indexed; matches ThreadNodePayload.position. */
  nodePosition: number;
  attachments: CanonicalAttachment[];
}

/**
 * Project a list of canonical attachments into the parallel array shape that
 * `scheduled_posts.media_urls` + `media_types` use. Preserves ordering. Drops
 * the `mimeType` field for any attachment that doesn't carry one (URL still
 * goes in; type column entry will be empty for that index).
 */
export function projectAttachmentsToDbArrays(
  attachments: CanonicalAttachment[] | null | undefined,
): { media_urls: string[]; media_types: string[] } {
  const list = Array.isArray(attachments) ? attachments : [];
  const media_urls: string[] = [];
  const media_types: string[] = [];
  for (const a of list) {
    if (!a || typeof a.url !== 'string' || a.url.trim().length === 0) continue;
    media_urls.push(a.url.trim());
    media_types.push(typeof a.mimeType === 'string' ? a.mimeType.trim() : '');
  }
  return { media_urls, media_types };
}

/**
 * Reverse projection: rehydrate canonical attachments from the parallel DB
 * arrays. Used by hydration helpers that load `scheduled_posts` rows and
 * want to expose the same shape that preview / scheduling APIs use.
 *
 * `id` / `assetId` are best-effort: when the relational owner isn't joined,
 * the URL itself is used as a stable id so preview keying stays stable.
 */
export function rehydrateAttachmentsFromDbArrays(input: {
  media_urls: unknown;
  media_types?: unknown;
}): CanonicalAttachment[] {
  const urls = Array.isArray(input.media_urls) ? input.media_urls : [];
  const types = Array.isArray(input.media_types) ? input.media_types : [];
  const out: CanonicalAttachment[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (typeof url !== 'string' || url.trim().length === 0) continue;
    const mimeType = typeof types[i] === 'string' ? (types[i] as string).trim() : undefined;
    out.push({
      id: url, // best-effort stable id when relational owner isn't joined
      assetId: url,
      url: url.trim(),
      mimeType: mimeType || undefined,
      kind: inferKindFromMime(mimeType),
    });
  }
  return out;
}

function inferKindFromMime(mime: string | undefined): CanonicalAttachmentKind | undefined {
  if (!mime) return undefined;
  const lower = mime.toLowerCase();
  if (lower.startsWith('image/gif')) return 'gif';
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('audio/')) return 'audio';
  if (lower.startsWith('application/pdf')) return 'document';
  return 'other';
}

/**
 * Permissive parser for API request bodies that carry attachment lists.
 * Returns a normalized CanonicalAttachment[] or an empty array. Never throws —
 * scheduling endpoints should treat malformed attachment data as "no
 * attachments" rather than rejecting the whole request, since the existing
 * post-level pathway already tolerates missing media.
 */
export function parseCanonicalAttachments(raw: unknown): CanonicalAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url.trim() : '';
    if (!url) continue;
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : url;
    const assetId = typeof obj.assetId === 'string' && obj.assetId.trim() ? obj.assetId.trim() : id;
    const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType.trim() : undefined;
    const kind = isCanonicalKind(obj.kind) ? obj.kind : inferKindFromMime(mimeType);
    out.push({
      id,
      assetId,
      url,
      mimeType: mimeType || undefined,
      kind,
      previewUrl: typeof obj.previewUrl === 'string' ? obj.previewUrl : undefined,
      thumbnailUrl: typeof obj.thumbnailUrl === 'string' ? obj.thumbnailUrl : undefined,
      title: typeof obj.title === 'string' ? obj.title : undefined,
      attachmentMode: isCanonicalMode(obj.attachmentMode) ? obj.attachmentMode : undefined,
    });
  }
  return out;
}

function isCanonicalKind(v: unknown): v is CanonicalAttachmentKind {
  return v === 'image' || v === 'video' || v === 'gif' || v === 'audio' || v === 'document' || v === 'other';
}

function isCanonicalMode(v: unknown): v is CanonicalAttachmentMode {
  return v === 'supporting_visual' || v === 'embedded_copy';
}
