/**
 * Creator Content Panel
 * Shown when execution_mode = CREATOR_REQUIRED.
 *
 * The UI adapts to the activity's content type:
 *   - video / reel / short → video player + thumbnail preview, no image/carousel toggle
 *   - image                → single image upload section
 *   - carousel             → per-slide image URL fields
 *
 * Each target platform gets its own upload card (different platforms have
 * different upload requirements / APIs). A "master source" block at the top
 * lets the creator apply the same URL + description to all platforms in one click.
 */

import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';

/* ────────────────────── types ────────────────────── */

export type CreatorAssetPayload = {
  type: 'video' | 'image' | 'carousel';
  url?: string;
  files?: string[];
  thumbnail?: string;
  description?: string;
  transcript?: string;
  theme?: string;
  platformUploads?: Record<string, PlatformUpload>;
};

export type PlatformUpload = {
  url?: string;
  externalLink?: string;
  caption?: string;
  /** carousel: image URL per slide (index = slide index) */
  slides?: string[];
};

type CreatorContentPanelProps = {
  theme: string;
  productionBrief: string;
  talkingPoints: string[];
  creatorInstructions?: Record<string, unknown> | null;
  creatorAsset?: CreatorAssetPayload | null;
  /** The activity's content type: video, reel, short, image, carousel, etc. */
  contentType?: string;
  /** Platforms this activity targets */
  platforms?: string[];
  onAssetSaved: (asset: CreatorAssetPayload) => void;
  onGeneratePromotion: () => void;
  isGeneratingPromotion?: boolean;
  campaignId: string;
  executionId: string;
  weekNumber: number;
  day: string;
  onNotice?: (type: 'success' | 'error' | 'info', message: string) => void;
};

/* ────────────────────── helpers ────────────────────── */

function resolveAssetType(ct: string): 'video' | 'image' | 'carousel' {
  const lower = ct.toLowerCase();
  if (['video', 'reel', 'short', 'live'].includes(lower)) return 'video';
  if (['carousel', 'slides', 'slide', 'slideware', 'infographic', 'deck', 'presentation'].includes(lower))
    return 'carousel';
  return 'image';
}

/** Extract YouTube video ID from common URL shapes */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null;
  } catch {
    // not a valid URL
  }
  return null;
}

function getVideoThumbnail(url: string): string | null {
  const ytId = extractYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
  return null;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
};

const PLATFORM_UPLOAD_HINTS: Record<string, string> = {
  linkedin: 'Upload via LinkedIn Video, or paste a hosted MP4/YouTube link.',
  facebook: 'Paste a Facebook video URL or a direct MP4 link.',
  instagram: 'Use a direct MP4 link (schedule via Meta API or third-party tools).',
  x: 'Paste a direct MP4 URL (max 512 MB, 140 s for regular; 10 min for X Premium).',
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
  pinterest: 'JPG/PNG 2:3 ratio (1000×1500 px recommended).',
};

/* ────────────────────── sub-components ────────────────────── */

