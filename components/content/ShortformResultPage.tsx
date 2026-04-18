'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';

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
  const { user, isLoading } = useCompanyContext();
  const [payload, setPayload] = useState<ShortformPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [hashtagsCopied, setHashtagsCopied] = useState(false);

  const token = typeof router.query.prefill === 'string' ? router.query.prefill : '';

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(token);
      if (!raw) return;
      setPayload(JSON.parse(raw) as ShortformPayload);
    } catch {
      setPayload(null);
    }
  }, [token]);

  const generatedContent = payload?.output?.platform_variant?.generated_content || '';
  const hashtags = payload?.output?.platform_variant?.discoverability_meta?.hashtags || [];
  const masterTrace = payload?.output?.master_content?.decision_trace;
  const adaptationTrace = payload?.output?.platform_variant?.adaptation_trace;
  const topic = payload?.topic || `Generated ${contentType}`;
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

              {socialWorkflowLinks && (
                <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Turn This Post Into Action</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Keep the momentum going by publishing this post, reworking it with fresh intelligence, or using it as the seed for a campaign.
                  </p>
                  <div className="mt-4 space-y-3">
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
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
