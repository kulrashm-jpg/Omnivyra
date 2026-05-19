import { useEffect, useMemo } from 'react';
import { inferExecutionMode } from '@/lib/shared/executionModeInference';
import {
  CONTENT_TYPE_OPTIONS_BY_PLATFORM,
  VIDEO_CONTENT_TYPES,
  asObject,
  buildMarketingSupport as buildMarketingSupportHelper,
  buildScheduleRowsFromExecutionItem as buildScheduleRowsFromExecutionItemHelper,
  getAddablePlatformsForContentType as getAddablePlatformsForContentTypeHelper,
  getContentTypeOptions as getContentTypeOptionsHelper,
  isVideoContentType as isVideoContentTypeHelper,
  type WorkspacePayload,
} from '@/lib/activity-workspace/shared';
import type { ScheduleItem } from '../types/activityWorkspace';
// Step-28: authoritative workspace UI consumption (projection PRIMARY under
// AUTHORITATIVE cutover; legacy fallback-only; SHADOW = diff-only).
import {
  useAuthoritativeWorkspace,
  buildRenderAuthority,
  workspaceRenderDiagnostics,
  detectDirectReads,
  extendRenderDiffWithConsumption,
} from '../components/activity-workspace/orchestration';

type Params = {
  payload: WorkspacePayload | null;
  latestMasterContent: Record<string, unknown> | null;
  schedules: ScheduleItem[];
  normalizeKey: (value: unknown) => string;
};

