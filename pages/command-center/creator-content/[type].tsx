import React from 'react';
import { useRouter } from 'next/router';
import { Calendar, Send } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import { launchSocialPostingFromContent } from '../../../lib/content/socialPosting';
import { buildCreatorContentBlocks, launchBlogFromCreator } from '../../../lib/content/creatorContentBridge';
import { buildCreatorFlowContext, serializeCreatorFlowContext, type CreatorFlowContext } from '../../../lib/content/creatorFlowContext';
import { appendCreatorVisualReviewCandidate } from '../../../lib/content/creatorVisualReview';
import { openCreatorEditor } from '../../../lib/content/openCreatorEditor';
import {
  type CreatorAssetLaunchType,
  type WriterOverlayText,
  type WriterCreatorSourcePayload,
} from '../../../lib/content/writerCreatorAssetLaunch';
import {
  loadAttachmentSession,
  attachAssetToSession,
  resolveReturnDestination,
} from '../../../lib/content/creatorAttachmentSession';
import { generateCreatorAssetId } from '../../../lib/content/creatorAssetIdFactory';
import { readMarketingBrief, MARKETING_BRIEF_SESSION_KEY } from '../../../lib/content/marketingBriefResolver';
import type { MarketingBrief } from '../../../lib/content/unifiedCreationModel';
import {
  buildAssetCompositionIntent,
  normalizeAttachmentMode,
  normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType,
  validateAttachmentPayload,
  type AssetCompositionIntent,
  type AttachmentMode,
  type WriterCreatorAssetType,
} from '../../../lib/content/writerCreatorAttachmentContracts';
// Variant Experience Embedding — drop-in CTA + winner display + fan-out runner.
// All additions are gated on the resolved strategy id being non-null
// (i.e. the operator has selected a known subtype). Legacy single-
// variant generation flows continue working byte-identically when no
// variant is pinned (the planner default is V1 baseline).
import CreatorFormColumn from '../../../components/creator/workflow/CreatorFormColumn';
import { useCreatorWorkflowState } from '../../../components/creator/workflow/useCreatorWorkflowState';
import { useCreatorWorkflowLifecycle } from '../../../components/creator/workflow/useCreatorWorkflowLifecycle';
import { useCreatorWorkflowActions } from '../../../components/creator/workflow/useCreatorWorkflowActions';
import CreatorResultsColumn from '../../../components/creator/workflow/CreatorResultsColumn';
import type { VariantExecutionResult, VariantFamily } from '../../../components/variant-experience/useVariantApi';
import { decodeVariantQuery } from '../../../lib/variants/creatorStrategyMapping';
import { runVariantFanOut } from '../../../lib/variants/fanOutRunner';
import { resolvePurposeStrategy, fitSlideArcToCount } from '../../../backend/services/creator/purposeStrategyRegistry';
// Creator Template Foundation — template-driven form + generation inputs.
// All additions are gated on an active template resolved from
// ?template_id=…; with no template_id the page behaves byte-identically.
import TemplateFieldsPanel, { type TemplateAiAssistContext } from '../../../components/creator/TemplateFieldsPanel';
import {
  freshSyncState,
  markManual,
  editorLeadValue,
  planBriefEditorSync,
  type BriefEditorSyncState,
} from '../../../lib/content/creatorBriefEditorSync';
// Quality Inspector — read-only display of the attached creator_diagnostic_report.
import CreatorQualityInspector from '../../../components/creator/CreatorQualityInspector';
import type { CreatorDiagnosticReport } from '../../../backend/services/creator/creatorDiagnosticReport';
import {
  getTemplateById,
  familyForCreatorType,
  resolveTemplateCreatorCardPatch,
  creatorIngestPrefillKey,
  buildGenerationReview,
  buildCreatorCampaignPackage,
  type CreatorTemplate,
} from '../../../lib/creator-templates';
import GenerationReviewPanel from '../../../components/creator/GenerationReviewPanel';
import AssetReviewPanel from '../../../components/creator/AssetReviewPanel';
import CampaignPackagePanel from '../../../components/creator/CampaignPackagePanel';
import {
  type TemplateFieldValues,
  initTemplateValues,
  applyTemplateFieldUpdates,
  projectImageOverlayText,
  projectCarouselSlides,
  projectInfographicSections,
} from '../../../lib/creator-templates/values';
// CREATOR-PROD-005 — flag-gated deterministic runtime (ON drives the payload;
// OFF, the default, keeps the legacy projectors untouched → instant rollback).
import { creatorRuntimeV2Live } from '../../../lib/creator-templates/creatorRuntimeFlag';
import { runCreatorRuntimeV2 } from '../../../lib/creator-templates/creatorRuntimeV2';

