/** MultiPlatformSchedulerPage — thin composition (relocated out of pages/). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle2, Loader2, Rocket } from 'lucide-react';
import { useCompanyContext } from '@/components/CompanyContext';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { resolveSchedulerDraft } from '@/components/content/post-to-social/schedulerDraft';
import PostToSocialPlatformPanel from '@/components/content/post-to-social/PostToSocialPlatformPanel';
import { filterConnectedPlatformsForContent } from '@/lib/shared/social/platformContentFilter';
import { CAPABILITY_LOG_EVENTS, type CapabilityLogPayload } from '@/lib/shared/social/capabilityEvents';
import { defaultScheduleValue, getContentTypeLabel, normalizePlatform, parseHashtags, resolveSocialPublishType, type ConnectedAccount, type DraftPayload, type PlatformConfigItem, type PlatformOption, type PlatformState } from '@/components/content/post-to-social/schedulerShared';
import { clearThreadPublishLink, saveThreadPublishLink } from '@/lib/thread/threadStorage';
import { getThreadNodeAttachmentsFromGraph } from '@/lib/thread/threadNodeUsageGraph';
import { getThreadContinuationLink } from '@/lib/thread/threadLinks';
import { openThreadRuntimeTracer } from '@/backend/services/threadRuntime/threadRuntimeInstrumentation';
import {
  POST_CREATOR_ASSET_TYPES_VISIBLE,
  THREAD_CREATOR_ASSET_TYPES_VISIBLE,
  assetLabel,
  buildWriterCreatorPrefill,
  createWriterSourceId,
  launchCreatorFromWriter,
  type CreatorAssetLaunchType,
  type WriterAttachedAsset,
  type WriterSourceType,
} from '@/lib/content/writerCreatorAssetLaunch';
import { loadWriterAttachmentsViaGraph } from '@/lib/content/writerAttachmentGraph';
import { detachUsage, writerDraftConsumer } from '@/lib/content/creatorAssetUsageGraph';
import {
  defaultAttachmentModeForAsset,
  defaultTransformForAsset,
  type AttachmentMode,
} from '@/lib/content/writerCreatorAttachmentContracts';
import { mediaTypesFromCreatorAttachments } from '@/lib/content/schedulerAttachmentSemantics';
import { attachmentRefsForConsumer, resolveSchedulingMediaUrls } from '@/lib/content/writerSchedulingRefs';
import AssetReusePicker from '@/components/creator/AssetReusePicker';
import { splitThreadIntoSegments, buildThreadNodesFromSegments } from '@/lib/thread/threadFlow';
import { validatePostForPlatform } from '@/lib/preview/platformLimitValidation';
import { useMultiPlatformSchedulerController } from './MultiPlatformSchedulerController';

export default function MultiPlatformSchedulerPage() {
  const f = useMultiPlatformSchedulerController();
  const {
    adaptedPlatformKeysRef, adaptingPlatform, allPlatformOptions, assetMenuOpen, assetSelector, attachVideoUrl, attachedAssets,
    connectedAccounts, deleteScheduledPost, displayablePlatformOptions, draft, ensureDraftAndPlatform, entryIntent, executionMode,
    getSourceContentForPlatform, handleRemoveAttachment, hiddenReasonByKey, isLikelyVideoUrl, isLoading, isManualThreadFlow,
    launchAssetCreator, loadingDraft, loadingPlatforms, persistThreadPublishLink, platformConfig, platformFilter, platformOptions,
    platformState, prefersImmediateShare, publishContentLabel, publishContentType, refreshAttachmentsFromGraph,
    requestQuickPlatformAdaptation, requestedPlatform, reuseAssetType, router, scheduleOrPublish, schedulerSourceContentType,
    selectedCompanyId, selectedCompanyName, selectedOption, selectedPlatform, selectedState, setAdaptingPlatform, setAssetMenuOpen,
    setAttachedAssets, setConnectedAccounts, setDraft, setLoadingDraft, setLoadingPlatforms, setPlatformConfig, setPlatformState,
    setReuseAssetType, setSelectedPlatform, setVideoFormOpen, setVideoInput, setVideoUrl, shouldUseQuickPlatformAdaptation,
    sourceContentLabel, sourceContentType, supportedCreatorAssetTypes, unregisteredKeys, updatePlatformState, user, videoFormOpen,
    videoInput, videoUrl, writerSourceId, writerSourceType
  } = f;

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
        <title>Share to Social | Omnivyra</title>
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
                  {prefersImmediateShare
                    ? 'The selected platform is ready for final review. Confirm the adapted copy, then share it live.'
                    : 'Select one connected platform, let the system repurpose the draft for that channel, then schedule it or share it live.'}
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
                {draft?.mediaUrls?.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {draft.mediaUrls.slice(0, 4).map((url, index) => (
                      <a
                        key={`${url}-${index}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                      >
                        <img
                          src={url}
                          alt={`${draft.title || 'Generated media'} ${index + 1}`}
                          className="h-44 w-full object-contain"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Connected platforms</h2>
              {allPlatformOptions.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                  No connected social platform is available for this company yet.
                  <div className="mt-4">
                    <Link href="/social-platforms" className="font-semibold text-blue-700 hover:text-blue-800">
                      Connect a platform first
                    </Link>
                  </div>
                </div>
              ) : platformFilter.capability === null ? (
                <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 p-5 text-sm text-amber-800">
                  Unable to determine compatible publishing platforms for this content type.
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {displayablePlatformOptions.map((option) => {
                      const disabled = hiddenReasonByKey.has(option.key);
                      const reason = hiddenReasonByKey.get(option.key);
                      const active = !disabled && option.key === selectedPlatform;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => { if (!disabled) setSelectedPlatform(option.key); }}
                          disabled={disabled}
                          aria-disabled={disabled || undefined}
                          title={disabled ? reason : undefined}
                          className={`rounded-2xl border p-4 text-left transition ${
                            disabled
                              ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                              : active
                                ? 'border-blue-300 bg-blue-50'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <PlatformIcon platform={option.key} size={18} showLabel />
                            {active ? <CheckCircle2 className="ml-auto h-4 w-4 text-blue-600" /> : null}
                          </div>
                          <p className={`mt-3 text-sm font-semibold ${disabled ? 'text-slate-500' : 'text-slate-900'}`}>{option.label}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {disabled ? reason : option.accountName || 'Connected account'}
                          </p>
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
                        assetAction={assetSelector}
                      />

                      {writerSourceType ? (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Attached Assets</p>
                          {attachedAssets.length === 0 && !videoUrl.trim() ? (
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              No Creator assets attached yet. Use Add Asset to create a supported Creator asset from this {sourceContentLabel.toLowerCase()}.
                            </p>
                          ) : (
                            <div className="mt-3 grid gap-2">
                              {attachedAssets.map((asset) => (
                                <div
                                  key={asset.id}
                                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 transition hover:border-slate-300"
                                >
                                  <a
                                    href={asset.url || `/command-center/creator-content/${asset.creatorType}`}
                                    target={asset.url ? '_blank' : undefined}
                                    rel={asset.url ? 'noreferrer' : undefined}
                                    className="min-w-0 flex-1"
                                  >
                                    <span className="font-semibold">{asset.title}</span>
                                    <span className="mt-1 block text-xs text-slate-500">
                                      {asset.creatorType.charAt(0).toUpperCase() + asset.creatorType.slice(1)}
                                      {asset.previewKind ? ` - ${asset.previewKind.replace(/_/g, ' ')}` : ''}
                                    </span>
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveAttachment(asset.id)}
                                    className="ml-3 shrink-0 text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                              {videoUrl.trim() ? (
                                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                                  <div className="min-w-0">
                                    <span className="font-semibold">Video</span>
                                    <a href={videoUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-blue-600 hover:underline">{videoUrl}</a>
                                    <span className="mt-0.5 block text-[11px] text-slate-500">Published as a video with your post text.</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setVideoUrl('')}
                                    className="ml-3 shrink-0 text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : null}

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