export function useActivityWorkspaceDerivedState({
  payload,
  latestMasterContent,
  schedules,
  normalizeKey,
}: Params) {
  const dailyRaw = asObject(payload?.dailyExecutionItem);
  const nestedBrief = asObject(dailyRaw?.writer_content_brief);
  const nestedIntent = asObject(dailyRaw?.intent);
  const topicText = String((payload?.topic || payload?.title || (dailyRaw?.topicTitle ?? dailyRaw?.topic)) ?? '').trim();
  const writerBrief = nestedBrief || (dailyRaw && (dailyRaw.topicTitle || dailyRaw.writingIntent || dailyRaw.whatShouldReaderLearn || dailyRaw.whatProblemAreWeAddressing || dailyRaw.desiredAction || dailyRaw.narrativeStyle || dailyRaw.introObjective || dailyRaw.summary || dailyRaw.objective || dailyRaw.cta || dailyRaw.brandVoice || dailyRaw.dailyObjective) ? {
    topicTitle: (dailyRaw.topicTitle ?? dailyRaw.topic ?? payload?.title ?? payload?.topic) as string,
    writingIntent: (dailyRaw.writingIntent ?? dailyRaw.description) as string,
    whatShouldReaderLearn: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective) as string,
    whatProblemAreWeAddressing: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary) as string,
    desiredAction: (dailyRaw.desiredAction ?? dailyRaw.cta) as string,
    narrativeStyle: (dailyRaw.narrativeStyle ?? dailyRaw.brandVoice) as string,
    topicGoal: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
  } as Record<string, unknown> : null);
  const intent = nestedIntent || (dailyRaw && (dailyRaw.dailyObjective || dailyRaw.objective || dailyRaw.pain_point || dailyRaw.outcome_promise || dailyRaw.whatProblemAreWeAddressing || dailyRaw.whatShouldReaderLearn || dailyRaw.desiredAction || dailyRaw.cta) ? {
    objective: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
    pain_point: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary ?? dailyRaw.pain_point) as string,
    outcome_promise: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective ?? dailyRaw.outcome_promise) as string,
    cta_type: (dailyRaw.desiredAction ?? dailyRaw.cta ?? dailyRaw.cta_type) as string,
  } as Record<string, unknown> : null);
  const effectiveWhatReaderLearns = String(writerBrief?.whatShouldReaderLearn || '').trim() || (topicText ? `Reader understands ${topicText} and why it matters.` : '-');
  const effectiveProblemAddressed = String(writerBrief?.whatProblemAreWeAddressing || intent?.pain_point || '').trim() || (topicText ? `Uncertainty about ${topicText}` : '-');
  const masterContentFromPayload = asObject(payload?.dailyExecutionItem && asObject(payload.dailyExecutionItem)?.master_content);
  const masterContent = latestMasterContent || masterContentFromPayload;
  const hasMasterGenerated =
    String(masterContent?.generation_status || '').toLowerCase() === 'generated' ||
    String(masterContent?.content || '').trim().length > 0;
  const contentType = String((dailyRaw?.content_type ?? dailyRaw?.contentType ?? 'post') as string).trim().toLowerCase();
  const executionMode = String((dailyRaw?.execution_mode ?? '') as string).trim() || inferExecutionMode(contentType);
  const isCreatorActivity = executionMode === 'CREATOR_REQUIRED' || executionMode === 'CONDITIONAL_AI';
  const creatorCard = asObject((dailyRaw as any)?.creator_card);
  const creatorAsset = asObject(dailyRaw?.creator_asset);
  const hasCreatorAsset = Boolean(
    creatorAsset &&
      (String(creatorAsset.url ?? '').trim() ||
        (Array.isArray(creatorAsset.files) && creatorAsset.files.length > 0) ||
        (creatorAsset.platformUploads && Object.values(creatorAsset.platformUploads as Record<string, { url?: string; externalLink?: string }>).some((upload) => upload?.url?.trim() || upload?.externalLink?.trim())))
  );
  const creatorHasMasterSource = hasCreatorAsset && (
    String(creatorAsset?.description ?? '').trim() ||
    String(creatorAsset?.transcript ?? '').trim() ||
    String(creatorAsset?.theme ?? '').trim() ||
    String(payload?.topic ?? payload?.title ?? '').trim()
  );
  const isDailyTopicView = payload?.source === 'daily';
  const allPlatformOptions = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'reddit', 'pinterest'];
  const suggestedPlatforms = (() => {
    const seen = new Set<string>();
    const add = (platform: unknown) => {
      const normalized = normalizeKey(platform);
      if (normalized && allPlatformOptions.includes(normalized)) seen.add(normalized);
    };
    const daily = asObject(payload?.dailyExecutionItem);
    if (daily) {
      (Array.isArray((daily as any)?.selected_platforms) ? (daily as any).selected_platforms : []).forEach(add);
      (Array.isArray((daily as any)?.planned_platform_targets) ? (daily as any).planned_platform_targets : []).forEach((target: any) => add(target?.platform));
      (Array.isArray((daily as any)?.active_platform_targets) ? (daily as any).active_platform_targets : []).forEach((target: any) => add(target?.platform));
      (Array.isArray((daily as any)?.platform_variants) ? (daily as any).platform_variants : []).forEach((variant: any) => add(variant?.platform));
      add((daily as any)?.platform);
    }
    (payload?.schedules || schedules || []).forEach((schedule: ScheduleItem) => add(schedule.platform));
    const list = Array.from(seen);
    return list.length > 0 ? list : allPlatformOptions;
  })();
  const platformOptions = suggestedPlatforms;
  const contentTypeOptionsByPlatform = CONTENT_TYPE_OPTIONS_BY_PLATFORM;
  const getContentTypeOptionsForPlatform = (platform: string) => getContentTypeOptionsHelper(platform, normalizeKey);
  const isVideoContentTypeForValue = (value: string) => isVideoContentTypeHelper(value, normalizeKey);
  const getAddablePlatformsForType = (value: string) => getAddablePlatformsForContentTypeHelper(value, normalizeKey);
  const allContentTypesForAdd = useMemo(() => {
    const set = new Set<string>();
    Object.values(contentTypeOptionsByPlatform).forEach((options) => options.forEach((item) => set.add(normalizeKey(item))));
    return Array.from(set).sort();
  }, []);
  const labelize = (value: string) =>
    String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  const normalizeComparableText = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const buildScheduleRows = (item: Record<string, unknown>, existingSchedules: ScheduleItem[]) =>
    buildScheduleRowsFromExecutionItemHelper(item, existingSchedules, normalizeKey);
  const buildMarketingSupportForVariant = (
    platform: string,
    variantContentType: string,
    content: string,
    variant?: Record<string, unknown> | null
  ) => buildMarketingSupportHelper({ platform, contentType: variantContentType, content, variant, payload, normalizeKey });

  // ── Step-28: authoritative workspace UI consumption ──────────────────
  // Legacy values above remain the FALLBACK. The canonical projection
  // (Step-27 `workspace_projection`) becomes PRIMARY only when the server
  // cut over to AUTHORITATIVE (gated, default SHADOW → byte-identical;
  // SHADOW emits [WORKSPACE_UI_DIFF] only; rollback/LEGACY → legacy).
  const legacyAiAssetState = String(
    (asObject((dailyRaw as any)?.ai_asset_override)?.state ??
      asObject((dailyRaw as any)?.ai_asset)?.asset_state ??
      'NONE') as string,
  ).toUpperCase();
  const legacyScheduled = (payload?.schedules || schedules || []).some(
    (s: ScheduleItem) => s?.scheduledFor,
  );
  const legacyReadinessReady = ['render_ready', 'ready', 'creator_ready', 'scheduled', 'published'].includes(
    String((dailyRaw as any)?.content_status ?? '').toLowerCase(),
  );
  // Memoized on primitives so the authority hook's effect doesn't re-fire
  // (and log) every render.
  const legacyUISnapshot = useMemo(
    () => ({
      isCreatorActivity,
      hasCreatorAsset,
      uploadRequired: isCreatorActivity && !hasCreatorAsset,
      aiAssetState: legacyAiAssetState,
      schedulingState: legacyScheduled ? 'SCHEDULED' : 'UNSCHEDULED',
      readinessReady: legacyReadinessReady,
    }),
    [isCreatorActivity, hasCreatorAsset, legacyAiAssetState, legacyScheduled, legacyReadinessReady],
  );
  const authoritativeWorkspace = useAuthoritativeWorkspace(
    payload,
    legacyUISnapshot,
    {
      campaignId: String((payload as any)?.campaignId ?? '') || null,
      executionId: String((payload as any)?.activityId ?? '') || null,
    },
  );
  const authView = authoritativeWorkspace.view;

  // ── Step-29: full render-authority cutover ───────────────────────────
  // Every render-facing signal resolves from the canonical view when mode
  // is AUTHORITATIVE; otherwise the legacy-derived values render
  // (fallback-only). SHADOW still computes the diff (no render change).
  const renderAuthorityResult = useMemo(
    () =>
      buildRenderAuthority({
        mode: authoritativeWorkspace.mode,
        view: authoritativeWorkspace.shadowView,
        legacy: {
          executionMode,
          isCreatorActivity,
          hasCreatorAsset,
          uploadRequired: isCreatorActivity && !hasCreatorAsset,
          aiAssetState: legacyAiAssetState,
          schedulingState: legacyScheduled ? 'SCHEDULED' : 'UNSCHEDULED',
          readinessReady: legacyReadinessReady,
        },
      }),
    [
      authoritativeWorkspace.mode,
      authoritativeWorkspace.shadowView,
      executionMode,
      isCreatorActivity,
      hasCreatorAsset,
      legacyAiAssetState,
      legacyScheduled,
      legacyReadinessReady,
    ],
  );
  const renderAuthority = renderAuthorityResult.render;
  const workspaceRenderDiff = renderAuthorityResult.diff;

  // ── Step-30: direct-consumption guard ────────────────────────────────
  // Centralized detection of legacy signals present on the raw resolve
  // payload that panels could read directly, bypassing render authority.
  // Detection/observability only — never changes what renders.
  const directReadViolation = useMemo(
    () => detectDirectReads('activity-workspace', payload),
    [payload],
  );
  const effectiveIsCreatorActivity = renderAuthority.isCreatorActivity;
  const effectiveHasCreatorAsset = renderAuthority.hasCreatorAsset;

  useEffect(() => {
    const base = {
      campaign_id: String((payload as any)?.campaignId ?? '') || null,
      execution_id: String((payload as any)?.activityId ?? '') || null,
      workspace_mode: authoritativeWorkspace.mode,
      rendered_readiness: renderAuthority.readinessState,
      rendered_scheduling: renderAuthority.schedulingState,
      rendered_ai_asset: renderAuthority.aiAssetState,
      rendered_creator: renderAuthority.isCreatorActivity ? 'creator' : 'non_creator',
      fallback_active: renderAuthority.source === 'legacy',
      mismatch_count: workspaceRenderDiff?.mismatch_count ?? 0,
    };
    if (renderAuthority.source === 'authoritative') workspaceRenderDiagnostics.authority(base);
    else workspaceRenderDiagnostics.fallback(base);
    workspaceRenderDiagnostics.scheduling(base);
    workspaceRenderDiagnostics.aiAsset(base);
    if (renderAuthority.blockingReasons.length > 0) {
      workspaceRenderDiagnostics.blockers({ ...base, blockers: renderAuthority.blockingReasons });
    }
    if (workspaceRenderDiff) {
      workspaceRenderDiagnostics.diff({
        ...base,
        orchestration_fidelity: workspaceRenderDiff.orchestration_fidelity,
        mismatches: workspaceRenderDiff.mismatches,
      });
    }
    // Step-30: extend the render diff with panel-consumption fidelity
    // (direct-read / authority-bypass), emits [WORKSPACE_PANEL_DIFF].
    extendRenderDiffWithConsumption({
      panelName: 'activity-workspace',
      campaignId: base.campaign_id,
      executionId: base.execution_id,
      workspaceMode: authoritativeWorkspace.mode,
      baseDiff: workspaceRenderDiff,
      violation: directReadViolation,
    });
  }, [renderAuthority, workspaceRenderDiff, authoritativeWorkspace.mode, payload, directReadViolation]);

  return {
    allContentTypesForAdd,
    allPlatformOptions,
    buildMarketingSupportForVariant,
    buildScheduleRows,
    contentType,
    contentTypeOptionsByPlatform,
    creatorAsset,
    creatorCard,
    creatorHasMasterSource,
    dailyRaw,
    effectiveProblemAddressed,
    effectiveWhatReaderLearns,
    // Step-29: render-authority cutover — executionMode renders from the
    // canonical routing/creator lineage under AUTHORITATIVE (legacy
    // inferExecutionMode is fallback-only).
    executionMode: renderAuthority.executionMode,
    getAddablePlatformsForType,
    getContentTypeOptionsForPlatform,
    hasCreatorAsset: effectiveHasCreatorAsset,
    hasMasterGenerated,
    intent,
    isCreatorActivity: effectiveIsCreatorActivity,
    // Step-28 authoritative surfaces (additive; consumers may adopt
    // incrementally — no layout/JSX change forced here).
    workspaceMode: authoritativeWorkspace.mode,
    workspaceFallbackActive: authoritativeWorkspace.fallbackActive,
    authoritativeWorkspaceView: authView,
    authoritativeWorkspaceShadowView: authoritativeWorkspace.shadowView,
    workspaceUIDiff: authoritativeWorkspace.diff,
    // Step-29 render-ready surfaces (authoritative under AUTHORITATIVE,
    // legacy-equivalent otherwise — stable shape, no forced JSX change).
    renderSource: renderAuthority.source,
    renderReadinessState: renderAuthority.readinessState,
    renderPublishState: renderAuthority.publishState,
    renderReadinessScore: renderAuthority.readinessScore,
    renderBlockingReasons: renderAuthority.blockingReasons,
    renderSchedulingState: renderAuthority.schedulingState,
    renderSchedulable: renderAuthority.schedulable,
    renderAiAssetState: renderAuthority.aiAssetState,
    renderAiAssetOrigin: renderAuthority.aiAssetOrigin,
    renderAiPreviewUrl: renderAuthority.aiPreviewUrl,
    renderAiPreviewPending: renderAuthority.aiPreviewPending,
    renderAiFallbackMode: renderAuthority.aiFallbackMode,
    renderAiUploadOverrideAvailable: renderAuthority.aiUploadOverrideAvailable,
    renderUploadRequired: renderAuthority.uploadRequired,
    renderUploadAssetState: renderAuthority.uploadAssetState,
    renderRoutingLineage: renderAuthority.routingLineage,
    renderProvenance: renderAuthority.provenance,
    workspaceRenderDiff,
    // Step-30: panel direct-consumption guard surface (observability;
    // panels may adopt guardedRead/panelAuthority incrementally).
    workspaceDirectReadViolation: directReadViolation,
    isDailyTopicView,
    isVideoContentTypeForValue,
    labelize,
    masterContent,
    masterContentFromPayload,
    nestedBrief,
    nestedIntent,
    normalizeComparableText,
    platformOptions,
    suggestedPlatforms,
    topicText,
    videoContentTypes: VIDEO_CONTENT_TYPES,
    writerBrief,
  };
}


