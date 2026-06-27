'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import PlatformIcon from '../ui/PlatformIcon';
import ContentRenderer from '../ContentRenderer';
import { filterConnectedPlatformsForContent } from '../../lib/shared/social/platformContentFilter';
import { PLATFORM_LABELS } from '../../lib/shared/platforms';
import { CAPABILITY_LOG_EVENTS, type CapabilityLogPayload } from '../../lib/shared/social/capabilityEvents';
import {
  POST_CREATOR_ASSET_TYPES,
  POST_CREATOR_ASSET_TYPES_VISIBLE,
  assetLabel,
  buildWriterCreatorPrefill,
  createWriterSourceId,
  launchCreatorFromWriter,
  type CreatorAssetLaunchType,
  type WriterAttachedAsset,
} from '../../lib/content/writerCreatorAssetLaunch';
import { loadWriterAttachmentsViaGraph } from '../../lib/content/writerAttachmentGraph';
import {
  attachmentModeLabel,
  defaultAttachmentModeForAsset,
  type AttachmentMode,
} from '../../lib/content/writerCreatorAttachmentContracts';
import WriterEmbeddedPreview from '../preview/WriterEmbeddedPreview';
import { projectWriterAttachment } from '../../lib/preview/previewUtils';

const WRITER_CREATOR_SOCIAL_PLATFORMS = ['linkedin', 'x', 'instagram', 'facebook', 'threads', 'reddit'];

type ShortformPayload = {
  output?: {
    success?: boolean;
    content_type?: 'post';
    template_used?: string | null;
    master_content?: {
      content?: string;
      decision_trace?: {
        objective?: string;
        writing_angle?: string;
        tone_used?: string;
        outcome_promise?: string;
      };
    };
    platform_variant?: {
      platform?: string;
      generated_content?: string;
      discoverability_meta?: {
        hashtags?: string[];
      };
      adaptation_trace?: {
        style_strategy?: string;
        format_family?: string;
        actual_length_used?: number | null;
      };
    };
  };
  topic?: string;
  platform?: string;
  /**
   * G18.3 — sentinel for the "Write my own" picker mode. When 'manual' and
   * generated_content is empty, the page renders a "Continue to scheduler"
   * CTA instead of the AI-generation empty state.
   */
  creation_mode?: 'ai' | 'manual';
};

type Props = {
  contentType: 'post';
  pageTitle: string;
  heading: string;
  accentSurfaceClassName: string;
  accentButtonClassName: string;
  accentBadgeClassName: string;
  createPath: string;
};

type ConnectedAccount = {
  connected?: boolean;
  category?: string;
  platform_key?: string;
  platform_label?: string;
};

