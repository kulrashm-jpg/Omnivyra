/**
 * useCreatorWorkflowLifecycle — the page's effects (prefill, drafts, template resolution,
 * loaders, attachment session, variant deep-link) + platform/brand/suggestion memos and
 * small setters, extracted VERBATIM. Consumes useCreatorWorkflowState via inferred contract.
 */
import React from 'react';
import { buildCreatorFlowContext, type CreatorFlowContext } from '../../../lib/content/creatorFlowContext';
import { type WriterOverlayText, type WriterCreatorSourcePayload } from '../../../lib/content/writerCreatorAssetLaunch';
import { loadAttachmentSession } from '../../../lib/content/creatorAttachmentSession';
import { readMarketingBrief, MARKETING_BRIEF_SESSION_KEY } from '../../../lib/content/marketingBriefResolver';
import {
  buildAssetCompositionIntent, normalizeAttachmentMode, normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType, type AssetCompositionIntent, type AttachmentMode,
} from '../../../lib/content/writerCreatorAttachmentContracts';
import { decodeVariantQuery } from '../../../lib/variants/creatorStrategyMapping';
import { markManual, editorLeadValue, planBriefEditorSync } from '../../../lib/content/creatorBriefEditorSync';
import type { TemplateFieldValues } from '../../../lib/creator-templates/values';
import {
  type BrandContextSelections, type SavedCreatorAsset,
  DEFAULT_BRAND_SELECTIONS, EMPTY_OVERLAY_TEXT,
  buildBrandContextLines, buildCreatorAnswersFromWriterSource, buildDefaultAnswers,
  buildSuggestionOptions, deriveOverlayFromContent, getCreatorDraftStorageKey,
  getRepurposePaths, mapBriefToEditorAnswers, mapCreatorBrandProfile, resolveSavedAssetMedia,
} from '../../../lib/creator-content/creatorTypeWorkflow';
import { useCreatorWorkflowState } from './useCreatorWorkflowState';

export function useCreatorWorkflowLifecycle(s: ReturnType<typeof useCreatorWorkflowState>) {
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
    availablePlatforms, brandContextLines, buildCurrentContext, flagMissingTopic, generationModeLabel,
    handleEditorChange, hasBrandProfile, repurposePaths, selectedAsset, selectedSuggestion, setAnswer,
    setAnswerSilent, setBrandOverride, setBrandSelection, setOverlayField, suggestionOptions
  };
}
