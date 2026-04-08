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
  User,
  Tag,
  Search,
  Hash,
  FileText,
  Megaphone,
  RefreshCw,
} from 'lucide-react';

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
};

type CreatorContentPanelProps = {
  theme: string;
  productionBrief: string;
  talkingPoints: string[];
  creatorInstructions?: Record<string, unknown> | null;
  creatorAsset?: CreatorAssetPayload | null;
  contentType?: string;
  platforms?: string[];
  onAssetSaved: (asset: CreatorAssetPayload) => void;
  onGeneratePromotion: () => void;
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
  reddit: 'Reddit', pinterest: 'Pinterest',
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
  objective = '',
  targetAudience = '',
  existingHashtags = [],
  onNotice,
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
      onNotice?.('success', 'Creator asset saved. Click Generate Promotion Content to create platform posts.');
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

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="px-5 py-4 bg-gray-50/60 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !canSave}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Save Creator Asset
          </button>
          {hasAsset && (
            <button
              type="button"
              onClick={onGeneratePromotion}
              disabled={isGeneratingPromotion}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isGeneratingPromotion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Promotion Content
            </button>
          )}
          {!canSave && (
            <p className="text-xs text-gray-400 self-center">
              Add at least one platform link + description to enable save.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
