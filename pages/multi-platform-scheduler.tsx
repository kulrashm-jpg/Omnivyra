import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle2, Loader2, Rocket } from 'lucide-react';
import { useCompanyContext } from '@/components/CompanyContext';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { resolveSchedulerDraft } from '@/components/content/post-to-social/schedulerDraft';
import PostToSocialPlatformPanel from '@/components/content/post-to-social/PostToSocialPlatformPanel';
import { defaultScheduleValue, getContentTypeLabel, normalizePlatform, parseHashtags, resolveSocialPublishType, type ConnectedAccount, type DraftPayload, type PlatformConfigItem, type PlatformOption, type PlatformState } from '@/components/content/post-to-social/schedulerShared';
import { clearThreadPublishLink, saveThreadPublishLink } from '@/lib/thread/threadStorage';
import { getThreadContinuationLink } from '@/lib/thread/threadLinks';
export default function MultiPlatformSchedulerPage() {
  const router = useRouter();
  const { user, selectedCompanyId, selectedCompanyName, isLoading } = useCompanyContext();
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [loadingPlatforms, setLoadingPlatforms] = useState(true);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfigItem[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [platformState, setPlatformState] = useState<Record<string, PlatformState>>({});
  const [adaptingPlatform, setAdaptingPlatform] = useState<string | null>(null);
  const adaptedPlatformKeysRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (typeof window === 'undefined' || !router.isReady) return;
    const topic = typeof router.query.topic === 'string' ? router.query.topic.trim() : '';
    const prefill = typeof router.query.prefill === 'string' ? router.query.prefill : '';
    const sourceContentType = typeof router.query.contentType === 'string' ? router.query.contentType.trim() : 'post';
    const sourceId = typeof router.query.sourceId === 'string' ? router.query.sourceId : null;
    setDraft(resolveSchedulerDraft({ prefill, topic, sourceContentType, sourceId }));
    setLoadingDraft(false);
  }, [router.isReady, router.query.contentType, router.query.prefill, router.query.sourceId, router.query.topic]);
  useEffect(() => {
    if (!selectedCompanyId) return;
    let active = true;
    setLoadingPlatforms(true);
    Promise.all([
      fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { accounts: [] }))
        .catch(() => ({ accounts: [] })),
      fetch(`/api/company/platform-config?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { platforms: [] }))
        .catch(() => ({ platforms: [] })),
    ])
      .then(([accountsData, configData]) => {
        if (!active) return;
        const accounts = Array.isArray(accountsData?.accounts) ? accountsData.accounts : [];
        const configs = Array.isArray(configData?.platforms) ? configData.platforms : [];
        setConnectedAccounts(
          accounts.filter((account: ConnectedAccount) => account.connected && account.category === 'social'),
        );
        setPlatformConfig(configs);
      })
      .finally(() => {
        if (active) setLoadingPlatforms(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);
  const platformOptions = useMemo(() => {
    const configMap = new Map(platformConfig.map((item) => [normalizePlatform(item.platform), item]));
    return connectedAccounts
      .map((account) => {
        const key = normalizePlatform(account.platform_key);
        const config = configMap.get(key);
        if (!config) return null;
        return {
          key,
          label: account.platform_label,
          socialAccountId: account.social_account_id,
          accountName: account.account_name || account.username || null,
          contentTypes: config.content_types?.length ? config.content_types : ['post'],
        };
      })
      .filter(Boolean) as PlatformOption[];
  }, [connectedAccounts, platformConfig]);
  useEffect(() => {
    if (platformOptions.length === 0) {
      setSelectedPlatform('');
      return;
    }
    setSelectedPlatform((current) => (current && platformOptions.some((item) => item.key === current) ? current : platformOptions[0].key));
  }, [platformOptions]);
  useEffect(() => {
    if (!draft) return;
    adaptedPlatformKeysRef.current = {};
    setPlatformState((current) => {
      const next = { ...current };
      for (const option of platformOptions) {
        if (next[option.key]) continue;
        next[option.key] = {
          contentType: option.contentTypes[0] || 'post',
          content: draft.content,
          hashtags: draft.hashtags.join(' '),
          scheduledFor: defaultScheduleValue(),
          busy: false,
          message: null,
          status: 'idle',
        };
      }
      return next;
    });
  }, [draft, platformOptions]);

  const selectedOption = platformOptions.find((item) => item.key === selectedPlatform) || null;
  const selectedState = selectedPlatform ? platformState[selectedPlatform] : null;
  const sourceContentType = String(draft?.sourceContentType || router.query.contentType || 'post').trim().toLowerCase();
  const executionMode = typeof router.query.executionMode === 'string' ? router.query.executionMode.trim().toLowerCase() : '';
  const publishContentType = resolveSocialPublishType(sourceContentType, selectedOption);
  const sourceContentLabel = getContentTypeLabel(sourceContentType);
  const publishContentLabel = getContentTypeLabel(publishContentType);
  const isManualThreadFlow = sourceContentType === 'thread' && executionMode !== 'auto';

  const updatePlatformState = (platform: string, patch: Partial<PlatformState>) => {
    setPlatformState((current) => ({
      ...current,
      [platform]: {
        ...current[platform],
        ...patch,
      },
    }));
  };

  const persistThreadPublishLink = (platform: string, scheduledPostId: string | null) => {
    if (typeof window === 'undefined' || !draft?.sourceId || sourceContentType !== 'thread') return;
    if (!scheduledPostId) {
      clearThreadPublishLink(draft.sourceId);
      return;
    }
    saveThreadPublishLink(draft.sourceId, {
      scheduledPostId,
      platform,
      updatedAt: new Date().toISOString(),
    });
  };

  const ensureDraftAndPlatform = () => {
    if (!draft || !selectedOption || !selectedState) {
      return { ok: false as const, error: 'Select a connected platform first.' };
    }
    if (!selectedState.content.trim()) {
      return { ok: false as const, error: 'Post content is empty.' };
    }
    return { ok: true as const };
  };

  useEffect(() => {
    if (!selectedCompanyId || !draft || !selectedOption) return;
    const state = platformState[selectedOption.key];
    if (!state) return;
    if (adaptingPlatform === selectedOption.key || state.busy) return;
    const sourcePlatform = normalizePlatform(draft.sourcePlatform || '');
    if (sourcePlatform && sourcePlatform === selectedOption.key) {
      return;
    }
    const currentContent = String(state.content || '').trim();
    const draftContent = String(draft.content || '').trim();
    if (currentContent && draftContent && currentContent !== draftContent) return;

    const adaptationKey = `${selectedOption.key}::${draft.title}::${draft.topic}::${draft.content}`;
    if (adaptedPlatformKeysRef.current[selectedOption.key] === adaptationKey) {
      return;
    }

    const adaptForPlatform = async () => {
      adaptedPlatformKeysRef.current[selectedOption.key] = adaptationKey;
      setAdaptingPlatform(selectedOption.key);
      updatePlatformState(selectedOption.key, { busy: true, message: null });

      try {
        const masterContent = draft.masterContent || {
          id: `scheduler-master-${Date.now()}`,
          generated_at: new Date().toISOString(),
          content: draft.content,
          generation_status: 'generated',
          generation_source: 'ai',
          content_type_mode: 'text',
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        let response: Response;
        try {
          response = await fetch('/api/activity-workspace/content', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              action: 'generate_variants',
              companyId: selectedCompanyId,
              activity: {
                id: `workspace-${selectedOption.key}`,
                title: draft.title,
                topic: draft.topic,
                platform: selectedOption.key,
                contentType: publishContentType,
              },
              dailyExecutionItem: {
                execution_id: `workspace-post-${selectedOption.key}`,
                platform: selectedOption.key,
                content_type: publishContentType,
                topic: draft.topic,
                title: draft.title,
                master_content: masterContent,
                active_platform_targets: [
                  {
                    platform: selectedOption.key,
                    content_type: publishContentType,
                  },
                ],
              },
            }),
          });
        } finally {
          clearTimeout(timeout);
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to adapt content for the selected platform.');
        }

        const variant = Array.isArray(data?.platform_variants) ? data.platform_variants[0] : null;
        if (!variant?.generated_content) throw new Error('The platform-adapted post was missing from the response.');

        updatePlatformState(selectedOption.key, {
          content: String(variant.generated_content || '').trim(),
          hashtags: Array.isArray(variant?.discoverability_meta?.hashtags)
            ? variant.discoverability_meta.hashtags.join(' ')
            : state.hashtags,
          busy: false,
          message: `Adapted for ${selectedOption.label}.`,
          status: 'idle',
        });
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (!isAbort) delete adaptedPlatformKeysRef.current[selectedOption.key];
        updatePlatformState(selectedOption.key, {
          busy: false,
          status: isAbort ? 'idle' : 'error',
          message: isAbort
            ? `LinkedIn adaptation took too long. You can keep editing and continue with the current post.`
            : error instanceof Error
              ? error.message
              : 'Failed to adapt the post for this platform.',
        });
      } finally {
        setAdaptingPlatform((current) => (current === selectedOption.key ? null : current));
      }
    };

    void adaptForPlatform();
  }, [adaptingPlatform, draft, platformState, selectedCompanyId, selectedOption]);

  const scheduleOrPublish = async (mode: 'schedule' | 'publish') => {
    const check = ensureDraftAndPlatform();
    if (!check.ok || !selectedOption || !selectedState) {
      if (selectedPlatform) updatePlatformState(selectedPlatform, { message: check.error, status: 'error' });
      return;
    }

    updatePlatformState(selectedPlatform, { busy: true, message: null, status: 'idle' });
    try {
      const scheduleDate =
        mode === 'publish'
          ? new Date(Date.now() + 5 * 60 * 1000)
          : new Date(selectedState.scheduledFor);
      const hashtagsArray = parseHashtags(selectedState.hashtags);
      let scheduledPostId = selectedState.scheduledPostId || null;

      if (scheduledPostId) {
        const updateRes = await fetch(`/api/schedule/posts/${scheduledPostId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft?.title,
            content: selectedState.content,
            hashtags: hashtagsArray,
            scheduledFor: scheduleDate.toISOString(),
            status: 'scheduled',
            contentType: publishContentType,
          }),
        });
        const updateData = await updateRes.json().catch(() => ({}));
        if (!updateRes.ok) {
          throw new Error(updateData.error || 'Failed to update scheduled post');
        }
      } else {
        const scheduleRes = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            title: draft?.title,
            content: selectedState.content,
            hashtags: hashtagsArray.join(' '),
            scheduledFor: scheduleDate.toISOString(),
            contentType: publishContentType,
            platform: selectedOption.key,
            accountId: selectedOption.socialAccountId,
          }),
        });
        const scheduleData = await scheduleRes.json().catch(() => ({}));
        if (!scheduleRes.ok) {
          throw new Error(scheduleData.error || 'Failed to schedule post');
        }
        scheduledPostId = scheduleData.id || null;
      }

      if (mode === 'publish') {
        const publishRes = await fetch('/api/social/publish', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: scheduledPostId }),
        });
        const publishData = await publishRes.json().catch(() => ({}));
        if (!publishRes.ok) {
          throw new Error(publishData.error || 'Failed to publish post');
        }
      persistThreadPublishLink(selectedPlatform, scheduledPostId);
      updatePlatformState(selectedPlatform, { busy: false, status: 'published', message: `${selectedOption.label} post published successfully.` });
        return;
      }

      persistThreadPublishLink(selectedPlatform, scheduledPostId);
      updatePlatformState(selectedPlatform, { busy: false, scheduledPostId, status: 'scheduled', message: `${selectedOption.label} post scheduled for ${scheduleDate.toLocaleString()}.` });
    } catch (error) {
      updatePlatformState(selectedPlatform, { busy: false, status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  };

  const deleteScheduledPost = async () => {
    if (!selectedOption || !selectedState?.scheduledPostId) return;

    updatePlatformState(selectedOption.key, { busy: true, message: null });
    try {
      const response = await fetch(`/api/schedule/posts/${selectedState.scheduledPostId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to delete scheduled post');

      persistThreadPublishLink(selectedOption.key, null);
      updatePlatformState(selectedOption.key, { busy: false, scheduledPostId: null, status: 'idle', message: `${selectedOption.label} scheduled post deleted.` });
    } catch (error) {
      updatePlatformState(selectedOption.key, { busy: false, status: 'error', message: error instanceof Error ? error.message : 'Failed to delete scheduled post.' });
    }
  };

  if (isLoading || loadingDraft || loadingPlatforms) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Sign in to continue.</div>;
  }

  return (
    <>
      <Head>
        <title>Share to Social | OmniVyra</title>
      </Head>

      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Share to Social</p>
                <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold text-slate-950">
                  <span className="rounded-2xl bg-blue-100 p-3 text-blue-700"><Rocket className="h-5 w-5" /></span>
                  Share this {sourceContentLabel.toLowerCase()} for {selectedCompanyName || 'your company'}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  Select one connected platform, let the system repurpose the draft for that channel, then schedule it or share it live.
                </p>
                {isManualThreadFlow ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-violet-700">
                    Manual review is active for this thread. Adjust the sequence for the selected platform, choose the timing, and share it only when you are ready.
                  </p>
                ) : null}
              </div>
              <div className="flex gap-3">
                <Link href="/command-center/content" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  Back to content hub
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">{sourceContentLabel} ready to share</h2>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-900">{draft?.title || 'Generated post'}</p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-700">{draft?.content || ''}</pre>
                {draft?.hashtags?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.hashtags.map((tag) => (
                      <span key={tag} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Connected platforms</h2>
              {platformOptions.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                  No connected social platform is available for this company yet.
                  <div className="mt-4">
                    <Link href="/social-platforms" className="font-semibold text-blue-700 hover:text-blue-800">
                      Connect a platform first
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {platformOptions.map((option) => {
                      const active = option.key === selectedPlatform;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setSelectedPlatform(option.key)}
                          className={`rounded-2xl border p-4 text-left transition ${
                            active ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <PlatformIcon platform={option.key} size={18} showLabel />
                            {active ? <CheckCircle2 className="ml-auto h-4 w-4 text-blue-600" /> : null}
                          </div>
                          <p className="mt-3 text-sm font-semibold text-slate-900">{option.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{option.accountName || 'Connected account'}</p>
                        </button>
                      );
                    })}
                  </div>

                  {selectedOption && selectedState ? (
                    <>
                      <PostToSocialPlatformPanel
                        adaptingPlatform={adaptingPlatform}
                        sourceContentLabel={sourceContentLabel}
                        publishContentLabel={publishContentLabel}
                        selectedOption={selectedOption}
                        selectedState={selectedState}
                        minScheduleValue={defaultScheduleValue()}
                        onChange={(patch) => updatePlatformState(selectedOption.key, patch)}
                        onSchedule={() => void scheduleOrPublish('schedule')}
                        onPublish={() => void scheduleOrPublish('publish')}
                        onDelete={() => void deleteScheduledPost()}
                      />

                      {isManualThreadFlow && draft?.sourceId ? (
                        <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-600">Thread Follow-through</p>
                          <p className="mt-2 text-sm leading-6 text-violet-900">
                            Once you schedule or share this thread, move into continuation planning so the next step is ready if engagement shows up or the 2-day manual fallback kicks in.
                          </p>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <Link
                              href={getThreadContinuationLink(draft.sourceId)}
                              className="inline-flex items-center justify-center rounded-xl border border-violet-300 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:border-violet-400 hover:bg-violet-100"
                            >
                              Open continuation plan
                            </Link>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