// Decomposition: the pure type-workflow domain model (configs, chips, brand model,
// writer-source mapping, suggestion builders) lives in lib/creator-content/creatorTypeWorkflow.
import {
  BRAND_ASSET_BASE_PX,
  BRAND_ASSET_SIZE_PRESETS,
  BrandAssetSize,
  BrandContextSelections,
  BrandPresence,
  CREATOR_DRAFT_MAX_AGE_MS,
  CREATOR_GENERATION_TIMEOUT_MS,
  ChoiceOption,
  CreatorBrandMode,
  CreatorBrandProfile,
  CreatorResult,
  CreatorTypeId,
  DEFAULT_BRAND_ASSET_SIZE,
  DEFAULT_BRAND_SELECTIONS,
  DEFAULT_CTA_PRESETS,
  EMPTY_OVERLAY_TEXT,
  GUIDANCE_ONLY_TYPES,
  OVERLAY_FIELD_LABELS,
  RepurposePath,
  SOCIAL_CREATIVE_PLATFORMS,
  STARTER_CHIPS_BY_CONTENT_TYPE,
  SavedBlockReference,
  SavedCreatorAsset,
  SuggestionOption,
  WORKFLOW_CONFIG,
  WorkflowConfig,
  WorkflowField,
  brandAssetSizePx,
  buildBlockReference,
  buildBrandContextLines,
  buildCreatorAnswersFromWriterSource,
  buildDefaultAnswers,
  buildCreatorGenerationBody,
  buildFreeformFieldSuggestions,
  buildOverlayFieldSuggestions,
  buildSuggestionOptions,
  buildWriterStructureGuidance,
  deriveOverlayFromContent,
  describeBrandAssetSize,
  getCreatorDraftStorageKey,
  getDiagnosticReport,
  getMediaPreviewMetadata,
  getOptionLabel,
  getRepurposePaths,
  getSavedAssetAttachmentLabel,
  getSavedAssetCreatorType,
  getStarterChips,
  hasUsableCreatorOutput,
  humanizeValue,
  isDeterministicStructuredType,
  isGuidanceOnlyType,
  isSocialCreativeType,
  mapBriefToEditorAnswers,
  mapCreatorBrandProfile,
  normalizeBrandAssetSize,
  pickFirstString,
  pickOptionValue,
  resolveSavedAssetMedia,
  setIfFieldExists,
  splitList,
  splitWriterSourcePoints,
  summarizeMediaUrls,
} from '../../../lib/creator-content/creatorTypeWorkflow';