export default function ShortformResultPage({
  contentType,
  pageTitle,
  heading,
  accentSurfaceClassName,
  accentButtonClassName,
  accentBadgeClassName,
  createPath,
}: Props) {
  const router = useRouter();
  const { user, isLoading, selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const [payload, setPayload] = useState<ShortformPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [hashtagsCopied, setHashtagsCopied] = useState(false);
  const [connectedPlatforms, setConnectedPlatforms] = useState<Array<{ key: string; label: string }>>([]);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [selectedCreatorPlatform, setSelectedCreatorPlatform] = useState('linkedin');
  const [attachedAssets, setAttachedAssets] = useState<WriterAttachedAsset[]>([]);

  const token = typeof router.query.prefill === 'string' ? router.query.prefill : '';

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(token);
      if (!raw) return;
      try {
        window.localStorage.setItem(token, raw);
      } catch {
        // Ignore localStorage write failures and keep the current-tab session flow working.
      }
      setPayload(JSON.parse(raw) as ShortformPayload);
    } catch {
      setPayload(null);
    }
  }, [token]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setConnectedPlatforms([]);
      return;
    }

    let active = true;
    fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { accounts: [] }))
      .then((data) => {
        if (!active) return;
        const accounts = Array.isArray(data?.accounts) ? data.accounts as ConnectedAccount[] : [];
        const unique = new Map<string, string>();
        for (const account of accounts) {
          const key = String(account.platform_key || '').trim().toLowerCase().replace(/^twitter$/i, 'x');
          if (!account.connected || account.category !== 'social' || !key || unique.has(key)) continue;
          unique.set(key, account.platform_label || key);
        }
        setConnectedPlatforms(Array.from(unique.entries()).map(([key, label]) => ({ key, label })));
      })
      .catch(() => {
        if (active) setConnectedPlatforms([]);
      });

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  const generatedContent = payload?.output?.platform_variant?.generated_content || '';
  const hashtags = payload?.output?.platform_variant?.discoverability_meta?.hashtags || [];
  const masterTrace = payload?.output?.master_content?.decision_trace;
  const adaptationTrace = payload?.output?.platform_variant?.adaptation_trace;
  const topic = payload?.topic || `Generated ${contentType}`;
  const writerSourceId = useMemo(() => createWriterSourceId('post', token || topic), [token, topic]);
  // Phase 5 hydration hardening — memoized projection so the embedded
  // preview rebuilds only when the attached-asset list changes, not on
  // every parent re-render (modal open, focus, etc.). projectWriterAttachment
  // is a pure function so the memo is referentially stable across renders.
  const projectedAssets = useMemo(
    () => attachedAssets.map((a) => projectWriterAttachment(a)),
    [attachedAssets],
  );

  // Capability-aware platform filter (Phase 2.C). Routes connected platforms
  // through the shared registry. Now ASSET-AWARE — when the Writer has
  // attached Creator assets (image/banner/infographic/carousel/pdf), those
  // asset types unlock additional platforms (e.g. Instagram + Pinterest for
  // image-class assets) via the capability-set resolver. Video-only
  // destinations (YouTube/TikTok) are filtered out of the displayable list
  // by the helper itself.
  const platformFilter = useMemo(() => {
    return filterConnectedPlatformsForContent(
      connectedPlatforms.map((p) => p.key),
      {
        formatFamily:       adaptationTrace?.format_family,
        contentType:        payload?.output?.content_type ?? contentType,
        attachedAssetTypes: attachedAssets.map((asset) => asset.creatorType),
      },
    );
  }, [connectedPlatforms, adaptationTrace?.format_family, payload?.output?.content_type, contentType, attachedAssets]);

  useEffect(() => {
    if (connectedPlatforms.length === 0) return;
    const payload: CapabilityLogPayload = {
      surface: 'shortform-result',
      publishSource: 'shortform-result',
      resolvedCapability: platformFilter.capability,
      connectedPlatforms: connectedPlatforms.map((p) => p.key),
      supportedPlatforms: platformFilter.supported,
      hiddenPlatforms: platformFilter.hidden.map((h) => h.platform),
      unregisteredPlatforms: platformFilter.unregistered.map((u) => u.platform),
      hiddenReasons: platformFilter.hidden.reduce<Record<string, string>>((acc, h) => {
        acc[h.platform] = h.reason;
        return acc;
      }, {}),
      unregisteredReasons: platformFilter.unregistered.reduce<Record<string, string>>((acc, u) => {
        acc[u.platform] = u.reason;
        return acc;
      }, {}),
    };
    console.info(JSON.stringify({ event: CAPABILITY_LOG_EVENTS.FILTERED, ...payload }));
  }, [platformFilter, connectedPlatforms]);

  // Add Asset picker: only platforms (a) connected for this company AND
  // (b) able to publish text + at least one of the 5 Creator asset types
  // (image / banner / infographic / carousel / brand_card). Resolves via
  // the same capability registry as the main publish-target filter, so
  // the matrix stays consistent.
  const creatorAssetPlatformOptions = useMemo(() => {
    const filtered = filterConnectedPlatformsForContent(
      connectedPlatforms.map((p) => p.key),
      {
        contentType:        'post',
        attachedAssetTypes: POST_CREATOR_ASSET_TYPES,
      },
    );
    const supportedSet = new Set(filtered.supported);
    return WRITER_CREATOR_SOCIAL_PLATFORMS.filter((p) => supportedSet.has(p));
  }, [connectedPlatforms]);

  useEffect(() => {
    if (creatorAssetPlatformOptions.length === 0) return;
    if (!creatorAssetPlatformOptions.includes(selectedCreatorPlatform)) {
      setSelectedCreatorPlatform(creatorAssetPlatformOptions[0]);
    }
  }, [creatorAssetPlatformOptions, selectedCreatorPlatform]);

  const labelFor = (key: string) =>
    connectedPlatforms.find((p) => p.key === key)?.label || PLATFORM_LABELS[key] || key;
  const platformLabel = useMemo(() => {
    const platform = payload?.output?.platform_variant?.platform || payload?.platform || 'linkedin';
    return platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
  }, [payload]);
  const socialWorkflowLinks = useMemo(() => {
    const topicQuery = topic ? `&topic=${encodeURIComponent(topic)}` : '';
    const prefillQuery = token ? `&prefill=${encodeURIComponent(token)}` : '';
    const normalizedType = encodeURIComponent(contentType);
    return {
      intelligence: '/posts/intelligence',
      social: `/multi-platform-scheduler?source=${contentType}-result&contentType=${normalizedType}${topicQuery}${prefillQuery}`,
      campaign: `/campaign-planner?mode=direct&source=${contentType}-result&contentType=${normalizedType}${topicQuery}`,
    };
  }, [contentType, token, topic]);

  // Relationship discovery comes solely from the canonical Usage Graph (via the
  // shared bridge → listAssetsForConsumer → resolveCreatorAsset). This component
  // never reads the legacy store or infers attachment ownership.
  const refreshAttachmentsFromGraph = useCallback(() => {
    if (!writerSourceId) return;
    void loadWriterAttachmentsViaGraph({
      companyId: selectedCompanyId,
      sourceType: 'post',
      sourceId: writerSourceId,
    }).then(setAttachedAssets).catch(() => { /* keep current list on transient error */ });
  }, [selectedCompanyId, writerSourceId]);

  useEffect(() => {
    if (!writerSourceId) return;
    refreshAttachmentsFromGraph();
    window.addEventListener('focus', refreshAttachmentsFromGraph);
    window.addEventListener('storage', refreshAttachmentsFromGraph);
    return () => {
      window.removeEventListener('focus', refreshAttachmentsFromGraph);
      window.removeEventListener('storage', refreshAttachmentsFromGraph);
    };
  }, [refreshAttachmentsFromGraph, writerSourceId]);

  const launchAssetCreator = (assetType: CreatorAssetLaunchType) => {
    // Attachment mode + source-text transform are NOT user-facing knobs
    // in the asset-type selector — they are rendering-behavior concerns
    // resolved deterministically from payload signals in
    // resolveAttachmentModeFromIntent. We pass the per-asset default
    // here; the resolver inside buildWriterCreatorPrefill upgrades it
    // based on the actual content shape.
    const attachmentMode: AttachmentMode = defaultAttachmentModeForAsset(assetType);
    setAssetMenuOpen(false);
    launchCreatorFromWriter({
      router,
      assetType,
      source: buildWriterCreatorPrefill({
        sourceType: 'post',
        sourceId: writerSourceId,
        assetType,
        attachmentMode,
        title: topic,
        body: generatedContent,
        audience: '',
        tone: masterTrace?.tone_used || adaptationTrace?.style_strategy || '',
        platform: selectedCreatorPlatform,
        hashtags,
        companyName: selectedCompanyName || '',
        brandContext: {
          objective: masterTrace?.objective || '',
          writingAngle: masterTrace?.writing_angle || '',
          outcomePromise: masterTrace?.outcome_promise || '',
        },
      }),
    });
  };

  const copyText = async (text: string, type: 'content' | 'hashtags') => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text).catch(() => null);
    if (type === 'content') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      setHashtagsCopied(true);
      window.setTimeout(() => setHashtagsCopied(false), 1800);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Sign in to continue.</p>
      </div>
    );
  }

  // G18.3 — manual-draft mode: user picked "Write my own" on /posts/intelligence.
  // The page renders a "Continue to scheduler" CTA because ShortformResultPage
  // itself is a viewer; the scheduler is where editing happens.
  if (payload?.creation_mode === 'manual' && !generatedContent) {
    const manualSchedulerHref = token
      ? `/multi-platform-scheduler?source=${contentType}-result&contentType=${encodeURIComponent(contentType)}&prefill=${encodeURIComponent(token)}`
      : `/multi-platform-scheduler?source=${contentType}-result&contentType=${encodeURIComponent(contentType)}`;
    return (
      <div className={`min-h-screen bg-gradient-to-br ${accentSurfaceClassName} p-6`}>
        <div className="mx-auto max-w-3xl rounded-[28px] border border-white/80 bg-white/92 p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Write my own</p>
          <h1 className="text-2xl font-semibold text-slate-950">Open the scheduler to write your post</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            You picked to write this {contentType} manually. The scheduler is where you write the post content per platform and schedule it.
            We left the AI generation step out — you stay in control of every line.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href={manualSchedulerHref}
              className={`inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white ${accentButtonClassName}`}
            >
              Open scheduler to write
            </Link>
            <Link href="/command-center/content" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">
              Back to content hub
            </Link>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            Tip: the scheduler will not allow scheduling until you add post content for at least one platform.
          </p>
        </div>
      </div>
    );
  }

  if (!payload || !generatedContent) {
    return (
      <div className={`min-h-screen bg-gradient-to-br ${accentSurfaceClassName} p-6`}>
        <div className="mx-auto max-w-3xl rounded-[28px] border border-white/80 bg-white/92 p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <h1 className="text-2xl font-semibold text-slate-950">No generated {contentType} found</h1>
          <p className="mt-3 text-sm text-slate-600">
            The result payload was not available in this session. Start a new flow to generate a fresh output.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link href={createPath} className={`rounded-xl px-5 py-3 text-sm font-semibold text-white ${accentButtonClassName}`}>
              Create Post
            </Link>
            <Link href="/command-center/content" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">
              Back to content hub
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle} | Omnivyra</title>
      </Head>

      <div className={`min-h-screen bg-gradient-to-br ${accentSurfaceClassName} p-6`}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Generated Output
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{heading}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                The final shortform asset is ready. Review the platform-ready output, copy it directly, or use the decision notes to refine the next iteration.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${accentBadgeClassName}`}>{platformLabel}</span>
              {payload.output?.template_used && (
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                  {payload.output.template_used}
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Platform-Ready Output</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">{topic}</h2>
                </div>

                <button
                  type="button"
                  onClick={() => void copyText(generatedContent, 'content')}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${accentButtonClassName}`}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy output'}
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                {/* G9.B — central ContentRenderer for platform-aware hashtag/mention highlighting + char-count.
                    Replaces a raw <pre> that lost the platform-specific formatting every other preview already has. */}
                <ContentRenderer
                  content={generatedContent}
                  platform={payload?.output?.platform_variant?.platform || payload?.platform || ''}
                  contentType={payload?.output?.content_type || contentType}
                  renderMode="social"
                  showCharCount
                  className="text-sm leading-7 text-slate-800"
                />
              </div>

              {/* Phase 1 — Writer Embedded Preview. Renders the REAL
                  composed post (text + attached creator assets) using
                  the same platform-faithful renderer family that
                  PostPreviewModal uses at publish time → preview/publish
                  parity. Hides when there is nothing meaningful to show. */}
              {(generatedContent || attachedAssets.length > 0) && (
                <div className="mt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-2">
                    Composed Preview
                  </p>
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    <WriterEmbeddedPreview
                      mode="post"
                      platform={payload?.output?.platform_variant?.platform || payload?.platform || 'linkedin'}
                      content={generatedContent}
                      contentType={payload?.output?.content_type || contentType}
                      title={topic}
                      // Phase 4 — projection consolidated into the shared
                      // `projectWriterAttachment` util so post + thread
                      // writers produce identical CreatorAttachment shapes.
                      // Phase 5 — memoize the projection so the preview
                      // only rebuilds when attachedAssets actually change.
                      attachedAssets={projectedAssets}
                    />
                  </div>
                </div>
              )}

              {hashtags.length > 0 && (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Discoverability Support</p>
                    <button
                      type="button"
                      onClick={() => void copyText(hashtags.join(' '), 'hashtags')}
                      className="text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                    >
                      {hashtagsCopied ? 'Copied' : 'Copy hashtags'}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {hashtags.map((tag) => (
                      <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-5">
              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Strategy Notes</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div>
                    <p className="font-semibold text-slate-900">Objective</p>
                    <p className="mt-1">{masterTrace?.objective || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Writing Angle</p>
                    <p className="mt-1">{masterTrace?.writing_angle || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Tone Used</p>
                    <p className="mt-1">{masterTrace?.tone_used || 'Not available'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Outcome Promise</p>
                    <p className="mt-1">{masterTrace?.outcome_promise || 'Not available'}</p>
                  </div>
                </div>
              </div>

              {socialWorkflowLinks && (
                <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Turn This Post Into Action</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Keep the momentum going by publishing this post, reworking it with fresh intelligence, or using it as the seed for a campaign.
                  </p>
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Repurpose For Connected Platforms</p>
                    {connectedPlatforms.length === 0 ? (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
                        No connected social platforms were found for the currently selected company.
                      </div>
                    ) : platformFilter.capability === null ? (
                      <div className="mt-3 rounded-2xl border border-dashed border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
                        Unable to determine compatible publishing platforms for this content type.
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {platformFilter.supported.map((key) => (
                          <Link
                            key={key}
                            href={`${socialWorkflowLinks.social}&platform=${encodeURIComponent(key)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <PlatformIcon platform={key} size={16} />
                            {labelFor(key)}
                          </Link>
                        ))}
                        {/* Video-only platforms (YouTube/TikTok) are pre-filtered
                            out of `hidden` by the helper itself — no per-call
                            carve-out needed. Remaining hidden chips are
                            registered-but-incompatible (e.g. Instagram for a
                            text-only post with no attached asset). */}
                        {platformFilter.hidden.map(({ platform, reason }) => (
                          <span
                            key={platform}
                            role="button"
                            aria-disabled="true"
                            title={reason}
                            className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-400 opacity-70"
                          >
                            <PlatformIcon platform={platform} size={16} />
                            {labelFor(platform)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setAssetMenuOpen((open) => !open)}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                      >
                        Add Asset
                      </button>
                      {assetMenuOpen ? (
                        <div className="absolute left-0 right-0 z-10 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                          <div className="border-b border-slate-100 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Create asset from post</p>
                            <p className="mt-1 text-xs text-slate-500">Pick a Creator asset type. Post flow supports Image, Banner, Brand Card, and Infographic.</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {creatorAssetPlatformOptions.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  Connect a social platform that supports image, infographic, or brand-card posts to attach a Creator asset.
                                </p>
                              ) : (
                                creatorAssetPlatformOptions.map((platform) => (
                                  <button
                                    key={platform}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedCreatorPlatform(platform);
                                    }}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                                      selectedCreatorPlatform === platform
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200'
                                    }`}
                                  >
                                    <PlatformIcon platform={platform} size={14} />
                                    {labelFor(platform)}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAssetMenuOpen(false)}
                            className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
                          >
                            No asset
                          </button>
                          {POST_CREATOR_ASSET_TYPES_VISIBLE.map((assetType) => (
                            <button
                              key={assetType}
                              type="button"
                              onClick={() => launchAssetCreator(assetType)}
                              className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <span>{assetLabel(assetType)}</span>
                              <span className="mt-1 block text-xs font-normal text-slate-500">
                                Opens {assetLabel(assetType)} Creator with this post attached.
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Link href={socialWorkflowLinks.social} className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white ${accentButtonClassName}`}>
                      Post to social
                    </Link>
                    <Link href={socialWorkflowLinks.intelligence} className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                      Return to post intelligence
                    </Link>
                  </div>
                </div>
              )}

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Attached Assets</p>
                {attachedAssets.length === 0 ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    No Creator assets attached yet. Use Add Asset to launch an Image, Banner, Brand Card, or Infographic with this post prefilled.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {attachedAssets.map((asset) => {
                      // Visual preview of the attached asset. Previously
                      // rendered as a text-only link, which made operators
                      // think nothing was attached after returning from the
                      // creator page. Now each attachment shows the image
                      // (or the first file from a multi-file asset) so
                      // "Continue with your post" lands on a page that
                      // clearly carries forward the asset.
                      const previewSrc = asset.url
                        || (Array.isArray(asset.files) ? asset.files.find(Boolean) : '')
                        || '';
                      return (
                        <div
                          key={asset.id}
                          className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 transition hover:border-slate-300"
                        >
                          {previewSrc ? (
                            <a href={previewSrc} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={previewSrc}
                                alt={asset.title || 'Attached creator asset'}
                                className="w-full max-h-72 object-contain bg-slate-100"
                                loading="lazy"
                              />
                            </a>
                          ) : null}
                          <div className="px-4 py-3 text-sm text-slate-700">
                            <span className="block font-semibold">{asset.title}</span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {assetLabel(asset.creatorType)}
                              {asset.attachmentMode ? ` · ${attachmentModeLabel(asset.attachmentMode)}` : ''}
                              {asset.previewKind ? ` · ${asset.previewKind.replace(/_/g, ' ')}` : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Adaptation Details</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Format Family</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{adaptationTrace?.format_family || contentType}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Length</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {adaptationTrace?.actual_length_used ? `${adaptationTrace.actual_length_used} chars` : `${generatedContent.length} chars`}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Platform Strategy</p>
                  <p className="mt-2 text-sm text-slate-600">{adaptationTrace?.style_strategy || 'Platform-specific adaptation was applied to shape pacing and readability.'}</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next Actions</p>
                <div className="mt-4 flex flex-col gap-3">
                  <Link href={createPath} className={`inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white ${accentButtonClassName}`}>
                    Create another post
                  </Link>
                  <Link href="/command-center/content" className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                    Back to content hub
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
