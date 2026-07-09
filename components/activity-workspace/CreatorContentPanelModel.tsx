/** Part 1/3 of CreatorContentPanel.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * Creator Content Panel
 *
 * Sections:
 *   1. Creator Profile  — who is creating: name, handle, profile URL, bio
 *   2. Media Asset      — master URL + apply-to-all, per-platform upload cards
 *   3. Marketing Package — AI-generated: title, summary, meta description, SEO keywords,
 *                          universal hashtags, per-platform hashtag sets, CTA
 *   4. Actions          — Save Asset | Generate Promotion Content
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Video,
  Image,
  LayoutGrid,
  Link2,
  ExternalLink,
  Loader2,
  Sparkles,
  Upload,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  User,
  Tag,
  Search,
  Hash,
  FileText,
  Megaphone,
  RefreshCw,
  Users,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import {
  getVideoFormatsForPlatform,
  isValidPlatformVideoFormat,
  platformSupportsVideo,
  normalizeVideoPlatform,
  listVideoCapablePlatforms,
} from '../../lib/shared/videoFormatCapabilities';

/* ────────────────────── types ────────────────────── */


export type CreatorProfile = {
  name?: string;
  handle?: string;
  profile_url?: string;
  bio?: string;
  platform_profiles?: Record<string, string>; // platform → profile URL
};

export type MarketingPackage = {
  title?: string;
  summary?: string;
  meta_description?: string;
  seo_keywords?: string[];
  hashtags?: string[];
  cta?: string;
  platform_hashtags?: Record<string, string[]>;
};

export type PlatformUpload = {
  url?: string;
  externalLink?: string;
  caption?: string;
  /** carousel: image URL per slide */
  slides?: string[];
  /** per-platform marketing overrides */
  hashtags?: string[];
  cta?: string;
};

export type CreatorAssetPayload = {
  type: 'video' | 'image' | 'carousel';
  url?: string;
  files?: string[];
  thumbnail?: string;
  description?: string;
  transcript?: string;
  theme?: string;
  creator_profile?: CreatorProfile;
  marketing?: MarketingPackage;
  platformUploads?: Record<string, PlatformUpload>;
  /** PHASE CREATOR-VIDEO-UX-SIMPLIFICATION — ownership + same/different mapping. */
  uploaded_by?: { user_id: string; name?: string };
  video_mode?: 'same' | 'different';
  /** Per-video YouTube visibility (only affects the YouTube upload). */
  youtube_visibility?: 'public' | 'unlisted' | 'private';
  /** Generic per-platform publish options (e.g. { tiktok: {...} }). */
  publish_settings?: Record<string, unknown>;
  platform_videos?: Record<string, string>;
  /**
   * PLATFORM-SPECIFIC VIDEO MAPPING — richer per-row mappings (platform +
   * format + url + title). `platform_videos` above is derived from these (one
   * primary url per platform) so the publish resolver (resolveVideoForPlatform)
   * keeps working unchanged.
   */
  platform_video_mappings?: Array<{
    platformId: string;
    videoFormat: string;
    videoUrl: string;
    videoTitle?: string;
    uploadedBy?: string;
  }>;
};

/**
 * State surface for attachment-required rows (video / reel / short /
 * podcast). When set, the panel renders an Upload Media section at the
 * top — independent of the per-platform upload model below — that drives
 * the per-row lifecycle:
 *
 *   awaiting_media_upload / upload_failed
 *     → media_uploaded (validation pass)
 *     → ready_for_schedule
 *
 * Autonomous formats leave this prop unset and the panel behaves as
 * before.
 */
export type AttachmentRowState = {
  dailyPlanId: string;
  contentType: 'video' | 'reel' | 'short' | 'podcast';
  lifecycle: 'awaiting_media_upload' | 'media_uploaded' | 'ready_for_schedule' | 'scheduled' | 'upload_failed';
  uploadedMediaUrl?: string;
  uploadSource?: 'user_upload' | 'external_link' | 'direct_upload';
  uploadValidation?: { valid: boolean; errors?: string[]; details?: Record<string, unknown> } | null;
  uploadedMimeType?: string;
  /**
   * Optimistic-concurrency token (row's `creator_lifecycle_history.length`).
   * Sent back to the server on every mutating call so a stale tab is
   * rejected with 409 CONCURRENT_UPLOAD_CONFLICT.
   */
  revision?: number;
  scheduledAt?: string;
  scheduledPostId?: string;
  themeTreatmentSummary?: {
    hookText?: string;
    sceneCount?: number;
    durationSeconds?: number;
    aspectRatio?: string;
    ctaText?: string;
  };
  creatorGuidance?: {
    production_notes?: string;
    production_checklist?: string[];
    talking_points?: string[];
    b_roll_ideas?: string[];
  };
  marketingPackage?: {
    caption?: string;
    hashtags?: string[];
    cta?: string;
  };
};

