/**
 * Normalized Preview Payload (Phase 3 unification).
 *
 * Single contract consumed by every preview surface:
 *   - PostPreviewModal (calendar / day-detail / activity workspace)
 *   - WriterEmbeddedPreview (post + thread writer pages)
 *   - PreviewCard (multi-platform repurpose quick-QA)
 *   - per-platform faithful renderers in components/preview/platforms/
 *
 * Reuses the existing `ThreadNode` + `CreatorAttachment` types from the
 * Phase G9 unified contract so a normalized payload can be projected
 * from EITHER a calendar-style `ActivityEvent` OR a writer's local
 * state (post text + attached assets, or thread segments + per-node
 * attachments) WITHOUT separate type lineages.
 */

import type {
  CreatorAttachment,
  ThreadNode,
} from '../../components/thread/ThreadSequencePreview';
import {
  collectAttachmentPreviewUrls,
  inferMediaType,
  normalizePlatformKey,
  pickAttachmentPreviewUrl,
  type NormalizedMediaType,
} from './previewUtils';

export type NormalizedPreviewSurface = 'calendar' | 'writer' | 'thread-node' | 'preview-card';

export type NormalizedPreviewStyle = 'platform-faithful' | 'generic-card';

export type NormalizedPreviewPayload = {
  /** Lowercase canonical platform key. */
  platform: string;
  /** Resolved content type (post / thread / image / carousel / reel / etc.). */
  contentType: string;
  /** Display-only platform-native content-type label (e.g. "Post with asset"). */
  contentTypeLabel?: string;

  /** Primary text body. Always trimmed; null when no caption. */
  content: string | null;
  /** Optional title — used for articles, LinkedIn-Article cards, Pinterest pins, YouTube videos. */
  title?: string | null;

  /** Author display info; defaults applied when omitted. */
  authorName?: string;
  authorHandle?: string;
  scheduledDate?: string;
  status?: string | null;
  isOverdue?: boolean;

  /** Media — pre-merged from event.media_urls + attached creator assets. */
  mediaUrls: string[];
  /** Per-asset structured attachments (badges for non-media assets, semantic info). */
  attachedAssets: CreatorAttachment[];
  /** Optional media type hint (image / video / carousel / reel / story). */
  mediaType?: 'image' | 'video' | 'carousel' | 'reel' | 'story' | 'none';

  /** Thread mode toggle + ordered nodes. When `isThread` is true, thread renderer runs. */
  isThread: boolean;
  threadNodes?: ThreadNode[];

  /** Surface hint — drives which extra affordances are rendered. */
  surface: NormalizedPreviewSurface;
  /** Style hint — driver for which renderer family. */
  style: NormalizedPreviewStyle;

  /** Optional platform constraint envelope (char limit / hashtag limit). */
  charLimit?: number | null;

  /** Extension surface for renderer-specific metadata (engagement counts, etc.). */
  metadata?: Record<string, unknown>;
};

/* ── Builders ───────────────────────────────────────────────────────── */
// Platform-key normalization, media-type inference, and attachment URL
// resolution all flow through the shared `previewUtils` module so every
// preview surface (modal / writer / preview card / unified preview)
// agrees on the same rules.

/**
 * Build a normalized payload from a calendar-style ActivityEvent. Used by
 * PostPreviewModal and any other calendar/dashboard surface.
 */
