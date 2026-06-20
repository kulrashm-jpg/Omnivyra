/**
 * Phase 6F-1A — Canonical authority for ATTACHMENT-REQUIRED media.
 *
 * Single source of truth for externally-supplied (user-uploaded) media formats:
 * video, reel, short, podcast — plus aliases for audio / webinar / interview
 * recordings. These are NOT AI-generated and NOT creator-rendered: the planner
 * creates the slot, the user provides the asset URL, and the publisher blocks
 * until the asset exists.
 *
 * This authority is DERIVED from the creator governance registry's Group B
 * (`GROUP_B_ATTACHMENT_REQUIRED_FORMATS` / `media_upload_required`) — it does NOT
 * maintain a competing list, so it can never drift from the registry. It exists
 * to give planner / scheduler / publisher one named, shared concept (and the
 * required-asset-type helper that was previously implicit).
 *
 * Execution-model facts it encodes (all already true in the registry today):
 *   - video/reel/short/podcast carry `media_upload_required: true`,
 *     `autonomous_renderable: false`, `ai_renderable: false`.
 *   - They are routed by `getRowSchedulingEligibility` through the single
 *     `media_upload_required` branch (awaiting_media_upload → media_uploaded →
 *     ready_for_schedule), identical for video and podcast.
 *   - In `generate-weekly-structure` they are NOT `requiresMediaIntent`, so they
 *     take the text lane and never hit the creator-asset DB CHECK.
 */

import {
  GROUP_B_ATTACHMENT_REQUIRED_FORMATS,
  getCreatorGovernance,
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
} from '../creatorGovernanceRegistry';

/** Canonical membership — derived from the registry's Group B (no duplicate list). */
export const ATTACHMENT_REQUIRED_MEDIA_FORMATS: readonly string[] = [
  ...GROUP_B_ATTACHMENT_REQUIRED_FORMATS,
]; // video, reel, short, podcast

/**
 * Phase 6F-1B — business-facing media taxonomy. Every entry is PURE NAME
 * MAPPING onto an EXISTING attachment-required family (video / podcast). It
 * introduces no new execution path, no new format, no generation capability —
 * if a planner/UI surfaces one of these business-friendly labels it resolves to
 * the existing video or audio attachment-required slot.
 */
const ATTACHMENT_MEDIA_ALIASES: Record<string, string> = {
  // ── AUDIO family → podcast (the registry's Group-B audio format) ──────────
  audio: 'podcast',
  podcast_audio: 'podcast',
  audio_interview: 'podcast',
  customer_interview: 'podcast',
  executive_interview: 'podcast',
  founder_talk_audio: 'podcast',
  // ── VIDEO family → video (registry Group-B video format) ──────────────────
  webinar: 'video',
  webinar_recording: 'video',
  recording: 'video',
  interview: 'video',
  interview_recording: 'video',
  product_demo: 'video',
  event_recording: 'video',
  founder_talk_video: 'video',
};

/**
 * Business-facing taxonomy groupings. These are user-friendly NAMES only; every
 * member normalizes to a canonical Group-B format (video or podcast) and runs on
 * the identical attachment-required execution model.
 */
export const VIDEO_ASSET_FORMATS: readonly string[] = [
  'video', 'reel', 'short',
  'webinar_recording', 'product_demo', 'event_recording', 'founder_talk_video',
];

export const AUDIO_ASSET_FORMATS: readonly string[] = [
  'podcast', 'audio',
  'audio_interview', 'customer_interview', 'executive_interview', 'founder_talk_audio',
];

export const MEDIA_TAXONOMY = {
  VIDEO_ASSET: VIDEO_ASSET_FORMATS,
  AUDIO_ASSET: AUDIO_ASSET_FORMATS,
} as const;

/** Normalize a format label to its canonical attachment-required key. */
export function normalizeAttachmentMediaFormat(format: unknown): string {
  const base = normalizeCreatorFormat(format); // reuse registry aliases (reels→reel, etc.)
  return ATTACHMENT_MEDIA_ALIASES[base] ?? base;
}

/**
 * True if the format is externally-supplied media that requires a user-uploaded
 * asset URL before it can be published. Canonical signal = the registry's
 * `media_upload_required` (Group B); alias labels resolve onto it.
 */
export function isAttachmentRequiredMedia(format: unknown): boolean {
  return isAttachmentRequiredFormat(normalizeAttachmentMediaFormat(format));
}

/** The asset family a user must supply for an attachment-required format. */
export type RequiredAssetType = 'video' | 'audio';

/**
 * The semantic asset type the user must provide for an attachment-required
 * format ('video' for video/reel/short/webinar/interview, 'audio' for
 * podcast/audio). Returns null for non-attachment formats. NOTE: this is the
 * SEMANTIC family — persistence of audio still uses the existing
 * post_with_asset/text-lane path; this helper does not change storage.
 */
export function getRequiredAssetType(format: unknown): RequiredAssetType | null {
  const gov = getCreatorGovernance(normalizeAttachmentMediaFormat(format));
  if (!gov || !gov.media_upload_required) return null;
  return gov.canonical_asset_family === 'audio' ? 'audio' : 'video';
}

/** Semantic alias — true when a format needs a user-supplied asset URL. */
export function requiresAssetUrl(format: unknown): boolean {
  return isAttachmentRequiredMedia(format);
}

/**
 * Phase 6F-1B — classify a (possibly business-facing) media name into its
 * canonical asset family. Identical to {@link getRequiredAssetType} but named
 * for the taxonomy use-case. Returns null for non-media formats.
 */
export type MediaAssetFamily = RequiredAssetType;
export function getMediaAssetFamily(format: unknown): MediaAssetFamily | null {
  return getRequiredAssetType(format);
}