export type UploadMediaResult = {
  ok: boolean;
  lifecycle?: AttachmentRowState['lifecycle'];
  validation?: AttachmentRowState['uploadValidation'];
  message?: string;
  /** Public URL of the uploaded media (for direct uploads). */
  uploadedMediaUrl?: string;
  /** MIME of the uploaded media (for preview rendering). */
  uploadedMimeType?: string;
  /** True when the upload was aborted by the user; no lifecycle change. */
  aborted?: boolean;
  /** True when a concurrent edit invalidated this upload (409). */
  conflict?: boolean;
  /** New revision token (when the upload succeeded). */
  revision?: number;
};

/**
 * Snapshot of a previously-started resumable upload that the workspace
 * detected on mount. Surfaced by the panel as a "Resume upload?" banner.
 *
 * The metadata is captured by the resumable-upload helper at session
 * start (via `localStorage` AND, for tus-js-client, its own fingerprint
 * store). Used by the panel to decide between resume / discard / restart
 * actions for an attachment-required row that's still in
 * `awaiting_media_upload` or `upload_failed`.
 */
export type ResumableUploadHandle = {
  tusUploadUrl?: string;
  uploadSessionId?: string;
  objectPath?: string;
  createdAt?: string;
  /** Best-effort indicator that tus-js-client found a matching prior upload. */
  hasPersistedFingerprint?: boolean;
};

export type ResumeUploadHandler = (handle: ResumableUploadHandle) => Promise<UploadMediaResult>;
export type DiscardResumableUploadHandler = (handle: ResumableUploadHandle) => Promise<void>;

/**
 * Direct (multipart) upload handler. Reports progress percentage as the
 * file streams to storage. Returns the same UploadMediaResult shape as
 * the URL-based handler so the consumer can drive a single set of UI
 * state transitions.
 *
 * `signal` lets the component cancel an in-flight upload (e.g., when
 * the user clicks "Cancel upload"). The implementation calls
 * `xhr.abort()` and resolves with `{ ok: false, aborted: true }` so the
 * row's lifecycle state is NOT mutated.
 *
 * `expectedRevision` is the row's lifecycle revision at fetch time.
 * Sent server-side so a stale tab is rejected with 409.
 */
export type DirectUploadHandler = (input: {
  file: File;
  source?: 'user_upload' | 'direct_upload';
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  expectedRevision?: number;
}) => Promise<UploadMediaResult>;

/**
 * Reschedule handler. Used by the scheduled-row UI to either retime the
 * post, replace the uploaded media via URL, or both at once. Direct-
 * file replacement reuses {@link DirectUploadHandler} since the upload
 * endpoint now accepts `scheduled` as a starting lifecycle state.
 */
export type RescheduleHandler = (input: {
  mediaUrl?: string;
  scheduledAt?: string;
  source?: 'external_link' | 'user_upload';
  expectedRevision?: number;
}) => Promise<UploadMediaResult>;

/**
 * Unschedule handler. Cancels the queued publish job and transitions the
 * row to `upload_failed` with reason `user_unscheduled`. The row's
 * uploaded_media_url + creator_guidance + marketing_package are
 * preserved so the user can re-schedule from the same row.
 */
export type UnscheduleHandler = (input: {
  reason?: string;
  expectedRevision?: number;
}) => Promise<UploadMediaResult>;

