'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import {
  getThreadExecutionDescription,
  getThreadExecutionLabel,
  type ThreadExecutionMode,
} from '../../lib/thread/threadExecution';
import { getThreadResultLink } from '../../lib/thread/threadLinks';
import {
  buildThreadCompanySummary,
  buildThreadRecommendations,
  getThreadFormat,
  getThreadIntent,
  getThreadPlatformLabel,
  THREAD_INTENTS,
  type ThreadCompanyProfile,
  type ThreadIntentValue,
  type ThreadSessionPayload,
} from '../../lib/thread/threadFlow';
import { createThreadSessionToken, saveThreadSession } from '../../lib/thread/threadStorage';

export default function ThreadIntelligenceView() {
  const router = useRouter();
  const { user, isLoading, selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const format = getThreadFormat(typeof router.query.format === 'string' ? router.query.format : undefined);
  const prefillTopic = typeof router.query.prefill_topic === 'string' ? router.query.prefill_topic.trim() : '';
  const prefillReason = typeof router.query.prefill_reason === 'string' ? router.query.prefill_reason.trim() : '';
  const prefillIntent = typeof router.query.prefill_intent === 'string' ? router.query.prefill_intent.trim() : '';
  const prefillPlatform = typeof router.query.prefill_platform === 'string' ? router.query.prefill_platform.trim().toLowerCase() : '';
  const prefillExecutionMode = typeof router.query.prefill_execution_mode === 'string'
    ? router.query.prefill_execution_mode.trim().toLowerCase()
    : '';

  const [profile, setProfile] = useState<ThreadCompanyProfile | null>(null);
  const [topic, setTopic] = useState(prefillTopic);
  const [intent, setIntent] = useState<ThreadIntentValue>(
    prefillIntent && THREAD_INTENTS.some((entry) => entry.value === prefillIntent)
      ? (prefillIntent as ThreadIntentValue)
      : 'educate',
  );
  const [platform, setPlatform] = useState<'x' | 'linkedin'>(
    prefillPlatform === 'linkedin' ? 'linkedin' : 'x',
  );
  const [executionMode, setExecutionMode] = useState<ThreadExecutionMode>(
    prefillExecutionMode === 'auto' ? 'auto' : 'manual',
  );
  const [extraInstruction, setExtraInstruction] = useState(prefillReason);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setLoadingProfile(true);
    fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=0`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setProfile((data?.profile ?? null) as ThreadCompanyProfile | null))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false));
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (prefillTopic) setTopic(prefillTopic);
    if (prefillReason) setExtraInstruction(prefillReason);
    if (prefillIntent && THREAD_INTENTS.some((entry) => entry.value === prefillIntent)) {
      setIntent(prefillIntent as ThreadIntentValue);
    }
    if (prefillPlatform === 'linkedin' || prefillPlatform === 'x') {
      setPlatform(prefillPlatform as 'x' | 'linkedin');
    }
    if (prefillExecutionMode === 'auto' || prefillExecutionMode === 'manual') {
      setExecutionMode(prefillExecutionMode as ThreadExecutionMode);
    }
  }, [prefillExecutionMode, prefillIntent, prefillPlatform, prefillReason, prefillTopic, router.isReady]);

  const companyName = selectedCompanyName || profile?.name?.trim() || 'Your company';
  const selectedIntent = getThreadIntent(intent);
  const recommendations = useMemo(
    () => buildThreadRecommendations(companyName, format, profile),
    [companyName, format, profile],
  );
  const contextSummary = useMemo(
    () => buildThreadCompanySummary(companyName, profile),
    [companyName, profile],
  );

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

  const startThread = async () => {
    if (!selectedCompanyId || !topic.trim() || starting) return;
    setStarting(true);

    const payload: ThreadSessionPayload = {
      createdAt: new Date().toISOString(),
      executionMode,
      topic: topic.trim(),
      format: format.value,
      formatLabel: format.label,
      intent,
      intentLabel: selectedIntent.label,
      platform,
      platformLabel: getThreadPlatformLabel(platform),
      objective: selectedIntent.objective,
      audience:
        typeof profile?.target_audience === 'string' && profile.target_audience.trim()
          ? profile.target_audience.trim()
          : 'Audience aligned to the company context and topic',
      tone:
        typeof profile?.brand_voice === 'string' && profile.brand_voice.trim()
          ? profile.brand_voice.trim()
          : format.value === 'narrative-thread'
            ? 'Confident, sharp, and momentum-building'
            : 'Clear, high-signal, and easy to follow',
      cta: intent === 'launch' ? 'Invite readers to follow the launch and engage' : 'Invite readers to react, reply, or follow for the next step',
      extraInstruction: extraInstruction.trim(),
      companyName,
    };

    const token = createThreadSessionToken();
    saveThreadSession(token, payload);
    void router.push(getThreadResultLink(token));
  };

  return (
    <>
      <Head>
        <title>Thread Intelligence | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50 px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <Link href="/threads/create" className="mb-8 inline-flex text-sm text-gray-600 transition hover:text-gray-900">
            &larr; Back
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Thread Intelligence
                </p>
                <h1 className="text-4xl font-bold tracking-tight text-gray-900">Build the thread, not just the topic</h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Keep this brief tight. We already have the company context, so the goal here is to set the thread angle, the sequence intent, and the publishing destination without forcing you through a long interview.
                </p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">Thread Shape</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{format.label}</p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">Company Context</p>
                  <p className="mt-1 text-sm text-gray-700">{loadingProfile ? 'Loading company context...' : contextSummary}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">Thread topic</label>
                <textarea
                  rows={3}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Describe the idea this thread should unfold. Keep it concrete and outcome-aware."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </div>

              <div className="mt-6">
                <p className="mb-3 text-sm font-semibold text-slate-800">Sequence intent</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {THREAD_INTENTS.map((option) => {
                    const active = option.value === intent;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setIntent(option.value)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          active
                            ? 'border-violet-300 bg-violet-50 text-violet-900 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/60'
                        }`}
                      >
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className="mt-1 text-sm leading-6">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <p className="mb-3 text-sm font-semibold text-slate-800">Primary destination</p>
                  <div className="grid gap-3">
                    {(['x', 'linkedin'] as const).map((entry) => {
                      const active = platform === entry;
                      return (
                        <button
                          key={entry}
                          type="button"
                          onClick={() => setPlatform(entry)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-violet-300 bg-violet-50 text-violet-900 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/60'
                          }`}
                        >
                          <p className="text-sm font-semibold">{getThreadPlatformLabel(entry)}</p>
                          <p className="mt-1 text-sm leading-6">
                            {entry === 'x'
                              ? 'Default thread-native destination with strong sequential reading behavior.'
                              : 'Useful when the same sequence should read as a structured LinkedIn series.'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-sm font-semibold text-slate-800">Execution mode</p>
                  <div className="grid gap-3">
                    {(['manual', 'auto'] as const).map((mode) => {
                      const active = executionMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setExecutionMode(mode)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-violet-300 bg-violet-50 text-violet-900 shadow-sm'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/60'
                          }`}
                        >
                          <p className="text-sm font-semibold">{getThreadExecutionLabel(mode)}</p>
                          <p className="mt-1 text-sm leading-6">{getThreadExecutionDescription(mode)}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <label className="mb-3 block text-sm font-semibold text-slate-800">Optional guidance</label>
                <textarea
                  rows={6}
                  value={extraInstruction}
                  onChange={(event) => setExtraInstruction(event.target.value)}
                  placeholder="Only add this if there is one thing the sequence must emphasize, avoid, or frame more carefully."
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Operating rule</p>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-900">{getThreadExecutionLabel(executionMode)}:</span>{' '}
                    {getThreadExecutionDescription(executionMode)}
                  </p>
                  <p>Engagement still gets the first chance to shape continuation during the initial 2-day observation window.</p>
                  <p>If no interaction appears in that window, the next step should move to manual planning instead of stalling.</p>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
                <p className="text-sm text-violet-700">
                  We will generate a full thread sequence next, not just one platform-ready shortform block.
                </p>
                <button
                  type="button"
                  disabled={!topic.trim() || starting}
                  onClick={() => void startThread()}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Build thread sequence
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </section>

            <aside className="space-y-5">
              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Suggested Angles</p>
                <div className="mt-4 space-y-3">
                  {recommendations.map((item) => (
                    <button
                      key={item.topic}
                      type="button"
                      onClick={() => {
                        setTopic(item.topic);
                        setIntent(item.intent);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50/60"
                    >
                      <p className="text-sm font-semibold text-slate-900">{item.topic}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Execution Rule</p>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p>{getThreadExecutionLabel(executionMode)}: {getThreadExecutionDescription(executionMode)}</p>
                  <p>Engagement-driven continuation still takes over if interaction appears within two days after sharing.</p>
                  <p>If nothing happens, the next thread step falls back to manual planning so the sequence keeps moving.</p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
