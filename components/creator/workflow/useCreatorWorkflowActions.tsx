/**
 * useCreatorWorkflowActions — the page's user-action handlers (generate, inline render,
 * schedule/publish, save-as-block/blog, repurpose, download brief, per-field + overlay AI
 * assist), extracted VERBATIM. Consumes state + lifecycle via inferred contracts.
 */
import React from 'react';
import { launchSocialPostingFromContent } from '../../../lib/content/socialPosting';
import { launchBlogFromCreator } from '../../../lib/content/creatorContentBridge';
import { serializeCreatorFlowContext } from '../../../lib/content/creatorFlowContext';
import { appendCreatorVisualReviewCandidate } from '../../../lib/content/creatorVisualReview';
import { type CreatorAssetLaunchType, type WriterOverlayText } from '../../../lib/content/writerCreatorAssetLaunch';
import { attachAssetToSession } from '../../../lib/content/creatorAttachmentSession';
import { generateCreatorAssetId } from '../../../lib/content/creatorAssetIdFactory';
import {
  normalizeWriterCreatorAssetType, validateAttachmentPayload, type AttachmentMode,
} from '../../../lib/content/writerCreatorAttachmentContracts';
import type { VariantFamily } from '../../variant-experience/useVariantApi';
import { resolvePurposeStrategy, fitSlideArcToCount } from '../../../backend/services/creator/purposeStrategyRegistry';
import type { TemplateAiAssistContext, TemplateAiAssistTarget } from '../TemplateFieldsPanel';
import { applyTemplateFieldUpdates } from '../../../lib/creator-templates/values';
import {
  type CreatorResult, type RepurposePath, type SavedCreatorAsset,
  CREATOR_GENERATION_TIMEOUT_MS, OVERLAY_FIELD_LABELS,
  buildBlockReference, buildCreatorGenerationBody, getMediaPreviewMetadata,
  hasUsableCreatorOutput, isSocialCreativeType, summarizeMediaUrls,
} from '../../../lib/creator-content/creatorTypeWorkflow';
import { useCreatorWorkflowState } from './useCreatorWorkflowState';
import { useCreatorWorkflowLifecycle } from './useCreatorWorkflowLifecycle';