export type CreatorContentPanelProps = {
  theme: string;
  productionBrief: string;
  talkingPoints: string[];
  creatorInstructions?: Record<string, unknown> | null;
  creatorAsset?: CreatorAssetPayload | null;
  contentType?: string;
  platforms?: string[];
  onAssetSaved: (asset: CreatorAssetPayload) => void;
  onGeneratePromotion: (asset?: Record<string, unknown> | null) => void;
  isGeneratingPromotion?: boolean;
  campaignId: string;
  executionId: string;
  weekNumber: number;
  day: string;
  /** Context for AI marketing package generation */
  objective?: string;
  targetAudience?: string;
  existingHashtags?: string[];
  onNotice?: (type: 'success' | 'error' | 'info', message: string) => void;
  /** Attachment-required lifecycle state (video/reel/short/podcast). Optional. */
  attachmentRowState?: AttachmentRowState | null;
  /** Handler that POSTs to /api/activity-workspace/[id]/upload-media (URL-based). */
  onUploadMedia?: (input: { mediaUrl: string; source: 'user_upload' | 'external_link'; mimeType?: string; expectedRevision?: number }) => Promise<UploadMediaResult>;
  /** Handler that POSTs multipart to /api/activity-workspace/[id]/upload-media-direct (file-based). */
  onUploadFile?: DirectUploadHandler;
  /** Handler that POSTs to /api/activity-workspace/[id]/reschedule. */
  onReschedule?: RescheduleHandler;
  /** Handler that POSTs to /api/activity-workspace/[id]/unschedule. */
  onUnschedule?: UnscheduleHandler;
  /**
   * Snapshot of a previously-started resumable upload (read from local
   * persistence at workspace mount). When present + lifecycle is
   * `awaiting_media_upload` or `upload_failed`, the panel renders a
   * "Resume upload?" banner with three actions.
   */
  resumableUploadHandle?: ResumableUploadHandle | null;
  /** Resumes the prior TUS upload from where it left off. */
  onResumeUpload?: ResumeUploadHandler;
  /** Discards the persisted resumable-upload metadata + local fingerprint. */
  onDiscardResumableUpload?: DiscardResumableUploadHandler;
};

/* ────────────────────── helpers ────────────────────── */

export function resolveAssetType(ct: string): 'video' | 'image' | 'carousel' {
  const lower = ct.toLowerCase();
  if (['video', 'reel', 'short', 'live'].includes(lower)) return 'video';
  if (['carousel', 'slides', 'slide', 'slideware', 'infographic', 'deck', 'presentation'].includes(lower))
    return 'carousel';
  return 'image';
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null;
  } catch { /* not a valid URL */ }
  return null;
}

function getVideoThumbnail(url: string): string | null {
  const ytId = extractYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
  return null;
}

export const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram',
  x: 'X (Twitter)', youtube: 'YouTube', tiktok: 'TikTok',
  reddit: 'Reddit', pinterest: 'Pinterest', threads: 'Threads',
};

const PLATFORM_UPLOAD_HINTS: Record<string, string> = {
  linkedin: 'Upload via LinkedIn Video, or paste a hosted MP4/YouTube link.',
  facebook: 'Paste a Facebook video URL or a direct MP4 link.',
  instagram: 'Use a direct MP4 link (schedule via Meta API or third-party tools).',
  x: 'Paste a direct MP4 URL (max 512 MB, 140s for regular; 10 min for X Premium).',
  youtube: 'Paste the YouTube video URL where this content is published.',
  tiktok: 'Paste a TikTok video URL or a direct MP4 link.',
  reddit: 'Paste a YouTube/Vimeo URL or a direct hosted video link.',
  pinterest: 'Upload a MP4 (max 2 GB) or paste a YouTube/Vimeo URL.',
};

const CAROUSEL_HINTS: Record<string, string> = {
  linkedin: 'PDF carousel (up to 300 pages) or individual JPG/PNG slides.',
  facebook: 'Up to 10 images/cards per carousel post.',
  instagram: 'Up to 10 images or videos; first asset is the cover.',
  x: 'Up to 4 images per post (no native carousel; use thread for multi-image).',
  youtube: 'Not applicable — use a video or playlist instead.',
  tiktok: 'Photo carousels: up to 35 images.',
  reddit: 'Gallery post: up to 20 images.',
  pinterest: 'Up to 5 images per Idea Pin.',
};

