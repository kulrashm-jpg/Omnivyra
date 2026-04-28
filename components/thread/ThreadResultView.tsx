'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { getThreadExecutionDescription, getThreadExecutionLabel } from '../../lib/thread/threadExecution';
import ThreadSegmentsEditor from './ThreadSegmentsEditor';
import {
  joinThreadSegments,
  splitThreadIntoSegments,
  type ThreadGenerationPayload,
  type ThreadSessionPayload,
} from '../../lib/thread/threadFlow';
import {
  loadThreadResult,
  loadThreadSession,
  saveThreadResult,
  saveThreadSession,
  createThreadSessionToken,
} from '../../lib/thread/threadStorage';
import { getThreadContinuationLink, getThreadSchedulerLink } from '../../lib/thread/threadLinks';

type ApiResponse = {
  success?: boolean;
  error?: string;
} & NonNullable<ThreadGenerationPayload['output']>;

type PrefillThreadPayload = {
  output?: ThreadGenerationPayload['output'];
  topic?: string;
  platform?: string;
  template_name?: string;
};

function buildSessionFromPrefill(prefill: PrefillThreadPayload): ThreadSessionPayload | null {
  const output = prefill.output;
  const topic = typeof prefill.topic === 'string' ? prefill.topic.trim() : '';
  if (!output || !topic) return null;

  const platformRaw =
    typeof output.platform_variant?.platform === 'string'
      ? output.platform_variant.platform.trim().toLowerCase()
      : typeof prefill.platform === 'string'
        ? prefill.platform.trim().toLowerCase()
        : 'x';

  const platform = platformRaw === 'linkedin' ? 'linkedin' : 'x';
  const templateLabel =
    typeof output.template_used === 'string' && output.template_used.trim()
      ? output.template_used.trim()
      : typeof prefill.template_name === 'string' && prefill.template_name.trim()
        ? prefill.template_name.trim()
        : 'Generated Thread';

  return {
    createdAt: new Date().toISOString(),
    executionMode: 'manual',
    topic,
    format: 'explainer-thread',
    formatLabel: templateLabel,
    intent: 'educate',
    intentLabel: output.master_content?.decision_trace?.writing_angle || 'Teach something clearly',
    platform,
    platformLabel: platform === 'linkedin' ? 'LinkedIn' : 'X',
    objective:
      output.master_content?.decision_trace?.objective ||
      'Create a high-retention educational thread.',
    audience: 'Audience aligned to the topic and company context',
    tone:
      output.master_content?.decision_trace?.tone_used ||
      'Punchy, clear, and momentum-building',
    cta: 'Invite readers to react, reply, or follow for the next step',
    extraInstruction: '',
    companyName: 'Your company',
  };
}

