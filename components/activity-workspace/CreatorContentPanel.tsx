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

type CreatorContentPanelProps = {
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

function resolveAssetType(ct: string): 'video' | 'image' | 'carousel' {
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

const PLATFORM_LABELS: Record<string, string> = {
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

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
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

function TagInput({
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

function LinkPreview({ url, label = 'Open link' }: { url: string; label?: string }) {
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

function PlatformCard({
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

const DEFAULT_PLATFORMS = ['linkedin', 'x', 'instagram', 'facebook', 'threads', 'reddit'];

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
const DIFFERENT_VIDEO_ENABLED = true;

/** A single per-platform video mapping row (platform + format + url + title). */
type VideoMappingRow = { id: string; platformId: string; videoFormat: string; videoUrl: string; videoTitle: string };
let __vmapSeq = 0;
const nextVmapId = () => `vmap-${++__vmapSeq}`;

function UploadedMediaPreview({ url, mime }: { url: string; mime?: string | null }) {
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

type UploadUiStatus = 'idle' | 'dragging' | 'uploading' | 'validating' | 'ready' | 'failed';

function AttachmentUploadSection({
  state,
  onUploadMedia,
  onUploadFile,
  onReschedule,
  onUnschedule,
  resumableUploadHandle,
  onResumeUpload,
  onDiscardResumableUpload,
  onNotice,
}: {
  state: AttachmentRowState;
  onUploadMedia: NonNullable<CreatorContentPanelProps['onUploadMedia']>;
  onUploadFile?: CreatorContentPanelProps['onUploadFile'];
  onReschedule?: CreatorContentPanelProps['onReschedule'];
  onUnschedule?: CreatorContentPanelProps['onUnschedule'];
  resumableUploadHandle?: CreatorContentPanelProps['resumableUploadHandle'];
  onResumeUpload?: CreatorContentPanelProps['onResumeUpload'];
  onDiscardResumableUpload?: CreatorContentPanelProps['onDiscardResumableUpload'];
  onNotice?: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [url, setUrl] = useState(state.uploadedMediaUrl ?? '');
  const [source, setSource] = useState<'user_upload' | 'external_link'>(
    state.uploadSource === 'user_upload' ? 'user_upload' : 'external_link',
  );
  const [submitting, setSubmitting] = useState(false);
  const [uiStatus, setUiStatus] = useState<UploadUiStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localOk, setLocalOk] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [replaceMediaEnabled, setReplaceMediaEnabled] = useState(false);
  const [unscheduleConfirmOpen, setUnscheduleConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isReady = state.lifecycle === 'ready_for_schedule' || state.lifecycle === 'media_uploaded';
  const isFailed = state.lifecycle === 'upload_failed';
  const isScheduled = state.lifecycle === 'scheduled';
  const isAwaiting = state.lifecycle === 'awaiting_media_upload';
  const directUploadEnabled = typeof onUploadFile === 'function';
  const rescheduleEnabled = typeof onReschedule === 'function';
  const unscheduleEnabled = typeof onUnschedule === 'function';
  // Resume banner shows ONLY when a prior session is detected AND the row
  // is still in a state where resuming makes sense (awaiting / failed).
  // Scheduled / ready rows never show the banner — the row already has
  // a finalized upload.
  const resumeBannerVisible = !!resumableUploadHandle
    && typeof onResumeUpload === 'function'
    && (state.lifecycle === 'awaiting_media_upload' || state.lifecycle === 'upload_failed');
  const [resumeBusy, setResumeBusy] = useState<'idle' | 'resuming' | 'discarding'>('idle');
  // The drop zone / URL field are enabled when the row is editable:
  //   - any non-scheduled state, OR
  //   - scheduled + user clicked "Replace media" (replaceMediaEnabled)
  const uploadControlsLocked = isScheduled && !replaceMediaEnabled;

  const statusBadge = isScheduled
    ? { label: 'Scheduled', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
    : isReady
      ? { label: 'Ready to schedule', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : isFailed
        ? { label: 'Upload failed — retry', cls: 'bg-red-50 text-red-700 border-red-200' }
        : { label: 'Awaiting media upload', cls: 'bg-amber-50 text-amber-700 border-amber-200' };

  const validationErrors = state.uploadValidation?.errors ?? [];
  const showThemeSummary = !!state.themeTreatmentSummary;
  const showGuidance = !!state.creatorGuidance;
  const previewUrl = state.uploadedMediaUrl ?? null;
  const previewMime = state.uploadedMimeType ?? null;

  function resetFeedback() {
    setLocalError(null);
    setLocalOk(null);
  }

  // ── URL submit (link-based path, with concurrency token) ───────────────
  async function submitUrl() {
    if (!url.trim()) {
      setLocalError('Provide a media URL first.');
      return;
    }
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const result = await onUploadMedia({
        mediaUrl: url.trim(),
        source,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        const message = isScheduled
          ? 'Media replaced; row remains scheduled.'
          : 'Media validated. Row is ready to schedule.';
        setLocalOk(message);
        setUiStatus('ready');
        setReplaceMediaEnabled(false);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message
          || (result.validation && !result.validation.valid && Array.isArray(result.validation.errors) ? result.validation.errors.join(' | ') : 'Validation failed.');
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
      setProgress(0);
    }
  }

  // ── Direct file upload (multipart, with progress + abort support) ─────
  async function submitFile(file: File) {
    if (!directUploadEnabled || !onUploadFile) return;
    setSubmitting(true);
    setUiStatus('uploading');
    setProgress(0);
    resetFeedback();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const result = await onUploadFile({
        file,
        source: 'direct_upload',
        signal: controller.signal,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
        onProgress: (pct) => {
          setProgress(Math.max(0, Math.min(100, Math.round(pct))));
          // While bytes are still streaming we stay in 'uploading'.
          // Once we hit 100 (or close to it) and we're awaiting a server
          // response we flip to 'validating' so the UI reflects that the
          // server-side validator is now running.
          if (pct >= 99) setUiStatus('validating');
        },
      });
      if (result.aborted) {
        // User-initiated cancellation: NO lifecycle transition occurred.
        // Just clear the UI state and let the user retry.
        setUiStatus(state.lifecycle === 'upload_failed' ? 'failed' : 'idle');
        onNotice?.('info', 'Upload cancelled.');
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else if (result.ok) {
        const message = isScheduled
          ? 'Media replaced; row remains scheduled.'
          : 'File uploaded and validated. Row is ready to schedule.';
        setLocalOk(message);
        setUiStatus('ready');
        setReplaceMediaEnabled(false);
        onNotice?.('success', message);
      } else {
        const message = result.message
          || (result.validation && !result.validation.valid && Array.isArray(result.validation.errors) ? result.validation.errors.join(' | ') : 'Upload validation failed.');
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
      setProgress(0);
      abortControllerRef.current = null;
    }
  }

  function cancelUpload() {
    abortControllerRef.current?.abort();
  }

  async function resumePersistedUpload() {
    if (!resumableUploadHandle || !onResumeUpload || resumeBusy !== 'idle') return;
    setResumeBusy('resuming');
    resetFeedback();
    setUiStatus('uploading');
    try {
      const result = await onResumeUpload(resumableUploadHandle);
      if (result.aborted) {
        setUiStatus('idle');
        onNotice?.('info', 'Resume cancelled.');
        return;
      }
      if (result.ok) {
        setUiStatus('ready');
        const msg = 'Upload resumed and finalized.';
        setLocalOk(msg);
        onNotice?.('success', msg);
      } else if (result.conflict) {
        const msg = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(msg);
        setUiStatus('failed');
        onNotice?.('error', msg);
      } else {
        const msg = result.message || 'Resume failed.';
        setLocalError(msg);
        setUiStatus('failed');
        onNotice?.('error', msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Resume request failed.';
      setLocalError(msg);
      setUiStatus('failed');
      onNotice?.('error', msg);
    } finally {
      setResumeBusy('idle');
    }
  }

  async function discardPersistedUpload() {
    if (!resumableUploadHandle || !onDiscardResumableUpload || resumeBusy !== 'idle') return;
    setResumeBusy('discarding');
    try {
      await onDiscardResumableUpload(resumableUploadHandle);
      onNotice?.('info', 'Discarded the in-progress upload. You can start over below.');
    } catch (e) {
      onNotice?.('error', e instanceof Error ? e.message : 'Failed to discard upload.');
    } finally {
      setResumeBusy('idle');
    }
  }

  async function submitUnschedule() {
    if (!unscheduleEnabled || !onUnschedule) return;
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const result = await onUnschedule({
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        const message = 'Unscheduled. Uploaded media + guidance preserved.';
        setLocalOk(message);
        setUiStatus('idle');
        setUnscheduleConfirmOpen(false);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message || 'Unschedule failed.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unschedule request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReschedule() {
    if (!rescheduleEnabled || !onReschedule) return;
    if (!rescheduleAt.trim()) {
      setLocalError('Pick a new scheduled time first.');
      return;
    }
    setSubmitting(true);
    setUiStatus('validating');
    resetFeedback();
    try {
      const isoAt = new Date(rescheduleAt).toISOString();
      const result = await onReschedule({
        scheduledAt: isoAt,
        expectedRevision: typeof state.revision === 'number' ? state.revision : undefined,
      });
      if (result.ok) {
        setRescheduleOpen(false);
        setRescheduleAt('');
        setUiStatus('ready');
        const message = 'Reschedule applied.';
        setLocalOk(message);
        onNotice?.('success', message);
      } else if (result.conflict) {
        const message = result.message || 'This row changed in another tab. Refresh to continue.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      } else {
        const message = result.message || 'Reschedule failed.';
        setLocalError(message);
        setUiStatus('failed');
        onNotice?.('error', message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Reschedule request failed.';
      setLocalError(message);
      setUiStatus('failed');
      onNotice?.('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Drag / drop handlers ───────────────────────────────────────────────
  function onDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setUiStatus((prev) => (prev === 'uploading' || prev === 'validating' ? prev : 'dragging'));
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setUiStatus((prev) => (prev === 'dragging' ? 'idle' : prev));
    }
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setUiStatus('idle');
    const file = e.dataTransfer.files?.[0];
    if (file) submitFile(file);
  }
  function onPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    const file = e.target.files?.[0];
    if (file) submitFile(file);
    e.target.value = '';
  }
  function onDropZoneClick() {
    if (!directUploadEnabled || submitting || uploadControlsLocked) return;
    fileInputRef.current?.click();
  }

  // ── Paste-from-clipboard: if a file is in the clipboard, upload it ─────
  useEffect(() => {
    const node = dropZoneRef.current;
    if (!node || !directUploadEnabled) return;
    const handler = (e: ClipboardEvent) => {
      if (submitting || uploadControlsLocked) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            submitFile(f);
            return;
          }
        }
      }
    };
    node.addEventListener('paste', handler as EventListener);
    return () => node.removeEventListener('paste', handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directUploadEnabled, submitting, uploadControlsLocked]);

  const placeholderLabel = state.contentType === 'podcast' ? 'audio file' : 'video file';
  const acceptAttr = state.contentType === 'podcast' ? 'audio/*' : 'video/*';
  const dropZoneClass = (() => {
    if (uploadControlsLocked) return 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60';
    if (uiStatus === 'uploading' || uiStatus === 'validating') return 'border-indigo-300 bg-indigo-50';
    if (uiStatus === 'dragging') return 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200';
    if (uiStatus === 'failed') return 'border-red-300 bg-red-50';
    if (uiStatus === 'ready') return 'border-emerald-300 bg-emerald-50';
    return 'border-gray-300 bg-white hover:border-indigo-300';
  })();

  return (
    <div className="px-5 py-4 border-b border-gray-100 bg-amber-50/30">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <SectionHeader
          icon={<Upload className="h-3.5 w-3.5" />}
          title={`Attachment-required: ${state.contentType}`}
          subtitle="AI cannot render this format — upload finished media to unlock scheduling."
        />
        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
      </div>

      {resumeBannerVisible && resumableUploadHandle && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900" role="region" aria-label="Resume upload">
          <div className="font-semibold mb-1">Resume previous upload?</div>
          <p className="mb-2">
            A {state.contentType} upload session is in progress.
            {resumableUploadHandle.createdAt ? <> Started <time dateTime={resumableUploadHandle.createdAt}>{new Date(resumableUploadHandle.createdAt).toLocaleString()}</time>.</> : null}
            {resumableUploadHandle.hasPersistedFingerprint
              ? ' tus-js-client has a matching local fingerprint — resume will continue from the last successful chunk.'
              : ' Resume will continue from the server-known offset; if none, it restarts.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resumePersistedUpload}
              disabled={resumeBusy !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resumeBusy === 'resuming' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Resume upload
            </button>
            <button
              type="button"
              onClick={discardPersistedUpload}
              disabled={resumeBusy !== 'idle'}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 text-amber-700 bg-white hover:bg-amber-100 disabled:opacity-50"
            >
              {resumeBusy === 'discarding' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Discard &amp; start over
            </button>
          </div>
        </div>
      )}

      {showThemeSummary && (
        <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-900">
          <div className="font-semibold mb-1">Theme treatment</div>
          {state.themeTreatmentSummary?.hookText && (
            <p className="text-indigo-900"><span className="font-medium">Hook:</span> {state.themeTreatmentSummary.hookText}</p>
          )}
          <p className="text-indigo-800">
            {state.themeTreatmentSummary?.sceneCount ?? 0} scenes
            {state.themeTreatmentSummary?.durationSeconds ? ` · ${state.themeTreatmentSummary.durationSeconds}s target` : ''}
            {state.themeTreatmentSummary?.aspectRatio ? ` · ${state.themeTreatmentSummary.aspectRatio}` : ''}
          </p>
          {state.themeTreatmentSummary?.ctaText && (
            <p className="text-indigo-900"><span className="font-medium">CTA:</span> {state.themeTreatmentSummary.ctaText}</p>
          )}
        </div>
      )}

      {showGuidance && state.creatorGuidance && (
        <details className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700">
          <summary className="cursor-pointer font-semibold text-gray-800">Creator guidance</summary>
          {state.creatorGuidance.production_notes && (
            <p className="mt-2"><span className="font-medium">Production notes:</span> {state.creatorGuidance.production_notes}</p>
          )}
          {Array.isArray(state.creatorGuidance.production_checklist) && state.creatorGuidance.production_checklist.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Checklist:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.production_checklist.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(state.creatorGuidance.talking_points) && state.creatorGuidance.talking_points.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">Talking points:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.talking_points.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(state.creatorGuidance.b_roll_ideas) && state.creatorGuidance.b_roll_ideas.length > 0 && (
            <div className="mt-2">
              <div className="font-medium">B-roll ideas:</div>
              <ul className="list-disc pl-5">
                {state.creatorGuidance.b_roll_ideas.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}

      {/* Scheduled-row controls: Replace Media + Reschedule */}
      {isScheduled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!replaceMediaEnabled && (
            <button
              type="button"
              onClick={() => { setReplaceMediaEnabled(true); resetFeedback(); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50"
            >
              <Upload className="h-3 w-3" /> Replace media
            </button>
          )}
          {replaceMediaEnabled && (
            <button
              type="button"
              onClick={() => setReplaceMediaEnabled(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel replace
            </button>
          )}
          {rescheduleEnabled && (
            <button
              type="button"
              onClick={() => setRescheduleOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 text-amber-700 bg-white hover:bg-amber-50"
            >
              {rescheduleOpen ? 'Close reschedule' : 'Reschedule'}
            </button>
          )}
          {unscheduleEnabled && (
            <button
              type="button"
              onClick={() => setUnscheduleConfirmOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50"
            >
              {unscheduleConfirmOpen ? 'Cancel' : 'Unschedule'}
            </button>
          )}
        </div>
      )}

      {isScheduled && unscheduleConfirmOpen && unscheduleEnabled && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 px-3 py-3 space-y-2">
          <p className="text-xs leading-snug text-red-900">
            Unscheduling cancels the queued publish. Your uploaded media, theme treatment, and marketing package stay attached — you can re-schedule later without re-uploading.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submitUnschedule}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm unschedule
            </button>
            <button
              type="button"
              onClick={() => setUnscheduleConfirmOpen(false)}
              disabled={submitting}
              className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Keep scheduled
            </button>
          </div>
        </div>
      )}

      {isScheduled && rescheduleOpen && rescheduleEnabled && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3">
          <label className="block text-xs font-medium text-amber-900 mb-1">New scheduled time</label>
          <input
            type="datetime-local"
            value={rescheduleAt}
            onChange={(e) => setRescheduleAt(e.target.value)}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg bg-white focus:outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={submitReschedule}
            disabled={submitting || !rescheduleAt.trim()}
            className="mt-2 inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Apply reschedule
          </button>
        </div>
      )}

      {/* Drag-drop / file-picker zone (direct upload) */}
      {directUploadEnabled && (
        <div className="mt-3">
          <div
            ref={dropZoneRef}
            tabIndex={uploadControlsLocked ? -1 : 0}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={onDropZoneClick}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploadControlsLocked && !submitting) { e.preventDefault(); onDropZoneClick(); } }}
            role="button"
            aria-label={`Drop a ${placeholderLabel} here or click to choose`}
            aria-disabled={uploadControlsLocked || submitting}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors text-center ${dropZoneClass}`}
          >
            <Upload className={`h-5 w-5 ${uiStatus === 'failed' ? 'text-red-500' : uiStatus === 'ready' ? 'text-emerald-600' : 'text-indigo-500'}`} />
            <div className="text-sm font-medium text-gray-800">
              {uiStatus === 'uploading' && <>Uploading {placeholderLabel}… {progress}%</>}
              {uiStatus === 'validating' && <>Validating upload server-side…</>}
              {uiStatus === 'dragging' && <>Release to upload</>}
              {uiStatus === 'ready' && <>Upload complete — ready to schedule</>}
              {uiStatus === 'failed' && <>Upload failed — try again</>}
              {uiStatus === 'idle' && (uploadControlsLocked
                ? <>Click "Replace media" above to upload a new file.</>
                : <>Drag &amp; drop your {placeholderLabel}, or click to select</>)}
            </div>
            <div className="text-[11px] text-gray-500">
              Accepted: {acceptAttr.replace('/*', '/*')} · max 2 GB · paste a file from clipboard
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr}
              onChange={onPickerChange}
              disabled={submitting || uploadControlsLocked}
              className="hidden"
            />
          </div>
          {(uiStatus === 'uploading' || uiStatus === 'validating') && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className={`h-full bg-indigo-500 transition-all duration-150 ${uiStatus === 'validating' ? 'animate-pulse' : ''}`}
                  style={{ width: `${uiStatus === 'validating' ? 100 : progress}%` }}
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  role="progressbar"
                />
              </div>
              {uiStatus === 'uploading' && (
                <button
                  type="button"
                  onClick={cancelUpload}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-800 underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* URL paste field (preserved) */}
      <div className="mt-3 space-y-2">
        <label className="text-xs font-medium text-gray-700">
          {directUploadEnabled ? 'Or paste a media URL' : 'Media URL'}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={state.contentType === 'podcast' ? 'https://...mp3 or platform episode link' : 'https://...mp4 or platform link (YouTube, Vimeo, etc.)'}
          disabled={submitting || uploadControlsLocked}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 disabled:bg-gray-50"
        />
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            <input type="radio" name={`upload-source-${state.dailyPlanId}`} checked={source === 'external_link'} onChange={() => setSource('external_link')} disabled={submitting || uploadControlsLocked} /> External link
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`upload-source-${state.dailyPlanId}`} checked={source === 'user_upload'} onChange={() => setSource('user_upload')} disabled={submitting || uploadControlsLocked} /> User upload
          </label>
        </div>
        <button
          type="button"
          onClick={submitUrl}
          disabled={submitting || uploadControlsLocked || !url.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {isFailed ? 'Retry URL upload' : (isReady || isScheduled ? 'Re-upload from URL' : 'Submit URL')}
        </button>
      </div>

      {/* Preview of the currently-persisted uploaded media */}
      {previewUrl && (isReady || isScheduled) && (
        <UploadedMediaPreview url={previewUrl} mime={previewMime} />
      )}

      {localOk && (
        <p className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5">
          <Check className="h-3 w-3 inline mr-1" /> {localOk}
        </p>
      )}
      {localError && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5">{localError}</p>
      )}
      {!localError && isFailed && validationErrors.length > 0 && (
        <ul className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5 list-disc pl-5">
          {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
        </ul>
      )}
      {(isReady || isScheduled) && state.uploadedMediaUrl && (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-medium">Uploaded:</span>{' '}
          <a href={state.uploadedMediaUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">
            {state.uploadedMediaUrl}
          </a>
        </p>
      )}
      {isAwaiting && !localError && !localOk && (
        <p className="mt-2 text-xs text-amber-700">
          Provide the finished {state.contentType} URL (platform link or direct media), or drop a file above. Validation runs server-side before the row becomes schedulable.
        </p>
      )}
    </div>
  );
}

export default function CreatorContentPanel({
  theme,
  productionBrief,
  talkingPoints,
  creatorInstructions,
  creatorAsset,
  contentType = 'video',
  platforms,
  onAssetSaved,
  onGeneratePromotion,
  isGeneratingPromotion = false,
  campaignId,
  executionId,
  weekNumber,
  day,
  objective = '',
  targetAudience = '',
  existingHashtags = [],
  onNotice,
  attachmentRowState,
  onUploadMedia,
  onUploadFile,
  onReschedule,
  onUnschedule,
  resumableUploadHandle,
  onResumeUpload,
  onDiscardResumableUpload,
}: CreatorContentPanelProps) {
  const assetType = useMemo(() => resolveAssetType(contentType), [contentType]);
  const targetPlatforms = platforms && platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;

  /* ── Section collapse state ── */
  const [profileOpen, setProfileOpen] = useState(true);
  const [assetOpen, setAssetOpen] = useState(true);
  const [marketingOpen, setMarketingOpen] = useState(true);

  /* ── 1. Creator Profile ── */
  const [profile, setProfile] = useState<CreatorProfile>(creatorAsset?.creator_profile ?? {});

  /* ── 2. Media Asset ── */
  const [masterUrl, setMasterUrl] = useState(creatorAsset?.url ?? '');
  const [masterCaption, setMasterCaption] = useState(creatorAsset?.description ?? creatorAsset?.theme ?? '');
  const [transcript, setTranscript] = useState(creatorAsset?.transcript ?? '');
  const [masterApplied, setMasterApplied] = useState(false);
  const [platformUploads, setPlatformUploads] = useState<Record<string, PlatformUpload>>(() => {
    const existing = creatorAsset?.platformUploads ?? {};
    const init: Record<string, PlatformUpload> = {};
    for (const p of targetPlatforms) init[p] = existing[p] ?? {};
    return init;
  });

  /* ── 3. Marketing Package ── */
  const [marketing, setMarketing] = useState<MarketingPackage>(creatorAsset?.marketing ?? {});
  const [isGeneratingMarketing, setIsGeneratingMarketing] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  /* ── PHASE CREATOR-VIDEO-UX-SIMPLIFICATION ──────────────────────────
   * Video workflow collapses to: who uploaded + same/different video.
   * Marketing Package, Creator Profile, transcript, SEO, per-platform
   * marketing blocks are all dead-collection (dropped server-side, no
   * consumers) — hidden for video. AI generates packaging during
   * execution; the creator only supplies the asset + ownership. */
  // `String(...)` keeps this a plain boolean so it does NOT narrow `assetType`
  // inside the gated legacy (`!isVideoWorkflow`) branch, which still references
  // assetType === 'video' for image/carousel rendering.
  const isVideoWorkflow = String(assetType) === 'video';
  const { user, userName, selectedCompanyId } = useCompanyContext();
  const [uploadedById, setUploadedById] = useState<string>(creatorAsset?.uploaded_by?.user_id ?? '');
  const [uploadedByName, setUploadedByName] = useState<string>(creatorAsset?.uploaded_by?.name ?? '');
  const [videoMode, setVideoMode] = useState<'same' | 'different'>(
    DIFFERENT_VIDEO_ENABLED && creatorAsset?.video_mode === 'different' ? 'different' : 'same',
  );
  const [sameVideoUrl, setSameVideoUrl] = useState<string>(creatorAsset?.url ?? '');
  const [videoTitle, setVideoTitle] = useState<string>(creatorAsset?.description ?? '');
  // Per-platform video mapping rows (platform + format + url + title). Seeded
  // from the richer platform_video_mappings, else from legacy platform_videos
  // (one row per platform, default format) for backward compatibility.
  const [mappings, setMappings] = useState<VideoMappingRow[]>(() => {
    const rich = creatorAsset?.platform_video_mappings;
    if (Array.isArray(rich) && rich.length > 0) {
      return rich.map((m) => ({
        id: nextVmapId(),
        platformId: normalizeVideoPlatform(m.platformId),
        videoFormat: m.videoFormat || (getVideoFormatsForPlatform(m.platformId)[0] ?? ''),
        videoUrl: m.videoUrl || '',
        videoTitle: m.videoTitle || '',
      }));
    }
    const legacy = creatorAsset?.platform_videos ?? {};
    return Object.entries(legacy)
      .filter(([, url]) => String(url || '').trim())
      .map(([p, url]) => ({
        id: nextVmapId(),
        platformId: normalizeVideoPlatform(p),
        videoFormat: getVideoFormatsForPlatform(p)[0] ?? '',
        videoUrl: String(url),
        videoTitle: '',
      }));
  });
  // Connected platforms (governance) — only these are selectable in mappings.
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [teamMembers, setTeamMembers] = useState<Array<{ user_id: string; name: string }>>([]);

  // Prefill "Uploaded By" with the logged-in user once context resolves.
  useEffect(() => {
    if (!uploadedById && user?.userId) {
      setUploadedById(user.userId);
      setUploadedByName(userName || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, userName]);

  // Team-member fallback dropdown (only the video workflow needs it).
  useEffect(() => {
    if (!isVideoWorkflow || !selectedCompanyId) return;
    let cancelled = false;
    fetch(`/api/company/users?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.users)) return;
        setTeamMembers(
          d.users
            .filter((u: any) => u?.user_id)
            .map((u: any) => ({ user_id: String(u.user_id), name: String(u.name || u.email || u.user_id) })),
        );
      })
      .catch(() => { /* dropdown is best-effort; prefill still works */ });
    return () => { cancelled = true; };
  }, [isVideoWorkflow, selectedCompanyId]);

  // Connected-platform registry (governance): only connected, video-capable
  // platforms may be selected in mappings.
  useEffect(() => {
    if (!isVideoWorkflow || !selectedCompanyId) return;
    let cancelled = false;
    fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.accounts)) return;
        const connected = d.accounts
          .filter((a: any) => a?.connected)
          .map((a: any) => normalizeVideoPlatform(String(a.platform_key || '')))
          .filter((p: string) => platformSupportsVideo(p));
        setConnectedPlatforms(Array.from(new Set<string>(connected)));
      })
      .catch(() => { /* governance is best-effort on load; save still fail-closes */ });
    return () => { cancelled = true; };
  }, [isVideoWorkflow, selectedCompanyId]);

  // Platforms offered in the mapping picker — connected ∩ video-capable.
  const availableVideoPlatforms = useMemo(() => connectedPlatforms, [connectedPlatforms]);

  // ── Mapping row helpers ────────────────────────────────────────────────────
  const addMappingRow = () => {
    const platformId = availableVideoPlatforms[0] ?? '';
    setMappings((prev) => [
      ...prev,
      { id: nextVmapId(), platformId, videoFormat: getVideoFormatsForPlatform(platformId)[0] ?? '', videoUrl: '', videoTitle: '' },
    ]);
  };
  const removeMappingRow = (id: string) => setMappings((prev) => prev.filter((r) => r.id !== id));
  const updateMappingRow = (id: string, patch: Partial<VideoMappingRow>) =>
    setMappings((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      // When the platform changes, reset to a format valid for it.
      if (patch.platformId && !isValidPlatformVideoFormat(next.platformId, next.videoFormat)) {
        next.videoFormat = getVideoFormatsForPlatform(next.platformId)[0] ?? '';
      }
      return next;
    }));

  // ── Governance validation (UI + Save use the SAME checks; fail closed) ─────
  const mappingRowError = (row: VideoMappingRow): string | null => {
    if (!row.platformId) return 'Select a platform.';
    if (connectedPlatforms.length > 0 && !connectedPlatforms.includes(row.platformId)) return 'Platform disconnected — reconnect or remove this row.';
    if (!row.videoFormat) return 'Select a format.';
    if (!isValidPlatformVideoFormat(row.platformId, row.videoFormat)) return `${row.videoFormat} is not valid for this platform.`;
    if (!row.videoUrl.trim()) return 'Add the video URL.';
    return null;
  };
  const duplicateMappingIds = useMemo(() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    for (const r of mappings) {
      const key = `${r.platformId}::${r.videoFormat}`;
      if (!r.platformId || !r.videoFormat) continue;
      if (seen.has(key)) { dups.add(r.id); dups.add(seen.get(key)!); }
      else seen.set(key, r.id);
    }
    return dups;
  }, [mappings]);
  const mappingsValid = mappings.length > 0
    && mappings.every((r) => !mappingRowError(r))
    && duplicateMappingIds.size === 0;

  const canSaveVideo = !!uploadedById && (
    videoMode === 'same' ? sameVideoUrl.trim().length > 0 : mappingsValid
  );

  const handleSaveVideoSimplified = async () => {
    if (!uploadedById) { onNotice?.('info', 'Select who uploaded this video.'); return; }
    if (videoMode === 'same' && !sameVideoUrl.trim()) { onNotice?.('info', 'Add the video URL.'); return; }
    if (videoMode === 'different') {
      // Fail-closed governance: at least one row; every row valid (connected,
      // capable format, url present); no duplicate platform+format combos.
      if (mappings.length === 0) { onNotice?.('info', 'Add at least one platform video.'); return; }
      if (duplicateMappingIds.size > 0) { onNotice?.('error', 'Duplicate platform + format combinations are not allowed.'); return; }
      const firstErr = mappings.map(mappingRowError).find(Boolean);
      if (firstErr) { onNotice?.('error', firstErr); return; }
    }
    setIsSaving(true);
    try {
      // Build the rich mappings; derive the per-platform primary url that the
      // publish resolver (resolveVideoForPlatform) already consumes.
      const platform_video_mappings = videoMode === 'different'
        ? mappings.map((r) => ({
            platformId: r.platformId,
            videoFormat: r.videoFormat,
            videoUrl: r.videoUrl.trim(),
            videoTitle: r.videoTitle.trim() || undefined,
            uploadedBy: uploadedById,
          }))
        : undefined;
      const platform_videos = videoMode === 'different'
        ? mappings.reduce<Record<string, string>>((acc, r) => {
            // One primary url per platform — first row for that platform wins.
            if (!acc[r.platformId]) acc[r.platformId] = r.videoUrl.trim();
            return acc;
          }, {})
        : undefined;
      const primaryUrl = videoMode === 'same'
        ? sameVideoUrl.trim()
        : (mappings[0]?.videoUrl.trim() ?? '');
      const asset: CreatorAssetPayload = {
        type: assetType,
        url: primaryUrl || undefined,
        theme: theme || undefined,
        description: videoTitle.trim() || undefined,
        uploaded_by: { user_id: uploadedById, name: uploadedByName || undefined },
        video_mode: videoMode,
        ...(platform_videos ? { platform_videos } : {}),
        ...(platform_video_mappings ? { platform_video_mappings } : {}),
        ...(platform_videos
          ? { platformUploads: Object.fromEntries(Object.entries(platform_videos).map(([p, v]) => [p, { externalLink: v }])) }
          : {}),
      };
      const res = await fetch('/api/activity-workspace/creator-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_id: executionId,
          campaign_id: campaignId,
          week_number: weekNumber,
          day,
          creator_asset: asset,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? data?.message ?? 'Failed to save video asset');
      onAssetSaved(asset);
      onNotice?.('success', 'Video asset saved. Generating the caption, hashtags & CTA to post with it…');
      // Auto-offer the marketing content on upload: generate the platform
      // caption/hashtags/CTA immediately from the just-saved asset (passed
      // directly to avoid the async creatorAsset state being stale).
      try { onGeneratePromotion(asset as unknown as Record<string, unknown>); } catch { /* non-fatal */ }
    } catch (err) {
      onNotice?.('error', String((err as Error)?.message ?? 'Failed to save'));
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Apply master to all ── */
  const handleApplyToAll = () => {
    if (!masterUrl.trim() && !masterCaption.trim()) {
      onNotice?.('info', 'Enter a link or caption above, then click Apply to all.');
      return;
    }
    setPlatformUploads((prev) => {
      const next: Record<string, PlatformUpload> = {};
      for (const p of targetPlatforms) {
        next[p] = {
          ...prev[p],
          ...(masterUrl.trim() ? { externalLink: masterUrl.trim() } : {}),
          ...(masterCaption.trim() ? { caption: masterCaption.trim() } : {}),
        };
      }
      return next;
    });
    setMasterApplied(true);
    setTimeout(() => setMasterApplied(false), 2000);
  };

  /* ── Generate AI Marketing Package ── */
  const handleGenerateMarketing = async () => {
    setIsGeneratingMarketing(true);
    try {
      const res = await fetch('/api/activity-workspace/generate-marketing-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: theme || masterCaption,
          summary: productionBrief || transcript,
          objective,
          target_audience: targetAudience,
          content_type: contentType,
          platforms: targetPlatforms,
          existing_hashtags: existingHashtags,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to generate marketing package');
      const pkg = data.marketing as MarketingPackage;
      setMarketing(pkg);
      // Pre-fill per-platform hashtags if not already set by user
      setPlatformUploads((prev) => {
        const next = { ...prev };
        for (const p of targetPlatforms) {
          const aiHashtags = pkg.platform_hashtags?.[p] ?? pkg.hashtags ?? [];
          if (aiHashtags.length > 0 && !(next[p]?.hashtags?.length)) {
            next[p] = { ...next[p], hashtags: aiHashtags };
          }
        }
        return next;
      });
      onNotice?.('success', 'Marketing package generated. Review and edit before saving.');
    } catch (err) {
      onNotice?.('error', String((err as Error)?.message ?? 'Failed to generate'));
    } finally {
      setIsGeneratingMarketing(false);
    }
  };

  /* ── Save ── */
  const hasAnyLink = targetPlatforms.some((p) => {
    const u = platformUploads[p];
    return u?.externalLink?.trim() || u?.slides?.some((s) => s.trim());
  });

  const canSave = hasAnyLink && (masterCaption.trim().length > 0 || transcript.trim().length > 0 || Boolean(theme));

  const hasAsset = Boolean(
    creatorAsset &&
    (creatorAsset.platformUploads &&
      Object.values(creatorAsset.platformUploads).some((u) => u?.externalLink?.trim() || u?.slides?.some((s) => s?.trim())))
  );

  const handleSave = async () => {
    if (!canSave) {
      onNotice?.('info', 'Add at least one platform link and a description/caption.');
      return;
    }
    setIsSaving(true);
    try {
      const primaryPlatform = targetPlatforms.find((p) => platformUploads[p]?.externalLink?.trim());
      const primaryUrl = primaryPlatform ? (platformUploads[primaryPlatform].externalLink?.trim() ?? '') : '';

      const asset: CreatorAssetPayload = {
        type: assetType,
        url: primaryUrl || undefined,
        description: masterCaption.trim() || undefined,
        transcript: transcript.trim() || undefined,
        theme: theme || undefined,
        creator_profile: Object.values(profile).some(Boolean) ? profile : undefined,
        marketing: Object.values(marketing).some(Boolean) ? marketing : undefined,
        platformUploads,
      };

      const res = await fetch('/api/activity-workspace/creator-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_id: executionId,
          campaign_id: campaignId,
          week_number: weekNumber,
          day,
          creator_asset: asset,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? data?.message ?? 'Failed to save creator asset');

      onAssetSaved(asset);
      onNotice?.('success', 'Creator asset saved. Generating platform posts (caption, hashtags & CTA)…');
      // Auto-offer the marketing content on upload (see video handler above).
      try { onGeneratePromotion(asset as unknown as Record<string, unknown>); } catch { /* non-fatal */ }
    } catch (err) {
      onNotice?.('error', String((err as Error)?.message ?? 'Failed to save'));
    } finally {
      setIsSaving(false);
    }
  };

  const assetTypeIcon = assetType === 'video'
    ? <Video className="h-4 w-4" />
    : assetType === 'carousel' ? <LayoutGrid className="h-4 w-4" /> : <Image className="h-4 w-4" />;
  const assetTypeLabel = assetType === 'video' ? 'Video' : assetType === 'carousel' ? 'Carousel' : 'Image';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Upload className="h-4 w-4 text-amber-600" />
          Creator Workspace
        </h2>
        <span className="flex items-center gap-1 text-xs font-medium text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded-full">
          {assetTypeIcon} {assetTypeLabel}
        </span>
      </div>

      <div className="divide-y divide-gray-100">

        {/* ── Attachment-required upload section (renders only when state is provided) ── */}
        {attachmentRowState && onUploadMedia && (
          <AttachmentUploadSection
            state={attachmentRowState}
            onUploadMedia={onUploadMedia}
            onUploadFile={onUploadFile}
            onReschedule={onReschedule}
            onUnschedule={onUnschedule}
            resumableUploadHandle={resumableUploadHandle}
            onResumeUpload={onResumeUpload}
            onDiscardResumableUpload={onDiscardResumableUpload}
            onNotice={onNotice}
          />
        )}

        {/* ── PHASE CREATOR-VIDEO-UX-SIMPLIFICATION: simplified video flow ── */}
        {isVideoWorkflow && (
          <div className="px-5 py-4 space-y-4">
            <SectionHeader
              icon={<Video className="h-3.5 w-3.5" />}
              title="Video Asset"
              subtitle="Upload your video, confirm ownership, and choose platform mapping."
            />

            {/* Uploaded By — reuses the logged-in user; team dropdown as fallback */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                <Users className="h-3 w-3" /> Uploaded by
              </label>
              <select
                value={uploadedById}
                onChange={(e) => {
                  const id = e.target.value;
                  setUploadedById(id);
                  const m = teamMembers.find((t) => t.user_id === id);
                  setUploadedByName(m?.name ?? (id === user?.userId ? (userName || '') : ''));
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
              >
                {user?.userId && !teamMembers.some((t) => t.user_id === user.userId) && (
                  <option value={user.userId}>{userName || 'Me'} (you)</option>
                )}
                {teamMembers.map((t) => (
                  <option key={t.user_id} value={t.user_id}>
                    {t.name}{t.user_id === user?.userId ? ' (you)' : ''}
                  </option>
                ))}
                {!user?.userId && teamMembers.length === 0 && <option value="">Loading…</option>}
              </select>
            </div>

            {/* Step 1 — same vs different video */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">How would you like to provide videos?</p>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                  <input type="radio" name="video-mode" checked={videoMode === 'same'} onChange={() => setVideoMode('same')} className="mt-0.5" />
                  <span>Use the <b>same video</b> across all selected platforms</span>
                </label>
                <label className={`flex items-start gap-2 text-sm ${DIFFERENT_VIDEO_ENABLED ? 'text-gray-800 cursor-pointer' : 'text-gray-400 cursor-not-allowed'}`}>
                  <input
                    type="radio"
                    name="video-mode"
                    checked={videoMode === 'different'}
                    disabled={!DIFFERENT_VIDEO_ENABLED}
                    onChange={() => { if (DIFFERENT_VIDEO_ENABLED) setVideoMode('different'); }}
                    className="mt-0.5"
                  />
                  <span>
                    Use <b>different videos</b> for different platforms
                    {!DIFFERENT_VIDEO_ENABLED && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Coming soon</span>
                    )}
                  </span>
                </label>
              </div>
            </div>

            {/* Same-video mode — URL + optional title only */}
            {videoMode === 'same' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                    <Link2 className="h-3 w-3" /> Video URL
                  </label>
                  <input
                    type="url"
                    value={sameVideoUrl}
                    onChange={(e) => setSameVideoUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=…  or a direct .mp4 link"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                  {sameVideoUrl.trim() && <LinkPreview url={sameVideoUrl.trim()} label="Open video" />}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Video title <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    placeholder="Short label for this video…"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
            )}

            {/* Different-video mode — platform video mapping rows */}
            {videoMode === 'different' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-600">Platform video mapping</p>
                  <button
                    type="button"
                    onClick={addMappingRow}
                    disabled={availableVideoPlatforms.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Platform
                  </button>
                </div>

                {availableVideoPlatforms.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    No connected video-capable platforms. Connect an account (Instagram, YouTube, TikTok, …) to map platform videos.
                  </p>
                ) : null}

                {mappings.map((row) => {
                  const err = mappingRowError(row);
                  const isDup = duplicateMappingIds.has(row.id);
                  const formats = getVideoFormatsForPlatform(row.platformId);
                  const platformOptions = Array.from(new Set([...availableVideoPlatforms, ...(row.platformId ? [row.platformId] : [])]));
                  return (
                    <div key={row.id} className={`rounded-lg border p-3 ${err || isDup ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={row.platformId}
                          onChange={(e) => updateMappingRow(row.id, { platformId: e.target.value })}
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400"
                        >
                          {platformOptions.map((p) => (
                            <option key={p} value={p}>{PLATFORM_LABELS[p] ?? p}</option>
                          ))}
                        </select>
                        <select
                          value={row.videoFormat}
                          onChange={(e) => updateMappingRow(row.id, { videoFormat: e.target.value })}
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400"
                        >
                          {formats.length === 0 ? <option value="">—</option> : null}
                          {formats.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeMappingRow(row.id)}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                      <input
                        type="url"
                        value={row.videoUrl}
                        onChange={(e) => updateMappingRow(row.id, { videoUrl: e.target.value })}
                        placeholder="https://… video URL"
                        className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                      />
                      <input
                        type="text"
                        value={row.videoTitle}
                        onChange={(e) => updateMappingRow(row.id, { videoTitle: e.target.value })}
                        placeholder="Video title (optional)"
                        className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                      />
                      {(err || isDup) ? (
                        <p className="mt-1.5 text-[11px] font-medium text-red-600">
                          {isDup ? 'Duplicate platform + format combination.' : err}
                        </p>
                      ) : null}
                    </div>
                  );
                })}

                {/* Informational guidance — connected platforms + supported formats (read-only) */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Connected platforms</p>
                  <p className="text-xs text-gray-600">
                    {availableVideoPlatforms.length > 0
                      ? availableVideoPlatforms.map((p) => `${PLATFORM_LABELS[p] ?? p} ✓`).join('   ')
                      : 'None connected.'}
                  </p>
                  <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Supported formats</p>
                  <ul className="space-y-0.5 text-xs text-gray-600">
                    {listVideoCapablePlatforms().map((p) => (
                      <li key={p}>{PLATFORM_LABELS[p] ?? p} → {getVideoFormatsForPlatform(p).join(', ')}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              Captions, hashtags, SEO and CTA are generated automatically by AI for each platform — you don't need to enter them here.
            </p>
          </div>
        )}

        {!isVideoWorkflow && (<>
        {/* ── Section 1: Creator Profile ───────────────────────────── */}
        <div className="px-5 py-4">
          <button
            type="button"
            onClick={() => setProfileOpen((x) => !x)}
            className="w-full flex items-center justify-between mb-1 group"
          >
            <SectionHeader
              icon={<User className="h-3.5 w-3.5" />}
              title="Creator Profile"
              subtitle="Who is producing this content?"
            />
            {profileOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>

          {profileOpen && (
            <div className="space-y-3 mt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Creator name</label>
                  <input
                    type="text"
                    value={profile.name ?? ''}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Jane Smith"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Handle / username</label>
                  <input
                    type="text"
                    value={profile.handle ?? ''}
                    onChange={(e) => setProfile((p) => ({ ...p, handle: e.target.value }))}
                    placeholder="@janesmith"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Main profile URL</label>
                <input
                  type="url"
                  value={profile.profile_url ?? ''}
                  onChange={(e) => setProfile((p) => ({ ...p, profile_url: e.target.value }))}
                  placeholder="https://linkedin.com/in/janesmith"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Creator bio / tagline
                  <span className="text-gray-400 font-normal ml-1">(used in post attribution)</span>
                </label>
                <textarea
                  value={profile.bio ?? ''}
                  onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="2-3 sentence bio or tagline that will appear alongside the post…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
                />
              </div>
              {/* Per-platform profile links */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Platform profile links
                  <span className="text-gray-400 font-normal ml-1">(for tagging / attribution per platform)</span>
                </label>
                <div className="space-y-2">
                  {targetPlatforms.map((p) => (
                    <div key={p} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-20 shrink-0">{PLATFORM_LABELS[p] ?? p}</span>
                      <input
                        type="url"
                        value={profile.platform_profiles?.[p] ?? ''}
                        onChange={(e) =>
                          setProfile((prev) => ({
                            ...prev,
                            platform_profiles: { ...(prev.platform_profiles ?? {}), [p]: e.target.value },
                          }))
                        }
                        placeholder={`https://${p}.com/...`}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 2: Media Asset ───────────────────────────────── */}
        <div className="px-5 py-4">
          <button
            type="button"
            onClick={() => setAssetOpen((x) => !x)}
            className="w-full flex items-center justify-between mb-1 group"
          >
            <SectionHeader
              icon={assetTypeIcon}
              title={`${assetTypeLabel} Asset`}
              subtitle="Upload URL and per-platform details"
            />
            {assetOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>

          {assetOpen && (
            <div className="space-y-4 mt-3">
              {/* Master / apply-to-all */}
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">Apply same {assetTypeLabel.toLowerCase()} to all platforms</p>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">optional</span>
                </div>

                <div className="flex gap-2 items-start">
                  <ExternalLink className="h-4 w-4 text-gray-400 mt-2.5 shrink-0" />
                  <input
                    type="url"
                    value={masterUrl}
                    onChange={(e) => setMasterUrl(e.target.value)}
                    placeholder={
                      assetType === 'video' ? 'YouTube, Vimeo, TikTok, or any platform video URL…'
                      : assetType === 'carousel' ? 'Canva deck, PDF, or first slide link to apply everywhere…'
                      : 'Canva, Google Drive, Dropbox, or any image link…'
                    }
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                  />
                </div>
                {masterUrl.trim() && <LinkPreview url={masterUrl.trim()} label="Open link" />}

                <textarea
                  value={masterCaption}
                  onChange={(e) => setMasterCaption(e.target.value)}
                  placeholder="Master marketing message / description to apply to all platforms…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none bg-white"
                />

                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {assetType === 'video' ? 'Video transcript' : assetType === 'carousel' ? 'Slide notes / script' : 'Alt text / notes'}
                    <span className="text-gray-400 ml-1">(optional — helps AI write captions)</span>
                  </label>
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder={
                      assetType === 'video' ? 'Paste video transcript here…'
                      : assetType === 'carousel' ? 'Paste slide notes or presenter script here…'
                      : 'Describe the image for AI context…'
                    }
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none bg-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleApplyToAll}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-xs hover:bg-indigo-100 transition-colors"
                >
                  {masterApplied ? <><Check className="h-3.5 w-3.5" /> Applied to all</> : <><Copy className="h-3.5 w-3.5" /> Apply to all platforms</>}
                </button>
              </div>

              {/* Per-platform upload cards */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-700">Per-platform customisation</p>
                {targetPlatforms.map((platform) => (
                  <PlatformCard
                    key={platform}
                    platform={platform}
                    assetType={assetType}
                    upload={platformUploads[platform] ?? {}}
                    platformHashtags={marketing.platform_hashtags?.[platform] ?? marketing.hashtags}
                    onChange={(upd) => setPlatformUploads((prev) => ({ ...prev, [platform]: upd }))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Marketing Package ─────────────────────────── */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => setMarketingOpen((x) => !x)}
              className="flex items-center gap-2 text-left"
            >
              <SectionHeader
                icon={<Megaphone className="h-3.5 w-3.5" />}
                title="Marketing Package"
                subtitle="SEO, hashtags, meta description &amp; CTA"
              />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateMarketing}
                disabled={isGeneratingMarketing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {isGeneratingMarketing
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-3.5 w-3.5" /> AI Generate</>}
              </button>
              <button type="button" onClick={() => setMarketingOpen((x) => !x)}>
                {marketingOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>
            </div>
          </div>

          {marketingOpen && (
            <div className="space-y-3 mt-3">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Content title
                  <span className="text-gray-400 font-normal ml-1">(SEO-optimised, 60-70 chars)</span>
                </label>
                <input
                  type="text"
                  value={marketing.title ?? ''}
                  onChange={(e) => setMarketing((m) => ({ ...m, title: e.target.value }))}
                  placeholder="Compelling title for your content…"
                  maxLength={80}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
                {(marketing.title?.length ?? 0) > 0 && (
                  <p className={`text-[10px] mt-0.5 ${(marketing.title?.length ?? 0) > 70 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {marketing.title?.length ?? 0} / 70 chars
                  </p>
                )}
              </div>

              {/* Summary */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Content summary
                  <span className="text-gray-400 font-normal ml-1">(for bio / description fields)</span>
                </label>
                <textarea
                  value={marketing.summary ?? ''}
                  onChange={(e) => setMarketing((m) => ({ ...m, summary: e.target.value }))}
                  placeholder="2-3 sentence summary of the content…"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
                />
              </div>

              {/* Meta description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Search className="h-3 w-3" /> Meta description
                  <span className="text-gray-400 font-normal ml-1">(150-160 chars, for web/SEO)</span>
                </label>
                <textarea
                  value={marketing.meta_description ?? ''}
                  onChange={(e) => setMarketing((m) => ({ ...m, meta_description: e.target.value }))}
                  placeholder="SEO meta description for website / embed preview…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
                />
                {(marketing.meta_description?.length ?? 0) > 0 && (
                  <p className={`text-[10px] mt-0.5 ${(marketing.meta_description?.length ?? 0) > 160 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {marketing.meta_description?.length ?? 0} / 160 chars
                  </p>
                )}
              </div>

              {/* SEO keywords */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> SEO keywords
                  <span className="text-gray-400 font-normal ml-1">(press Enter or comma to add)</span>
                </label>
                <TagInput
                  value={marketing.seo_keywords ?? []}
                  onChange={(v) => setMarketing((m) => ({ ...m, seo_keywords: v }))}
                  placeholder="keyword, keyword…"
                />
              </div>

              {/* Universal hashtags */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Hash className="h-3 w-3" /> Universal hashtags
                  <span className="text-gray-400 font-normal ml-1">(cross-platform defaults)</span>
                </label>
                <TagInput
                  value={marketing.hashtags ?? []}
                  onChange={(v) => setMarketing((m) => ({ ...m, hashtags: v }))}
                  placeholder="#hashtag, #hashtag…"
                  prefix="#"
                />
              </div>

              {/* CTA */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Call to action
                </label>
                <input
                  type="text"
                  value={marketing.cta ?? ''}
                  onChange={(e) => setMarketing((m) => ({ ...m, cta: e.target.value }))}
                  placeholder="Watch now · Subscribe · Comment below · Link in bio…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>

              {/* Regenerate hint */}
              {Object.values(marketing).some(Boolean) && (
                <button
                  type="button"
                  onClick={handleGenerateMarketing}
                  disabled={isGeneratingMarketing}
                  className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" /> Regenerate with AI
                </button>
              )}
            </div>
          )}
        </div>

        </>)}

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="px-5 py-4 bg-gray-50/60 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={isVideoWorkflow ? handleSaveVideoSimplified : handleSave}
            disabled={isSaving || (isVideoWorkflow ? !canSaveVideo : !canSave)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isVideoWorkflow ? 'Save Video Asset' : 'Save Creator Asset'}
          </button>
          {hasAsset && (
            <button
              type="button"
              onClick={() => onGeneratePromotion()}
              disabled={isGeneratingPromotion}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isGeneratingPromotion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Promotion Content
            </button>
          )}
          {isVideoWorkflow
            ? !canSaveVideo && (
                <p className="text-xs text-gray-400 self-center">
                  Select who uploaded it and add {videoMode === 'same' ? 'the video URL' : 'at least one platform video URL'} to enable save.
                </p>
              )
            : !canSave && (
                <p className="text-xs text-gray-400 self-center">
                  Add at least one platform link + description to enable save.
                </p>
              )}
        </div>
      </div>
    </div>
  );
}