const IMAGE_HINTS: Record<string, string> = {
  linkedin: 'JPG/PNG/GIF up to 5 MB; 1200×627 px recommended.',
  facebook: 'JPG/PNG; 1200×630 px recommended.',
  instagram: 'Square (1080×1080) or portrait (1080×1350) JPG/PNG.',
  x: 'JPG/PNG/GIF/WEBP; up to 5 MB per image (4 max).',
  youtube: 'Custom thumbnail: JPG/PNG, 1280×720 px.',
  tiktok: 'Cover image: JPG/PNG, 9:16 ratio.',
  reddit: 'JPG/PNG up to 20 MB.',
  threads: 'Square or portrait JPG/PNG for lightweight social creatives.',
  pinterest: 'JPG/PNG 2:3 ratio (1000×1500 px recommended).',
};

/* ────────────────────── sub-components ────────────────────── */

export function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-gray-800">{title}</div>
        {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}
      </div>
    </div>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full">
      {text}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-indigo-400 hover:text-indigo-700 ml-0.5 leading-none">×</button>
      )}
    </span>
  );
}

export function TagInput({
  value,
  onChange,
  placeholder,
  prefix = '',
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  prefix?: string;
}) {
  const [inputVal, setInputVal] = useState('');

  const add = (raw: string) => {
    const tags = raw.split(/[\s,]+/).map((t) => {
      let clean = t.trim();
      if (prefix && !clean.startsWith(prefix)) clean = prefix + clean;
      return clean;
    }).filter(Boolean);
    if (tags.length === 0) return;
    onChange([...value, ...tags.filter((t) => !value.includes(t))]);
    setInputVal('');
  };

  return (
    <div className="flex flex-wrap gap-1.5 border border-gray-300 rounded-lg p-2 min-h-[42px] focus-within:border-indigo-400 bg-white">
      {value.map((t) => (
        <Chip key={t} text={t} onRemove={() => onChange(value.filter((x) => x !== t))} />
      ))}
      <input
        type="text"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inputVal); }
          if (e.key === 'Backspace' && !inputVal && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={() => { if (inputVal.trim()) add(inputVal); }}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[100px] outline-none text-sm text-gray-700 bg-transparent"
      />
    </div>
  );
}

