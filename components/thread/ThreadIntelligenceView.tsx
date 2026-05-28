'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Loader2, MessageSquare, PenLine, Sparkles, Target } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import AIBlogCardModal from '../blog/AIBlogCardModal';
import { buildThreadPrefillFromCard, type AiChatCardForThread } from '../../lib/thread/threadAiChatAdapter';
import {
  getThreadExecutionDescription,
  getThreadExecutionLabel,
  type ThreadExecutionMode,
} from '../../lib/thread/threadExecution';
import { getThreadResultLink } from '../../lib/thread/threadLinks';
import {
  buildThreadCompanySummary,
  buildThreadRecommendations,
  getThreadAnchor,
  getThreadFormat,
  getThreadIntent,
  getThreadPlatformLabel,
  isThreadAnchor,
  THREAD_ANCHORS,
  THREAD_INTENTS,
  type ThreadAnchorValue,
  type ThreadCompanyProfile,
  type ThreadGenerationPayload,
  type ThreadIntentValue,
  type ThreadSessionPayload,
} from '../../lib/thread/threadFlow';
import { createThreadSessionToken, saveThreadResult, saveThreadSession } from '../../lib/thread/threadStorage';

type ThreadCreationMode = 'ai' | 'manual';

// Manual-mode starter segments. Visible placeholders the user immediately
// replaces. Joined by \n\n so splitThreadIntoSegments produces 3 entries.
const MANUAL_MODE_STARTER_SEGMENTS: readonly string[] = [
  'Post 1 — write your hook here.',
  'Post 2 — develop the idea so it earns the next post.',
  'Post 3 — close with the payoff or the action you want readers to take.',
];

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
  const prefillAnchor = typeof router.query.prefill_anchor === 'string'
    ? router.query.prefill_anchor.trim().toLowerCase()
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
  const [anchor, setAnchor] = useState<ThreadAnchorValue>(
    isThreadAnchor(prefillAnchor) ? prefillAnchor : 'market',
  );
  const [extraInstruction, setExtraInstruction] = useState(prefillReason);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [starting, setStarting] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [creationMode, setCreationMode] = useState<ThreadCreationMode>('ai');
  // G19 — AI Chat modal state + optional chat-sourced overrides for tone/audience
  // (the existing form derives these from company profile; the chat may surface
  // freer-form values the user wants to inject for this specific thread).
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [toneOverride, setToneOverride] = useState<string>('');
  const [audienceOverride, setAudienceOverride] = useState<string>('');
  const [aiChatNotice, setAiChatNotice] = useState<string | null>(null);

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
    if (isThreadAnchor(prefillAnchor)) {
      setAnchor(prefillAnchor);
    }
  }, [prefillAnchor, prefillExecutionMode, prefillIntent, prefillPlatform, prefillReason, prefillTopic, router.isReady]);

  const companyName = selectedCompanyName || profile?.name?.trim() || 'Your company';
  const selectedIntent = getThreadIntent(intent);
  const selectedAnchor = getThreadAnchor(anchor);
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

  // G19 — apply AI Chat card output to the form. Pure prefill; user can edit
  // every field afterward. Thread-specific structured fields (anchor, exec
  // mode, platform, format) are deliberately NOT touched — chat doesn't
  // capture them.
  const applyAiChatCard = (card: AiChatCardForThread) => {
    const prefill = buildThreadPrefillFromCard(card);
    if (prefill.topic) setTopic(prefill.topic);
    if (prefill.intent) setIntent(prefill.intent);
    if (prefill.tone) setToneOverride(prefill.tone);
    if (prefill.audience) setAudienceOverride(prefill.audience);
    if (prefill.extraInstruction) setExtraInstruction(prefill.extraInstruction);
    setAiChatOpen(false);
    setAiChatNotice(
      'AI Chat pre-filled topic + intent + tone + audience + guidance. Review anchor, platform, and execution mode below, then click Build thread sequence.',
    );
  };

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
        // G19 — AI Chat audience override takes precedence when provided.
        audienceOverride.trim()
          ? audienceOverride.trim()
          : typeof profile?.target_audience === 'string' && profile.target_audience.trim()
            ? profile.target_audience.trim()
            : 'Audience aligned to the company context and topic',
      tone:
        // G19 — AI Chat tone override takes precedence when provided.
        toneOverride.trim()
          ? toneOverride.trim()
          : typeof profile?.brand_voice === 'string' && profile.brand_voice.trim()
            ? profile.brand_voice.trim()
            : format.value === 'narrative-thread'
              ? 'Confident, sharp, and momentum-building'
              : 'Clear, high-signal, and easy to follow',
      cta: intent === 'launch' ? 'Invite readers to follow the launch and engage' : 'Invite readers to react, reply, or follow for the next step',
      extraInstruction: extraInstruction.trim(),
      companyName,
      anchor: selectedAnchor.value,
      anchorLabel: selectedAnchor.label,
      anchorFocus: selectedAnchor.focusPrompt,
      productsServices:
        typeof profile?.products_services === 'string' ? profile.products_services.trim() : '',
      brandVoice:
        typeof profile?.brand_voice === 'string' ? profile.brand_voice.trim() : '',
    };

    const token = createThreadSessionToken();
    saveThreadSession(token, payload);

    // Manual mode: also seed a stub generation result so /threads/result skips
    // the AI generation effect and renders the editor with starter segments.
    // The result-page effect guard at ThreadResultView.tsx checks
    // `payload?.output?.success` and short-circuits when truthy.
    if (creationMode === 'manual') {
      const stubResult: ThreadGenerationPayload = {
        output: {
          success: true,
          content_type: 'thread',
          template_used: format.label,
          master_content: {
            content: '',
            decision_trace: {
              objective: selectedIntent.objective,
              writing_angle: selectedIntent.label,
              tone_used: payload.tone,
            },
          },
          platform_variant: {
            platform,
            generated_content: MANUAL_MODE_STARTER_SEGMENTS.join('\n\n'),
            discoverability_meta: { hashtags: [] },
            adaptation_trace: {
              style_strategy: `Manual draft on ${getThreadPlatformLabel(platform)} — written without AI generation.`,
              format_family: format.label,
              actual_length_used: null,
            },
          },
        },
        session: payload,
      };
      saveThreadResult(token, stubResult);
    }

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
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">Company Context</p>
                    {!loadingProfile && contextSummary ? (
                      <button
                        type="button"
                        onClick={() => setContextExpanded((value) => !value)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 transition hover:text-violet-700"
                        aria-expanded={contextExpanded}
                      >
                        {contextExpanded ? 'Hide' : 'View'}
                        {contextExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-700">
                    {loadingProfile
                      ? 'Loading company context...'
                      : contextExpanded
                        ? contextSummary
                        : 'Pulled from your company profile to ground the thread. View to see what we are using.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="mb-6">
                <p className="mb-3 text-sm font-semibold text-slate-800">How do you want to start?</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setCreationMode('ai')}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      creationMode === 'ai'
                        ? 'border-violet-300 bg-violet-50 text-violet-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-violet-500" />
                      <p className="text-sm font-semibold">Generate with AI</p>
                    </div>
                    <p className="mt-2 text-sm leading-6">
                      Give us the angle and we build the full sequence for you.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreationMode('manual')}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      creationMode === 'manual'
                        ? 'border-violet-300 bg-violet-50 text-violet-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <PenLine className="h-4 w-4 text-violet-500" />
                      <p className="text-sm font-semibold">Write my own</p>
                    </div>
                    <p className="mt-2 text-sm leading-6">
                      Skip AI generation and write each post yourself in the editor.
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled
                    title="Curated starter threads coming soon."
                    className="cursor-not-allowed rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4 text-left opacity-70"
                  >
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-slate-400" />
                      <p className="text-sm font-semibold text-slate-500">Use a starter</p>
                      <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        Soon
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Pick a curated starter thread and edit it. Available in a later release.
                    </p>
                  </button>
                </div>
              </div>

              {creationMode === 'ai' && (
                <div className="mb-6 rounded-2xl border border-violet-200 bg-violet-50/40 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">
                        Skip the form &mdash; chat with AI instead
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        Describe what you want to thread about. AI refines the topic, intent, tone, and audience &mdash; you stay in control of anchor, platform, and execution mode.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAiChatOpen(true)}
                      disabled={!selectedCompanyId}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Open AI Chat
                    </button>
                  </div>
                  {aiChatNotice && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      {aiChatNotice}
                    </div>
                  )}
                </div>
              )}

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
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Thread anchor</p>
                  <p className="text-xs text-slate-500">What this thread is grounded in</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {THREAD_ANCHORS.map((option) => {
                    const active = option.value === anchor;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAnchor(option.value)}
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

              {creationMode === 'ai' && (
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
              )}

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
                  {creationMode === 'ai'
                    ? 'We will generate a full thread sequence next, not just one platform-ready shortform block.'
                    : 'You will land in the segment editor with 3 starter posts to replace with your own.'}
                </p>
                <button
                  type="button"
                  disabled={!topic.trim() || starting}
                  onClick={() => void startThread()}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {starting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : creationMode === 'ai' ? <Sparkles className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
                  {creationMode === 'ai' ? 'Build thread sequence' : 'Open editor'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </section>

            <aside className="space-y-5">
              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Suggested Angles</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">One per anchor. Picking an angle sets the anchor for you.</p>
                <div className="mt-4 space-y-3">
                  {recommendations.map((item) => {
                    const anchorOption = getThreadAnchor(item.anchor);
                    return (
                      <button
                        key={item.topic}
                        type="button"
                        onClick={() => {
                          setTopic(item.topic);
                          setIntent(item.intent);
                          setAnchor(item.anchor);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50/60"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">{anchorOption.label} anchor</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{item.topic}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
                      </button>
                    );
                  })}
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

      {/* G19 — AI Chat modal. Reuses AIBlogCardModal with contentType='thread'.
          The modal returns a BlogCardPreview which the adapter projects into
          our form state via applyAiChatCard. */}
      {selectedCompanyId && (
        <AIBlogCardModal
          isOpen={aiChatOpen}
          onClose={() => setAiChatOpen(false)}
          companyId={selectedCompanyId}
          companyName={companyName}
          companyContext={contextSummary}
          contentLabel="thread"
          contentType="thread"
          contentModeLabel={format.label}
          onCardCreated={applyAiChatCard}
        />
      )}
    </>
  );
}
