'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, MessageSquareText, TimerReset } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import { getThreadExecutionDescription, getThreadExecutionLabel } from '../../lib/thread/threadExecution';
import {
  buildThreadContinuationDraft,
  deriveThreadContinuationSummary,
  deriveThreadPublishState,
  THREAD_FOLLOW_UP_OPTIONS,
} from '../../lib/thread/threadContinuation';
import { getThreadPlatformLabel, type ThreadSessionPayload } from '../../lib/thread/threadFlow';
import {
  createThreadReplyDraftToken,
  loadThreadPublishLink,
  loadThreadResult,
  loadThreadSession,
  saveThreadSession,
  writeThreadStorage,
  type ThreadContinuationReplyDraft,
  type ThreadPublishLink,
} from '../../lib/thread/threadStorage';
import {
  getThreadEngagementLink,
  getThreadFollowUpLink,
  getThreadResultLink,
  getThreadSchedulerLink,
} from '../../lib/thread/threadLinks';

type EngagementThreadSummary = {
  id: string;
  platform: string | null;
  platform_thread_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ScheduledPostLookup = {
  id?: string;
  platform?: string | null;
  platform_post_id?: string | null;
  status?: string | null;
};

function normalizePlatform(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'twitter' ? 'x' : normalized;
}

export default function ThreadContinuationView() {
  const router = useRouter();
  const { user, isLoading, selectedCompanyId } = useCompanyContext();
  const sessionToken = typeof router.query.session === 'string' ? router.query.session : '';
  const threadId = typeof router.query.threadId === 'string' ? router.query.threadId : '';

  const [session, setSession] = useState<ThreadSessionPayload | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState(THREAD_FOLLOW_UP_OPTIONS[0].value);
  const [contextNote, setContextNote] = useState('');
  const [candidateThreads, setCandidateThreads] = useState<EngagementThreadSummary[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [publishedLink, setPublishedLink] = useState<ThreadPublishLink | null>(null);
  const [scheduledPost, setScheduledPost] = useState<ScheduledPostLookup | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const activePlatform = useMemo(() => {
    const platform = normalizePlatform(publishedLink?.platform || scheduledPost?.platform || session?.platform);
    return platform || session?.platform || 'x';
  }, [publishedLink?.platform, scheduledPost?.platform, session?.platform]);
  const activePlatformLabel = activePlatform === 'linkedin' || activePlatform === 'x'
    ? getThreadPlatformLabel(activePlatform)
    : activePlatform.charAt(0).toUpperCase() + activePlatform.slice(1);

  useEffect(() => {
    if (!sessionToken || typeof window === 'undefined') return;
    const parsedSession = loadThreadSession(sessionToken);
    if (parsedSession) {
      setSession(parsedSession);
      return;
    }
    const parsedResult = loadThreadResult(sessionToken);
    if (parsedResult?.session) {
      setSession(parsedResult.session);
      saveThreadSession(sessionToken, parsedResult.session);
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken || typeof window === 'undefined') return;
    setPublishedLink(loadThreadPublishLink(sessionToken));
  }, [sessionToken]);

  useEffect(() => {
    if (!publishedLink?.scheduledPostId) {
      setScheduledPost(null);
      return;
    }
    let active = true;
    fetch(`/api/schedule/posts/${encodeURIComponent(publishedLink.scheduledPostId)}`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : { data: null }))
      .then((data) => {
        if (!active) return;
        setScheduledPost((data?.data ?? null) as ScheduledPostLookup | null);
      })
      .catch(() => {
        if (active) setScheduledPost(null);
      });

    return () => {
      active = false;
    };
  }, [publishedLink?.scheduledPostId]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    let active = true;
    fetch(`/api/feature-completion?sync=true&company_id=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { data: null }))
      .then((data) => {
        if (!active) return;
        const features = Array.isArray(data?.data?.features) ? data.data.features : [];
        const extensionFeature = features.find((entry: { key?: string; status?: string; score?: number }) => entry.key === 'chrome_extension_installed');
        setExtensionReady(Boolean(extensionFeature && (extensionFeature.status === 'completed' || Number(extensionFeature.score) >= 1)));
      })
      .catch(() => {
        if (active) setExtensionReady(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId || !activePlatform || !session) return;
    let active = true;
    setLoadingThreads(true);
    fetch(
      `/api/engagement/threads?organization_id=${encodeURIComponent(selectedCompanyId)}&platform=${encodeURIComponent(activePlatform)}&limit=20`,
      { credentials: 'include' },
    )
      .then((response) => (response.ok ? response.json() : { threads: [] }))
      .then((data) => {
        if (!active) return;
        const startedAt = session.createdAt ? new Date(session.createdAt).getTime() : 0;
        const threads = Array.isArray(data?.threads) ? data.threads : [];
        const relevant = threads.filter((entry: EngagementThreadSummary) => {
          const platform = normalizePlatform(entry.platform);
          const platformThreadId = String(entry.platform_thread_id || '').trim();
          const publishedPlatformPostId = String(scheduledPost?.platform_post_id || '').trim();
          if (publishedPlatformPostId) {
            return platform === activePlatform && platformThreadId === publishedPlatformPostId;
          }
          const updatedAt = entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
          const createdAt = entry.created_at ? new Date(entry.created_at).getTime() : 0;
          return platform === activePlatform && Math.max(updatedAt, createdAt) >= startedAt;
        });
        setCandidateThreads(relevant);
      })
      .catch(() => {
        if (active) setCandidateThreads([]);
      })
      .finally(() => {
        if (active) setLoadingThreads(false);
      });

    return () => {
      active = false;
    };
  }, [activePlatform, scheduledPost?.platform_post_id, selectedCompanyId, session]);

  const interactionDetected = router.query.engagement === '1' || Boolean(threadId) || candidateThreads.length > 0;

  const summary = useMemo(
    () => deriveThreadContinuationSummary({ startedAt: session?.createdAt, interactionDetected }),
    [interactionDetected, session?.createdAt],
  );
  const publishState = useMemo(
    () =>
      deriveThreadPublishState({
        scheduledPostId: publishedLink?.scheduledPostId ?? null,
        scheduledStatus: scheduledPost?.status ?? null,
        platformPostId: scheduledPost?.platform_post_id ?? null,
        engagementLinked: candidateThreads.length > 0,
      }),
    [candidateThreads.length, publishedLink?.scheduledPostId, scheduledPost?.platform_post_id, scheduledPost?.status],
  );
  const hasScheduledLink = Boolean(publishedLink?.scheduledPostId);
  const hasPublishedIdentity = Boolean(scheduledPost?.platform_post_id);
  const needsPublishSetup = !hasScheduledLink && !hasPublishedIdentity;
  const waitingForPublishIdentity = hasScheduledLink && !hasPublishedIdentity && candidateThreads.length === 0;

  const followUp = THREAD_FOLLOW_UP_OPTIONS.find((entry) => entry.value === selectedFollowUp) ?? THREAD_FOLLOW_UP_OPTIONS[0];
  const continuationDraft = useMemo(() => {
    if (!session) return '';
    return buildThreadContinuationDraft({
      topic: session.topic,
      intentLabel: session.intentLabel,
      companyName: session.companyName,
      followUpDescription: followUp.description,
      contextNote,
    });
  }, [contextNote, followUp.description, session]);
  const nextManualLink = useMemo(() => {
    if (!sessionToken || !session) return '/threads/intelligence';
    const note = contextNote.trim() || followUp.description;
    return getThreadFollowUpLink({
      format: session.format,
      topic: session.topic,
      reason: note,
      intent: session.intent,
      platform: session.platform,
      executionMode: session.executionMode,
    });
  }, [contextNote, followUp.description, session, sessionToken]);
  const schedulerLink = useMemo(() => {
    if (!sessionToken || !session) return '/command-center/content';
    return getThreadSchedulerLink({
      sessionToken,
      executionMode: session.executionMode,
    });
  }, [session, sessionToken]);

  const openEngagementWithSuggestion = (targetThreadId: string) => {
    if (typeof window === 'undefined') {
      void router.push(getThreadEngagementLink(targetThreadId));
      return;
    }
    const token = createThreadReplyDraftToken();
    const payload: ThreadContinuationReplyDraft = {
      threadId: targetThreadId,
      text: continuationDraft,
      createdAt: new Date().toISOString(),
    };
    writeThreadStorage(token, payload);
    void router.push(getThreadEngagementLink(targetThreadId, token));
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

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">No thread context found</h1>
          <p className="mt-3 text-sm text-slate-600">Start with a thread first so the continuation flow knows what it is extending.</p>
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
        <title>Thread Continuation | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50 px-4 py-8">
        <div className="mx-auto max-w-6xl">
          <Link href={getThreadResultLink(sessionToken)} className="mb-8 inline-flex text-sm text-gray-600 transition hover:text-gray-900">
            &larr; Back
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Thread Continuation</p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">{summary.label}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-gray-600">{summary.description}</p>
            {summary.deadlineLabel && (
              <p className="mt-3 text-sm font-medium text-violet-700">
                {summary.mode === 'waiting_for_engagement' ? 'Observation window ends' : 'Fallback became active'}: {summary.deadlineLabel}
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Current Thread</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{session.topic}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {session.formatLabel} for {activePlatformLabel} with a {session.intentLabel.toLowerCase()} sequence.
                </p>
              </div>

              {needsPublishSetup ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-5">
                  <div className="flex items-center gap-2 text-amber-700">
                    <TimerReset className="h-4 w-4" />
                    <p className="text-sm font-semibold">Schedule or publish this thread first</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-amber-900">
                    Continuation should attach to a real scheduled or published thread. Finish the sharing step first, then come back here to watch for engagement or plan the follow-up.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={schedulerLink}
                      className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-700"
                    >
                      Review, schedule, and post
                    </Link>
                    <Link
                      href={getThreadResultLink(sessionToken)}
                      className="inline-flex items-center justify-center rounded-xl border border-amber-200 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:border-amber-300"
                    >
                      Back to thread result
                    </Link>
                  </div>
                </div>
              ) : waitingForPublishIdentity ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex items-center gap-2 text-slate-700">
                    <TimerReset className="h-4 w-4" />
                    <p className="text-sm font-semibold">Waiting for the published thread identity</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    This thread is already scheduled, but engagement takeover should begin only after the platform returns a publish id. You can keep the schedule, post it now, or come back once it goes live.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={schedulerLink}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
                    >
                      Review schedule
                    </Link>
                  </div>
                </div>
              ) : summary.canUseEngagement ? (
                <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/80 p-5">
                  <div className="flex items-center gap-2 text-violet-700">
                    <MessageSquareText className="h-4 w-4" />
                    <p className="text-sm font-semibold">Engagement is now the control point</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-violet-900">
                    Use the live interaction to shape the next thread step. Continue from the engagement surface, review the suggested continuation, then edit and post from there.
                  </p>
                  <div className="mt-4 space-y-3">
                    {loadingThreads ? (
                      <div className="flex items-center gap-2 text-sm text-violet-700">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Checking live engagement threads...
                      </div>
                    ) : (
                      <>
                        {(candidateThreads.length > 0 ? candidateThreads : threadId ? [{ id: threadId, platform: activePlatform }] : []).slice(0, 4).map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-violet-200 bg-white px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-violet-900">
                                Open engagement thread
                                <span className="ml-2 text-violet-600">
                                  {entry.platform_thread_id || entry.id.slice(0, 8)}
                                </span>
                              </span>
                              <ArrowRight className="h-4 w-4 text-violet-500" />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openEngagementWithSuggestion(entry.id)}
                                className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
                              >
                                Open with suggested continuation
                              </button>
                              <Link
                                href={getThreadEngagementLink(entry.id)}
                                className="inline-flex items-center justify-center rounded-xl border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-700 transition hover:border-violet-300"
                              >
                                Open thread only
                              </Link>
                            </div>
                          </div>
                        ))}
                        {candidateThreads.length === 0 && !threadId && (
                          <div className="flex flex-wrap gap-2">
                            <Link href="/engagement" className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700">
                              Open engagement
                            </Link>
                            {!extensionReady ? <Link href="/integrations?focus=data" className="inline-flex items-center justify-center rounded-xl border border-violet-200 px-4 py-3 text-sm font-semibold text-violet-700 transition hover:border-violet-300">Install extension</Link> : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <p className="mb-3 text-sm font-semibold text-slate-800">Manual follow-up angle</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {THREAD_FOLLOW_UP_OPTIONS.map((option) => {
                      const active = option.value === selectedFollowUp;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setSelectedFollowUp(option.value)}
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

                  <div className="mt-6">
                    <label className="mb-2 block text-sm font-semibold text-slate-800">What should the follow-up lean into?</label>
                    <textarea
                      rows={4}
                      value={contextNote}
                      onChange={(event) => setContextNote(event.target.value)}
                      placeholder="Optional: add the exact angle, objection, lesson, or example the next thread should pick up."
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
                    />
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href={nextManualLink} className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700">
                      Continue manually
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-5">
              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Publish State</p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      publishState.tone === 'green'
                        ? 'bg-emerald-100 text-emerald-700'
                        : publishState.tone === 'blue'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {publishState.label}
                  </span>
                  {publishedLink?.scheduledPostId && (
                    <span className="text-xs text-slate-500">Scheduled post: {publishedLink.scheduledPostId}</span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{publishState.description}</p>
              </div>

              <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <div className="flex items-center gap-2 text-slate-700">
                  <TimerReset className="h-4 w-4" />
                  <p className="text-sm font-semibold">Operating rule</p>
                </div>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <p>{getThreadExecutionLabel(session.executionMode)}. {getThreadExecutionDescription(session.executionMode)}</p>
                  <p>If there is real interaction within 2 days, engagement-driven continuation should take over.</p>
                  <p>If no interaction appears in that window, the next thread step should move to manual planning.</p>
                  <p>Do not let the sequence stall waiting forever for engagement.</p>
                  <p>{extensionReady ? 'Chrome extension is ready if you want faster last-mile execution from the live platform.' : 'Chrome extension is not installed for this company yet, so engagement continuation will stay in the in-app workflow.'}</p>
                  {needsPublishSetup ? (
                    <p>Finish scheduling or publishing first so continuation can attach to an actual thread instead of a draft-only session.</p>
                  ) : scheduledPost?.platform_post_id ? (
                    <p>Published identity is now tied to platform post id <span className="font-medium text-slate-900">{scheduledPost.platform_post_id}</span>.</p>
                  ) : publishedLink?.scheduledPostId ? (
                    <p>The thread is linked to scheduled post <span className="font-medium text-slate-900">{publishedLink.scheduledPostId}</span> and will attach to engagement once the platform post id exists.</p>
                  ) : (
                    <p>Schedule or publish the thread once to attach a direct publish identity for continuation tracking.</p>
                  )}
                </div>
              </div>

            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
