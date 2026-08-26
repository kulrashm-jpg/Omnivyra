/**
 * useCreatorWorkflowState — every useState/useRef + writer-derived flags of the creator
 * type-workflow page, extracted VERBATIM. First link of the s → l → a hook chain.
 */
import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../CompanyContext';
import { type WriterOverlayText, type WriterCreatorSourcePayload } from '../../../lib/content/writerCreatorAssetLaunch';
import type { AttachmentMode, WriterCreatorAssetType } from '../../../lib/content/writerCreatorAttachmentContracts';
import type { VariantExecutionResult, VariantFamily } from '../../variant-experience/useVariantApi';
import { freshSyncState, type BriefEditorSyncState } from '../../../lib/content/creatorBriefEditorSync';
import type { GuidedCreativeChoices } from '../../../lib/content/guidedCreativeDirection';
import { EMPTY_GUIDED_CHOICES, sanitizeGuidedChoices } from '../../../lib/content/guidedCreativeDirection';
import { readGuidedChoices, GUIDED_CHOICES_SESSION_KEY } from '../../../lib/content/guidedCreativeSession';
import { getTemplateById, familyForCreatorType, creatorIngestPrefillKey, type CreatorTemplate } from '../../../lib/creator-templates';
import { type TemplateFieldValues, initTemplateValues } from '../../../lib/creator-templates/values';
import {
  type BrandContextSelections, type BrandPresence, type CreatorBrandMode, type CreatorBrandProfile,
  type CreatorResult, type CreatorTypeId, type SavedBlockReference, type SavedCreatorAsset,
  DEFAULT_BRAND_SELECTIONS, EMPTY_OVERLAY_TEXT, WORKFLOW_CONFIG,
} from '../../../lib/creator-content/creatorTypeWorkflow';

export function useCreatorWorkflowState() {
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
  /*
   * The user's creative answers, restored from the guided workspace.
   *
   * Held next to the template rather than inside it: the template is a design
   * the company published, and these are one person's choices about one draft.
   */
  const [guidedChoices, setGuidedChoices] = React.useState<GuidedCreativeChoices>(EMPTY_GUIDED_CHOICES);
  React.useEffect(() => {
    if (!router.isReady || router.query.from !== 'workspace' || typeof window === 'undefined') return;
    const family = familyForCreatorType(type);
    if (!family) return;
    try {
      const restored = readGuidedChoices(window.sessionStorage.getItem(GUIDED_CHOICES_SESSION_KEY));
      // Sanitised against THIS family: a look chosen for an image is dropped
      // rather than forced onto an infographic the renderer cannot style.
      if (restored) setGuidedChoices(sanitizeGuidedChoices(restored, family));
    } catch { /* unreadable storage → AI decides, exactly as before */ }
  }, [router.isReady, router.query.from, type]);
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
  return {
    actionInProgress, activeTemplate, aiBusyKey, answers, assetReloadNonce, attachmentSessionTokenRef,
    authChecked, brandMode, brandOverrides, brandPanelOpen, brandPresence, brandProfile, brandSelections,
    config, connectedPlatforms, error, generatedSnapshot, generationInFlightRef, generationStage, hadResultRef,
    inlineRenderError, inlineRenderInFlight, isGenerating, isLoading, isLoadingAssets, isLoadingBrandProfile,
    isSavingBlock, notice, overlayText, processedWriterPrefillRef, recommendedAttachmentMode, refinePrompt,
    refinedSuggestion, regenCount, regenSeenResultRef, renderJobProgress, result, resultPanelRef, router,
    saveInFlightRef, savedAssets, savedBlock, selectNewestAssetRef, selectedAssetId, selectedCompanyId,
    guidedChoices, setGuidedChoices,
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
  };
}
