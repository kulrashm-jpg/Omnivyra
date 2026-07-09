/** useCreatorContentPanelController — state/effects/handlers of CreatorContentPanel, verbatim. */
/** Part 3/3 of CreatorContentPanel.tsx — verbatim split (barrel preserved; importers unchanged). */
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

import { type CreatorProfile, type MarketingPackage, type PlatformUpload, type CreatorAssetPayload, type CreatorContentPanelProps, resolveAssetType, PLATFORM_LABELS, SectionHeader, TagInput, LinkPreview, PlatformCard, DEFAULT_PLATFORMS, DIFFERENT_VIDEO_ENABLED, type VideoMappingRow, nextVmapId } from './CreatorContentPanelModel';
import { AttachmentUploadSection } from './CreatorContentPanelUpload';

export function useCreatorContentPanelController(props: CreatorContentPanelProps) {
  const {
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
  } = props;
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
  // Per-video YouTube visibility (only affects the YouTube upload; other platforms ignore it).
  const [youtubeVisibility, setYoutubeVisibility] = useState<'public' | 'unlisted' | 'private'>(
    ((creatorAsset as { youtube_visibility?: string })?.youtube_visibility as 'public' | 'unlisted' | 'private') ?? 'public',
  );
  // Per-video TikTok publish options (privacy + interactions + cover frame).
  const [tiktok, setTiktok] = useState<{ privacy: 'public' | 'friends' | 'private'; allow_comments: boolean; allow_duet: boolean; allow_stitch: boolean; cover_time_ms: number }>(() => {
    const s = ((creatorAsset as { publish_settings?: { tiktok?: any } })?.publish_settings?.tiktok) || {};
    return {
      privacy: s.privacy === 'friends' || s.privacy === 'private' ? s.privacy : 'public',
      allow_comments: s.allow_comments !== false,
      allow_duet: s.allow_duet !== false,
      allow_stitch: s.allow_stitch !== false,
      cover_time_ms: Number.isFinite(s.cover_time_ms) ? Number(s.cover_time_ms) : 1000,
    };
  });
  // Per-video Instagram Reel options (cover mode + frame + share-to-feed).
  const [instagram, setInstagram] = useState<{ cover: 'branded' | 'frame' | 'auto'; cover_time_ms: number; share_to_feed: boolean }>(() => {
    const s = ((creatorAsset as { publish_settings?: { instagram?: any } })?.publish_settings?.instagram) || {};
    return {
      cover: s.cover === 'branded' || s.cover === 'frame' ? s.cover : 'auto',
      cover_time_ms: Number.isFinite(s.cover_time_ms) ? Number(s.cover_time_ms) : 1000,
      share_to_feed: s.share_to_feed !== false,
    };
  });
  // Per-pin Pinterest options (board + destination link). Pinterest publishes
  // IMAGES; a stable board keeps pins together (no board-per-pin), and the link
  // drives traffic. Empty link → adapter falls back to the company website.
  const [pinterest, setPinterest] = useState<{ board_name: string; link: string }>(() => {
    const s = ((creatorAsset as { publish_settings?: { pinterest?: any } })?.publish_settings?.pinterest) || {};
    return {
      board_name: typeof s.board_name === 'string' ? s.board_name : '',
      link: typeof s.link === 'string' ? s.link : '',
    };
  });
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
        youtube_visibility: youtubeVisibility, // per-video YouTube privacy (read by the scheduler)
        publish_settings: { tiktok, instagram, pinterest }, // generic per-platform publish options (read by the scheduler)
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

  return {
    theme, productionBrief, talkingPoints, creatorInstructions, creatorAsset, contentType, platforms,
    onAssetSaved, onGeneratePromotion, isGeneratingPromotion, campaignId, executionId, weekNumber, day,
    objective, targetAudience, existingHashtags, onNotice, attachmentRowState, onUploadMedia, onUploadFile,
    onReschedule, onUnschedule, resumableUploadHandle, onResumeUpload, onDiscardResumableUpload
    ,
    addMappingRow, assetOpen, assetType, assetTypeIcon, assetTypeLabel, availableVideoPlatforms, canSave,
    canSaveVideo, connectedPlatforms, duplicateMappingIds, handleApplyToAll, handleGenerateMarketing,
    handleSave, handleSaveVideoSimplified, hasAnyLink, hasAsset, instagram, isGeneratingMarketing, isSaving,
    isVideoWorkflow, mappingRowError, mappings, mappingsValid, marketing, marketingOpen, masterApplied,
    masterCaption, masterUrl, pinterest, platformUploads, profile, profileOpen, removeMappingRow, sameVideoUrl,
    selectedCompanyId, setAssetOpen, setConnectedPlatforms, setInstagram, setIsGeneratingMarketing,
    setIsSaving, setMappings, setMarketing, setMarketingOpen, setMasterApplied, setMasterCaption, setMasterUrl,
    setPinterest, setPlatformUploads, setProfile, setProfileOpen, setSameVideoUrl, setTeamMembers, setTiktok,
    setTranscript, setUploadedById, setUploadedByName, setVideoMode, setVideoTitle, setYoutubeVisibility,
    targetPlatforms, teamMembers, tiktok, transcript, updateMappingRow, uploadedById, uploadedByName, user,
    userName, videoMode, videoTitle, youtubeVisibility
  };
}