export function useCreatorWorkflowActions(
  s: ReturnType<typeof useCreatorWorkflowState>,
  l: ReturnType<typeof useCreatorWorkflowLifecycle>,
) {
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
  const {
    availablePlatforms, brandContextLines, buildCurrentContext, flagMissingTopic, generationModeLabel,
    handleEditorChange, hasBrandProfile, repurposePaths, selectedAsset, selectedSuggestion, setAnswer,
    setAnswerSilent, setBrandOverride, setBrandSelection, setOverlayField, suggestionOptions
  } = l;
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

  // ── Auto-fill / de-duplicate the draft on create ─────────────────────────
  // Two problems this fixes, once per template, only when we have something to
  // write from (the operator's topic, or the Writer post / campaign strategic
  // card that flows in as source_content):
  //   1. A carousel/infographic editor LANDS with every repeated slide/section
  //      row empty, so required "Slide title" fields immediately error. We fill
  //      the EMPTY fields of ENTIRELY-empty rows (authored copy untouched).
  //   2. A flat image draft can land with a SUPPORTING field (e.g. subheadline)
  //      seeded identical to the lead (headline). A supporting line must ENHANCE
  //      the headline, never copy it — so we regenerate any non-lead field that
  //      duplicates the lead, plus any empty REQUIRED flat field. field-assist
  //      is sibling-aware (it's told not to duplicate the other fields), so the
  //      regenerated value is distinct.
  // The user can still edit or regenerate any field afterwards.
  const autoFilledTemplateRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!activeTemplate) return;
    if (autoFilledTemplateRef.current === activeTemplate.id) return; // once per template
    if (aiBusyKey) return;                                    // an AI op is already running
    // Need real context — never auto-write generic copy from nothing.
    const hasContext =
      String(answers.topic || '').trim().length > 0 || !!String(writerSource?.body || '').trim();
    if (!hasContext) return;

    const fd = activeTemplate.formDefinition;
    const targets: TemplateAiAssistTarget[] = [];

    // (1) Carousel slides / infographic sections — fill empty fields of empty rows.
    const repeat = fd.slides
      ? { scope: 'slide' as const, fields: fd.slides.fields, rows: templateValues.slides ?? [] }
      : fd.sections
        ? { scope: 'section' as const, fields: fd.sections.fields, rows: templateValues.sections ?? [] }
        : null;
    if (repeat) {
      repeat.rows.forEach((row, index) => {
        const rowEmpty = repeat.fields.every((f) => !String(row?.[f.key] || '').trim());
        if (!rowEmpty) return;
        for (const f of repeat.fields) {
          if (!f.aiAssist?.generate) continue;
          targets.push({ scope: repeat.scope, fieldKey: f.key, index, currentValue: '' });
        }
      });
    }

    // (2) Flat fields — regenerate a supporting field that DUPLICATES the lead,
    //     and fill any empty REQUIRED flat field.
    const flatFields = fd.fields ?? [];
    if (flatFields.length > 0) {
      const leadKey = flatFields.find((f) => ['headline', 'title', 'quote'].includes(f.key))?.key
        ?? flatFields[0]?.key ?? null;
      const leadVal = leadKey ? String(templateValues.fields?.[leadKey] ?? '').trim() : '';
      for (const f of flatFields) {
        if (!f.aiAssist?.generate) continue;
        const val = String(templateValues.fields?.[f.key] ?? '').trim();
        const duplicatesLead = f.key !== leadKey && !!leadVal && val.toLowerCase() === leadVal.toLowerCase();
        const emptyRequired = f.required && !val;
        if (duplicatesLead || emptyRequired) {
          targets.push({ scope: 'flat', fieldKey: f.key, currentValue: val });
        }
      }
    }

    if (targets.length === 0) return;                        // nothing to fill/fix
    autoFilledTemplateRef.current = activeTemplate.id;       // mark BEFORE firing (block re-entry)
    void handleTemplateAiAssist({
      template: activeTemplate,
      action: 'generate',
      busyKey: `batch:${repeat ? repeat.scope : 'flat'}:auto-fill`,
      label: repeat ? `Generating ${repeat.scope === 'slide' ? 'slides' : 'sections'}…` : 'Refining copy…',
      targets,
    });
  }, [activeTemplate, templateValues.slides, templateValues.sections, templateValues.fields, answers.topic, writerSource?.body, aiBusyKey, handleTemplateAiAssist]);

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
  const handleUseExistingAsset = (asset: SavedCreatorAsset) => {
    if (isGenerating || actionInProgress) return;
    setSelectedAssetId(asset.id);
    setAnswer('refinement', [
      answers.refinement,
      `Reuse existing creator asset "${asset.name}" as the starting context.`,
    ].filter(Boolean).join('\n'));
    if (!String(answers.topic || '').trim()) {
      // Programmatic restore (reuse-asset) — not a user edit; never mark manual.
      setAnswerSilent('topic', asset.name.replace(/\s+Asset$/i, ''));
    }

    // Final phase — continuity bundle restore. Resolution order:
    //   1. `asset.creator_metadata`  — surfaced by the API from the
    //      typed `creator_continuity` block (canonical).
    //   2. `asset.metadata`          — legacy attached-asset path.
    //   3. `asset.last_metadata`     — older legacy path.
    // Any field that is missing / mistyped is silently skipped so legacy
    // assets fail gracefully (no resets, no undefined writes, no leakage).
    const canonical = asset.creator_metadata && typeof asset.creator_metadata === 'object'
      ? asset.creator_metadata as Record<string, unknown>
      : null;
    const legacyA = (asset as unknown as { metadata?: Record<string, unknown> }).metadata ?? null;
    const legacyB = (asset as unknown as { last_metadata?: Record<string, unknown> }).last_metadata ?? null;
    const blob: Record<string, unknown> | null = canonical
      ?? (legacyA && typeof legacyA === 'object' ? legacyA : null)
      ?? (legacyB && typeof legacyB === 'object' ? legacyB : null);

    // Creator-type guard. If the saved asset's `asset_type` is recorded
    // and disagrees with the current Creator type (e.g. loading an
    // 'image' asset into a 'carousel' flow), we still copy compatible
    // fields (topic, refinement) but DO NOT restore type-specific state
    // (overlay text, attachment mode, subtype, etc.). This prevents cross-
    // type leakage that would corrupt the current flow.
    const savedAssetType = blob && typeof blob.asset_type === 'string' ? blob.asset_type : null;
    const typeMatch = !savedAssetType || savedAssetType === type;

    // Image-mode restore — only meaningful when current type is 'image'.
    if (type === 'image' && blob && typeMatch) {
      const persistedMode = blob.attachment_mode;
      if (persistedMode === 'embedded_copy' || persistedMode === 'supporting_visual') {
        setStandaloneAttachmentMode(persistedMode as AttachmentMode);
      }
    }

    // Overlay-text restore — supported by image (text_embedded), banner,
    // infographic. Snake/camel keys both accepted for compat with older
    // saves; non-strings silently skipped.
    if (typeMatch && blob && blob.overlay_text && typeof blob.overlay_text === 'object') {
      const ot = blob.overlay_text as Record<string, unknown>;
      setOverlayText({
        hook:           typeof ot.hook === 'string' ? ot.hook : '',
        headline:       typeof ot.headline === 'string' ? ot.headline : '',
        keyInsight:     typeof ot.keyInsight === 'string' ? ot.keyInsight : (typeof ot.key_insight === 'string' ? ot.key_insight : ''),
        cta:            typeof ot.cta === 'string' ? ot.cta : '',
        supportingText: typeof ot.supportingText === 'string' ? ot.supportingText : (typeof ot.supporting_text === 'string' ? ot.supporting_text : ''),
      });
    }

    // Subtype restore — guarded against missing/non-string values.
    if (typeMatch && blob && typeof blob.subtype === 'string' && blob.subtype.trim()) {
      setAnswer('subtype', blob.subtype);
    }

    // Brand-mode restore — accepts only the two canonical values; opens
    // the brand panel on 'brand-aware' so the user sees the restored
    // brand context.
    if (typeMatch && blob && typeof blob.brand_mode === 'string') {
      const persistedBrandMode = blob.brand_mode === 'brand-aware' ? 'brand-aware' : 'independent';
      setBrandMode(persistedBrandMode);
      if (persistedBrandMode === 'brand-aware') setBrandPanelOpen(true);
    }

    // Brand-presence restore — only valid when brand_mode is brand-aware.
    if (typeMatch && blob && typeof blob.brand_presence === 'string') {
      const presence = blob.brand_presence;
      if (presence === 'minimal' || presence === 'balanced' || presence === 'strong') {
        setBrandPresence(presence);
      }
    }

    // Platform restore — gated on the current config's primaryPlatforms
    // so we never set a platform the current Creator type cannot target.
    // Preserves platform continuity per Part 5: restored assets do NOT
    // re-expand unrelated platforms; the chip selection stays valid.
    if (typeMatch && blob && typeof blob.platform === 'string' && config?.primaryPlatforms.includes(blob.platform)) {
      setSelectedPlatform(blob.platform);
    }

    if (savedAssetType && savedAssetType !== type) {
      setNotice(`Using "${asset.name}" as context (originally a ${savedAssetType} asset; type-specific state was not restored to avoid leakage into the current ${type} flow).`);
    } else {
      setNotice(`Using existing asset "${asset.name}" as context for this ${config.title.toLowerCase()} flow.`);
    }

    // Structured event — emits one log line per restore so production
    // dashboards can pivot on restore_status (full / partial / legacy /
    // type-mismatch). Aggregates with the server-side `creator_event`
    // stream via the shared shape. Detail now includes the discriminators
    // (attachment mode, creator_type, subtype, platform) PLUS an explicit
    // `restoreFlavor` so 'modern' (typed creator_continuity block) is
    // distinguishable from 'legacy_backfill' (synthesized from
    // description/tags by the server) and 'legacy_metadata' (older
    // attached-asset path).
    const restoreStatus = blob === null
      ? (canonical === null && legacyA === null && legacyB === null ? 'legacy_no_metadata' : 'restore_skipped')
      : (savedAssetType && savedAssetType !== type ? 'partial_type_mismatch' : 'full');
    const synthesizedFromLegacy = canonical
      && typeof (canonical as Record<string, unknown>).synthesized_from_legacy === 'boolean'
      && (canonical as Record<string, unknown>).synthesized_from_legacy === true;
    const restoreFlavor = canonical
      ? (synthesizedFromLegacy ? 'legacy_backfill' : 'modern')
      : (legacyA ? 'legacy_metadata' : (legacyB ? 'legacy_last_metadata' : 'none'));
    try {
      console.info(JSON.stringify({
        event:        'creator_event',
        stage:        'restore',
        status:       restoreStatus === 'full' ? 'ok' : 'fallback',
        restoreStatus,
        restoreFlavor,
        creatorType:  type,
        assetType:    savedAssetType ?? null,
        attachmentMode: blob && typeof blob.attachment_mode === 'string' ? blob.attachment_mode : null,
        subtype:      blob && typeof blob.subtype === 'string' ? blob.subtype : null,
        platform:     blob && typeof blob.platform === 'string' ? blob.platform : null,
        usedSource:   canonical ? 'creator_metadata' : (legacyA ? 'legacy_metadata' : (legacyB ? 'legacy_last_metadata' : 'none')),
      }));
    } catch {
      // Structured logging is best-effort — never blocks the restore.
    }
  };

  const handleRefineSuggestion = () => {
    const note = String(refinePrompt || '').trim();
    if (!note) {
      setError('Add a short refinement note so AI knows what to push further.');
      return;
    }

    setError(null);
    const refined = `${selectedSuggestion.summary} Refine it further by making it ${note}.`;
    setRefinedSuggestion(refined);
    setNotice('AI direction refined. Generate when this feels right.');
  };

  // Generation-body builder (P1-1 fix). Constructs the canonical
  // request payload from current form state so fan-out can fire on
  // first click without requiring a prior baseline Generate.
  //
  // Pass `variantPinOverride` to override the operator's `variantPin`
  // — fan-out passes `null` because the runner adds variant_family
  // per decision; the single-variant path passes `variantPin` so the
  // operator's mode pick rides on the request.
  //
  // Returns null when the form is not ready (missing topic) — fan-out
  // callers receive null and short-circuit; handleGenerate sets the
  // error directly.
  // Shared payload builder (P1-1) — pure builder in lib/creator-content/creatorTypeWorkflow;
  // baseline Generate and variant fan-out both use it, so fan-out works on first click.
  const buildGenerationBody = React.useCallback((variantPinOverride: VariantFamily | null): Record<string, unknown> | null =>
    buildCreatorGenerationBody({
      type, config, answers, selectedAsset, selectedSuggestion, refinedSuggestion, refinePrompt,
      writerSource, writerSupportingVisual, writerEmbeddedCopy, writerCompositionIntent,
      writerAssetType, writerAttachmentMode, standaloneAttachmentMode,
      overlayText, brandMode, brandPresence, brandSelections, brandProfile, brandOverrides,
      brandContextLines, selectedPlatform, selectedCompanyId,
      activeTemplate, templateValues,
      lightweightContext: buildCurrentContext(selectedPlatform),
      blueprintId: typeof router.query.blueprint === 'string' && router.query.blueprint ? router.query.blueprint : null,
      variantPinOverride,
    }),
  [
    type, config, answers, selectedAsset, selectedSuggestion, refinedSuggestion, refinePrompt,
    writerSource, writerSupportingVisual, writerEmbeddedCopy, writerCompositionIntent,
    writerAssetType, writerAttachmentMode, standaloneAttachmentMode,
    overlayText, brandMode, brandPresence, brandSelections, brandProfile, brandOverrides,
    brandContextLines, selectedPlatform, selectedCompanyId,
    activeTemplate, templateValues, router.query.blueprint,
  ]);

  const handleGenerate = async () => {
    if (generationInFlightRef.current || isGenerating) return;
    if (!String(answers.topic || '').trim()) {
      setError('Please answer the main topic question first.');
      flagMissingTopic();
      return;
    }

    generationInFlightRef.current = true;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    setSavedBlock(null);
    setResult(null);

    // Local computations needed by the validation gate AND by the
    // downstream metadata echo (where the saved asset's record
    // mirrors the operator's intent). The full request body is
    // constructed by buildGenerationBody (P1-1).
    const writerCopyPolicy = writerCompositionIntent?.copyPolicy ?? null;
    const standaloneEmbeddedCopy = standaloneAttachmentMode === 'embedded_copy';
    const overlayAllowed = !writerSource || writerEmbeddedCopy;
    const overlayPayload = isSocialCreativeType(type) && overlayAllowed && (!writerSource ? !(type === 'image' && !standaloneEmbeddedCopy) : writerEmbeddedCopy)
      ? {
          hook: String(overlayText.hook || '').trim(),
          headline: String(overlayText.headline || answers.headline || answers.topic || '').trim(),
          keyInsight: String(overlayText.keyInsight || '').trim(),
          cta: (writerCopyPolicy?.allowCTA || (!writerSource && standaloneEmbeddedCopy)) ? String(overlayText.cta || answers.cta || '').trim() : '',
          supportingText: String(overlayText.supportingText || '').trim(),
        }
      : null;
    if (writerSource && writerCompositionIntent) {
      const validation = validateAttachmentPayload({
        attachmentMode: writerCompositionIntent.attachmentMode,
        assetType: writerCompositionIntent.assetType,
        copyPolicy: writerCompositionIntent.copyPolicy,
        overlayText: overlayPayload,
        cta: overlayPayload?.cta,
        sourceType: writerSource.sourceType,
      });
      if (!validation.ok) {
        generationInFlightRef.current = false;
        setIsGenerating(false);
        setError(validation.errors.join('. '));
        return;
      }
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CREATOR_GENERATION_TIMEOUT_MS);

    try {
      // Build via the shared payload builder (P1-1 fix). The same
      // helper feeds the variant fan-out path so fan-out works on
      // first click without needing a prior baseline Generate.
      const generationBody = buildGenerationBody(variantPin);
      if (!generationBody) {
        generationInFlightRef.current = false;
        setIsGenerating(false);
        setError('Please answer the main topic question first.');
        flagMissingTopic();
        return;
      }
      const response = await fetch('/api/command-center/creator-content/generate', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const baseMessage = data?.error || data?.message || 'Failed to generate creator content.';
        // Surface the server's actionable context (per-rule rejection
        // reasons + remediation hints) instead of the opaque top-line —
        // e.g. the writer attachment validator returns `details`/`hints`
        // explaining how to unblock the payload.
        const hintLines = Array.isArray(data?.hints) ? data.hints.filter(Boolean) : [];
        const detailLines = hintLines.length === 0 && Array.isArray(data?.details)
          ? data.details.filter(Boolean)
          : [];
        const extra = [...hintLines, ...detailLines];
        throw new Error(extra.length > 0 ? `${baseMessage} — ${extra.join(' ')}` : baseMessage);
      }
      setResult(data as CreatorResult);
      // PHASE 14F: the generate persisted a new creator_assets row server-side.
      // Refetch saved assets and select the newest so the freshly generated
      // render appears and is shown immediately — no page reload required.
      selectNewestAssetRef.current = true;
      setAssetReloadNonce((n) => n + 1);
      const generatedMediaBundle = data?.output?.asset_payload?.media_bundle || {};
      const generatedMediaUrl = typeof generatedMediaBundle.url === 'string' ? generatedMediaBundle.url : '';
      const generatedMetadata = generatedMediaBundle.metadata && typeof generatedMediaBundle.metadata === 'object'
        ? generatedMediaBundle.metadata as Record<string, unknown>
        : {};
      if (generatedMediaUrl && isSocialCreativeType(type)) {
        appendCreatorVisualReviewCandidate({
          id: `${Date.now()}-${type}-${selectedPlatform}`,
          createdAt: new Date().toISOString(),
          assetType: type,
          platform: selectedPlatform,
          title: String(answers.topic || config.title || '').trim() || `${config.title} creative`,
          mediaUrl: generatedMediaUrl,
          caption: String(data?.output?.packaging?.caption || '').trim(),
          metadata: generatedMetadata,
          overlayText: generatedMetadata.overlay_text && typeof generatedMetadata.overlay_text === 'object'
            ? generatedMetadata.overlay_text as Record<string, unknown>
            : undefined,
          score: Number((generatedMetadata.overlay_quality as { score?: unknown } | undefined)?.score ?? 0) || null,
        });
      }
      if (writerSource && type) {
        const mediaBundle = generatedMediaBundle;
        const renderedAttachmentMode = writerSource ? null : type === 'image'
          ? (generatedMetadata.attachment_mode === 'embedded_copy' || generatedMetadata.attachment_mode === 'supporting_visual'
              ? (generatedMetadata.attachment_mode as AttachmentMode)
              : standaloneAttachmentMode)
          : null;
        // Continuity bundle (Part 2). Every attached-asset record now carries
        // the full restore set:
        //   - attachmentMode (supporting_visual vs embedded_copy)
        //   - overlayText  (so reopening preserves the exact overlay copy)
        //   - subtype      (so promotional/quote/educational direction sticks)
        //   - platform     (so reopening keeps Writer-imported platform pin)
        //   - brandMode    (so brand-aware vs independent is preserved)
        //   - files        (multi-file assets — carousel slides, PDFs)
        //   - metadata     (full server response for diagnostic/remix paths)
        // Reads on `handleUseExistingAsset` + Writer chip render use these
        // fields; legacy callers see them as optional and ignore.
        const filesFromBundle = Array.isArray(mediaBundle.files)
          ? mediaBundle.files.filter((file: unknown): file is string => typeof file === 'string')
          : undefined;
        const attachmentMetadata = {
            ...generatedMetadata,
            // Echo the client-side intent so reopen restores subtype +
            // overlayText + brandMode without needing to parse them out of
            // the server response.
            subtype:    String(answers.subtype || '').trim() || undefined,
            attachment_mode: writerAttachmentMode,
            asset_composition_intent: writerCompositionIntent,
            copy_policy: writerCopyPolicy,
            source_text_transform: writerCopyPolicy?.sourceTextTransform,
            overlay_text: overlayPayload ?? undefined,
            brand_mode:     brandMode,
            brand_presence: brandMode === 'brand-aware' ? brandPresence : undefined,
            ...(!writerSource && type === 'image' ? { recommended_attachment_mode: recommendedAttachmentMode ?? undefined } : {}),
            platform: selectedPlatform,
          };
        // Canonical lifecycle — attach through the session (which owns the draft
        // target + lifecycle and delegates to the ONE durable persistence). Creator
        // never appends to writer storage directly.
        void attachAssetToSession(
          attachmentSessionTokenRef.current || (typeof router.query.session === 'string' ? router.query.session : ''),
          {
            id: generateCreatorAssetId({ kind: type }),
            creatorType: (writerAssetType ?? normalizeWriterCreatorAssetType(type)) as CreatorAssetLaunchType,
            title: `${config.title} for ${writerSource.title}`,
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined,
            files: filesFromBundle,
            previewKind: typeof mediaBundle.metadata?.preview_kind === 'string' ? mediaBundle.metadata.preview_kind : undefined,
            attachmentMode: writerAttachmentMode ?? undefined,
            compositionIntent: writerCompositionIntent ?? undefined,
            platformContext: selectedPlatform,
            renderIdentityHash: typeof generatedMetadata.renderIdentityHash === 'string'
              ? generatedMetadata.renderIdentityHash
              : typeof generatedMetadata.render_identity_hash === 'string'
                ? generatedMetadata.render_identity_hash
                : undefined,
            metadata: attachmentMetadata,
            createdAt: new Date().toISOString(),
          },
          {
            companyId: selectedCompanyId,
            sourceContent: {
              sourceType: writerSource.sourceType,
              sourceId: writerSource.sourceId,
              title: writerSource.title,
              body: writerSource.body,
              platform: writerSource.platform,
              hashtags: writerSource.hashtags,
            },
          },
        );
      }
    } catch (generationError) {
      const isAbort = generationError instanceof Error && generationError.name === 'AbortError';
      setError(
        isAbort
          ? 'Generation is taking longer than expected. Please try again in a moment.'
          : generationError instanceof Error
            ? generationError.message
            : 'Failed to generate creator content.',
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsGenerating(false);
      generationInFlightRef.current = false;
    }
  };

  const handleRenderInline = async () => {
    if (!result || inlineRenderInFlight) return;
    const assetPayload = result.output?.asset_payload as Record<string, unknown> | undefined;
    if (!assetPayload) return;
    setInlineRenderInFlight(true);
    setInlineRenderError(null);
    try {
      const response = await fetch('/api/command-center/creator-content/render-inline', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_payload: assetPayload,
          company_id: selectedCompanyId,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        rendered?: { url?: string; files?: string[]; metadata?: Record<string, unknown> };
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.success || !payload.rendered) {
        const msg = payload?.message || payload?.error || `Inline render failed (HTTP ${response.status})`;
        setInlineRenderError(msg);
        return;
      }
      const renderedFiles = Array.isArray(payload.rendered.files)
        ? payload.rendered.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
        : [];
      const renderedUrl = typeof payload.rendered.url === 'string' ? payload.rendered.url : '';
      if (renderedFiles.length === 0 && !renderedUrl) {
        setInlineRenderError('Inline render returned no images.');
        return;
      }
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
            ...(payload.rendered!.metadata ?? {}),
            render_async: false,
            render_completed_at: new Date().toISOString(),
            rendered_via: 'inline_fallback',
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
    } catch (err) {
      setInlineRenderError(err instanceof Error ? err.message : 'Inline render failed.');
    } finally {
      setInlineRenderInFlight(false);
    }
  };

  const handleOpenScheduler = (intent: 'schedule' | 'publish' = 'schedule') => {
    const socialActionLabel = config.contentType === 'thread' ? 'thread' : 'post';
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError(`Generate a usable creator output before using it as a ${socialActionLabel}.`);
      return;
    }
    setActionInProgress(intent === 'publish' ? `share-${socialActionLabel}` : `schedule-${socialActionLabel}`);
    try {
      const context = buildCurrentContext(result.primary_platform);
      const generatedMediaUrls = summarizeMediaUrls(result);
      const mediaBundle = result.output.asset_payload.media_bundle || {};
      const mediaMetadata = getMediaPreviewMetadata(result);
      const mediaTypes = generatedMediaUrls.map(() => (type === 'video' || type === 'reel' || type === 'short' ? 'video' : type === 'pdf' ? 'document' : 'image'));
      const primaryPlatform = selectedPlatform || result.primary_platform || null;
      const creatorAttachments = generatedMediaUrls.length > 0
        ? [{
            id: selectedAsset?.id || generateCreatorAssetId({ kind: type }),
            creatorType: config.contentType,
            title: String(answers.topic || config.title),
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : generatedMediaUrls[0],
            files: Array.isArray(mediaBundle.files) ? mediaBundle.files.filter(Boolean) : generatedMediaUrls,
            previewKind: typeof mediaMetadata.preview_kind === 'string' ? mediaMetadata.preview_kind : null,
            platformContext: primaryPlatform,
            metadata: mediaMetadata,
            createdAt: new Date().toISOString(),
          }]
        : [];
      launchSocialPostingFromContent({
        router,
        contentType: config.contentType as any,
        title: String(answers.topic || config.title),
        content: `${result.output.packaging.caption}\n\n${context.CTA ? `CTA: ${context.CTA}` : ''}`.trim(),
        tags: result.output.packaging.hashtags,
        excerpt: result.output.packaging.meta_description,
        sourceId: selectedAsset?.id || null,
        platform: primaryPlatform,
        mediaUrls: generatedMediaUrls,
        mediaTypes,
        creatorAttachments,
        intent,
      });
    } catch (schedulerError) {
      setError(schedulerError instanceof Error ? schedulerError.message : `Could not open this output as a ${socialActionLabel}.`);
      setActionInProgress(null);
    }
  };

  const handleSaveAsBlog = () => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before saving it as a blog.');
      return;
    }
    setActionInProgress('blog');
    try {
      launchBlogFromCreator({
        router,
        title: String(answers.topic || config.title),
        output: result.output,
        context: buildCurrentContext(result.primary_platform),
      });
    } catch (blogError) {
      setError(blogError instanceof Error ? blogError.message : 'Could not open this output as a blog draft.');
      setActionInProgress(null);
    }
  };

  const handleRepurpose = (path: RepurposePath) => {
    if (actionInProgress || !hasUsableCreatorOutput(result)) {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before repurposing it.');
      return;
    }
    if (!repurposePaths.some((entry) => entry.id === path.id)) {
      setError('That repurpose path is not available for this creator type.');
      return;
    }
    const title = String(answers.topic || config.title);
    setActionInProgress(`repurpose-${path.id}`);
    try {
      if (path.id === 'linkedin-post') {
        launchSocialPostingFromContent({
          router,
          contentType: 'post',
          title,
          content: result.output.packaging.caption,
          tags: result.output.packaging.hashtags,
          excerpt: result.output.packaging.meta_description,
          sourceId: selectedAsset?.id || null,
        });
        return;
      }
      if (path.id === 'thread') {
        launchSocialPostingFromContent({
          router,
          contentType: 'thread',
          title,
          content: result.output.packaging.caption,
          tags: result.output.packaging.hashtags,
          excerpt: result.output.packaging.meta_description,
          sourceId: selectedAsset?.id || null,
        });
        return;
      }
      launchBlogFromCreator({
        router,
        title: path.id === 'long-form-outline' ? `${title} Long-Form Outline` : title,
        output: result.output,
        context: buildCurrentContext(result.primary_platform),
      });
    } catch (repurposeError) {
      setError(repurposeError instanceof Error ? repurposeError.message : 'Could not repurpose this output.');
      setActionInProgress(null);
    }
  };

  const handleSaveAsBlock = async () => {
    if (saveInFlightRef.current || isSavingBlock) return;
    if (!hasUsableCreatorOutput(result)) {
      setError('Generate a usable creator output before saving it as an asset.');
      return;
    }
    if (!selectedCompanyId) {
      setError('Select a company before saving this creator output as an asset.');
      return;
    }
    saveInFlightRef.current = true;
    setIsSavingBlock(true);
    setError(null);
    setNotice(null);

    try {
      const rendererMetadata = ((result.output.asset_payload?.media_bundle as any)?.metadata || {}) as Record<string, any>;
      const persistedRendererMetadata = {
        tenantId: rendererMetadata.tenantId || rendererMetadata.tenant_id || null,
        companyId: rendererMetadata.companyId || rendererMetadata.company_id || selectedCompanyId,
        paletteUsed: rendererMetadata.paletteUsed || rendererMetadata.palette_used || null,
        logoSource: rendererMetadata.logoSource || rendererMetadata.logo_source || null,
        rendererVersion: rendererMetadata.rendererVersion || rendererMetadata.renderer_version || null,
        layoutVariantId: rendererMetadata.layoutVariantId || rendererMetadata.layout_variant_id || null,
        platformContext: rendererMetadata.platformContext || result.primary_platform || null,
        renderIdentityHash: rendererMetadata.renderIdentityHash || rendererMetadata.render_identity_hash || null,
        exportCapabilities: rendererMetadata.exportCapabilities || rendererMetadata.export_capabilities || null,
      };
      // Continuity bundle (final phase). Build the metadata block that the
      // API will surface as `creator_metadata` on subsequent reads. Mirrors
      // the WriterAttachedAsset bundle so "Use Existing Asset" restore is
      // a superset of attached-asset reopen. The bundle is prepended to
      // content_blocks as a typed marker that downstream renderers skip.
      const mediaBundleForSave = (result.output.asset_payload?.media_bundle as any) || {};
      const filesForSave = Array.isArray(mediaBundleForSave.files)
        ? (mediaBundleForSave.files as unknown[]).filter((f): f is string => typeof f === 'string')
        : null;
      const continuityMetadata = {
        asset_type:             type,
        attachment_mode:        writerAttachmentMode,
        asset_composition_intent: writerCompositionIntent,
        copy_policy:            writerCompositionIntent?.copyPolicy ?? null,
        source_text_transform:  writerCompositionIntent?.copyPolicy?.sourceTextTransform ?? null,
        ...(!writerSource && type === 'image' ? {
          attachment_mode: standaloneAttachmentMode,
          recommended_attachment_mode: recommendedAttachmentMode ?? null,
        } : {}),
        overlay_text:           isSocialCreativeType(type) && !writerSupportingVisual && (!writerSource ? !(type === 'image' && standaloneAttachmentMode === 'supporting_visual') : writerEmbeddedCopy)
          ? {
              hook:           overlayText.hook,
              headline:       overlayText.headline,
              keyInsight:     overlayText.keyInsight,
              // CTA is no longer captured as a dedicated overlay input —
              // the workflow's "What action should the viewer take?"
              // (answers.cta) is the single source of truth. Preserve
              // overlayText.cta if a legacy session restored a value.
              cta:            overlayText.cta || String(answers.cta || '').trim(),
              supportingText: overlayText.supportingText,
            }
          : null,
        subtype:         String(answers.subtype || '').trim() || null,
        brand_mode:      brandMode,
        brand_presence:  brandMode === 'brand-aware' ? brandPresence : null,
        platform:        selectedPlatform || result.primary_platform || null,
        files:           filesForSave,
        preview_kind:    typeof rendererMetadata.preview_kind === 'string' ? rendererMetadata.preview_kind : null,
        platformContext: persistedRendererMetadata.platformContext,
        renderIdentityHash: persistedRendererMetadata.renderIdentityHash,
        renderer_metadata:  rendererMetadata,
      };
      // SINGLE storage path: creator_assets table, categorized by
      // creator_type. The block_templates POST that used to run here
      // polluted the blog-templates UI with creator assets — that path
      // is gone. The full continuity bundle now travels inside
      // asset.metadata.creator_continuity so "Use Existing Asset"
      // restore still has everything it needs without a parallel
      // block_template row.
      const assetTitle = `${String(answers.topic || config.title).trim()} Asset`;
      const description = `Creator asset from ${config.title}. Stored for future long-form writer reuse.\n\n${serializeCreatorFlowContext(buildCurrentContext(result.primary_platform))}`;
      const mediaBundle = result.output.asset_payload?.media_bundle || {};
      const creatorTypeForSave = writerAssetType ?? (type === 'image' ? 'supporting_image' : type);

      const response = await fetch('/api/creator-assets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompanyId,
          source_type: writerSource?.sourceType,
          source_id: writerSource?.sourceId,
          source_content: writerSource ? {
            sourceType: writerSource.sourceType,
            sourceId: writerSource.sourceId,
            title: writerSource.title,
            body: writerSource.body,
            platform: writerSource.platform,
            hashtags: writerSource.hashtags,
          } : null,
          asset: {
            creatorType: creatorTypeForSave,
            title: assetTitle,
            url: typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined,
            files: Array.isArray(mediaBundle.files) ? mediaBundle.files : undefined,
            previewKind: typeof rendererMetadata.preview_kind === 'string' ? rendererMetadata.preview_kind : undefined,
            platformContext: result.primary_platform || selectedPlatform,
            renderIdentityHash: persistedRendererMetadata.renderIdentityHash,
            metadata: {
              ...rendererMetadata,
              creatorContentAssetType: type,
              description,
              creator_continuity: { ...continuityMetadata, schema_version: 1 },
              tags: [
                ...result.output.packaging.hashtags,
                'creator-asset',
                config.contentType,
                `source:${type}`,
                answers.audience ? `audience:${answers.audience}` : '',
                answers.cta ? `cta:${answers.cta}` : '',
                persistedRendererMetadata.rendererVersion ? `renderer:${persistedRendererMetadata.rendererVersion}` : '',
                persistedRendererMetadata.logoSource ? `logo:${persistedRendererMetadata.logoSource}` : '',
                persistedRendererMetadata.layoutVariantId ? `layout:${persistedRendererMetadata.layoutVariantId}` : '',
                String(answers.assetSubtype || result.output.asset_type || '').trim(),
              ].filter(Boolean),
            },
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save this creator output as a reusable asset.');
      }

      const assetId = String(data?.asset?.id || '').trim();
      const nextSavedBlock = assetId
        ? {
            id: assetId,
            reference: buildBlockReference(assetId),
            name: assetTitle,
          }
        : null;

      setSavedBlock(nextSavedBlock);
      setNotice(
        nextSavedBlock
          ? `Saved to your ${config.title.toLowerCase()} asset library. Long-form content can pull this from the asset picker.`
          : 'Saved as a reusable creator asset. Long-form content can pull it from the asset picker.',
      );
      if (nextSavedBlock) {
        setSelectedAssetId(nextSavedBlock.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save this creator output as a reusable asset.');
    } finally {
      setIsSavingBlock(false);
      saveInFlightRef.current = false;
    }
  };

  const handleDownloadBrief = async () => {
    if (actionInProgress || !hasUsableCreatorOutput(result) || typeof window === 'undefined') {
      if (!hasUsableCreatorOutput(result)) setError('Generate a usable creator output before downloading it.');
      return;
    }
    setActionInProgress('download');
    try {
      // Download the rendered image asset itself (PNG / JPG) — NOT a
      // markdown brief. Earlier this handler emitted a `.md` summary of
      // the creator output which was the wrong artifact for an image-
      // focused workflow. We fetch the primary media URL, infer the
      // extension from the URL path, and stream it through a Blob anchor
      // so cross-origin Supabase storage URLs download cleanly.
      const imageUrl = mediaUrls[0];
      if (!imageUrl) {
        setError('No image available to download yet.');
        return;
      }
      const title = String(answers.topic || config.title || 'creator-asset').trim();
      const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'creator-asset';
      let ext = 'png';
      try {
        const parsed = new URL(imageUrl, window.location.href);
        const extMatch = parsed.pathname.match(/\.(png|jpe?g|webp|gif|svg)$/i);
        if (extMatch) ext = extMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : extMatch[1].toLowerCase();
      } catch {
        // keep png fallback
      }
      const filename = `${safeTitle}.${ext}`;
      const response = await fetch(imageUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error(`fetch failed (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      setNotice(`Downloaded ${filename}.`);
    } catch {
      setError('Could not prepare the download. Please try again.');
    } finally {
      setActionInProgress(null);
    }
  };

  const mediaUrls = summarizeMediaUrls(result);
  return {
    buildGenerationBody, handleDownloadBrief, handleGenerate, handleOpenScheduler, handleOverlayAi,
    handleRefineSuggestion, handleRenderInline, handleRepurpose, handleSaveAsBlock, handleSaveAsBlog,
    handleTemplateAiAssist, handleUseExistingAsset, mediaUrls
  };
}
