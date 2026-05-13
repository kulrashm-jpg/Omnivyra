'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import PlatformIcon from '../ui/PlatformIcon';
import { filterConnectedPlatformsForContent } from '../../lib/shared/social/platformContentFilter';
import { PLATFORM_LABELS } from '../../lib/shared/platforms';
import { CAPABILITY_LOG_EVENTS, type CapabilityLogPayload } from '../../lib/shared/social/capabilityEvents';
import {
  POST_CREATOR_ASSET_TYPES,
  buildWriterCreatorPrefill,
  createWriterSourceId,
  launchCreatorFromWriter,
  loadWriterAttachedAssetsDurable,
  readWriterAttachedAssets,
  type CreatorAssetLaunchType,
  type WriterAttachedAsset,
} from '../../lib/content/writerCreatorAssetLaunch';

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

  useEffect(() => {
    if (!writerSourceId) return;
    const refresh = () => setAttachedAssets(readWriterAttachedAssets('post', writerSourceId));
    const refreshDurable = () => {
      void loadWriterAttachedAssetsDurable({
        companyId: selectedCompanyId,
        sourceType: 'post',
        sourceId: writerSourceId,
      }).then(setAttachedAssets);
    };
    refresh();
    refreshDurable();
    window.addEventListener('focus', refreshDurable);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refreshDurable);
      window.removeEventListener('storage', refresh);
    };
  }, [selectedCompanyId, writerSourceId]);

  const launchAssetCreator = (assetType: CreatorAssetLaunchType) => {
    setAssetMenuOpen(false);
    launchCreatorFromWriter({
      router,
      assetType,
      source: buildWriterCreatorPrefill({
        sourceType: 'post',
        sourceId: writerSourceId,
        title: topic,
        body: generatedContent,
        cta: masterTrace?.outcome_promise || '',
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
                <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">{generatedContent}</pre>
              </div>

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
                            <p className="mt-1 text-xs text-slate-500">Choose a supported Creator asset and we will prefill it from this post.</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {WRITER_CREATOR_SOCIAL_PLATFORMS.map((platform) => (
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
                              ))}
                            </div>
                          </div>
                          {POST_CREATOR_ASSET_TYPES.map((assetType) => (
                            <button
                              key={assetType}
                              type="button"
                              onClick={() => launchAssetCreator(assetType)}
                              className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <span>{assetType.charAt(0).toUpperCase() + assetType.slice(1)}</span>
                              <span className="mt-1 block text-xs font-normal text-slate-500">
                                Opens {assetType.charAt(0).toUpperCase() + assetType.slice(1)} Creator with this post attached.
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Link href={socialWorkflowLinks.social} className={`inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white ${accentButtonClassName}`}>
                      Post to social
                    </Link>
                    <Link href={socialWorkflowLinks.campaign} className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                      Use in campaign
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
                    No Creator assets attached yet. Use Add Asset to launch Image, Banner, Infographic, Carousel, or PDF with this post prefilled.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {attachedAssets.map((asset) => (
                      <a
                        key={asset.id}
                        href={asset.url || `/command-center/creator-content/${asset.creatorType}`}
                        target={asset.url ? '_blank' : undefined}
                        rel={asset.url ? 'noreferrer' : undefined}
                        className="block rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300"
                      >
                        <span className="font-semibold">{asset.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {asset.creatorType.charAt(0).toUpperCase() + asset.creatorType.slice(1)}
                          {asset.creatorType === 'image' && asset.imageMode
                            ? ` - ${asset.imageMode === 'text_embedded' ? 'Text Inside Image' : 'Post + Image'}`
                            : ''}
                          {asset.previewKind ? ` - ${asset.previewKind.replace(/_/g, ' ')}` : ''}
                        </span>
                      </a>
                    ))}
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