/** Shows YouTube thumbnail (extracted from URL) or a plain open-link button. */
function LinkPreview({ url, label = 'Open link' }: { url: string; label?: string }) {
  const thumb = getVideoThumbnail(url);
  if (thumb) {
    return (
      <div className="mt-2 relative rounded-lg overflow-hidden border border-gray-200">
        <img src={thumb} alt="Video thumbnail" className="w-full max-h-48 object-cover" />
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
  onChange,
}: {
  platform: string;
  assetType: 'video' | 'image' | 'carousel';
  upload: PlatformUpload;
  onChange: (upd: PlatformUpload) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const label = PLATFORM_LABELS[platform] ?? platform;
  const hint =
    assetType === 'video'
      ? PLATFORM_UPLOAD_HINTS[platform]
      : assetType === 'carousel'
      ? CAROUSEL_HINTS[platform]
      : IMAGE_HINTS[platform];

  const slideCount = upload.slides?.length ?? 1;

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

          {/* ── Video: external link only ── */}
          {assetType === 'video' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Video link (YouTube, Vimeo, TikTok, platform post URL…)
              </label>
              <input
                type="url"
                value={upload.externalLink ?? ''}
                onChange={(e) => onChange({ ...upload, externalLink: e.target.value })}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
              />
              {(upload.externalLink ?? '').trim() && (
                <LinkPreview url={upload.externalLink!.trim()} label="Open video" />
              )}
            </div>
          )}

          {/* ── Image: external link only ── */}
          {assetType === 'image' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Image link (Canva, Google Drive, Dropbox, CDN…)
              </label>
              <input
                type="url"
                value={upload.externalLink ?? ''}
                onChange={(e) => onChange({ ...upload, externalLink: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
              />
              {(upload.externalLink ?? '').trim() && (
                <LinkPreview url={upload.externalLink!.trim()} label="Open image" />
              )}
            </div>
          )}

          {/* ── Carousel: link per slide (or a single deck link) ── */}
          {assetType === 'carousel' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600 flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Slide / deck links (one per slide, or a single PDF / Canva deck URL)
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
                <button
                  type="button"
                  onClick={() => onChange({ ...upload, slides: [...(upload.slides ?? ['']), ''] })}
                  className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 border border-indigo-200 rounded-md"
                >
                  + Add slide
                </button>
                {slideCount > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...upload, slides: (upload.slides ?? []).slice(0, -1) })}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded-md"
                  >
                    Remove last
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Marketing / promotion caption ── */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Marketing / promotion caption
              <span className="text-gray-400 font-normal ml-1">(used when generating post text)</span>
            </label>
            <textarea
              value={upload.caption ?? ''}
              onChange={(e) => onChange({ ...upload, caption: e.target.value })}
              placeholder={`Caption or key message for ${label}…`}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────── main component ────────────────────── */

const DEFAULT_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok'];

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
  onNotice,
}: CreatorContentPanelProps) {
  const assetType = useMemo(() => resolveAssetType(contentType), [contentType]);
  const targetPlatforms = platforms && platforms.length > 0 ? platforms : DEFAULT_PLATFORMS;

  // Master (apply-to-all) fields
  const [masterUrl, setMasterUrl] = useState('');
  const [masterCaption, setMasterCaption] = useState(creatorAsset?.description ?? creatorAsset?.theme ?? '');
  const [transcript, setTranscript] = useState(creatorAsset?.transcript ?? '');
  const [masterApplied, setMasterApplied] = useState(false);

  // Per-platform state
  const [platformUploads, setPlatformUploads] = useState<Record<string, PlatformUpload>>(() => {
    const existing = creatorAsset?.platformUploads ?? {};
    const init: Record<string, PlatformUpload> = {};
    for (const p of targetPlatforms) {
      init[p] = existing[p] ?? {};
    }
    return init;
  });

  const [isSaving, setIsSaving] = useState(false);

  /* ── Apply master link + caption to all platforms ── */
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
      // Canonical primary link = first platform that has one (for backwards-compat with the API url field)
      const primaryPlatform = targetPlatforms.find((p) => platformUploads[p]?.externalLink?.trim());
      const primaryUrl = primaryPlatform ? (platformUploads[primaryPlatform].externalLink?.trim() ?? '') : '';

      const asset: CreatorAssetPayload = {
        type: assetType,
        url: primaryUrl || undefined,
        description: masterCaption.trim() || undefined,
        transcript: transcript.trim() || undefined,
        theme: theme || undefined,
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
      onNotice?.('success', 'Creator asset saved. You can now generate promotion content.');
    } catch (err) {
      onNotice?.('error', String((err as Error)?.message ?? 'Failed to save'));
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Asset type label / icon ── */
  const assetTypeIcon = assetType === 'video' ? <Video className="h-4 w-4" /> : assetType === 'carousel' ? <LayoutGrid className="h-4 w-4" /> : <Image className="h-4 w-4" />;
  const assetTypeLabel = assetType === 'video' ? 'Video' : assetType === 'carousel' ? 'Carousel' : 'Image';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      {/* Header */}
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Upload className="h-5 w-5 text-amber-600" />
        Creator Workspace
        <span className="ml-auto flex items-center gap-1 text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {assetTypeIcon} {assetTypeLabel}
        </span>
      </h2>

      {/* Brief info */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Content Theme</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">{theme || '—'}</div>
        </div>
        {productionBrief && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Production Brief</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">{productionBrief}</div>
          </div>
        )}
        {talkingPoints.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Talking Points</label>
            <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-800">
              {talkingPoints.map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          </div>
        )}
        {creatorInstructions && typeof creatorInstructions === 'object' && Object.keys(creatorInstructions).length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Creator Instructions</label>
            <div className="rounded-lg border border-gray-200 bg-amber-50/50 px-3 py-2 text-sm text-gray-800">
              <pre className="whitespace-pre-wrap font-sans text-sm">{JSON.stringify(creatorInstructions, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>

      {/* ── Master / apply-to-all ── */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-gray-800">
            Apply same {assetTypeLabel.toLowerCase()} to all platforms
          </label>
          <span className="text-xs text-gray-400">(optional — fill per-platform below instead)</span>
        </div>

        <div className="flex gap-2 items-start">
          <ExternalLink className="h-4 w-4 text-gray-400 mt-2.5 shrink-0" />
          <input
            type="url"
            value={masterUrl}
            onChange={(e) => setMasterUrl(e.target.value)}
            placeholder={
              assetType === 'video'
                ? 'YouTube, Vimeo, TikTok, or any platform video URL…'
                : assetType === 'carousel'
                ? 'Canva deck, PDF, or first slide link to apply everywhere…'
                : 'Canva, Google Drive, Dropbox, or any image link…'
            }
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>

        {masterUrl.trim() && <LinkPreview url={masterUrl.trim()} label="Open link" />}

        <textarea
          value={masterCaption}
          onChange={(e) => setMasterCaption(e.target.value)}
          placeholder="Description / marketing message to apply to all platforms…"
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
        />

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            {assetType === 'video' ? 'Transcript' : assetType === 'carousel' ? 'Slide notes / script' : 'Alt text / notes'}
            <span className="text-gray-400 ml-1">(optional — helps AI write platform captions)</span>
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={
              assetType === 'video'
                ? 'Paste video transcript here…'
                : assetType === 'carousel'
                ? 'Paste slide notes or presenter script here…'
                : 'Describe the image for AI context…'
            }
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
          />
        </div>

        <button
          type="button"
          onClick={handleApplyToAll}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-sm hover:bg-indigo-100 transition-colors"
        >
          {masterApplied
            ? <><Check className="h-4 w-4" /> Applied to all platforms</>
            : <><Copy className="h-4 w-4" /> Apply to all platforms</>}
        </button>
      </div>

      {/* ── Per-platform cards ── */}
      <div className="space-y-2 border-t border-gray-200 pt-4">
        <label className="block text-sm font-semibold text-gray-800 mb-2">
          Per-platform upload
          <span className="text-xs font-normal text-gray-400 ml-2">— customise for each platform</span>
        </label>
        {targetPlatforms.map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            assetType={assetType}
            upload={platformUploads[platform] ?? {}}
            onChange={(upd) => setPlatformUploads((prev) => ({ ...prev, [platform]: upd }))}
          />
        ))}
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !canSave}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Save Creator Asset
        </button>
        {hasAsset && (
          <button
            type="button"
            onClick={onGeneratePromotion}
            disabled={isGeneratingPromotion}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isGeneratingPromotion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Promotion Content
          </button>
        )}
      </div>
    </div>
  );
}