export default function CreatorTypeWorkflowPage() {
  // ── Decomposition: state → lifecycle → actions hook chain ─────────────────
  // All state/refs live in useCreatorWorkflowState; effects/loaders/memos in
  // useCreatorWorkflowLifecycle; user-action handlers in useCreatorWorkflowActions.
  // Contracts are INFERRED (ReturnType<typeof …>), so drift is a compile error.
  const s = useCreatorWorkflowState();
  const {
    actionInProgress, activeTemplate, aiBusyKey, answers, assetReloadNonce, attachmentSessionTokenRef,
    authChecked, brandMode, brandOverrides, brandPanelOpen, brandPresence, brandProfile, brandSelections,
    config, connectedPlatforms, error, generatedSnapshot, generationInFlightRef, generationStage, hadResultRef,
    inlineRenderError, inlineRenderInFlight, isGenerating, isLoading, isLoadingAssets, isLoadingBrandProfile,
    isSavingBlock, notice, overlayText, processedWriterPrefillRef, recommendedAttachmentMode, refinePrompt,
    refinedSuggestion, regenCount, regenSeenResultRef, renderJobProgress, result, resultPanelRef, router,
    saveInFlightRef, savedAssets, savedBlock, selectNewestAssetRef, selectedAssetId, selectedCompanyId,
    selectedCompanyName, selectedPlatform, selectedSuggestionId, setActionInProgress, setActiveTemplate,
    setAiBusyKey, setAnswers, setAssetReloadNonce, setBrandMode, setBrandOverrides, setBrandPanelOpen,
    setBrandPresence, setBrandProfile, setBrandSelections, setConnectedPlatforms, setError,
    setGeneratedSnapshot, setGenerationStage, setInlineRenderError, setInlineRenderInFlight, setIsGenerating,
    setIsLoadingAssets, setIsLoadingBrandProfile, setIsSavingBlock, setNotice, setOverlayText,
    setRecommendedAttachmentMode, setRefinePrompt, setRefinedSuggestion, setRegenCount, setRenderJobProgress,
    setResult, setSavedAssets, setSavedBlock, setSelectedAssetId, setSelectedPlatform, setSelectedSuggestionId,
    setShowProgress, setStandaloneAttachmentMode, setSyncState, setTemplateValues, setTopicMissing,
    setVariantFanOutInFlight, setVariantFanOutSummary, setVariantPin, setVariantPlan, setWriterSource,
    showProgress, standaloneAttachmentMode, syncState, templateValues, topicFieldRef, topicMissing, type, user,
    variantFanOutInFlight, variantFanOutSummary, variantPin, variantPlan, writerAssetType,
    writerAttachmentMode, writerCompositionIntent, writerEmbeddedCopy, writerSource, writerSupportingVisual
  } = s;
  const l = useCreatorWorkflowLifecycle(s);
  const {
    availablePlatforms, brandContextLines, buildCurrentContext, flagMissingTopic, generationModeLabel,
    handleEditorChange, hasBrandProfile, repurposePaths, selectedAsset, selectedSuggestion, setAnswer,
    setAnswerSilent, setBrandOverride, setBrandSelection, setOverlayField, suggestionOptions
  } = l;

  const overlayFieldSuggestions = React.useMemo(() => buildOverlayFieldSuggestions({
    type,
    writerTitle: String(writerSource?.title || ''),
    writerBody: String(writerSource?.body || ''),
    topic: String(answers.topic || ''),
    keyMessage: String(answers.keyMessage || ''),
    currentHook: String(overlayText.hook || ''),
  }), [writerSource?.body, writerSource?.title, answers.topic, answers.keyMessage, overlayText.hook, type]);

  // Freeform-question chips (audience / keyMessage / cta / topic / dataPoints /
  // refinement / objective) — pure builder, same dependency array as before.
  const freeformFieldSuggestions = React.useMemo(() => buildFreeformFieldSuggestions({
    type,
    subtype: String(answers.subtype || ''),
    writerAudience: String(writerSource?.audience || ''),
    writerBody: String(writerSource?.body || ''),
    writerTitle: String(writerSource?.title || ''),
    brandOverrideAudience: String(brandOverrides.audience || ''),
    brandProfileAudience: String(brandProfile?.audience || ''),
    topic: String(answers.topic || ''),
    overlayHook: String(overlayText.hook || ''),
    overlayKeyInsight: String(overlayText.keyInsight || ''),
    overlayCta: String(overlayText.cta || ''),
  }), [
    writerSource?.audience,
    writerSource?.body,
    writerSource?.title,
    brandOverrides.audience,
    brandProfile?.audience,
    answers.topic,
    answers.subtype,
    overlayText.hook,
    overlayText.keyInsight,
    overlayText.cta,
    type,
  ]);


  const a = useCreatorWorkflowActions(s, l);
  const {
    buildGenerationBody, handleDownloadBrief, handleGenerate, handleOpenScheduler, handleOverlayAi,
    handleRefineSuggestion, handleRenderInline, handleRepurpose, handleSaveAsBlock, handleSaveAsBlog,
    handleTemplateAiAssist, handleUseExistingAsset, mediaUrls
  } = a;

  const previewMetadata = getMediaPreviewMetadata(result);
  const previewKind = previewMetadata.preview_kind || '';
  const isDirectionCardPreview = previewKind === 'direction_card';
  const isProviderImagePreview = previewKind === 'provider_image' || previewKind === 'social_creative';
  const isThemeTreatment = previewKind === 'theme_treatment';
  // Theme treatment payload exposed on asset_payload for guidance-only
  // formats (video, reel, short, podcast). Pulled out here so the JSX block
  // below stays readable.
  const themeAssetPayload = (result?.output?.asset_payload || {}) as Record<string, unknown>;
  const themeHookScene = (themeAssetPayload.hook_scene && typeof themeAssetPayload.hook_scene === 'object'
    ? themeAssetPayload.hook_scene as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeCtaScene = (themeAssetPayload.cta_scene && typeof themeAssetPayload.cta_scene === 'object'
    ? themeAssetPayload.cta_scene as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeScenes: Array<Record<string, unknown>> = Array.isArray(themeAssetPayload.scenes)
    ? (themeAssetPayload.scenes as unknown[]).filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && !Array.isArray(s)))
    : [];
  const themePlatformNotes = (themeAssetPayload.platform_notes && typeof themeAssetPayload.platform_notes === 'object'
    ? themeAssetPayload.platform_notes as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const themeDurationSeconds = Number(themeAssetPayload.duration_seconds ?? 0);
  const themeAspectRatio = String(themeAssetPayload.aspect_ratio || themePlatformNotes.optimal_aspect_ratio || '9:16');
  const documentUrl = typeof previewMetadata.document_url === 'string' ? previewMetadata.document_url : '';
  const documentFallbackReason = typeof previewMetadata.document_fallback_reason === 'string'
    ? previewMetadata.document_fallback_reason
    : '';
  // Part 3 — graceful-degradation surface fields. `pdf_document_status`
  // is the authoritative signal; `pdf_document_user_message` is ready-
  // to-display copy categorized by the renderer.
  const pdfDocumentStatus = typeof previewMetadata.pdf_document_status === 'string'
    ? previewMetadata.pdf_document_status
    : '';
  const pdfDocumentFallbackCategory = typeof previewMetadata.pdf_document_fallback_category === 'string'
    ? previewMetadata.pdf_document_fallback_category
    : '';
  const pdfDocumentUserMessage = typeof previewMetadata.pdf_document_user_message === 'string'
    ? previewMetadata.pdf_document_user_message
    : '';
  const pdfPreviewPagesAvailable = typeof previewMetadata.pdf_preview_pages_available === 'number'
    ? previewMetadata.pdf_preview_pages_available
    : 0;
  const previewWidth = Number(previewMetadata.width || 1) || 1;
  const previewHeight = Number(previewMetadata.height || 1) || 1;
  const previewAspectRatio = `${previewWidth} / ${previewHeight}`;
  const overlayQuality = previewMetadata.overlay_quality && typeof previewMetadata.overlay_quality === 'object'
    ? previewMetadata.overlay_quality as { score?: number; flags?: string[]; preset?: string }
    : null;
  const creatorQuality = previewMetadata.creator_quality_score && typeof previewMetadata.creator_quality_score === 'object'
    ? previewMetadata.creator_quality_score as { cleanliness?: number; readability?: number; clutterRisk?: number; warnings?: string[] }
    : null;
  const visualGovernanceWarnings = Array.isArray(previewMetadata.visual_governance_warnings)
    ? previewMetadata.visual_governance_warnings.map(String).filter(Boolean)
    : [];
  const slides = Array.isArray(result?.output.asset_payload.slides) ? result.output.asset_payload.slides : [];
  // config can be null here (router query not yet ready / unknown type) — this
  // const sits ABOVE the `if (!config)` guard below, so it must be null-safe.
  // The value is only consumed in the post-guard render where config is non-null.
  const socialActionLabel = config?.contentType === 'thread' ? 'thread' : 'post';

  // Relocated from the top of the component (post Rendering Forensic
  // Audit). These early returns must fire AFTER every hook in the
  // component has been called this render — otherwise React sees a
  // different hook count between renders. All three branches are pure
  // rendering decisions; they do not depend on state that hasn't been
  // computed by this point.
  if (!authChecked || isLoading) {
    return <PageLoader message="Loading creator studio…" />;
  }
  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;
  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-600">
          Unknown creator content type.
        </div>
      </div>
    );
  }

  const selectedSubtype = config.subtypeOptions.find((option) => option.value === answers.subtype) || config.subtypeOptions[0];
  const proposalLine = [
    refinedSuggestion || selectedSuggestion?.summary || '',
  ].filter(Boolean).join(' ');

  // The typed contract handed to the two extracted render columns. The page owns
  // ALL state/effects/handlers; the columns are verbatim JSX consumers of this object.
  const ctx = {
    actionInProgress,
    activeTemplate,
    aiBusyKey,
    answers,
    attachmentSessionTokenRef,
    availablePlatforms,
    brandMode,
    brandOverrides,
    brandPanelOpen,
    brandPresence,
    brandProfile,
    brandSelections,
    buildGenerationBody,
    config,
    connectedPlatforms,
    creatorQuality,
    documentFallbackReason,
    documentUrl,
    error,
    freeformFieldSuggestions,
    generatedSnapshot,
    generationInFlightRef,
    generationModeLabel,
    generationStage,
    handleDownloadBrief,
    handleEditorChange,
    handleGenerate,
    handleOpenScheduler,
    handleOverlayAi,
    handleRefineSuggestion,
    handleRenderInline,
    handleSaveAsBlock,
    handleTemplateAiAssist,
    handleUseExistingAsset,
    hasBrandProfile,
    inlineRenderError,
    inlineRenderInFlight,
    isDirectionCardPreview,
    isGenerating,
    isLoadingAssets,
    isLoadingBrandProfile,
    isProviderImagePreview,
    isSavingBlock,
    isThemeTreatment,
    mediaUrls,
    notice,
    overlayFieldSuggestions,
    overlayQuality,
    overlayText,
    pdfDocumentFallbackCategory,
    pdfDocumentStatus,
    pdfDocumentUserMessage,
    pdfPreviewPagesAvailable,
    previewAspectRatio,
    previewKind,
    proposalLine,
    recommendedAttachmentMode,
    refinePrompt,
    refinedSuggestion,
    regenCount,
    renderJobProgress,
    result,
    resultPanelRef,
    router,
    savedAssets,
    savedBlock,
    selectedAsset,
    selectedAssetId,
    selectedCompanyId,
    selectedPlatform,
    selectedSuggestionId,
    setAnswer,
    setBrandMode,
    setBrandOverride,
    setBrandPanelOpen,
    setBrandPresence,
    setBrandSelection,
    setError,
    setNotice,
    setOverlayField,
    setRefinePrompt,
    setRefinedSuggestion,
    setSelectedAssetId,
    setSelectedPlatform,
    setSelectedSuggestionId,
    setStandaloneAttachmentMode,
    setVariantFanOutInFlight,
    setVariantFanOutSummary,
    setVariantPin,
    setVariantPlan,
    showProgress,
    slides,
    socialActionLabel,
    standaloneAttachmentMode,
    suggestionOptions,
    templateValues,
    themeAspectRatio,
    themeCtaScene,
    themeDurationSeconds,
    themeHookScene,
    themePlatformNotes,
    themeScenes,
    topicFieldRef,
    topicMissing,
    type,
    variantFanOutInFlight,
    variantFanOutSummary,
    variantPin,
    variantPlan,
    visualGovernanceWarnings,
    writerAttachmentMode,
    writerCompositionIntent,
    writerEmbeddedCopy,
    writerSource,
    writerSupportingVisual,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <button
          onClick={() => router.push('/command-center/creator-content')}
          className="flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Creator Content
        </button>

        <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Creator Workflow
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
            {config.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-600 md:text-base">
            {config.intro}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <CreatorFormColumn ctx={ctx} />
          <CreatorResultsColumn ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