export function LinkPreview({ url, label = 'Open link' }: { url: string; label?: string }) {
  const thumb = getVideoThumbnail(url);
  if (thumb) {
    return (
      <div className="mt-2 relative rounded-lg overflow-hidden border border-gray-200">
        <img src={thumb} alt="Video thumbnail" className="w-full max-h-44 object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-white flex flex-col items-center gap-1 hover:opacity-80">
            <ExternalLink className="h-8 w-8" />
            <span className="text-xs">{label}</span>
          </a>
        </div>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
      <ExternalLink className="h-3 w-3" /> {label}
    </a>
  );
}

export function PlatformCard({
  platform,
  assetType,
  upload,
  platformHashtags,
  onChange,
}: {
  platform: string;
  assetType: 'video' | 'image' | 'carousel';
  upload: PlatformUpload;
  platformHashtags?: string[];
  onChange: (upd: PlatformUpload) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const label = PLATFORM_LABELS[platform] ?? platform;
  const hint =
    assetType === 'video' ? PLATFORM_UPLOAD_HINTS[platform]
    : assetType === 'carousel' ? CAROUSEL_HINTS[platform]
    : IMAGE_HINTS[platform];

  const slideCount = Math.max(upload.slides?.length ?? 1, 1);
  // Init hashtags from AI suggestion if not overridden yet
  const hashtags = upload.hashtags ?? platformHashtags ?? [];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3">
          {hint && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">{hint}</p>}

          {/* Media link */}
          {assetType === 'video' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Video link
              </label>
              <input
                type="url"
                value={upload.externalLink ?? ''}
                onChange={(e) => onChange({ ...upload, externalLink: e.target.value })}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
              />
              {(upload.externalLink ?? '').trim() && <LinkPreview url={upload.externalLink!.trim()} label="Open video" />}
            </div>
          )}
          {assetType === 'image' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Image link (Canva, Drive, Dropbox, CDN…)
              </label>
              <input
                type="url"
                value={upload.externalLink ?? ''}
                onChange={(e) => onChange({ ...upload, externalLink: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
              />
              {(upload.externalLink ?? '').trim() && <LinkPreview url={upload.externalLink!.trim()} label="Open image" />}
            </div>
          )}
          {assetType === 'carousel' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Slide / deck links
              </label>
              {Array.from({ length: slideCount }, (_, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}.</span>
                  <input
                    type="url"
                    value={upload.slides?.[i] ?? ''}
                    onChange={(e) => {
                      const slides = [...(upload.slides ?? Array(slideCount).fill(''))];
                      slides[i] = e.target.value;
                      onChange({ ...upload, slides });
                    }}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => onChange({ ...upload, slides: [...(upload.slides ?? ['']), ''] })}
                  className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 border border-indigo-200 rounded-md">
                  + Add slide
                </button>
                {slideCount > 1 && (
                  <button type="button"
                    onClick={() => onChange({ ...upload, slides: (upload.slides ?? []).slice(0, -1) })}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded-md">
                    Remove last
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Platform-specific caption */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Post caption / marketing text
              <span className="text-gray-400 font-normal ml-1">(shown with this content on {label})</span>
            </label>
            <textarea
              value={upload.caption ?? ''}
              onChange={(e) => onChange({ ...upload, caption: e.target.value })}
              placeholder={`Caption or key message for ${label}…`}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
            />
          </div>

          {/* Per-platform hashtags (pre-filled from AI, editable) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Hashtags for {label}
              <span className="text-gray-400 font-normal ml-1">(press Enter or comma to add)</span>
            </label>
            <TagInput
              value={hashtags}
              onChange={(v) => onChange({ ...upload, hashtags: v })}
              placeholder={`#${platform} hashtags…`}
              prefix="#"
            />
          </div>

          {/* CTA override */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">CTA override <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={upload.cta ?? ''}
              onChange={(e) => onChange({ ...upload, cta: e.target.value })}
              placeholder="e.g. Watch now · Link in bio · Comment below"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────── main component ────────────────────── */

export const DEFAULT_PLATFORMS = ['linkedin', 'x', 'instagram', 'facebook', 'threads', 'reddit'];

/**
 * PHASE CREATOR-VIDEO-PUBLISHING-CONSISTENCY — UI honesty gate.
 * Per-platform "different videos" is resolved by resolveVideoForPlatform() at
 * scheduling, but the validated single-URL upload lifecycle (uploaded_media_url
 * + upload validation) is what actually gates publishing per row. Until that
 * lifecycle accepts per-platform validated media, the "different videos" option
 * is disabled so we never expose functionality that isn't executed end-to-end.
 */
// PLATFORM-SPECIFIC VIDEO MAPPING — enabled. "Different videos" now uses the
// per-platform mapping rows (platform + format + url + title) with connected-
// platform governance + format capability validation, and derives the
// per-platform primary url (`platform_videos`) that the publish resolver
// already consumes.
export const DIFFERENT_VIDEO_ENABLED = true;

/** A single per-platform video mapping row (platform + format + url + title). */
export type VideoMappingRow = { id: string; platformId: string; videoFormat: string; videoUrl: string; videoTitle: string };
let __vmapSeq = 0;
export const nextVmapId = () => `vmap-${++__vmapSeq}`;

export function UploadedMediaPreview({ url, mime }: { url: string; mime?: string | null }) {
  const lower = (mime || '').toLowerCase();
  if (lower.startsWith('video/')) {
    return (
      <video
        controls
        preload="metadata"
        className="mt-2 w-full max-h-72 rounded-lg border border-gray-200 bg-black"
        src={url}
      >
        Your browser does not support embedded video.
      </video>
    );
  }
  if (lower.startsWith('audio/')) {
    return (
      <audio controls className="mt-2 w-full" src={url}>
        Your browser does not support embedded audio.
      </audio>
    );
  }
  if (lower.startsWith('image/')) {
    return (
      <img
        src={url}
        alt="Uploaded media preview"
        loading="lazy"
        className="mt-2 max-h-72 rounded-lg border border-gray-200 object-contain bg-gray-50"
      />
    );
  }
  // Unknown MIME → no inline preview, just a link.
  return null;
}

export type UploadUiStatus = 'idle' | 'dragging' | 'uploading' | 'validating' | 'ready' | 'failed';