export function buildPreviewPayloadFromActivityEvent(input: {
  event: {
    platform: string;
    title?: string;
    content?: string | null;
    content_type: string;
    asset_type?: string;
    scheduled_for?: string | null;
    date?: string;
    status?: string;
    is_overdue?: boolean;
    media_urls?: string[];
    media_types?: string[];
  };
  /** Pre-resolved canonical display content type (asset_type fallback). */
  contentType: string;
  contentTypeLabel?: string;
}): NormalizedPreviewPayload {
  const platform = normalizePlatformKey(input.event.platform);
  const mediaUrls = (input.event.media_urls ?? []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  return {
    platform,
    contentType: input.contentType,
    contentTypeLabel: input.contentTypeLabel,
    content: input.event.content?.trim() || null,
    title: input.event.title ?? null,
    scheduledDate: input.event.scheduled_for
      ? new Date(input.event.scheduled_for).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : input.event.date || '',
    status: input.event.status ?? null,
    isOverdue: !!input.event.is_overdue,
    mediaUrls,
    attachedAssets: [],
    mediaType: inferMediaType(input.contentType, mediaUrls),
    isThread: false,
    surface: 'calendar',
    style: 'platform-faithful',
  };
}

/**
 * Build a normalized payload from the writer's local state (post + attached
 * creator assets). Used by WriterEmbeddedPreview on ShortformResultPage.
 */
export function buildPreviewPayloadFromWriterPost(input: {
  platform: string;
  content: string;
  contentType?: string;
  title?: string;
  scheduledDate?: string;
  attachedAssets: CreatorAttachment[];
}): NormalizedPreviewPayload {
  const platform = normalizePlatformKey(input.platform);
  const mediaUrls = collectAttachmentPreviewUrls(input.attachedAssets);
  const contentType = String(input.contentType || 'post').toLowerCase();
  return {
    platform,
    contentType,
    content: (input.content || '').trim() || null,
    title: input.title ?? null,
    scheduledDate: input.scheduledDate ?? '',
    mediaUrls,
    attachedAssets: input.attachedAssets,
    mediaType: inferMediaType(contentType, mediaUrls),
    isThread: false,
    surface: 'writer',
    style: 'platform-faithful',
  };
}

/**
 * Build a normalized payload for the thread writer. Maps thread segments
 * + per-node attachment map into a `threadNodes` array consumed by the
 * thread renderer.
 */
export function buildPreviewPayloadFromWriterThread(input: {
  platform: string;
  segments: string[];
  /** position → asset id list */
  nodeAttachmentMap?: Record<number, string[]>;
  /** asset registry — looked up by id when projecting per-node attachments */
  availableAssets?: CreatorAttachment[];
  title?: string;
}): NormalizedPreviewPayload {
  const platform = normalizePlatformKey(input.platform);
  const assetById = new Map<string, CreatorAttachment>();
  for (const asset of input.availableAssets ?? []) {
    assetById.set(asset.id, asset);
  }
  const threadNodes: ThreadNode[] = input.segments.map((content, index) => {
    const attachmentIds = (input.nodeAttachmentMap?.[index] ?? []).filter(Boolean);
    const attachments = attachmentIds
      .map((id) => assetById.get(id))
      .filter((a): a is CreatorAttachment => Boolean(a));
    return {
      id: `seg-${index}`,
      position: index,
      content: content || '',
      attachments,
      platform,
    };
  });
  return {
    platform,
    contentType: 'thread',
    content: null,
    title: input.title ?? null,
    mediaUrls: [],
    attachedAssets: [],
    mediaType: 'none',
    isThread: true,
    threadNodes,
    surface: 'writer',
    style: 'platform-faithful',
  };
}

/**
 * Lightweight builder for `PreviewCard` — multi-platform repurpose
 * preview. The result-page surface that ContentRenderer was already
 * powering. Style hint stays `generic-card` to preserve PreviewCard's
 * generic visual language.
 */
export function buildPreviewPayloadFromPlatformPost(input: {
  platform: string;
  content: string;
  hashtags?: string[];
  title?: string;
  mediaType?: 'none' | 'image' | 'video';
}): NormalizedPreviewPayload {
  const platform = normalizePlatformKey(input.platform);
  const contentBody = (input.content || '').trim();
  const hashtagsText = (input.hashtags ?? []).join(' ');
  return {
    platform,
    contentType: 'post',
    content: contentBody || null,
    title: input.title ?? null,
    mediaUrls: [],
    attachedAssets: [],
    mediaType: input.mediaType ?? 'none',
    isThread: false,
    surface: 'preview-card',
    style: 'generic-card',
    metadata: { hashtags: hashtagsText },
  };
}