export default function ThreadResultView() {
  const router = useRouter();
  const { user, isLoading, selectedCompanyId } = useCompanyContext();
  const sessionToken = typeof router.query.session === 'string' ? router.query.session : '';
  const prefillToken = typeof router.query.prefill === 'string' ? router.query.prefill : '';

  const [session, setSession] = useState<ThreadSessionPayload | null>(null);
  const [payload, setPayload] = useState<ThreadGenerationPayload | null>(null);
  const [segments, setSegments] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSessionToken, setActiveSessionToken] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (sessionToken) {
      setActiveSessionToken(sessionToken);
      const parsedSession = loadThreadSession(sessionToken);
      if (parsedSession) {
        setSession(parsedSession);
      } else {
        setSession(null);
      }

      const parsedResult = loadThreadResult(sessionToken);
      if (!parsedResult) return;
      try {
        setPayload(parsedResult);
        if (!parsedSession && parsedResult?.session) {
          setSession(parsedResult.session);
          saveThreadSession(sessionToken, parsedResult.session);
        }
        const generated = parsedResult?.output?.platform_variant?.generated_content || '';
        if (generated.trim()) {
          setSegments(splitThreadIntoSegments(generated));
        }
      } catch {
        setPayload(null);
      }
      return;
    }

    if (!prefillToken) return;
    try {
      const raw = sessionStorage.getItem(prefillToken);
      if (!raw) return;
      const parsedPrefill = JSON.parse(raw) as PrefillThreadPayload;
      const derivedSession = buildSessionFromPrefill(parsedPrefill);
      if (!derivedSession || !parsedPrefill.output) return;

      const token = createThreadSessionToken();
      const nextPayload: ThreadGenerationPayload = {
        output: parsedPrefill.output,
        session: derivedSession,
      };

      saveThreadSession(token, derivedSession);
      saveThreadResult(token, nextPayload);
      setActiveSessionToken(token);
      setSession(derivedSession);
      setPayload(nextPayload);

      const generated = parsedPrefill.output.platform_variant?.generated_content || '';
      if (generated.trim()) {
        setSegments(splitThreadIntoSegments(generated));
      }

      void router.replace({
        pathname: router.pathname,
        query: { session: token },
      }, undefined, { shallow: true });
    } catch {
      setSession(null);
      setPayload(null);
    }
  }, [prefillToken, router, sessionToken]);

  useEffect(() => {
    if (!activeSessionToken || !session || !selectedCompanyId || generating || payload?.output?.success) return;

    const run = async () => {
      setGenerating(true);
      setError(null);
      try {
        const response = await fetch('/api/threads/generate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: selectedCompanyId,
            topic: session.topic,
            platform: session.platform,
            objective: session.objective,
            target_audience: session.audience,
            tone: session.tone,
            cta: session.cta,
            template_name: session.formatLabel,
            extra_instruction: [
              session.extraInstruction,
              `Structure this as a true thread with a strong opener, a logical sequence, and a closing post that resolves the thread.`,
              `Keep each post able to stand alone while clearly earning the next one.`,
            ].filter(Boolean).join('\n\n'),
          }),
        });

        const data = (await response.json()) as ApiResponse;
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to generate thread');
        }

        const nextPayload: ThreadGenerationPayload = { output: data, session };
        setPayload(nextPayload);

        const generated = data.platform_variant?.generated_content || '';
        setSegments(splitThreadIntoSegments(generated));

        saveThreadResult(activeSessionToken, nextPayload);
      } catch (generationError) {
        setError(generationError instanceof Error ? generationError.message : 'Failed to generate thread');
      } finally {
        setGenerating(false);
      }
    };

    void run();
  }, [activeSessionToken, generating, payload?.output?.success, selectedCompanyId, session]);

  const fullThread = useMemo(() => joinThreadSegments(segments), [segments]);
  const hashtags = payload?.output?.platform_variant?.discoverability_meta?.hashtags || [];
  const decisionTrace = payload?.output?.master_content?.decision_trace;
  const adaptationTrace = payload?.output?.platform_variant?.adaptation_trace;
  const socialLink = useMemo(() => {
    return getThreadSchedulerLink({
      sessionToken: activeSessionToken,
      executionMode: session?.executionMode || 'manual',
      topic: session?.topic,
    });
  }, [activeSessionToken, session?.executionMode, session?.topic]);

  const copyThread = async () => {
    if (!fullThread.trim()) return;
    await navigator.clipboard.writeText(fullThread).catch(() => null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  useEffect(() => {
    if (!activeSessionToken || !payload || typeof window === 'undefined') return;
    saveThreadResult(activeSessionToken, {
      ...payload,
      output: {
        ...payload.output,
        platform_variant: {
          ...payload.output?.platform_variant,
          generated_content: fullThread,
        },
      },
    });
  }, [activeSessionToken, fullThread, payload]);

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

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">No thread session found</h1>
          <p className="mt-3 text-sm text-slate-600">Start from thread intelligence so we can build the sequence with the right context.</p>
          <Link href="/threads/create" className="mt-6 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">
            Create thread
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Generated Thread | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50 px-4 py-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Generated Thread</p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Your thread sequence is ready</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                This is now a sequence editor, not a shortform result card. Tighten the opener, rebalance the middle posts, or adjust the close before publishing it as one thread.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyThread()}
              disabled={!fullThread.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy full thread'}
            </button>
          </div>

          {generating && (
            <div className="mb-6 rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-3 text-violet-700">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-sm font-semibold">Building the full thread sequence...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_360px]">
            <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Thread Brief</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{session.topic}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {session.formatLabel} on {session.platformLabel} with a {session.intentLabel.toLowerCase()} sequence.
                </p>
              </div>

              {segments.length > 0 && (
                <ThreadSegmentsEditor segments={segments} onChange={setSegments} />
              )}
            </section>

            <aside className="space-y-5">
              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Sequence Notes</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div>
                    <p className="font-semibold text-slate-900">Objective</p>
                    <p className="mt-1">{decisionTrace?.objective || session.objective}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Writing Angle</p>
                    <p className="mt-1">{decisionTrace?.writing_angle || session.intentLabel}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Platform Strategy</p>
                    <p className="mt-1">{adaptationTrace?.style_strategy || `Built for ${session.platformLabel} as the primary thread destination.`}</p>
                  </div>
                </div>
              </div>

              {hashtags.length > 0 && (
                <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Discoverability Support</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {hashtags.map((tag) => (
                      <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next Actions</p>
                <div className="mt-4 flex flex-col gap-3">
                  <Link href={socialLink} className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700">
                    Review, schedule, and post
                  </Link>
                  <Link href={getThreadContinuationLink(activeSessionToken)} className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                    Plan continuation
                  </Link>
                  <Link href={`/campaign-planner?mode=direct&source=thread-result&contentType=thread&topic=${encodeURIComponent(session.topic)}`} className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                    Use in campaign
                  </Link>
                  <Link href="/threads/intelligence" className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                    Build another thread
                  </Link>
                </div>
              </div>

              <div className="rounded-[28px] border border-violet-100 bg-violet-50/80 p-5">
                <div className="flex items-center gap-2 text-violet-700">
                  <Sparkles className="h-4 w-4" />
                  <p className="text-sm font-semibold">Execution rule</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-violet-900">
                  {getThreadExecutionLabel(session.executionMode)}. {getThreadExecutionDescription(session.executionMode)} If engagement appears within two days after sharing, engagement-driven continuation should take over. If not, the next thread step stays manual.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
