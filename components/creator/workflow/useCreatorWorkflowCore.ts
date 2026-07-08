/**
 * useCreatorWorkflowCore — ALL state, refs, effects, loaders and inline setters of the
 * creator type-workflow page, extracted VERBATIM (decomposition: page < 1000 LOC).
 * Returns every top-level binding; the page destructures what the memos/derived/render need,
 * and useCreatorWorkflowActions receives the whole object (contract inferred via ReturnType).
 */
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


export function useCreatorWorkflowCore() {
  const router = useRouter();
  const { user, authChecked, isLoading, selectedCompanyId, selectedCompanyName } = useCompanyContext();
  const type = typeof router.query.type === 'string' ? (router.query.type as CreatorTypeId) : null;

  // Taxonomy consolidation — legacy URL aliasing. Users (or external
  // bookmarks / writer attachments) hitting /creator-content/banner or
  // /creator-content/slider are redirected to the consolidated
  // image/carousel workflow with the corresponding layout pre-selected.
  // Historical creator_assets rows stored under creatorType='banner' or
  // 'slider' continue to render normally — only the AUTHORING URL is
  // redirected, never the saved-asset surfaces.
  React.useEffect(() => {
    if (!router.isReady) return;
    if (type === 'banner') {
      void router.replace({
        pathname: '/command-center/creator-content/image',
        query: { ...router.query, type: 'image', layout: 'wide-banner' },
      }, undefined, { shallow: false });
    } else if (type === 'slider') {
      void router.replace({
        pathname: '/command-center/creator-content/carousel',
        query: { ...router.query, type: 'carousel', layout: 'widescreen-presentation' },
      }, undefined, { shallow: false });
    }
  }, [router, type]);

  // Template-first: a template-capable asset opened FRESH (no template selected)
  // is sent to the template gallery to choose one (recommendation auto-selects
  // the best). This is the canonical safety net — it enforces template selection
  // regardless of which entry point (nav / landing / bookmark / stale link)
  // reached the workflow. It NEVER fires when:
  //   - a template is already chosen (?template_id=…),
  //   - the user explicitly skipped (?skip_templates=1),
  //   - the workflow was opened with authoring context (writer prefill /
  //     attachment / text-transform / edit), which is template-less by design.
  // No loop: the gallery lives at /<type>/templates; picking a template returns
  // here with ?template_id=… and the redirect no longer fires.
  React.useEffect(() => {
    if (!router.isReady) return;
    if (type !== 'image' && type !== 'carousel' && type !== 'infographic') return;
    const q = router.query;
    const has = (k: string) => typeof q[k] === 'string' && (q[k] as string).trim().length > 0;
    if (has('template_id') || q.skip_templates === '1' || has('prefill') || has('session') || has('source') || has('source_text_transform') || has('asset_type')) return;
    void router.replace(
      { pathname: `/command-center/creator-content/${type}/templates`, query: { ...q, type: undefined } },
      undefined,
      { shallow: false },
    );
  }, [router, type]);

  const config = type ? WORKFLOW_CONFIG[type] : null;

  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = React.useState(false);
  // Progress tracker state. `generationStage` advances through 4 stages
  // while a generation is in flight; `showProgress` is gated behind a
  // 2-second delay so quick runs (cache hits, small payloads) don't
  // flash a tracker the operator never gets to read.
  const [generationStage, setGenerationStage] = React.useState(0);
  const [showProgress, setShowProgress] = React.useState(false);
  const [isSavingBlock, setIsSavingBlock] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savedBlock, setSavedBlock] = React.useState<SavedBlockReference | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = React.useState('safe-fit');
  const [refinePrompt, setRefinePrompt] = React.useState('');
  const [refinedSuggestion, setRefinedSuggestion] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreatorResult | null>(null);
  // ── Variant Experience Embedding state ──────────────────────────
  // `variantPin` carries the family the operator chose for a single
  // generation; consumed by the existing handleGenerate path so the
  // server sees `variant_id` / `variant_family` on the creator_card
  // payload. `variantPlan` carries the most recent planner result
  // for top-3 / experiment fan-out (rendered as preview + Generate
  // Variants button below the main Generate button).
  const [variantPin, setVariantPin] = React.useState<VariantFamily | null>(null);
  const [variantPlan, setVariantPlan] = React.useState<VariantExecutionResult | null>(null);
  const [variantFanOutInFlight, setVariantFanOutInFlight] = React.useState(false);
  const [variantFanOutSummary, setVariantFanOutSummary] = React.useState<string | null>(null);
  // Note: `lastGeneratePayloadRef` was removed in the final readiness
  // pass. Variant fan-out now builds its payload directly from form
  // state via `buildGenerationBody(null)`, so the ref had no readers.
  const [savedAssets, setSavedAssets] = React.useState<SavedCreatorAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = React.useState(false);
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);
  // PHASE 14F: bump to force a savedAssets refetch after a generate; the ref
  // asks the loader to select the newest asset once that refetch lands, so a
  // newly generated render appears and is selected without a page reload.
  const [assetReloadNonce, setAssetReloadNonce] = React.useState(0);
  const selectNewestAssetRef = React.useRef(false);
  const [brandMode, setBrandMode] = React.useState<CreatorBrandMode>('independent');
  const [brandPanelOpen, setBrandPanelOpen] = React.useState(false);
  const [brandPresence, setBrandPresence] = React.useState<BrandPresence>('balanced');
  const [brandSelections, setBrandSelections] = React.useState<BrandContextSelections>(DEFAULT_BRAND_SELECTIONS);
  const [brandProfile, setBrandProfile] = React.useState<CreatorBrandProfile | null>(null);
  const [brandOverrides, setBrandOverrides] = React.useState<Record<string, string>>({});
  const [isLoadingBrandProfile, setIsLoadingBrandProfile] = React.useState(false);
  const [actionInProgress, setActionInProgress] = React.useState<string | null>(null);
  const [writerSource, setWriterSource] = React.useState<WriterCreatorSourcePayload | null>(null);
  const [standaloneAttachmentMode, setStandaloneAttachmentMode] = React.useState<AttachmentMode>('supporting_visual');
  const [recommendedAttachmentMode, setRecommendedAttachmentMode] = React.useState<AttachmentMode | null>(null);
  // Creator Template Foundation — active template + its form values. When a
  // template is active, it drives the form fields AND the generation inputs
  // (purpose_key / subtype / infographic_layout / attachment_mode / slides).
  const [activeTemplate, setActiveTemplate] = React.useState<CreatorTemplate | null>(null);
  const [templateValues, setTemplateValues] = React.useState<TemplateFieldValues>({ fields: {} });
  // Canonical Brief ⇄ Editor sync state (per synchronized endpoint). Reset below
  // whenever a different template / new asset / different draft loads.
  const [syncState, setSyncState] = React.useState<BriefEditorSyncState>(freshSyncState);
  // Reset sync state on a new template / asset / draft so auto-fill resumes for a
  // genuinely new context (manual locks belong to the asset that was being edited).
  React.useEffect(() => {
    setSyncState(freshSyncState());
  }, [activeTemplate?.id, type, router.query.template_id, router.query.ingest, router.query.session, router.query.prefill]);
  // Field-level AI assist — the busyKey of the in-flight assist action (per
  // field / batch); the panel disables that single control while it runs.
  const [aiBusyKey, setAiBusyKey] = React.useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = React.useState('linkedin');
  // Connected platforms that support the current creator content type
  // (creator capability). null = still loading; [] = company has none
  // connected. Routes through the canonical bolt/available-platforms API
  // so capability filtering + token validity stay in sync with the
  // rest of the app.
  const [connectedPlatforms, setConnectedPlatforms] = React.useState<string[] | null>(null);
  const [overlayText, setOverlayText] = React.useState<WriterOverlayText>(EMPTY_OVERLAY_TEXT);
  const generationInFlightRef = React.useRef(false);
  const saveInFlightRef = React.useRef(false);
  const processedWriterPrefillRef = React.useRef('');
  // CreatorAttachmentSession token in flight (owns attach + return for this launch).
  const attachmentSessionTokenRef = React.useRef('');
  // Output panel ref + previous-result tracker. When `result`
  // transitions from null → non-null, we scroll the panel into view
  // so the operator can see the generated carousel/image/etc.
  // immediately — without this, on narrow viewports the output
  // stacks below the form and is easy to miss.
  const resultPanelRef = React.useRef<HTMLDivElement | null>(null);
  const hadResultRef = React.useRef(false);
  // Required "main topic" field — when generation is gated on an empty topic we
  // scroll to + focus + highlight this field (it sits at the top of a long form,
  // so a bottom-of-page error alone leaves the operator hunting for it).
  const topicFieldRef = React.useRef<HTMLDivElement | null>(null);
  const [topicMissing, setTopicMissing] = React.useState(false);
  // Render-job progress tracker. Carousel / infographic / pdf / slider
  // render in a durable background job; the polling effect updates this
  // state every 2s so the banner can show a real progress bar instead
  // of a generic spinner.
  // CREATOR-011 — snapshot the editor values that produced the asset, and count
  // regenerations, for the read-only Asset Review (presentation only).
  const [generatedSnapshot, setGeneratedSnapshot] = React.useState<TemplateFieldValues | null>(null);
  const [regenCount, setRegenCount] = React.useState(0);
  const regenSeenResultRef = React.useRef(false);
  const [renderJobProgress, setRenderJobProgress] = React.useState<{
    percent: number;
    status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'dead_letter' | 'waiting';
    attempts: number;
    /** Wall-clock seconds the job has spent in queued/waiting (worker
     *  hasn't picked it up). After ~20s this signals that no render
     *  worker is running locally (`npm run dev` without `dev:full`). */
    queuedSeconds: number;
  } | null>(null);
  // Inline-render escape hatch state. When the durable queue stalls
  // (no worker consuming), the operator can trigger a synchronous
  // render via /api/command-center/creator-content/render-inline.
  const [inlineRenderInFlight, setInlineRenderInFlight] = React.useState(false);
  const [inlineRenderError, setInlineRenderError] = React.useState<string | null>(null);
  const writerCompositionIntent = writerSource?.compositionIntent ?? null;
  const writerAttachmentMode: AttachmentMode | null = writerCompositionIntent?.attachmentMode ?? null;
  const writerAssetType: WriterCreatorAssetType | null = writerCompositionIntent?.assetType ?? null;
  const writerSupportingVisual = writerAttachmentMode === 'supporting_visual';
  const writerEmbeddedCopy = writerAttachmentMode === 'embedded_copy';

  // Creator Template Foundation — resolve the active template from the URL
  // (?template_id=…) once the router is ready. Initialises the template form
  // values and, for image templates, syncs the attachment-mode contract
  // (text-in-image vs clean visual) onto the existing standalone selector.
  // No template_id → activeTemplate stays null and the page is unchanged.
  React.useEffect(() => {
    if (!router.isReady) return;
    const templateId = typeof router.query.template_id === 'string' ? router.query.template_id : '';
    const family = familyForCreatorType(type);
    if (!templateId || !family) {
      setActiveTemplate(null);
      return;
    }
    const tpl = getTemplateById(templateId, family);
    setActiveTemplate(tpl);
    if (tpl) {
      setTemplateValues(initTemplateValues(tpl));
      // CREATOR-007 — seed the canonical form values from deterministic content
      // ingestion when handed off via ?ingest=<token>. The editor stays fully
      // editable; this only pre-fills. Guarded to the matching template id.
      const ingestToken = typeof router.query.ingest === 'string' ? router.query.ingest : '';
      if (ingestToken) {
        try {
          const rawV = window.sessionStorage.getItem(creatorIngestPrefillKey(ingestToken));
          if (rawV) {
            const parsed = JSON.parse(rawV) as { templateId?: string; values?: TemplateFieldValues };
            if (parsed && parsed.templateId === tpl.id && parsed.values && typeof parsed.values === 'object') {
              setTemplateValues(parsed.values);
            }
          }
        } catch { /* ignore malformed prefill */ }
      }
      if (tpl.assetFamily === 'image' && tpl.renderingContract.attachmentMode) {
        setStandaloneAttachmentMode(tpl.renderingContract.attachmentMode);
      }
    }
  }, [router.isReady, router.query.template_id, router.query.ingest, type]);

  // CREATOR-011 — snapshot values at generation; count regenerations.
  React.useEffect(() => {
    if (result) {
      setGeneratedSnapshot(templateValues);
      if (regenSeenResultRef.current) setRegenCount((c) => c + 1);
      regenSeenResultRef.current = true;
    } else {
      regenSeenResultRef.current = false; setRegenCount(0); setGeneratedSnapshot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Field-level AI assist handler. User-invoked; updates ONLY the targeted
  // field(s) returned by the endpoint — never a full asset, never an automatic
  // overwrite. Manual content for non-targeted fields is preserved.
  const handleTemplateAiAssist = React.useCallback(async (ctx: TemplateAiAssistContext) => {
    if (!activeTemplate || ctx.targets.length === 0) return;
    setAiBusyKey(ctx.busyKey);
    setError(null);
    try {
      // Carousel slides play distinct roles in a narrative arc — attach each slide's role +
      // intent so the AI writes arc-aware titles/bodies (hook → build → proof → CTA) that
      // advance the story instead of repeating. Derived from the purpose strategy's slideArc,
      // sized to the actual slide count (the same arc the renderer/preview uses).
      let slideRoles: Array<{ role: string; intent: string }> = [];
      if (activeTemplate.assetFamily === 'carousel' && ctx.targets.some((t) => t.scope === 'slide')) {
        const strategy = resolvePurposeStrategy(type, String(answers.subtype || ''));
        const arc = strategy?.slideArc ?? [];
        const slideCount = Math.max(
          (templateValues.slides ?? []).length,
          ...ctx.targets.filter((t) => t.scope === 'slide').map((t) => (t.index ?? 0) + 1),
          1,
        );
        const sizedRoles = fitSlideArcToCount(arc.map((a) => a.role), slideCount);
        const intentByRole = new Map(arc.map((a) => [a.role, a.intent] as const));
        slideRoles = sizedRoles.map((role) => ({
          role,
          intent: intentByRole.get(role) ?? 'Advance the narrative with a distinct supporting point — do not repeat an earlier slide.',
        }));
      }
      const resp = await fetch('/api/creator-templates/field-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId || undefined,
          asset_family: activeTemplate.assetFamily,
          template_id: activeTemplate.id,
          action: ctx.action,
          targets: ctx.targets.map((t) => ({
            scope: t.scope, field_key: t.fieldKey, index: t.index, current_value: t.currentValue,
            ...(t.scope === 'slide' && typeof t.index === 'number' && slideRoles[t.index]
              ? { role: slideRoles[t.index].role, role_intent: slideRoles[t.index].intent }
              : {}),
          })),
          context: {
            topic: String(answers.topic || '').trim(),
            audience: String(answers.audience || '').trim(),
            objective: String(answers.objective || '').trim(),
            tone: String(answers.styleDirection || '').trim(),
            // The content the asset is built FROM: the Writer post body / campaign card when this
            // flow carried one, else the operator's key message / data points. Carousel generation
            // turns this into the slide sequence instead of inventing from the short topic.
            source_content: String(
              writerSource?.body
              || [answers.keyMessage, answers.dataPoints].map((v) => String(v || '').trim()).filter(Boolean).join('\n\n')
              || '',
            ).trim().slice(0, 6000) || undefined,
            // Already-filled fields on this asset, so AI-generated copy stays DISTINCT
            // (e.g. the subheadline won't restate the headline). The API drops the field
            // being written and instructs the model not to duplicate the rest.
            siblings: (activeTemplate.formDefinition.fields ?? [])
              .map((f) => ({ label: f.label, value: String(templateValues.fields?.[f.key] ?? '').trim() }))
              .filter((s) => s.value),
          },
        }),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail?.error || `AI assist failed (${resp.status})`);
      }
      const data = await resp.json();
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      if (updates.length > 0) {
        setTemplateValues((prev) => applyTemplateFieldUpdates(prev, updates));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed');
    } finally {
      setAiBusyKey(null);
    }
  }, [activeTemplate, selectedCompanyId, answers, templateValues, writerSource, type]);

  // Auto-fill EMPTY slide titles ONCE on arrival from the brief flow
  // (?from=workspace), so "Generate my carousel" lands on a titled carousel
  // instead of an empty "NOT READY" form. This mirrors the "Generate empty
  // slides" button exactly (only fully-empty rows, only generate-enabled
  // fields) — so it never overwrites anything the user typed, and the once-per
  // (template + slide count) guard means editing or changing the count later
  // never re-triggers it. Manual entry points (not ?from=workspace) still start
  // clean, honouring the "never an automatic overwrite" rule.
  const autoFilledSlidesRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (router.query.from !== 'workspace') return;
    if (aiBusyKey) return;
    const slideDef = activeTemplate?.formDefinition.slides;
    if (!slideDef) return;
    const slideFields = slideDef.fields ?? [];
    const rows = templateValues.slides ?? [];
    if (rows.length === 0 || slideFields.length === 0) return;
    const targets = rows.flatMap((row, index) => {
      const rowEmpty = slideFields.every((f) => !String(row[f.key] || '').trim());
      if (!rowEmpty) return [];
      return slideFields
        .filter((f) => f.aiAssist.generate)
        .map((f) => ({ scope: 'slide' as const, fieldKey: f.key, index, currentValue: String(row[f.key] || '') }));
    });
    if (targets.length === 0) return;
    const fireKey = `${activeTemplate!.id}:${rows.length}`;
    if (autoFilledSlidesRef.current === fireKey) return;
    autoFilledSlidesRef.current = fireKey;
    handleTemplateAiAssist({
      template: activeTemplate!,
      action: 'generate',
      busyKey: 'batch:slide:Generate empty slides',
      label: 'Generate empty slides',
      targets,
    });
  }, [router.query.from, activeTemplate, templateValues.slides, aiBusyKey, handleTemplateAiAssist]);

  // AI-generate a single OVERLAY field (hook / headline / supporting text / key insight).
  // Overlay copy isn't a template field, so we call field-assist with the 'overlay' scope
  // (role-framed synthetic fields), passing the OTHER filled overlay fields as siblings so
  // each role stays distinct (a key insight won't restate the headline).
  const handleOverlayAi = React.useCallback(async (fieldId: keyof WriterOverlayText, action: 'generate' | 'rewrite' = 'generate') => {
    if (!activeTemplate) return;
    const busyKey = `overlay:${fieldId}`;
    setAiBusyKey(busyKey);
    setError(null);
    try {
      const siblings = (Object.keys(OVERLAY_FIELD_LABELS) as Array<keyof WriterOverlayText>)
        .filter((k) => k !== fieldId)
        .map((k) => ({ label: OVERLAY_FIELD_LABELS[k], value: String(overlayText[k] || '').trim() }))
        .filter((s) => s.value);
      const resp = await fetch('/api/creator-templates/field-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId || undefined,
          asset_family: activeTemplate.assetFamily,
          template_id: activeTemplate.id,
          action,
          targets: [{ scope: 'overlay', field_key: fieldId, current_value: String(overlayText[fieldId] || '') }],
          context: {
            topic: String(answers.topic || '').trim(),
            audience: String(answers.audience || '').trim(),
            objective: String(answers.objective || '').trim(),
            tone: String(answers.styleDirection || '').trim(),
            siblings,
          },
        }),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail?.error || `AI assist failed (${resp.status})`);
      }
      const data = await resp.json();
      const updates = Array.isArray(data?.updates) ? data.updates : [];
      const match = updates.find((u: { field_key?: string; fieldKey?: string; value?: string }) => (u.field_key ?? u.fieldKey) === fieldId);
      if (match && typeof match.value === 'string' && match.value.trim()) {
        setOverlayField(fieldId, match.value);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed');
    } finally {
      setAiBusyKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate, selectedCompanyId, answers, overlayText]);

  // Text-inside-image prepopulation: mirror the template-content fields the operator already
  // filled on the previous step into the overlay panel so it isn't blank — hook ← the image
  // text (headline), overlay headline ← the subtext (subheadline). Only fills EMPTY overlay
  // fields (never overrides edits), and only for the standalone flow (writer imports derive
  // their overlay from the source post instead).
  React.useEffect(() => {
    if (!activeTemplate || writerSource) return;
    const imageText = String(templateValues.fields?.headline ?? '').trim();
    const subText = String(templateValues.fields?.subheadline ?? '').trim();
    if (!imageText && !subText) return;
    setOverlayText((prev) => {
      const next = { ...prev };
      if (!String(prev.hook || '').trim() && imageText) next.hook = imageText.slice(0, 76);
      if (!String(prev.headline || '').trim() && subText) next.headline = subText.slice(0, 84);
      return next.hook === prev.hook && next.headline === prev.headline ? prev : next;
    });
  }, [activeTemplate, writerSource, templateValues.fields?.headline, templateValues.fields?.subheadline]);

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, isLoading, user?.userId, router]);

  React.useEffect(() => {
    const defaults = config ? buildDefaultAnswers(config) : {};
    // Operator feedback: when navigating to a creator-content type
    // from header or cards, no field should be prefilled — every
    // visit should start clean. The writer-prefill flow
    // (?source=writer&prefill=token) is an EXPLICIT carry-over that
    // continues to work via its own sessionStorage handshake below;
    // it does NOT use this localStorage draft.
    //
    // Side effect: also wipe any stale draft from a prior session so
    // it doesn't get re-applied on a future navigation.
    let restored: Record<string, unknown> | null = null;
    if (type && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(getCreatorDraftStorageKey(type));
      } catch {
        // localStorage access can fail in private-mode browsers — silent.
      }
    }
    // URL layout override (consolidation alias redirect) — when the
    // user arrives via /creator-content/image?layout=wide-banner (or
    // ?layout=widescreen-presentation on carousel), preselect the
    // layout choice so the form opens on the intended preset.
    const urlLayout = typeof router.query.layout === 'string' ? router.query.layout : '';
    const layoutOverride = (urlLayout === 'wide-banner' || urlLayout === 'widescreen-presentation' || urlLayout === 'square' || urlLayout === 'portrait' || urlLayout === 'landscape' || urlLayout === 'standard') ? { layout: urlLayout } : {};
    // CREATOR-106: EXPLICIT carry-over from the Marketing Workspace (?from=workspace).
    // Seed the editor fields from the workspace brief so the user doesn't re-enter what
    // they already gave; everything stays editable. Other entry points still start clean.
    let workspacePrefill: Record<string, string> = {};
    if (config && router.query.from === 'workspace' && typeof window !== 'undefined') {
      try {
        const wb = readMarketingBrief(window.sessionStorage.getItem(MARKETING_BRIEF_SESSION_KEY));
        if (wb) workspacePrefill = mapBriefToEditorAnswers(wb, config);
      } catch { /* ignore malformed brief */ }
    }
    setAnswers({
      ...defaults,
      ...workspacePrefill,
      ...((restored?.answers && typeof restored.answers === 'object') ? restored.answers as Record<string, string> : {}),
      ...layoutOverride,
    });
    setResult(null);
    setError(null);
    setNotice(null);
    setSavedBlock(null);
    setActionInProgress(null);
    setSelectedSuggestionId(typeof restored?.selectedSuggestionId === 'string' ? restored.selectedSuggestionId : 'safe-fit');
    setRefinePrompt('');
    setRefinedSuggestion(null);
    const hasPendingWriterPrefill =
      router.query.source === 'writer' && typeof router.query.prefill === 'string';
    if (!hasPendingWriterPrefill) {
      setWriterSource(null);
    }
    setSelectedPlatform(
      typeof restored?.selectedPlatform === 'string' && config?.primaryPlatforms.includes(restored.selectedPlatform)
        ? restored.selectedPlatform
        : config?.primaryPlatforms[0] || 'linkedin',
    );
    setOverlayText(
      restored?.overlayText && typeof restored.overlayText === 'object'
        ? { ...EMPTY_OVERLAY_TEXT, ...(restored.overlayText as Partial<WriterOverlayText>) }
        : EMPTY_OVERLAY_TEXT,
    );
    setStandaloneAttachmentMode(
      restored?.standaloneAttachmentMode === 'embedded_copy' || restored?.standaloneAttachmentMode === 'supporting_visual'
        ? (restored.standaloneAttachmentMode as AttachmentMode)
        : 'supporting_visual',
    );
    setRecommendedAttachmentMode(
      restored?.recommendedAttachmentMode === 'embedded_copy' || restored?.recommendedAttachmentMode === 'supporting_visual'
        ? (restored.recommendedAttachmentMode as AttachmentMode)
        : null,
    );
    // CREATOR-106: arriving from the workspace, open the Brand panel so the logo-size
    // (Small/Medium/Large) + brand controls are visible up front, not buried.
    setBrandPanelOpen(router.query.from === 'workspace');
    setBrandMode(restored?.brandMode === 'brand-aware' ? 'brand-aware' : 'independent');
    setBrandPresence(
      restored?.brandPresence === 'minimal' || restored?.brandPresence === 'strong'
        ? restored.brandPresence
        : 'balanced',
    );
    if (restored?.brandSelections && typeof restored.brandSelections === 'object') {
      setBrandSelections({ ...DEFAULT_BRAND_SELECTIONS, ...(restored.brandSelections as Partial<BrandContextSelections>) });
    }
    if (restored?.brandOverrides && typeof restored.brandOverrides === 'object') {
      setBrandOverrides(restored.brandOverrides as Record<string, string>);
    }
    setSelectedAssetId(typeof restored?.selectedAssetId === 'string' ? restored.selectedAssetId : null);
  }, [config, router.query.prefill, router.query.source, router.query.from, type]);

  // ── Variant deep-link pin (PHASE 1 — Variant Experience Embedding) ──
  // When the Writer (or any sibling surface) routes the operator here
  // with `?variant_family=v2`, pre-pin that family so the generation
  // request carries the variant attribution without the operator
  // having to re-pick it. Legacy URLs (no query) keep `variantPin`
  // null and the page generates the V1 baseline byte-identically to
  // the pre-variant flow (PHASE 10 regression-safety guarantee).
  React.useEffect(() => {
    const decoded = decodeVariantQuery(router.query as Record<string, string | string[] | undefined>);
    if (decoded.variantFamily) setVariantPin(decoded.variantFamily);
  }, [router.query]);

  React.useEffect(() => {
    if (!router.isReady || !config || !type || typeof window === 'undefined') return;
    // Canonical lifecycle: read the CreatorAttachmentSession (new `?session=` token;
    // `?prefill=` accepted as a legacy fallback inside loadAttachmentSession). The
    // session's launchContext IS the former writer payload, so derivation below is
    // byte-identical — only the source of the payload changed (one object, one key).
    const sessionToken = (typeof router.query.session === 'string' ? router.query.session : '')
      || (typeof router.query.prefill === 'string' ? router.query.prefill : '');
    const source = typeof router.query.source === 'string' ? router.query.source : '';
    if (!sessionToken || source !== 'writer' || processedWriterPrefillRef.current === sessionToken) return;

    try {
      const session = loadAttachmentSession(sessionToken);
      if (!session) return;
      const parsed = session.launchContext;
      if (parsed.sourceType !== 'post' && parsed.sourceType !== 'thread') return;

      processedWriterPrefillRef.current = sessionToken;
      attachmentSessionTokenRef.current = sessionToken;
      const assetType = normalizeWriterCreatorAssetType(parsed.compositionIntent?.assetType ?? router.query.asset_type);
      const attachmentMode = normalizeAttachmentMode(parsed.compositionIntent?.attachmentMode ?? router.query.attachment_mode);
      const sourceTextTransform = normalizeSourceTextTransform(
        parsed.compositionIntent?.copyPolicy?.sourceTextTransform ?? router.query.source_text_transform,
      );
      const compositionIntent: AssetCompositionIntent = parsed.compositionIntent ?? buildAssetCompositionIntent({
        assetType,
        attachmentMode,
        sourceTextTransform,
      });
      const normalizedSource: WriterCreatorSourcePayload = {
        ...parsed,
        compositionIntent,
      };
      setWriterSource(normalizedSource);
      const importedPlatform =
        (parsed.platform && config.primaryPlatforms.includes(parsed.platform) ? parsed.platform : null) ||
        (typeof router.query.platform === 'string' && config.primaryPlatforms.includes(router.query.platform) ? router.query.platform : null) ||
        config.primaryPlatforms[0] ||
        'linkedin';
      setSelectedPlatform(importedPlatform);
      // Auto-fill the overlay panel from the imported campaign/Writer content (the
      // "campaign theme") so the image opens populated, not blank. Was cleared to
      // EMPTY_OVERLAY_TEXT, which left hook / supportingText / keyInsight empty in
      // the generated image (headline alone survived via the answers fallback).
      setOverlayText(deriveOverlayFromContent(normalizedSource.title, normalizedSource.body));
      if (type === 'image') setRecommendedAttachmentMode(null);
      setAnswers((current) => ({
        ...current,
        ...buildCreatorAnswersFromWriterSource(config, type, normalizedSource),
      }));
      setBrandMode(normalizedSource.companyName || normalizedSource.brandContext ? 'brand-aware' : 'independent');
      if (normalizedSource.companyName || normalizedSource.brandContext) {
        setBrandPanelOpen(true);
        setBrandOverrides((current) => ({
          ...current,
          companyName: current.companyName || normalizedSource.companyName || '',
          audience: current.audience || normalizedSource.audience || '',
          brandTone: current.brandTone || normalizedSource.tone || '',
        }));
      }
      setSelectedSuggestionId(type === 'carousel' && normalizedSource.sourceType === 'thread' ? 'educator' : 'safe-fit');
      setRefinedSuggestion(
        type === 'carousel' && normalizedSource.sourceType === 'thread'
          ? 'Transform the imported thread before slide generation; do not map raw thread posts directly to slides.'
          : `Create a ${config.title.toLowerCase()} asset from the imported ${normalizedSource.sourceType} using the selected attachment mode.`,
      );
      setNotice(`Imported ${normalizedSource.sourceType} context into this ${config.title.toLowerCase()} flow.`);
    } catch {
      setError('Could not import the Writer context. You can still complete this Creator flow manually.');
    }
  }, [config, router.isReady, router.query.session, router.query.asset_type, router.query.attachment_mode, router.query.platform, router.query.prefill, router.query.source, router.query.source_text_transform, type]);

  // Operator feedback: navigating to a creator-content type from
  // header or content cards must NOT prefill any field. We kill the
  // localStorage draft persistence entirely — the mount effect above
  // already wipes any stored draft on every visit. With nothing
  // saved AND nothing restored, every visit starts genuinely fresh.
  //
  // The writer-prefill flow (?source=writer&prefill=token) is
  // unaffected — it uses sessionStorage with a one-time token, not
  // this draft cache.

  React.useEffect(() => {
    if (!selectedCompanyId) {
      setBrandProfile(null);
      return;
    }
    let cancelled = false;
    setIsLoadingBrandProfile(true);
    fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}&includeCompleteness=0`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const profile = data?.profile || data || null;
        const mapped = mapCreatorBrandProfile(profile as Record<string, unknown> | null);
        if (!mapped.companyName && selectedCompanyName) mapped.companyName = selectedCompanyName;
        setBrandProfile(mapped);
        setBrandOverrides((current) => ({
          companyName: current.companyName || mapped.companyName || '',
          logoUrl: current.logoUrl || mapped.logoUrl || '',
          faviconUrl: current.faviconUrl || mapped.faviconUrl || '',
          tagline: current.tagline || mapped.tagline || '',
          brandTone: current.brandTone || mapped.brandTone || '',
          brandColors: current.brandColors || (mapped.brandColors || []).join(', '),
          audience: current.audience || mapped.audience || '',
          campaign: current.campaign || mapped.campaignAssociation || '',
        }));
      })
      .catch(() => {
        if (!cancelled) setBrandProfile(selectedCompanyName ? { companyName: selectedCompanyName } : null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBrandProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, selectedCompanyName]);

  // Progress tracker driver — when isGenerating flips true, schedule
  // (a) a 2-second timer that reveals the tracker (skips it on fast
  // runs) and (b) staged advancement timers that mirror the renderer
  // pipeline. When isGenerating flips back to false (success OR
  // error), every timer is torn down and the stage resets so the
  // next run starts fresh.
  React.useEffect(() => {
    if (!isGenerating) {
      setShowProgress(false);
      setGenerationStage(0);
      return;
    }
    // Reset for a fresh run.
    setGenerationStage(0);
    setShowProgress(false);
    // Timing tuned to the renderer pipeline:
    //   stage 0 (Preparing brief)    : t=0     until t=1.2s
    //   stage 1 (Generating with AI) : t=1.2s  until t=14s   (longest step)
    //   stage 2 (Composing overlay)  : t=14s   until t=22s
    //   stage 3 (Saving asset)       : t=22s   until done
    // Generation usually completes during stage 2 or 3; if it stalls
    // we hold on the final stage rather than lying that we are done.
    const showTimer = window.setTimeout(() => setShowProgress(true), 2000);
    const stageTimers = [
      window.setTimeout(() => setGenerationStage(1), 1_200),
      window.setTimeout(() => setGenerationStage(2), 14_000),
      window.setTimeout(() => setGenerationStage(3), 22_000),
    ];
    return () => {
      window.clearTimeout(showTimer);
      stageTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [isGenerating]);

  // Fetch creator-capable connected platforms for the current company so
  // the platform picker only surfaces platforms that (a) are actually
  // connected and (b) support image / carousel / etc. content. Mirrors
  // the BOLT picker's source-of-truth.
  React.useEffect(() => {
    if (!selectedCompanyId) {
      setConnectedPlatforms([]);
      return;
    }
    let cancelled = false;
    setConnectedPlatforms(null);
    fetch(
      `/api/bolt/available-platforms?companyId=${encodeURIComponent(selectedCompanyId)}&mode=bolt-creator`,
      { credentials: 'include' },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const supported = Array.isArray(data?.supported) ? data.supported as string[] : [];
        setConnectedPlatforms(supported);
      })
      .catch(() => {
        if (!cancelled) setConnectedPlatforms([]);
      });
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  React.useEffect(() => {
    if (!selectedCompanyId || !type) {
      setSavedAssets([]);
      setSelectedAssetId(null);
      setIsLoadingAssets(false);
      return;
    }
    let cancelled = false;
    setIsLoadingAssets(true);
    // Pull saved creator assets from the canonical creator_assets store,
    // FILTERED to the current page's type. For 'image' we query
    // 'supporting_image' which the API expands to ['supporting_image',
    // 'image'] via its alias map. Previously this read from
    // /api/block-templates?content_type=blog which polluted the blog
    // templates UI — that path is gone.
    const creatorTypeForRead = type === 'image' ? 'supporting_image' : type;
    fetch(
      `/api/creator-assets?company_id=${encodeURIComponent(selectedCompanyId)}&creator_type=${encodeURIComponent(creatorTypeForRead)}&limit=8`,
      { credentials: 'include' },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.assets) ? data.assets : [];
        const mapped: SavedCreatorAsset[] = rows.map((row: Record<string, unknown>) => {
          const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
            ? row.metadata as Record<string, unknown>
            : {};
          const continuity = (meta.creator_continuity && typeof meta.creator_continuity === 'object' && !Array.isArray(meta.creator_continuity))
            ? meta.creator_continuity as SavedCreatorAsset['creator_metadata']
            : undefined;
          return {
            id: String(row.id || ''),
            name: String(row.title || 'Creator asset'),
            description: typeof meta.description === 'string' ? meta.description as string : null,
            format_type: typeof row.creatorType === 'string' ? row.creatorType as string : null,
            tags: ['creator-asset', typeof row.creatorType === 'string' ? row.creatorType as string : ''].filter(Boolean),
            usage_count: 0,
            created_at: typeof row.createdAt === 'string' ? row.createdAt as string : undefined,
            creator_metadata: continuity,
            media_files: resolveSavedAssetMedia(row),
          } as SavedCreatorAsset;
        });
        setSavedAssets(mapped);
        // PHASE 14F: after a post-generate refetch, select the newest asset so
        // the freshly generated render is shown immediately (no page reload).
        if (selectNewestAssetRef.current && mapped.length > 0) {
          const newest = [...mapped].sort(
            (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
          )[0];
          if (newest) setSelectedAssetId(newest.id);
          selectNewestAssetRef.current = false;
        }
      })
      .catch(() => {
        if (!cancelled) setSavedAssets([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, savedBlock?.id, type, assetReloadNonce]);

  React.useEffect(() => {
    if (!selectedAssetId || isLoadingAssets || savedAssets.length === 0) return;
    if (!savedAssets.some((asset) => asset.id === selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [isLoadingAssets, savedAssets, selectedAssetId]);

  const repurposePaths = React.useMemo(
    () => (type ? getRepurposePaths(type, answers.assetSubtype) : []),
    [answers.assetSubtype, type],
  );
  const brandContextLines = React.useMemo(
    () => buildBrandContextLines({
      mode: brandMode,
      presence: brandPresence,
      selections: brandSelections,
      profile: brandProfile,
      overrides: brandOverrides,
    }),
    [brandMode, brandOverrides, brandPresence, brandProfile, brandSelections],
  );
  const suggestionOptions = React.useMemo(
    () => (config
      ? buildSuggestionOptions(config, answers, {
          brandMode,
          brandPresence,
          brandProfile,
          // Only carry a target platform when the session was hydrated from
          // a writer source. Direct-route image creation stays platform-agnostic.
          targetPlatform: writerSource?.platform ?? null,
        })
      : []),
    [answers, brandMode, brandPresence, brandProfile, config, writerSource],
  );

  // Rendering Forensic Audit follow-up. The early returns for
  // `!authChecked || isLoading`, `!user`, and `!config` were here at the
  // top of the component, but several hooks below them (useMemo /
  // useEffect / useCallback at lines for availablePlatforms, the
  // platform-snap effect, overlayFieldSuggestions,
  // freeformFieldSuggestions, and buildGenerationBody) get skipped on
  // renders where the early return fires. When the auth check completes
  // or user/config loads, React sees a different hook count and throws
  // "Rendered more hooks than during the previous render."
  // ALL early returns have been relocated to just before the final JSX
  // render path (right above the `const selectedSubtype =
  // config.subtypeOptions.find(...)` access that requires non-null
  // config). All hooks above that point fire on every render.

  // USER-input brief writer: marks `topic` manually_modified so the sync engine
  // never auto-fills/repopulates it again (respects an intentional edit or clear).
  // Programmatic restores use `setAnswerSilent` instead (no manual mark).
  const setAnswer = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (id === 'topic') {
      if (value.trim()) setTopicMissing(false);
      setSyncState((s) => markManual(s, 'topic'));
    }
  };
  const setAnswerSilent = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (id === 'topic' && value.trim()) setTopicMissing(false);
  };

  // USER-input editor writer: marks the editor lead field manually_modified only
  // when the lead value actually changes (so editing/clearing it is respected,
  // while edits to other fields don't lock the lead). The engine writes via the
  // raw `setTemplateValues` so its own writes never count as manual.
  const handleEditorChange = (next: TemplateFieldValues) => {
    if (activeTemplate) {
      const prevLead = editorLeadValue(activeTemplate, templateValues);
      const nextLead = editorLeadValue(activeTemplate, next);
      if (nextLead !== prevLead) setSyncState((s) => markManual(s, 'lead'));
    }
    setTemplateValues(next);
  };

  // Canonical Brief ⇄ Editor synchronization engine. EMPTY-ONLY mirroring driven
  // by `creatorBriefEditorSync` (the single sync service). Auto-fill runs only
  // while an endpoint is not `manually_modified`; one write per pass; converges
  // (each write fills an empty target, then both sides are non-empty / locked).
  React.useEffect(() => {
    if (!activeTemplate || !config) return;
    const hasTopicField = !!config.fields?.some((f) => f.id === 'topic');
    const plan = planBriefEditorSync({
      template: activeTemplate,
      topic: answers.topic ?? '',
      values: templateValues,
      state: syncState,
      hasTopicField,
    });
    if (plan.topicWrite !== undefined) {
      setAnswers((current) => ({ ...current, topic: plan.topicWrite! }));
      if (plan.topicWrite.trim()) setTopicMissing(false);
      setSyncState(plan.nextState);
    } else if (plan.editorWrite) {
      setTemplateValues(plan.editorWrite);
      setSyncState(plan.nextState);
    }
  }, [answers.topic, templateValues, activeTemplate, config, syncState]);

  // Surface the empty required topic field: highlight it, scroll it into view,
  // and focus its input so the operator immediately sees what's missing.
  const flagMissingTopic = () => {
    setTopicMissing(true);
    const node = topicFieldRef.current;
    if (!node) return;
    try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { node.scrollIntoView(); }
    const input = node.querySelector('input, textarea') as HTMLElement | null;
    if (input) window.setTimeout(() => { try { input.focus(); } catch { /* noop */ } }, 300);
  };

  const selectedAsset = savedAssets.find((asset) => asset.id === selectedAssetId) || null;
  const hasBrandProfile = Boolean(
    brandProfile?.companyName ||
    brandProfile?.logoUrl ||
    brandProfile?.faviconUrl ||
    brandProfile?.tagline ||
    brandProfile?.brandTone ||
    (brandProfile?.brandColors || []).length > 0 ||
    brandProfile?.audience,
  );
  const selectedSuggestion =
    suggestionOptions.find((option) => option.id === selectedSuggestionId) || suggestionOptions[0];
  const generationModeLabel =
    brandMode === 'brand-aware' ? 'brand-aware company context' : 'independent creative context';

  const buildCurrentContext = (primaryPlatform?: string | null): CreatorFlowContext => buildCreatorFlowContext({
    topic: answers.topic || config.title,
    audience: answers.audience,
    platform: primaryPlatform || selectedPlatform || config.primaryPlatforms[0],
    campaign: '',
    tone: answers.styleDirection || answers.objective,
    CTA: answers.cta,
    contentType: config.contentType,
    creatorType: type || config.title,
    sourceAssetId: selectedAsset?.id,
    sourceAssetName: selectedAsset?.name,
  });

  const setBrandSelection = (id: keyof BrandContextSelections, value: boolean) => {
    setBrandSelections((current) => ({ ...current, [id]: value }));
  };

  const setBrandOverride = (id: string, value: string) => {
    setBrandOverrides((current) => ({ ...current, [id]: value }));
  };

  const setOverlayField = (id: keyof WriterOverlayText, value: string) => {
    const limits: Record<keyof WriterOverlayText, number> = {
      hook: 76,
      headline: 84,
      keyInsight: 132,
      cta: 42,
      supportingText: 96,
    };
    setOverlayText((current) => ({ ...current, [id]: value.slice(0, limits[id]) }));
  };

  // Derive overlay-field suggestion chips from the actual Writer post
  // body (not generic templates or the topic/keyMessage descriptors).
  // We sentence-split the imported text and rank candidates per field:
  //   - hook       → shortest first sentence / strongest opener (≤76)
  //   - headline   → short declarative claims (≤84)
  //   - supporting → proof/benefit sentences (≤96)
  //   - keyInsight → longest substantive claim (≤132)
  // Intersection of the workflow's primary platforms and the company's
  // connected creator-capable platforms. Empty array when the company
  // has no creator-capable connections; null upstream means "loading".
  const availablePlatforms = React.useMemo(() => {
    if (!config) return [] as string[];
    if (!connectedPlatforms) return [] as string[]; // loading → render nothing yet
    const connectedSet = new Set(connectedPlatforms.map((p) => String(p).toLowerCase()));
    return config.primaryPlatforms.filter((p) => connectedSet.has(p.toLowerCase()));
  }, [config, connectedPlatforms]);

  // If the currently-selected platform is no longer in the connected/
  // capable set (e.g., the default 'linkedin' fired before the fetch
  // resolved, and LinkedIn isn't connected), snap to the first
  // available platform. Skip on the writer route — the writer source's
  // platform is authoritative there.
  React.useEffect(() => {
    if (writerSource) return;
    if (availablePlatforms.length === 0) return;
    if (!availablePlatforms.includes(selectedPlatform)) {
      setSelectedPlatform(availablePlatforms[0]);
    }
  }, [availablePlatforms, selectedPlatform, writerSource]);

  // Auto-scroll the generated-output panel into view the moment a
  // generation succeeds. On narrow viewports the right column stacks
  // below the form, so without this the operator stares at the form
  // wondering where their carousel went.
  React.useEffect(() => {
    if (!result) {
      hadResultRef.current = false;
      return;
    }
    if (hadResultRef.current) return;
    hadResultRef.current = true;
    const node = resultPanelRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        node.scrollIntoView();
      }
    }
  }, [result]);

  // Carousel / infographic / pdf / slider rendering is durable-queued
  // (canonical creatorAssetRegistry: `render_strategy: 'queue'`). The
  // generate API returns immediately with
  //   media_bundle.metadata = { render_async: true, render_job: {...} }
  // and NO `files`. Without polling, the operator sees slide text but
  // never the actual slide PNGs.
  //
  // This effect watches `result` for the async-render marker, polls the
  // render-job endpoint every 2s, and merges the rendered bundle
  // (url + files) into the result state once the job completes. Stops
  // polling on completion / failure / cancellation / unmount.
  React.useEffect(() => {
    if (!result) {
      setRenderJobProgress(null);
      return;
    }
    const bundleMeta = (result.output?.asset_payload?.media_bundle?.metadata ?? {}) as Record<string, unknown>;
    const isAsync = bundleMeta.render_async === true;
    if (!isAsync) {
      setRenderJobProgress(null);
      return;
    }
    const filesAlready = Array.isArray(result.output?.asset_payload?.media_bundle?.files)
      && (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean).length > 0;
    if (filesAlready) {
      setRenderJobProgress(null);
      return;
    }
    const renderJob = (bundleMeta.render_job ?? null) as { id?: string | number } | null;
    const jobId = renderJob && typeof renderJob === 'object'
      ? String((renderJob as { id?: unknown }).id ?? '').trim()
      : '';
    if (!jobId) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // ~3 minutes at 2s/poll
    const POLL_MS = 2000;
    const startedAt = Date.now();
    let firstActiveAt: number | null = null;
    // Seed the progress state so the banner shows 0% immediately rather
    // than waiting for the first poll response.
    setRenderJobProgress({ percent: 0, status: 'queued', attempts: 0, queuedSeconds: 0 });

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const response = await fetch(`/api/command-center/creator-content/render-job/${encodeURIComponent(jobId)}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (response.ok) {
          const payload = await response.json().catch(() => null) as {
            success?: boolean;
            render_job?: {
              status?: string;
              progress?: number;
              attemptsMade?: number;
              result?: { url?: string; files?: string[]; metadata?: Record<string, unknown> };
            };
          } | null;
          const status = payload?.render_job?.status;
          const rawPercent = Number(payload?.render_job?.progress ?? 0);
          const safePercent = Number.isFinite(rawPercent)
            ? Math.max(0, Math.min(100, Math.round(rawPercent)))
            : 0;
          const attemptsMade = Number(payload?.render_job?.attemptsMade ?? 0);
          if (!cancelled) {
            const normalizedStatus = ((): typeof renderJobProgress extends null ? never : NonNullable<typeof renderJobProgress>['status'] => {
              switch (status) {
                case 'completed': return 'completed';
                case 'active': return 'active';
                case 'failed': return 'failed';
                case 'cancelled': return 'cancelled';
                case 'dead_letter': return 'dead_letter';
                case 'waiting': return 'waiting';
                default: return 'queued';
              }
            })();
            // Track when the worker first picked up the job so we can
            // distinguish "queued (worker may be down)" from "active
            // (worker rendering but slow)" purely from elapsed time.
            if (normalizedStatus === 'active' && firstActiveAt === null) {
              firstActiveAt = Date.now();
            }
            const queuedSeconds = normalizedStatus === 'queued' || normalizedStatus === 'waiting'
              ? Math.round((Date.now() - startedAt) / 1000)
              : 0;
            setRenderJobProgress({
              percent: status === 'completed' ? 100 : safePercent,
              status: normalizedStatus,
              attempts: attemptsMade,
              queuedSeconds,
            });
          }
          if (status === 'completed' && payload?.render_job?.result) {
            const renderedBundle = payload.render_job.result;
            const renderedFiles = Array.isArray(renderedBundle.files)
              ? renderedBundle.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
              : [];
            const renderedUrl = typeof renderedBundle.url === 'string' ? renderedBundle.url : '';
            if (renderedFiles.length > 0 || renderedUrl) {
              setResult((current) => {
                if (!current) return current;
                const payload2 = current.output.asset_payload;
                const existingBundle = payload2.media_bundle ?? {};
                const mergedBundle = {
                  ...existingBundle,
                  ...(renderedUrl ? { url: renderedUrl } : {}),
                  ...(renderedFiles.length > 0 ? { files: renderedFiles } : {}),
                  metadata: {
                    ...(existingBundle.metadata ?? {}),
                    ...(renderedBundle.metadata ?? {}),
                    render_async: false,
                    render_completed_at: new Date().toISOString(),
                  },
                };
                return {
                  ...current,
                  output: {
                    ...current.output,
                    asset_payload: {
                      ...payload2,
                      media_bundle: mergedBundle,
                    },
                  },
                };
              });
            }
            return; // stop polling
          }
          if (status === 'failed' || status === 'cancelled' || status === 'dead_letter') {
            setError(`Slide rendering ${status}. The structured copy below is preserved; click Generate to retry.`);
            return; // stop polling
          }
        }
      } catch {
        // Best-effort — keep polling until MAX_ATTEMPTS.
      }
      if (attempts >= MAX_ATTEMPTS) return;
      window.setTimeout(() => { void poll(); }, POLL_MS);
    };

    window.setTimeout(() => { void poll(); }, POLL_MS);

    return () => { cancelled = true; };
  }, [result]);

  // Each source sentence is allocated to AT MOST one field (priority
  // order: hook → headline → supporting → keyInsight) so the four chip
  // lists never repeat the same underlying sentence. Falls back to the
  // title only when no body sentence fit a field.
  // Overlay-field chips — pure builder in lib/creator-content/creatorTypeWorkflow;
  // same inputs + dependency array as before, so recompute behavior is unchanged.

  return {
    actionInProgress,
    activeTemplate,
    aiBusyKey,
    answers,
    assetReloadNonce,
    attachmentSessionTokenRef,
    authChecked,
    availablePlatforms,
    brandContextLines,
    brandMode,
    brandOverrides,
    brandPanelOpen,
    brandPresence,
    brandProfile,
    brandSelections,
    buildCurrentContext,
    config,
    connectedPlatforms,
    error,
    flagMissingTopic,
    generatedSnapshot,
    generationInFlightRef,
    generationModeLabel,
    generationStage,
    hadResultRef,
    handleEditorChange,
    handleOverlayAi,
    handleTemplateAiAssist,
    hasBrandProfile,
    inlineRenderError,
    inlineRenderInFlight,
    isGenerating,
    isLoading,
    isLoadingAssets,
    isLoadingBrandProfile,
    isSavingBlock,
    notice,
    overlayText,
    processedWriterPrefillRef,
    recommendedAttachmentMode,
    refinePrompt,
    refinedSuggestion,
    regenCount,
    regenSeenResultRef,
    renderJobProgress,
    repurposePaths,
    result,
    resultPanelRef,
    router,
    saveInFlightRef,
    savedAssets,
    savedBlock,
    selectNewestAssetRef,
    selectedAsset,
    selectedAssetId,
    selectedCompanyId,
    selectedCompanyName,
    selectedPlatform,
    selectedSuggestion,
    selectedSuggestionId,
    setActionInProgress,
    setActiveTemplate,
    setAiBusyKey,
    setAnswer,
    setAnswerSilent,
    setAnswers,
    setAssetReloadNonce,
    setBrandMode,
    setBrandOverride,
    setBrandOverrides,
    setBrandPanelOpen,
    setBrandPresence,
    setBrandProfile,
    setBrandSelection,
    setBrandSelections,
    setConnectedPlatforms,
    setError,
    setGeneratedSnapshot,
    setGenerationStage,
    setInlineRenderError,
    setInlineRenderInFlight,
    setIsGenerating,
    setIsLoadingAssets,
    setIsLoadingBrandProfile,
    setIsSavingBlock,
    setNotice,
    setOverlayField,
    setOverlayText,
    setRecommendedAttachmentMode,
    setRefinePrompt,
    setRefinedSuggestion,
    setRegenCount,
    setRenderJobProgress,
    setResult,
    setSavedAssets,
    setSavedBlock,
    setSelectedAssetId,
    setSelectedPlatform,
    setSelectedSuggestionId,
    setShowProgress,
    setStandaloneAttachmentMode,
    setSyncState,
    setTemplateValues,
    setTopicMissing,
    setVariantFanOutInFlight,
    setVariantFanOutSummary,
    setVariantPin,
    setVariantPlan,
    setWriterSource,
    showProgress,
    standaloneAttachmentMode,
    suggestionOptions,
    syncState,
    templateValues,
    topicFieldRef,
    topicMissing,
    type,
    user,
    variantFanOutInFlight,
    variantFanOutSummary,
    variantPin,
    variantPlan,
    writerAssetType,
    writerAttachmentMode,
    writerCompositionIntent,
    writerEmbeddedCopy,
    writerSource,
    writerSupportingVisual,
  };
}
