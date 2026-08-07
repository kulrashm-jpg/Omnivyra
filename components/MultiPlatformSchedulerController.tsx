/** useMultiPlatformSchedulerController — state/handlers, verbatim. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotentOperation } from '../lib/idempotency';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle2, Loader2, Rocket, Sparkles } from 'lucide-react';
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
import type { CanonicalContent } from '@/lib/content/canonicalContent';
export function useMultiPlatformSchedulerController() {
  const router = useRouter();
  const { user, selectedCompanyId, selectedCompanyName, isLoading } = useCompanyContext();
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  // Wave 1 (item 8) — persisted canonical content fetched by id. When the draft
  // carries a contentId, the DB row is the AUTHORITATIVE reviewed content used to
  // seed the platform panels; the sessionStorage draft is only a fallback/cache.
  // `canonicalForId` records the contentId whose fetch has SETTLED; panel seeding
  // is gated until it matches the draft's contentId, so panels never seed from the
  // stale token while a fresh DB body is still in flight (no timing race).
  const [canonicalContent, setCanonicalContent] = useState<CanonicalContent | null>(null);
  const [canonicalForId, setCanonicalForId] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [loadingPlatforms, setLoadingPlatforms] = useState(true);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfigItem[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [platformState, setPlatformState] = useState<Record<string, PlatformState>>({});
  const [adaptingPlatform, setAdaptingPlatform] = useState<string | null>(null);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [attachedAssets, setAttachedAssets] = useState<WriterAttachedAsset[]>([]);
  // "Reuse Existing Asset" — the Catalog-driven picker, opened per asset type.
  const [reuseAssetType, setReuseAssetType] = useState<string | null>(null);
  // Video attachment by URL — not a generated Creator asset; the user supplies
  // a link that is published as a video alongside the post text. Kept separate
  // from `attachedAssets` (generated visuals) so it never touches the
  // generated-asset taxonomy/route system.
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [videoInput, setVideoInput] = useState('');
  const adaptedPlatformKeysRef = useRef<Record<string, string>>({});
  const requestedPlatform = typeof router.query.platform === 'string'
    ? normalizePlatform(router.query.platform)
    : '';
  const entryIntent = typeof router.query.intent === 'string' ? router.query.intent.trim().toLowerCase() : '';
  const prefersImmediateShare = entryIntent === 'publish';

  const getSourceContentForPlatform = (targetPlatform: string, currentDraft: DraftPayload | null) => {
    if (!currentDraft) return '';

    const masterContent = typeof currentDraft.masterContent?.content === 'string'
      ? String(currentDraft.masterContent.content).trim()
      : '';

    if (masterContent) {
      return masterContent;
    }

    return String(currentDraft.content || '').trim();
  };

  const requestQuickPlatformAdaptation = async ({
    platform,
    content,
    contentType,
    companyId,
    topic,
    objective,
  }: {
    platform: string;
    content: string;
    contentType: string;
    companyId: string | null;
    topic: string | null;
    objective?: string | null;
  }) => {
    const response = await fetch('/api/content/quick-platform-adapt', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        content,
        contentType,
        companyId,
        topic,
        // WS1 client half — send the strategic objective (field name EXACTLY
        // `objective`) so the platform-native rewrite can stay on-objective.
        // Omitted when the draft carries none (server treats it as optional).
        ...(objective && objective.trim() ? { objective: objective.trim() } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to apply quick platform adaptation.');
    }
    return data;
  };

  const shouldUseQuickPlatformAdaptation = (platform: string) => {
    const normalized = normalizePlatform(platform);
    return ['x', 'twitter', 'instagram', 'facebook', 'tiktok', 'pinterest', 'reddit'].includes(normalized);
  };
  useEffect(() => {
    if (typeof window === 'undefined' || !router.isReady) return;
    const topic = typeof router.query.topic === 'string' ? router.query.topic.trim() : '';
    const prefill = typeof router.query.prefill === 'string' ? router.query.prefill : '';
    const sourceContentType = typeof router.query.contentType === 'string' ? router.query.contentType.trim() : 'post';
    const sourceId = typeof router.query.sourceId === 'string' ? router.query.sourceId : null;
    setDraft(resolveSchedulerDraft({ prefill, topic, sourceContentType, sourceId }));
    setLoadingDraft(false);
  }, [router.isReady, router.query.contentType, router.query.prefill, router.query.sourceId, router.query.topic]);

  // Wave 1 (item 8) — when the draft carries a canonical Content id, fetch the
  // persisted content by id and treat its `body` as the source of truth for
  // seeding panels. Absent contentId ⇒ resolved immediately with no canonical
  // content, so the legacy seed-from-reviewed-draft path runs unchanged. The
  // fetch is best-effort: a failure resolves to null and the draft token is used
  // as the fallback cache (never blocks the scheduler).
  useEffect(() => {
    const contentId = draft?.contentId;
    if (!contentId) {
      setCanonicalContent(null);
      setCanonicalForId(null);
      return;
    }
    let active = true;
    fetch(`/api/content/${encodeURIComponent(contentId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        const content = data && typeof data.content === 'object' ? (data.content as CanonicalContent) : null;
        setCanonicalContent(content);
      })
      .catch(() => {
        if (active) setCanonicalContent(null);
      })
      .finally(() => {
        // Mark THIS contentId as settled — this is what un-gates panel seeding.
        if (active) setCanonicalForId(contentId);
      });
    return () => {
      active = false;
    };
  }, [draft?.contentId]);

  // Wave 1 (item 5) — persist a per-platform child VARIANT. A variant is a child
  // record of the canonical Content row; it NEVER overwrites the parent. Best-
  // effort by contract: any blip is swallowed so persistence can never block an
  // adaptation or a schedule. Absent contentId ⇒ no-op (unchanged behavior).
  const persistContentVariant = useCallback(
    async (
      platform: string,
      payload: {
        generatedContent?: string | null;
        editedContent?: string | null;
        adaptationMetadata?: Record<string, unknown> | null;
      },
    ) => {
      const contentId = draft?.contentId;
      const normalized = normalizePlatform(platform);
      if (!contentId || !normalized) return;
      try {
        await fetch(`/api/content/${encodeURIComponent(contentId)}/variants`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: normalized,
            ...(payload.generatedContent != null ? { generatedContent: payload.generatedContent } : {}),
            ...(payload.editedContent != null ? { editedContent: payload.editedContent } : {}),
            ...(payload.adaptationMetadata ? { adaptationMetadata: payload.adaptationMetadata } : {}),
          }),
        });
      } catch {
        // Best-effort child-record persistence — never surface or block on a blip.
      }
    },
    [draft?.contentId],
  );

  // Wave 1 (item 4) — advance the canonical lifecycle after the existing
  // scheduling/publishing has already succeeded. Best-effort; absent contentId
  // ⇒ no-op. Does not alter any existing scheduling logic.
  const advanceCanonicalLifecycle = useCallback(
    async (status: 'scheduled' | 'published') => {
      const contentId = draft?.contentId;
      if (!contentId) return;
      try {
        await fetch(`/api/content/${encodeURIComponent(contentId)}/status`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      } catch {
        // Best-effort lifecycle advance — scheduling already succeeded regardless.
      }
    },
    [draft?.contentId],
  );
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
  const allPlatformOptions = useMemo(() => {
    const configMap = new Map(platformConfig.map((item) => [normalizePlatform(item.platform), item]));
    return connectedAccounts
      .map((account) => {
        const key = normalizePlatform(account.platform_key);
        const config = configMap.get(key);
        return {
          key,
          label: account.platform_label,
          socialAccountId: account.social_account_id,
          accountName: account.account_name || account.username || null,
          contentTypes: config?.content_types?.length ? config.content_types : ['post'],
        };
      })
      .filter(Boolean) as PlatformOption[];
  }, [connectedAccounts, platformConfig]);

  // Capability-aware split (Round-3 Phase 2). Reuses the SAME filter helper
  // ShortformResultPage uses, so both UI surfaces decide compatibility from
  // the canonical registry. Incompatible-but-connected platforms remain
  // visible as DISABLED chips with the registry-provided reason as tooltip;
  // disconnected platforms are filtered out upstream (connectedAccounts).
  const schedulerSourceContentType = String(draft?.sourceContentType || router.query.contentType || 'post').trim().toLowerCase();
  // Phase 2.C asset-aware activation. attachedAssets is populated by the
  // Writer-source effect below; when the Writer has produced image/banner/
  // infographic/carousel/pdf assets, those types expand the platform
  // capability set so Instagram + Pinterest light up automatically. When
  // no asset is attached, the filter falls back to the text/writer
  // capability of the content type (legacy behavior preserved).
  const platformFilter = useMemo(() => {
    return filterConnectedPlatformsForContent(
      allPlatformOptions.map((opt) => opt.key),
      {
        contentType:        schedulerSourceContentType,
        // 'video' unlocks video-only destinations (YouTube/TikTok) via the
        // capability map when a video URL is attached.
        attachedAssetTypes: [
          ...attachedAssets.map((asset) => asset.creatorType),
          ...(videoUrl.trim() ? ['video'] : []),
        ],
      },
    );
  }, [allPlatformOptions, schedulerSourceContentType, attachedAssets, videoUrl]);

  const hiddenReasonByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of platformFilter.hidden) m.set(h.platform, h.reason);
    // Video-only platforms (YouTube / TikTok) are excluded from the
    // filter's `hidden` list by policy when the resolved capability set
    // does not include video/creator. On a card grid like this surface,
    // silently dropping them is confusing — the account is connected,
    // it just can't publish from a text/image flow. Render them as
    // frozen cards with the same "requires X" treatment as Instagram /
    // Pinterest. Once a video asset gets attached, the filter's
    // capability set includes video → these keys leave `videoOnlyHidden`
    // and the card thaws automatically.
    for (const key of platformFilter.videoOnlyHidden) {
      if (!m.has(key)) {
        m.set(key, `${key.charAt(0).toUpperCase()}${key.slice(1)} requires a video asset for publishing.`);
      }
    }
    return m;
  }, [platformFilter]);

  // Round-4 Phase 4: unregistered (unknown-to-registry) platforms must NEVER
  // render. They're filtered out of the displayable list entirely; hidden
  // (registered-but-unsupported) platforms still render as disabled chips.
  const unregisteredKeys = useMemo(
    () => new Set(platformFilter.unregistered.map((u) => u.platform)),
    [platformFilter],
  );
  const displayablePlatformOptions = useMemo(
    () => allPlatformOptions.filter((opt) => !unregisteredKeys.has(opt.key)),
    [allPlatformOptions, unregisteredKeys],
  );

  const platformOptions = useMemo(() => {
    const supported = new Set(platformFilter.supported);
    return allPlatformOptions.filter((opt) => supported.has(opt.key));
  }, [allPlatformOptions, platformFilter]);

  useEffect(() => {
    if (allPlatformOptions.length === 0) return;
    const payload: CapabilityLogPayload = {
      surface: 'multi-platform-scheduler',
      publishSource: 'multi-platform-scheduler',
      resolvedCapability: platformFilter.capability,
      connectedPlatforms: allPlatformOptions.map((o) => o.key),
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
  }, [allPlatformOptions, platformFilter]);

  useEffect(() => {
    if (platformOptions.length === 0) {
      setSelectedPlatform('');
      return;
    }
    setSelectedPlatform((current) => {
      if (requestedPlatform && platformOptions.some((item) => item.key === requestedPlatform)) {
        return requestedPlatform;
      }
      return current && platformOptions.some((item) => item.key === current) ? current : platformOptions[0].key;
    });
  }, [platformOptions, requestedPlatform]);
  useEffect(() => {
    if (!draft) return;
    // Wave 1 (item 8) — when a canonical contentId is present, wait for THAT id's
    // persisted body fetch to settle before seeding so panels seed from the DB
    // (source of truth), not the transient sessionStorage token. No contentId ⇒
    // the gate is inert, so seeding runs exactly as before.
    if (draft.contentId && canonicalForId !== draft.contentId) return;
    // Wave 1 (item 8) — authoritative reviewed body from the persisted canonical
    // row. Falls back to the draft token when there is no contentId or the fetch
    // failed, preserving the Wave-0 seed-from-reviewed behavior.
    const canonicalBody = typeof canonicalContent?.body === 'string' ? canonicalContent.body.trim() : '';
    adaptedPlatformKeysRef.current = {};
    setPlatformState((current) => {
      const next = { ...current };
      for (const option of platformOptions) {
        if (next[option.key]) continue;
        // WS2 + WS5 — reviewed == published. Each platform panel INITIALIZES
        // from the reviewed/approved copy (draft.content / masterContent),
        // NEVER blank and NEVER auto-regenerated on select. Adaptation is an
        // explicit, user-driven action (see handleAdaptForPlatform). We stash
        // the seed as `originalContent` so "Keep Original" can restore it and
        // "Compare" can diff it against later edits/adaptations. Seed from the
        // reviewed `draft.content` (what the user approved) — NOT the master-
        // preferring helper — so the panel shows exactly what was reviewed.
        const seedContent = canonicalBody || String(draft.content || '').trim() || getSourceContentForPlatform(option.key, draft);
        next[option.key] = {
          contentType: option.contentTypes[0] || 'post',
          content: seedContent,
          originalContent: seedContent,
          adapted: false,
          manuallyEdited: false,
          hashtags: draft.hashtags.join(' '),
          scheduledFor: defaultScheduleValue(),
          busy: false,
          message: null,
          status: 'idle',
        };
      }
      return next;
    });
  }, [draft, platformOptions, canonicalForId, canonicalContent]);

  const selectedOption = platformOptions.find((item) => item.key === selectedPlatform) || null;
  const selectedState = selectedPlatform ? platformState[selectedPlatform] : null;
  const sourceContentType = schedulerSourceContentType;
  const executionMode = typeof router.query.executionMode === 'string' ? router.query.executionMode.trim().toLowerCase() : '';
  const publishContentType = resolveSocialPublishType(sourceContentType, selectedOption);
  const sourceContentLabel = getContentTypeLabel(sourceContentType);
  const publishContentLabel = getContentTypeLabel(publishContentType);

  // Wave 1 (item 5) — persist OPERATOR EDITS of the selected platform's copy as a
  // child variant (editedContent), debounced so we write once the operator pauses
  // rather than on every keystroke. Only fires for manually-edited copy and only
  // when a canonical contentId is present; the parent content is never touched.
  useEffect(() => {
    if (!draft?.contentId || !selectedPlatform) return;
    const state = platformState[selectedPlatform];
    if (!state?.manuallyEdited) return;
    const body = String(state.content || '').trim();
    if (!body) return;
    const handle = setTimeout(() => {
      void persistContentVariant(selectedPlatform, {
        editedContent: body,
        adaptationMetadata: { source: 'operator-edit', contentType: publishContentType },
      });
    }, 1200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.contentId, selectedPlatform, platformState, persistContentVariant, publishContentType]);
  const isManualThreadFlow = sourceContentType === 'thread' && executionMode !== 'auto';
  const writerSourceType: WriterSourceType | null = sourceContentType === 'thread' ? 'thread' : sourceContentType === 'post' ? 'post' : null;
  const writerSourceId = writerSourceType && draft
    ? createWriterSourceId(writerSourceType, draft.sourceId || router.query.prefill?.toString() || draft.title)
    : '';
  // Taxonomy consolidation — surface only the 3 consolidated primary
  // types in the writer Add Asset picker. Banner attachments saved
  // historically still load + render via the API alias map; only the
  // authoring picker chips are reduced.
  const supportedCreatorAssetTypes = writerSourceType === 'thread'
    ? THREAD_CREATOR_ASSET_TYPES_VISIBLE
    : writerSourceType === 'post'
      ? POST_CREATOR_ASSET_TYPES_VISIBLE
      : [];

  const updatePlatformState = (platform: string, patch: Partial<PlatformState>) => {
    setPlatformState((current) => ({
      ...current,
      [platform]: {
        ...current[platform],
        ...patch,
      },
    }));
  };

  // The ONE attachment refresh: relationship discovery from the persisted Usage
  // Graph, payloads from the resolver. Every attachment action calls a graph
  // operation then this — the UI never mutates the attachment array locally.
  const refreshAttachmentsFromGraph = useCallback(() => {
    if (!writerSourceType || !writerSourceId) { setAttachedAssets([]); return; }
    void loadWriterAttachmentsViaGraph({
      companyId: selectedCompanyId,
      sourceType: writerSourceType,
      sourceId: writerSourceId,
    }).then(setAttachedAssets).catch(() => { /* keep current list on transient error */ });
  }, [selectedCompanyId, writerSourceType, writerSourceId]);

  useEffect(() => {
    if (!writerSourceType || !writerSourceId) {
      setAttachedAssets([]);
      return;
    }
    refreshAttachmentsFromGraph();
    window.addEventListener('focus', refreshAttachmentsFromGraph);
    window.addEventListener('storage', refreshAttachmentsFromGraph);
    return () => {
      window.removeEventListener('focus', refreshAttachmentsFromGraph);
      window.removeEventListener('storage', refreshAttachmentsFromGraph);
    };
  }, [refreshAttachmentsFromGraph, writerSourceId, writerSourceType]);

  // Remove an attachment → canonical graph op, then refresh from the graph.
  // No local array mutation (no splice/filter/setAttachedAssets here).
  const handleRemoveAttachment = useCallback(async (assetId: string) => {
    if (!writerSourceType || !writerSourceId) return;
    await detachUsage(assetId, writerDraftConsumer(writerSourceType, writerSourceId));
    refreshAttachmentsFromGraph();
  }, [writerSourceType, writerSourceId, refreshAttachmentsFromGraph]);

  const isLikelyVideoUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

  const attachVideoUrl = () => {
    const url = videoInput.trim();
    if (!isLikelyVideoUrl(url)) return;
    setVideoUrl(url);
    setVideoInput('');
    setVideoFormOpen(false);
    setAssetMenuOpen(false);
  };

  const launchAssetCreator = (assetType: CreatorAssetLaunchType) => {
    if (!draft || !writerSourceType || !writerSourceId) return;
    const sourceContent = selectedState?.content || draft.content || '';
    const hashtagText = selectedState?.hashtags || draft.hashtags.join(' ');
    // Asset-type selection is the only writer-facing choice. Attachment
    // mode + source-text transform are rendering-behavior defaults
    // resolved from payload signals downstream; we only seed the
    // per-asset defaults here so the validator never sees a raw 'none'.
    const attachmentMode: AttachmentMode = defaultAttachmentModeForAsset(assetType);
    const sourceTextTransform = defaultTransformForAsset(assetType, attachmentMode);
    setAssetMenuOpen(false);
    launchCreatorFromWriter({
      router,
      assetType,
      source: buildWriterCreatorPrefill({
        sourceType: writerSourceType,
        sourceId: writerSourceId,
        assetType,
        attachmentMode,
        sourceTextTransform,
        title: draft.title || draft.topic || `${sourceContentLabel} draft`,
        body: sourceContent,
        audience: 'Audience from the Writer draft',
        tone: 'Platform-aware and brand-aligned',
        platform: selectedOption?.key || draft.sourcePlatform || '',
        hashtags: parseHashtags(hashtagText),
        companyName: selectedCompanyName || '',
      }),
    });
  };

  // WS2 — explicit "Adapt for <platform>" control. Surfaced through the panel's
  // `assetAction` slot (the only prop MultiPlatformSchedulerMain forwards for
  // controller-driven controls), so adaptation only ever happens on this click,
  // never automatically on platform select. Available for every source (not
  // just writer sources), unlike the Add Asset menu below.
  const platformAdaptControl = selectedOption ? (
    <button
      type="button"
      onClick={() => void handleAdaptForPlatform()}
      disabled={!draft || !selectedState?.content?.trim() || adaptingPlatform === selectedOption.key || !!selectedState?.busy}
      title={`Rewrite the copy natively for ${selectedOption.label}. Your current copy is kept as the original for Compare / Keep Original.`}
      className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {adaptingPlatform === selectedOption.key
        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        : <Sparkles className="mr-2 h-4 w-4" />}
      {`Adapt for ${selectedOption.label}`}
    </button>
  ) : null;

  const assetSelector = (
    <>
      {platformAdaptControl}
      {supportedCreatorAssetTypes.length > 0 ? (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAssetMenuOpen((open) => !open)}
        disabled={!draft || !selectedState?.content?.trim()}
        className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Add Asset
      </button>
      {assetMenuOpen ? (
        <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Create asset</p>
            <p className="mt-1 text-xs text-slate-500">
              Pick a Creator asset type. Prefilled from this {sourceContentLabel.toLowerCase()}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAssetMenuOpen(false)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
          >
            No asset
          </button>
          {supportedCreatorAssetTypes.map((assetType) => (
            <div key={assetType} className="flex items-center justify-between gap-2 px-4 py-2.5 transition hover:bg-slate-50">
              <span className="text-sm font-semibold text-slate-700">{assetLabel(assetType)}</span>
              <span className="flex shrink-0 gap-1.5">
                {/* Create New — unchanged generation flow */}
                <button
                  type="button"
                  onClick={() => launchAssetCreator(assetType)}
                  className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-800"
                >
                  Create new
                </button>
                {/* Reuse Existing — Catalog-driven, no regeneration */}
                <button
                  type="button"
                  onClick={() => { setAssetMenuOpen(false); setReuseAssetType(assetType); }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300"
                >
                  Reuse
                </button>
              </span>
            </div>
          ))}
          {/* Video — attach a URL (not generated); published with the post text. */}
          <button
            type="button"
            onClick={() => setVideoFormOpen((open) => !open)}
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Video
          </button>
          {videoFormOpen ? (
            <div className="border-t border-slate-100 px-4 py-3">
              <label className="text-[11px] font-semibold text-slate-500">Video URL</label>
              <input
                type="url"
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') attachVideoUrl(); }}
                placeholder="https://… (YouTube, Vimeo, MP4)"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-blue-300"
              />
              <p className="mt-1 text-[10px] text-slate-400">Posted as a video with your text on platforms that support it.</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={attachVideoUrl}
                  disabled={!isLikelyVideoUrl(videoInput)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Attach video
                </button>
                <button
                  type="button"
                  onClick={() => { setVideoFormOpen(false); setVideoInput(''); }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {reuseAssetType && writerSourceType && writerSourceId ? (
        <AssetReusePicker
          consumer={writerDraftConsumer(writerSourceType, writerSourceId)}
          assetType={reuseAssetType}
          onAttached={refreshAttachmentsFromGraph}
          onClose={() => setReuseAssetType(null)}
        />
      ) : null}
    </div>
      ) : null}
    </>
  );

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
    // G11.E — over-limit guard. Soft, UI-side only. Server-side DB constraints
    // (chk_*_content) remain the last-line enforcement.
    const limitCheck = validatePostForPlatform(selectedState.content, selectedOption.key);
    if (limitCheck.state === 'invalid') {
      return {
        ok: false as const,
        error: `Content is over ${selectedOption.label} limit by ${limitCheck.exceeded} characters (${limitCheck.currentCount} / ${limitCheck.maxCount}). Trim the post and try again.`,
      };
    }
    // Creator-WS4 (creator asset workstream — NOT the Lead Intelligence programme's
    // WS-4 Content Generation Runtime; the two numbering schemes collide).
    // Async asset safety preflight. An attached creator visual can still
    // be rendering (async render not finished) or can have failed its text-fit
    // check. Publishing/scheduling either way ships a broken or missing image,
    // so we block with an actionable message BEFORE the network calls. We
    // preflight both the graph-loaded writer attachments and any creator
    // attachments carried on the prefill draft (e.g. a Creator → scheduler
    // handoff). Backward compat: `text_fit` is a newer renderer contract — when
    // it is absent (older assets) we do NOT block on it.
    const assetSafetyError = checkAttachedAssetSafety();
    if (assetSafetyError) {
      return { ok: false as const, error: assetSafetyError };
    }
    return { ok: true as const };
  };

  // Creator-WS4 (creator asset workstream, not programme WS-4).
  // Shared preflight helper. Returns the first blocking reason (a message)
  // across all attached creator assets, or null when everything is safe. Kept
  // out of ensureDraftAndPlatform's body so the intent (render-pending vs
  // text-overflow) reads clearly.
  const checkAttachedAssetSafety = (): string | null => {
    const draftCreatorAttachments = Array.isArray(draft?.creatorAttachments)
      ? draft!.creatorAttachments
      : [];
    const candidates: Array<{ url?: unknown; files?: unknown; metadata?: unknown }> = [
      ...attachedAssets,
      ...(draftCreatorAttachments as Array<{ url?: unknown; files?: unknown; metadata?: unknown }>),
    ];
    for (const asset of candidates) {
      if (!asset || typeof asset !== 'object') continue;
      // (a) No resolvable media → the render is still pending / unfinished.
      const hasUrl = typeof asset.url === 'string' && asset.url.trim().length > 0;
      const hasFiles = Array.isArray(asset.files)
        && asset.files.some((file) => typeof file === 'string' && file.trim().length > 0);
      if (!hasUrl && !hasFiles) {
        return 'This visual is still rendering. Wait for it to finish before publishing.';
      }
      // (b) Renderer text-fit contract. Only block on an EXPLICIT failure
      // (ok === false). Absent ⇒ older asset ⇒ do not block (backward compat).
      const metadata = asset.metadata && typeof asset.metadata === 'object'
        ? asset.metadata as { text_fit?: { ok?: unknown } }
        : null;
      if (metadata?.text_fit && typeof metadata.text_fit === 'object' && metadata.text_fit.ok === false) {
        return "Text doesn't fit safely inside the image. Regenerate the visual before publishing.";
      }
    }
    return null;
  };

  // WS2 + WS5 — EXPLICIT, user-triggered platform adaptation. This replaces the
  // former auto-fire effect that silently regenerated copy on platform select.
  // Content is now only ever adapted when the operator clicks "Adapt for
  // <platform>". It adapts the copy CURRENTLY in the panel (honoring edits),
  // preserves `originalContent` (so Keep Original / Compare keep working) and
  // clears `manuallyEdited` because the operator explicitly asked for this change.
  const handleAdaptForPlatform = async () => {
    if (!draft || !selectedOption || !selectedCompanyId) return;
    const platform = selectedOption.key;
    const state = platformState[platform];
    if (!state) return;
    if (adaptingPlatform === platform || state.busy) return;

    // Adapt the copy the operator is looking at; fall back to the reviewed
    // source if the panel is somehow empty.
    const sourceContent = String(state.content || getSourceContentForPlatform(platform, draft) || '').trim();
    if (!sourceContent) {
      updatePlatformState(platform, { message: 'Add some copy before adapting it for this platform.', status: 'error' });
      return;
    }

    setAdaptingPlatform(platform);
    updatePlatformState(platform, { busy: true, message: null, status: 'idle' });

    try {
      if (shouldUseQuickPlatformAdaptation(platform)) {
        const result = await requestQuickPlatformAdaptation({
          platform,
          content: sourceContent,
          contentType: publishContentType,
          companyId: selectedCompanyId,
          topic: draft.topic || draft.title || null,
          objective: draft.objective ?? null,
        });
        const variant = result?.variant;
        if (!variant?.generated_content) {
          throw new Error('The quick platform adaptation did not return content.');
        }
        const adaptedContent = String(variant.generated_content || '').trim();
        updatePlatformState(platform, {
          content: adaptedContent,
          hashtags: Array.isArray(variant?.discoverability_meta?.hashtags)
            ? variant.discoverability_meta.hashtags.join(' ')
            : state.hashtags,
          busy: false,
          adapted: true,
          manuallyEdited: false,
          message: `Adapted for ${selectedOption.label}.`,
          status: 'idle',
        });
        // Wave 1 (item 5) — record the adaptation as a child variant (best-effort).
        void persistContentVariant(platform, {
          generatedContent: adaptedContent,
          adaptationMetadata: {
            source: 'quick-platform-adapt',
            contentType: publishContentType,
            discoverabilityMeta: variant?.discoverability_meta ?? null,
          },
        });
        return;
      }

      // Non-quick platforms (e.g. LinkedIn/Threads) — full repurpose via the
      // activity-workspace variant path, with the quick-adapt rules as fallback.
      const masterContent = draft.masterContent || {
        id: `scheduler-master-${Date.now()}`,
        generated_at: new Date().toISOString(),
        content: sourceContent,
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
              id: `workspace-${platform}`,
              title: draft.title,
              topic: draft.topic,
              platform,
              contentType: publishContentType,
            },
            dailyExecutionItem: {
              execution_id: `workspace-post-${platform}`,
              platform,
              content_type: publishContentType,
              topic: draft.topic,
              title: draft.title,
              master_content: masterContent,
              active_platform_targets: [
                { platform, content_type: publishContentType },
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

      const adaptedContent = String(variant.generated_content || '').trim();
      updatePlatformState(platform, {
        content: adaptedContent,
        hashtags: Array.isArray(variant?.discoverability_meta?.hashtags)
          ? variant.discoverability_meta.hashtags.join(' ')
          : state.hashtags,
        busy: false,
        adapted: true,
        manuallyEdited: false,
        message: `Adapted for ${selectedOption.label}.`,
        status: 'idle',
      });
      // Wave 1 (item 5) — record the adaptation as a child variant (best-effort).
      void persistContentVariant(platform, {
        generatedContent: adaptedContent,
        adaptationMetadata: {
          source: 'activity-workspace',
          contentType: publishContentType,
          discoverabilityMeta: variant?.discoverability_meta ?? null,
        },
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      try {
        const fallback = await requestQuickPlatformAdaptation({
          platform,
          content: sourceContent,
          contentType: publishContentType,
          companyId: selectedCompanyId,
          topic: draft.topic || draft.title || null,
          objective: draft.objective ?? null,
        });
        const variant = fallback?.variant;
        if (!variant?.generated_content) {
          throw new Error('The quick platform adaptation did not return content.');
        }
        const adaptedContent = String(variant.generated_content || '').trim();
        updatePlatformState(platform, {
          content: adaptedContent,
          hashtags: Array.isArray(variant?.discoverability_meta?.hashtags)
            ? variant.discoverability_meta.hashtags.join(' ')
            : state.hashtags,
          busy: false,
          adapted: true,
          manuallyEdited: false,
          message: isAbort
            ? `Applied ${selectedOption.label} platform rules after the full repurpose timed out.`
            : `Applied ${selectedOption.label} platform rules.`,
          status: 'idle',
        });
        // Wave 1 (item 5) — record the fallback adaptation as a child variant.
        void persistContentVariant(platform, {
          generatedContent: adaptedContent,
          adaptationMetadata: {
            source: 'quick-platform-adapt-fallback',
            contentType: publishContentType,
            discoverabilityMeta: variant?.discoverability_meta ?? null,
          },
        });
      } catch (fallbackError) {
        updatePlatformState(platform, {
          busy: false,
          status: isAbort ? 'idle' : 'error',
          message: isAbort
            ? `${selectedOption.label} adaptation took too long, and the fallback rules could not finish.`
            : fallbackError instanceof Error
              ? fallbackError.message
              : 'Failed to adapt the post for this platform.',
        });
      }
    } finally {
      setAdaptingPlatform((current) => (current === platform ? null : current));
    }
  };

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

      // Flatten writer-attached creator assets to a media_urls list so the
      // scheduled_post row carries the rendered images/files. Each attached
      // asset can contribute a primary `url` and/or a `files` array (e.g.
      // carousel slides), and we de-dupe across attachments.
      const draftMediaUrls = Array.isArray(draft?.mediaUrls)
        ? draft.mediaUrls.map((url) => String(url || '').trim()).filter(Boolean)
        : [];
      // Reference-based transport: the canonical refs come from the Usage Graph;
      // payload resolution happens ONCE here (the publish boundary) via the
      // resolver — never from payload-extraction helpers, never earlier.
      const assetRefs = (writerSourceType && writerSourceId)
        ? await attachmentRefsForConsumer(writerDraftConsumer(writerSourceType, writerSourceId))
        : [];
      const mediaUrlsFromAttachedAssets = await resolveSchedulingMediaUrls(assetRefs);
      // User-supplied video URL — carried as media and tagged as a video so the
      // target platform shows the video alongside the post text.
      const videoUrls = videoUrl.trim() ? [videoUrl.trim()] : [];
      const mediaUrlsFromAttachments = Array.from(new Set([...draftMediaUrls, ...mediaUrlsFromAttachedAssets, ...videoUrls]));
      const inferredMediaTypes = mediaTypesFromCreatorAttachments({
        mediaUrls: mediaUrlsFromAttachments,
        attachedAssets,
      });
      const draftMediaTypes = Array.isArray(draft?.mediaTypes)
        ? draft.mediaTypes.map((type) => String(type || '').trim()).filter(Boolean)
        : [];
      const mediaTypesFromAttachments = mediaUrlsFromAttachments.map((url, index) =>
        videoUrls.includes(url) ? 'video' : (draftMediaTypes[index] || inferredMediaTypes[index] || 'image'));
      const draftCreatorAttachments = Array.isArray(draft?.creatorAttachments)
        ? draft.creatorAttachments.filter((attachment) => attachment && typeof attachment === 'object')
        : [];
      const creatorAttachments = [
        ...draftCreatorAttachments,
        ...attachedAssets.map((asset) => ({
        id: asset.id,
        creatorType: asset.creatorType,
        attachmentMode: asset.attachmentMode ?? asset.compositionIntent?.attachmentMode ?? null,
        compositionIntent: asset.compositionIntent ?? null,
        transformIntent: asset.compositionIntent?.copyPolicy?.sourceTextTransform ?? null,
        platformContext: asset.platformContext ?? null,
        renderManifest: asset.metadata?.render_manifest ?? null,
        validationManifest: asset.metadata?.validation_manifest ?? null,
        url: asset.url ?? null,
        files: Array.isArray(asset.files) ? asset.files : [],
        })),
      ];

      if (scheduledPostId) {
        const updateRes = await fetch(`/api/schedule/posts/${scheduledPostId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft?.title,
            content: selectedState.content,
            hashtags: hashtagsArray,
            mediaUrls: mediaUrlsFromAttachments,
            mediaTypes: mediaTypesFromAttachments,
            assetRefs,
            creatorAttachments,
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
        // Phase 1B.1: when this is a thread payload, also send `nodes` so the
        // server can take the multi-row insert path (gated by
        // THREAD_MULTI_ROW_RUNTIME). Server ignores `nodes` when the flag is
        // off — so this is safe to send unconditionally for thread payloads.
        //
        // G2-final — per-node attachment propagation activated.
        //
        // ThreadResultView's per-node assignments are stored in sessionStorage
        // under `thread_node_attachments_<sessionToken>`, where sessionToken
        // is the value the threads-result link forwards as `sourceId` to this
        // page. We resolve those compact asset-id pointers against the
        // thread-level `attachedAssets` list (already loaded on this page) to
        // build full CanonicalAttachment lists per position, then pass them
        // into the node builder.
        //
        // Pre-activation dormancy: until migration 20260809 is applied, the
        // RPC silently ignores the per-node media JSONB fields, so this
        // payload extension is a no-op on the DB side. Post-migration, child
        // rows persist their own media_urls + media_types.
        // Per-node attachments are read from the canonical Usage Graph (resolved
        // projection) — never from the legacy thread_node_attachments store.
        const perNodeAttachments = sourceContentType === 'thread' && draft?.sourceId
          ? await getThreadNodeAttachmentsFromGraph(draft.sourceId)
          : {};
        const threadNodes = sourceContentType === 'thread'
          ? buildThreadNodesFromSegments(
              splitThreadIntoSegments(selectedState.content),
              perNodeAttachments,
            )
          : undefined;

        // Observability: open a per-tab tracer for this schedule click. Note
        // the registry is per-tab in the browser — it does not share state
        // with the server-side registry. The server's tracer in
        // pages/api/scheduler/schedule.ts captures the authoritative trace.
        const clientTracer = openThreadRuntimeTracer({
          threadId: `client_${draft?.sourceId ?? 'unknown'}_${Date.now().toString(36)}`,
          companyId: selectedCompanyId ?? 'unknown',
        });
        const clientPersistStartedAtMs = Date.now();
        clientTracer.recordPersistAttempt({
          detail: `client schedule POST platform=${selectedOption.key} nodes=${threadNodes?.length ?? 0}`,
        });

        const scheduleRes = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            title: draft?.title,
            content: selectedState.content,
            hashtags: hashtagsArray.join(' '),
            mediaUrls: mediaUrlsFromAttachments,
            mediaTypes: mediaTypesFromAttachments,
            assetRefs,
            creatorAttachments,
            scheduledFor: scheduleDate.toISOString(),
            contentType: publishContentType,
            platform: selectedOption.key,
            accountId: selectedOption.socialAccountId,
            ...(threadNodes && threadNodes.length >= 2 ? { nodes: threadNodes } : {}),
          }),
        });
        const scheduleData = await scheduleRes.json().catch(() => ({}));
        if (!scheduleRes.ok) {
          clientTracer.recordPersistFailure({
            detail: scheduleData.error || `schedule POST returned ${scheduleRes.status}`,
            latencyMs: Date.now() - clientPersistStartedAtMs,
          });
          throw new Error(scheduleData.error || 'Failed to schedule post');
        }
        clientTracer.recordPersistSuccess({
          latencyMs: Date.now() - clientPersistStartedAtMs,
          detail: `scheduled id=${scheduleData.id ?? '(none)'}`,
        });
        scheduledPostId = scheduleData.id || null;
      }

      if (mode === 'publish') {
        // OR-07 Action 1: key derived from the scheduled post being published,
        // so a retry of THIS publish reuses it while a different post gets its own.
        const publishOp = createIdempotentOperation(`social-publish-${scheduledPostId}`);
        const publishRes = await fetch('/api/social/publish', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...publishOp.headers },
          body: JSON.stringify({ post_id: scheduledPostId }),
        });
        const publishData = await publishRes.json().catch(() => ({}));
        if (!publishRes.ok) {
          throw new Error(publishData.error || 'Failed to publish post');
        }
        // The publish endpoint returns HTTP 200 even when the platform adapter
        // reports FAILED (e.g. Instagram rejecting a post with no media). The
        // truth is in the body's `status` field — only PUBLISHED counts.
        if (publishData.status && publishData.status !== 'PUBLISHED') {
          throw new Error(publishData.message || `${selectedOption.label} rejected the post.`);
        }
      persistThreadPublishLink(selectedPlatform, scheduledPostId);
      // Wave 1 (items 4/5) — advance the canonical lifecycle to 'published' and
      // record the published copy as a child variant. Best-effort, AFTER the
      // publish already succeeded; never blocks or alters the publish result.
      void persistContentVariant(selectedPlatform, {
        editedContent: selectedState.content,
        adaptationMetadata: { source: 'scheduler-publish', contentType: publishContentType },
      });
      void advanceCanonicalLifecycle('published');
      updatePlatformState(selectedPlatform, { busy: false, status: 'published', message: `${selectedOption.label} post published successfully.` });
        return;
      }

      persistThreadPublishLink(selectedPlatform, scheduledPostId);
      // Wave 1 (items 4/5) — persist the reviewed/edited copy as a child variant
      // and advance the canonical lifecycle to 'scheduled'. Best-effort, AFTER the
      // schedule already succeeded; leaves the scheduling logic itself untouched.
      void persistContentVariant(selectedPlatform, {
        editedContent: selectedState.content,
        adaptationMetadata: { source: 'scheduler-schedule', contentType: publishContentType },
      });
      void advanceCanonicalLifecycle('scheduled');
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
  return {
    adaptedPlatformKeysRef, adaptingPlatform, allPlatformOptions, assetMenuOpen, assetSelector, attachVideoUrl, attachedAssets,
    connectedAccounts, deleteScheduledPost, displayablePlatformOptions, draft, ensureDraftAndPlatform, entryIntent, executionMode,
    getSourceContentForPlatform, handleAdaptForPlatform, handleRemoveAttachment, hiddenReasonByKey, isLikelyVideoUrl, isLoading, isManualThreadFlow,
    launchAssetCreator, loadingDraft, loadingPlatforms, persistThreadPublishLink, platformConfig, platformFilter, platformOptions,
    platformState, prefersImmediateShare, publishContentLabel, publishContentType, refreshAttachmentsFromGraph,
    requestQuickPlatformAdaptation, requestedPlatform, reuseAssetType, router, scheduleOrPublish, schedulerSourceContentType,
    selectedCompanyId, selectedCompanyName, selectedOption, selectedPlatform, selectedState, setAdaptingPlatform, setAssetMenuOpen,
    setAttachedAssets, setConnectedAccounts, setDraft, setLoadingDraft, setLoadingPlatforms, setPlatformConfig, setPlatformState,
    setReuseAssetType, setSelectedPlatform, setVideoFormOpen, setVideoInput, setVideoUrl, shouldUseQuickPlatformAdaptation,
    sourceContentLabel, sourceContentType, supportedCreatorAssetTypes, unregisteredKeys, updatePlatformState, user, videoFormOpen,
    videoInput, videoUrl, writerSourceId, writerSourceType
  };
}
