/** CreatorContentPanel — thin composition: controller + verbatim JSX. */
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
import { useCreatorContentPanelController } from './CreatorContentPanelController';

export default function CreatorContentPanel(props: CreatorContentPanelProps) {
  const f = useCreatorContentPanelController(props);
  const {
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
  } = f;
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
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">YouTube visibility</label>
                  <select
                    value={youtubeVisibility}
                    onChange={(e) => setYoutubeVisibility(e.target.value as 'public' | 'unlisted' | 'private')}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="public">Public — anyone can find and watch</option>
                    <option value="unlisted">Unlisted — only people with the link</option>
                    <option value="private">Private — only you</option>
                  </select>
                  <p className="text-[10px] text-gray-400 mt-0.5">Applies when this video publishes to YouTube.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">TikTok privacy &amp; interactions</label>
                  <select
                    value={tiktok.privacy}
                    onChange={(e) => setTiktok((t) => ({ ...t, privacy: e.target.value as 'public' | 'friends' | 'private' }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="public">Public</option>
                    <option value="friends">Friends</option>
                    <option value="private">Private — only me</option>
                  </select>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-600">
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={tiktok.allow_comments} onChange={(e) => setTiktok((t) => ({ ...t, allow_comments: e.target.checked }))} /> Comments</label>
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={tiktok.allow_duet} onChange={(e) => setTiktok((t) => ({ ...t, allow_duet: e.target.checked }))} /> Duet</label>
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={tiktok.allow_stitch} onChange={(e) => setTiktok((t) => ({ ...t, allow_stitch: e.target.checked }))} /> Stitch</label>
                    <label className="inline-flex items-center gap-1">Cover at
                      <input type="number" min={0} step={0.5} value={tiktok.cover_time_ms / 1000}
                        onChange={(e) => setTiktok((t) => ({ ...t, cover_time_ms: Math.max(0, Math.round(Number(e.target.value) * 1000)) }))}
                        className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded" /> s
                    </label>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Applies when this video publishes to TikTok.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instagram Reel cover &amp; feed</label>
                  <select
                    value={instagram.cover}
                    onChange={(e) => setInstagram((i) => ({ ...i, cover: e.target.value as 'branded' | 'frame' | 'auto' }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="auto">Auto cover (Instagram picks a frame)</option>
                    <option value="branded">Branded cover (auto-generated)</option>
                    <option value="frame">Frame at a chosen time</option>
                  </select>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-600">
                    {instagram.cover === 'frame' && (
                      <label className="inline-flex items-center gap-1">Cover at
                        <input type="number" min={0} step={0.5} value={instagram.cover_time_ms / 1000}
                          onChange={(e) => setInstagram((i) => ({ ...i, cover_time_ms: Math.max(0, Math.round(Number(e.target.value) * 1000)) }))}
                          className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded" /> s
                      </label>
                    )}
                    <label className="inline-flex items-center gap-1"><input type="checkbox" checked={instagram.share_to_feed} onChange={(e) => setInstagram((i) => ({ ...i, share_to_feed: e.target.checked }))} /> Also share to feed</label>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Applies when this video publishes to Instagram Reels.</p>
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

        {/* ── Section 4: Pinterest pin options (image assets) ───────── */}
        {connectedPlatforms.includes('pinterest') && (
          <div className="px-5 py-4 border-t border-gray-100">
            <SectionHeader
              icon={<Image className="h-3.5 w-3.5" />}
              title="Pinterest pin"
              subtitle="Board and destination link for this pin"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Board</label>
                <input
                  type="text"
                  value={pinterest.board_name}
                  onChange={(e) => setPinterest((p) => ({ ...p, board_name: e.target.value }))}
                  placeholder="Marketing"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Pins group under this board (created if new). Defaults to “Marketing”.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Destination link</label>
                <input
                  type="url"
                  value={pinterest.link}
                  onChange={(e) => setPinterest((p) => ({ ...p, link: e.target.value }))}
                  placeholder="https://your-site.com/landing"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-400"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Where the pin sends viewers. Leave blank to use your website.</p>
              </div>
            </div>
          </div>
        )}

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

