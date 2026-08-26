'use client';

/**
 * CreatorFormColumn — the intake/form column (questions, template fields, overlay, brand, saved assets, generate).
 * Extracted VERBATIM from pages/command-center/creator-content/[type].tsx (page < 1000 LOC).
 * All state/handlers live on the page and arrive via CreatorWorkflowCtx.
 */
import React from 'react';
import TemplateFieldsPanel from '../TemplateFieldsPanel';
import { IMAGE_COPY_FIELD_KEYS } from '../../../lib/creator-templates/types';
import CreatorVariantExperienceSection from '../CreatorVariantExperienceSection';
import { runVariantFanOut } from '../../../lib/variants/fanOutRunner';
import { resolvePurposeStrategy } from '../../../backend/services/creator/purposeStrategyRegistry';
import type { AttachmentMode } from '../../../lib/content/writerCreatorAttachmentContracts';
import {
  BRAND_ASSET_SIZE_PRESETS,
  type BrandPresence,
  type CreatorBrandMode,
  brandAssetSizePx,
  getSavedAssetAttachmentLabel,
  getSavedAssetCreatorType,
  humanizeValue,
  isSocialCreativeType,
  normalizeBrandAssetSize,
} from '../../../lib/creator-content/creatorTypeWorkflow';
import type { CreatorWorkflowCtx } from './creatorWorkflowCtx';
import CreatorImageAssetPanel from '../CreatorImageAssetPanel';
import { useCreatorCompositionId } from '../useCreatorCompositionId';
import CreativeSummaryCard, { type CreativeSummaryProps } from '../CreativeSummaryCard';
import { EMPTY_GUIDED_CHOICES } from '../../../lib/content/guidedCreativeDirection';

/**
 * Global AI-activity indicator. EVERY AI operation on this screen sets `aiBusyKey`
 * (per-field "+AI", batch generate, and the on-create AUTO-FILL of slides/overlay/
 * fields) — but the on-create auto-fill's busy-keys don't match any button, so
 * without this the fields silently populate with no "please wait" signal. This
 * shows one clear status the whole time any AI is working, then a brief "Ready"
 * confirmation when it finishes.
 */
function AiActivityIndicator({ aiBusyKey }: { aiBusyKey: string | null | undefined }) {
  const busy = !!aiBusyKey;
  const [justDone, setJustDone] = React.useState(false);
  const wasBusy = React.useRef(false);
  React.useEffect(() => {
    if (wasBusy.current && !busy) {
      setJustDone(true);
      const t = window.setTimeout(() => setJustDone(false), 1800);
      return () => window.clearTimeout(t);
    }
    wasBusy.current = busy;
  }, [busy]);

  if (!busy && !justDone) return null;
  const label = !busy
    ? 'Ready'
    : String(aiBusyKey).includes('auto-fill')
      ? 'Drafting your content — please wait…'
      : String(aiBusyKey).startsWith('overlay')
        ? 'Writing the overlay copy…'
        : String(aiBusyKey).startsWith('batch')
          ? 'Generating fields…'
          : 'Working…';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
        busy ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      {busy ? (
        <svg className="h-4 w-4 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : (
        <span aria-hidden="true">✓</span>
      )}
      <span>{label}</span>
    </div>
  );
}

export default function CreatorFormColumn({ ctx }: { ctx: CreatorWorkflowCtx }) {
  const {
    activeTemplate,
    aiBusyKey,
    answers,
    availablePlatforms,
    brandMode,
    brandOverrides,
    brandPanelOpen,
    brandPresence,
    brandSelections,
    buildGenerationBody,
    config,
    connectedPlatforms,
    error,
    freeformFieldSuggestions,
    generationInFlightRef,
    guidedChoices,
    generationModeLabel,
    generationStage,
    handleEditorChange,
    handleGenerate,
    handleOverlayAi,
    handleTemplateAiAssist,
    handleUseExistingAsset,
    hasBrandProfile,
    isGenerating,
    isLoadingAssets,
    isLoadingBrandProfile,
    notice,
    overlayFieldSuggestions,
    overlayText,
    proposalLine,
    recommendedAttachmentMode,
    router,
    savedAssets,
    selectedAsset,
    selectedAssetId,
    selectedCompanyId,
    selectedPlatform,
    setAnswer,
    setBrandMode,
    setBrandOverride,
    setBrandPanelOpen,
    setBrandPresence,
    setBrandSelection,
    setOverlayField,
    setSelectedAssetId,
    setSelectedPlatform,
    setStandaloneAttachmentMode,
    setVariantFanOutInFlight,
    setVariantFanOutSummary,
    setVariantPin,
    setVariantPlan,
    showProgress,
    standaloneAttachmentMode,
    templateValues,
    topicFieldRef,
    topicMissing,
    type,
    variantFanOutInFlight,
    variantFanOutSummary,
    variantPin,
    variantPlan,
    writerAttachmentMode,
    writerCompositionIntent,
    writerEmbeddedCopy,
    writerSource,
    writerSupportingVisual,
  } = ctx;
  // PHASE 2B — identity of the design being composed, so an uploaded image can
  // be attached to it and survive the trip to the template gallery.
  const compositionId = useCreatorCompositionId(type);
  /*
   * What is actually attached, as the image panel reports it.
   *
   * Held here rather than fetched, because the panel has already loaded the
   * references and a second fetch could disagree with what the user is looking
   * at — a summary that contradicts the screen above it is worse than none.
   */
  const [imageAttachment, setImageAttachment] =
    React.useState<CreativeSummaryProps['attachment']>(null);

  /**
   * Does on-image copy apply to this composition?
   *
   * Deliberately the SAME predicate the payload gate uses (Phase 61D) and the
   * same one the Platform & Overlay Text block below already applies, read from
   * the existing embedded_copy / supporting_visual vocabulary. No second mode
   * flag: the screen and the generated image must not be able to disagree.
   */
  const imageCopyActiveForUi = !writerSupportingVisual
    && (!writerSource
      ? !(type === 'image' && standaloneAttachmentMode === 'supporting_visual')
      : writerEmbeddedCopy);

  /**
   * The template as the FORM should present it.
   *
   * In "Post + Image" the image-copy fields are dropped from the template the
   * panel sees, so rendering, validation, progress and readiness all agree.
   * Hiding the inputs alone would not do: `headline` is `required: true`, so a
   * hidden-but-required field leaves the form permanently invalid and blocks
   * generation in the very mode where that field is irrelevant.
   *
   * Non-copy fields (a visual-direction hint, say) are untouched, and the
   * template contract itself is never mutated — only this view of it.
   */
  const effectiveTemplate = React.useMemo(() => {
    if (!activeTemplate || imageCopyActiveForUi) return activeTemplate;
    const excluded = new Set<string>(IMAGE_COPY_FIELD_KEYS);
    const fd = activeTemplate.formDefinition;
    return {
      ...activeTemplate,
      formDefinition: { ...fd, fields: (fd.fields ?? []).filter((f) => !excluded.has(f.key)) },
    };
  }, [activeTemplate, imageCopyActiveForUi]);

  return (
          <div className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Custom Brief</p>
                <p className="mt-1 text-sm text-gray-600">Pick the closest structured options first. AI will only need minimal extra direction after that.</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                {config.fields.length + 1} inputs
              </span>
            </div>

            {/*
              Whether on-image copy belongs to THIS composition. Same
              authoritative vocabulary the payload gate uses (Phase 61D), so the
              screen and the generated image cannot disagree: embedded_copy =
              "Text Inside Image", supporting_visual = "Post + Image".
            */}
            <div className="space-y-5">
              <AiActivityIndicator aiBusyKey={aiBusyKey} />
              {activeTemplate ? (
                <div>
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                    <div className="text-sm text-blue-900">
                      <span className="font-semibold">Template:</span> {activeTemplate.name}
                      <span className="ml-2 text-blue-700">{activeTemplate.description}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/command-center/creator-content/${type}/templates`)}
                      className="ml-3 shrink-0 text-xs font-semibold text-blue-700 underline hover:text-blue-900"
                    >
                      Change
                    </button>
                  </div>
                  {!imageCopyActiveForUi ? (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span className="font-semibold">Post + Image:</span> this image is visual-only,
                      so headline, subheadline and call-to-action are written on the post rather than
                      on the picture. Switch to <span className="font-semibold">Text Inside Image</span> to
                      put copy on the image itself.
                    </div>
                  ) : null}
                  {/*
                    The panel receives a template narrowed to the fields that
                    actually apply. Narrowing the TEMPLATE rather than hiding
                    inputs keeps rendering, validation, progress and readiness in
                    agreement — `headline` is `required: true`, so merely hiding
                    it would leave the form permanently invalid and block
                    generation in a mode where the field is irrelevant.
                  */}
                  <TemplateFieldsPanel
                    template={effectiveTemplate}
                    values={templateValues}
                    onChange={handleEditorChange}
                    onAiAssist={handleTemplateAiAssist}
                    aiBusyKey={aiBusyKey}
                  />
                </div>
              ) : null}
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{config.subtypeLabel}</span>
                <div className="grid gap-3 md:grid-cols-3">
                  {config.subtypeOptions.map((option) => {
                    const selected = (answers.subtype || config.subtypeOptions[0]?.value) === option.value;
                    // Pre-generation CTA suggestion. Looks up the
                    // strategy's CTA intensity + the CTA-slide intent
                    // text so the operator sees, at strategy-pick
                    // time, what the closing CTA will land like.
                    const optionStrategy = resolvePurposeStrategy(type, option.value);
                    const optionCtaIntensity = optionStrategy?.ctaIntensity ?? null;
                    const optionCtaSlide = optionStrategy?.slideArc
                      ?.find((s) => s.role === 'cta' || s.role === 'next_steps')?.intent ?? null;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAnswer('subtype', option.value)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className={`mt-1 text-xs leading-5 ${selected ? 'text-slate-200' : 'text-gray-500'}`}>
                          {option.description}
                        </p>
                        {optionCtaIntensity || optionCtaSlide ? (
                          <div
                            className={`mt-2 rounded-lg px-2 py-1.5 text-[10px] leading-4 ${
                              selected
                                ? 'bg-white/15 text-slate-100'
                                : 'bg-emerald-50 text-emerald-900'
                            }`}
                          >
                            {optionCtaIntensity ? (
                              <p className="font-semibold uppercase tracking-wider">
                                CTA: {optionCtaIntensity}
                              </p>
                            ) : null}
                            {optionCtaSlide ? (
                              <p className="mt-0.5">{optionCtaSlide}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Generation Context</p>
                    <p className="mt-1 text-sm text-gray-600">Choose whether this output should follow company identity or stay independent.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBrandPanelOpen((open) => !open)}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300"
                  >
                    Brand Context {brandPanelOpen ? 'Hide' : 'Show'}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    { id: 'brand-aware' as CreatorBrandMode, label: 'Brand-Aware Generation', body: 'Use selected company identity, tone, visual references, and audience context.' },
                    { id: 'independent' as CreatorBrandMode, label: 'Independent Creative Generation', body: 'Ignore company identity and keep the creative direction freeform.' },
                  ].map((option) => {
                    const selected = brandMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setBrandMode(option.id)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full border ${selected ? 'border-white bg-white' : 'border-gray-400 bg-white'}`} />
                          <p className="text-sm font-semibold">{option.label}</p>
                        </div>
                        <p className={`mt-2 text-xs leading-5 ${selected ? 'text-slate-200' : 'text-gray-500'}`}>
                          {option.body}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {brandPanelOpen && (
                  <div className="mt-4 space-y-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Brand Context</p>
                        <p className="mt-1 text-sm text-gray-600">
                          {isLoadingBrandProfile
                            ? 'Loading company defaults...'
                            : hasBrandProfile
                              ? 'Defaults are prefilled from company profile, but nothing is forced.'
                              : 'No full company profile found. Add only the brand details you want to use.'}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        brandMode === 'brand-aware' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
                      }`}>
                        {brandMode === 'brand-aware' ? 'Branding enabled' : 'Branding ignored'}
                      </span>
                    </div>

                    {brandMode === 'brand-aware' && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Brand Presence</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            { id: 'minimal' as BrandPresence, label: 'Minimal' },
                            { id: 'balanced' as BrandPresence, label: 'Balanced' },
                            { id: 'strong' as BrandPresence, label: 'Strong' },
                          ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setBrandPresence(option.id)}
                              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                                brandPresence === option.id
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {brandMode === 'independent' ? (
                      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                        Independent mode keeps these brand fields out of generation. Your entered values stay here if you switch back.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">Company Context</p>
                          <p className="mt-1 text-sm text-gray-600">Use the company identity, audience, and positioning signals you choose below.</p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {[
                            { id: 'companyContext' as const, label: 'Company Context', field: 'companyName', placeholder: 'Company name or identity context' },
                            { id: 'logo' as const, label: 'Company Logo', field: 'logoUrl', placeholder: 'Logo URL' },
                            { id: 'favicon' as const, label: 'Company Favicon', field: 'faviconUrl', placeholder: 'Favicon URL' },
                            { id: 'tagline' as const, label: 'Tagline', field: 'tagline', placeholder: 'Optional tagline' },
                            { id: 'brandTone' as const, label: 'Brand Tone', field: 'brandTone', placeholder: 'Professional, warm, bold...' },
                            { id: 'brandColors' as const, label: 'Brand Colors', field: 'brandColors', placeholder: '#0B5ED7, #111827...' },
                            { id: 'audience' as const, label: 'Audience', field: 'audience', placeholder: 'Target audience context' },
                            { id: 'campaign' as const, label: 'Campaign Association', field: 'campaign', placeholder: 'Campaign, launch, or initiative' },
                          ].map((item) => {
                            const isSizable = item.id === 'logo' || item.id === 'favicon';
                            const sizeFieldKey = isSizable ? `${item.id}Size` : '';
                            const currentSize = isSizable ? normalizeBrandAssetSize(brandOverrides[sizeFieldKey]) : null;
                            return (
                              <div key={item.id} className="rounded-xl border border-gray-200 bg-white px-3 py-3">
                                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                                  <input
                                    type="checkbox"
                                    checked={brandSelections[item.id]}
                                    onChange={(event) => setBrandSelection(item.id, event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-slate-900"
                                  />
                                  {item.label}
                                </label>
                                <input
                                  value={brandOverrides[item.field] || ''}
                                  onChange={(event) => setBrandOverride(item.field, event.target.value)}
                                  placeholder={item.placeholder}
                                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                                />
                                {isSizable && brandSelections[item.id] ? (
                                  <div className="mt-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                                      Size on asset
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-3">
                                      {BRAND_ASSET_SIZE_PRESETS.map((preset) => (
                                        <label
                                          key={preset.value}
                                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700"
                                        >
                                          <input
                                            type="radio"
                                            name={`${item.id}-size`}
                                            value={preset.value}
                                            checked={currentSize === preset.value}
                                            onChange={() => setBrandOverride(sizeFieldKey, preset.value)}
                                            className="h-3.5 w-3.5 border-gray-300 text-slate-900"
                                          />
                                          {preset.label} ({brandAssetSizePx(item.id, preset.value)}px)
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PHASE 2B — bring your own image. Sits above "Use Existing
                  Asset" because uploading is the more common intent, and the
                  two are different things: this attaches a file the USER owns
                  to the composition; that one reuses a previously GENERATED
                  creator asset as context. Only the visual families can carry
                  a composition image. */}
              {isSocialCreativeType(type) ? (
                <CreatorImageAssetPanel
                  companyId={selectedCompanyId}
                  compositionId={compositionId}
                  creatorTypeLabel={String(type ?? 'design')}
                  /* The TEMPLATE decides which usages are real. Slots come from
                   * activeTemplate, not effectiveTemplate: the image-copy
                   * narrowing filters form FIELDS and says nothing about which
                   * reference assets the design accepts. */
                  templateSlots={activeTemplate?.assetSlots ?? null}
                  templateName={activeTemplate?.name ?? null}
                  /* Signals the treatment proposal reads. All optional: absent
                   * simply means fewer signals, never a different mechanism. */
                  templateCategory={activeTemplate?.category ?? null}
                  templatePurposeKey={activeTemplate?.renderingContract?.purposeKey ?? null}
                  guidedChoices={guidedChoices ?? EMPTY_GUIDED_CHOICES}
                  brief={String(answers.topic || '')}
                  /* So the summary below can state what happens to their image. */
                  onAttachmentChange={setImageAttachment}
                />
              ) : null}

              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      {type === 'post' || type === 'thread' ? 'Use / Attach Existing Asset' : 'Use Existing Asset'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {type === 'post' || type === 'thread'
                        ? 'Optional: attach a saved Creator asset as context without creating a separate asset-based category.'
                        : 'Optional: pull a saved Creator asset into this brief as reusable context.'}
                    </p>
                  </div>
                  {selectedAsset ? (
                    <button
                      type="button"
                      onClick={() => setSelectedAssetId(null)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300"
                    >
                      Clear Asset
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {isLoadingAssets ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                      Loading saved assets...
                    </div>
                  ) : savedAssets.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                      No saved Creator assets yet. Generated outputs saved as assets will appear here.
                    </div>
                  ) : (
                    savedAssets.slice(0, 4).map((asset) => {
                      const selected = selectedAssetId === asset.id;
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => handleUseExistingAsset(asset)}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            selected
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                              : 'border-gray-200 bg-white text-gray-800 hover:border-emerald-200'
                          }`}
                        >
                          <p className="text-sm font-semibold">{asset.name}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {(() => {
                              const modeLabel = getSavedAssetAttachmentLabel(asset);
                              const parts = [
                                getSavedAssetCreatorType(asset),
                                modeLabel,
                                `${asset.usage_count || 0} uses`,
                              ].filter(Boolean);
                              return parts.join(' · ');
                            })()}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {(() => {
                // Selected-asset visual preview. Surfaces the slide
                // images of the existing saved carousel/infographic so
                // operators can SEE what they're reusing before they
                // generate. Falls back to the single image when the
                // asset is a single-frame type.
                if (!selectedAsset) return null;
                // Canonical reader path (PHASE 14F): resolve image URL(s) from
                // the reconciled media_files (creator_continuity.files →
                // metadata.files → files column → url column), instead of only
                // creator_metadata.files which most write paths never populate.
                const savedFiles: string[] = Array.isArray(selectedAsset.media_files)
                  ? selectedAsset.media_files.filter(Boolean)
                  : [];
                if (savedFiles.length === 0) return null;
                const savedType = getSavedAssetCreatorType(selectedAsset);
                const isCarousel = savedFiles.length > 1
                  || /carousel|pdf|slider|infographic/i.test(savedType);
                const sectionLabel = /infographic/i.test(savedType) ? 'Sections' : 'Slides';
                return (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800">
                        Selected Asset Preview · {selectedAsset.name}
                      </p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        {savedFiles.length} {savedFiles.length === 1 ? 'frame' : sectionLabel.toLowerCase()}
                      </span>
                    </div>
                    {isCarousel ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {savedFiles.map((src, idx) => (
                          <a
                            key={`${src}-${idx}`}
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${sectionLabel.slice(0, -1)} ${idx + 1}`}
                            className="block overflow-hidden rounded-xl border border-emerald-100 bg-white"
                          >
                            <div className="flex items-center justify-between bg-emerald-50/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                              <span>{sectionLabel.slice(0, -1)} {idx + 1} / {savedFiles.length}</span>
                            </div>
                            <img
                              src={src}
                              alt={`${selectedAsset.name} ${sectionLabel.slice(0, -1)} ${idx + 1}`}
                              loading="lazy"
                              className="block h-44 w-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <a
                        href={savedFiles[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-xl border border-emerald-100 bg-white"
                      >
                        <img
                          src={savedFiles[0]}
                          alt={selectedAsset.name}
                          loading="lazy"
                          className="block w-full object-cover"
                        />
                      </a>
                    )}
                  </div>
                );
              })()}

              {writerSource ? (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700">Source Content</p>
                  <p className="mt-2 text-sm font-semibold text-indigo-950">
                    Imported from {writerSource.sourceType === 'thread' ? 'Thread' : 'Post'}
                  </p>
                  <p className="mt-1 text-sm text-indigo-900">{writerSource.title}</p>
                  <p className="mt-2 text-xs font-semibold text-indigo-900">
                    {writerAttachmentMode === 'embedded_copy' ? 'Embedded copy' : 'Supporting visual'} · {writerCompositionIntent?.assetType ?? 'asset'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-indigo-800">
                    {writerSupportingVisual
                      ? 'No overlay text, CTA, paragraph rendering, or thread restatement is allowed for this asset.'
                      : `Copy policy: headline ${writerCompositionIntent?.copyPolicy?.allowHeadline ? 'allowed' : 'blocked'}, key insight ${writerCompositionIntent?.copyPolicy?.allowKeyInsight ? 'allowed' : 'blocked'}, CTA ${writerCompositionIntent?.copyPolicy?.allowCTA ? 'allowed' : 'blocked'}.`}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-indigo-800">
                    {writerSource.body}
                  </p>
                </div>
              ) : null}

              {/*
                Image-mode selector — shown only for the Image creator type.
                Two modes (composition / text_embedded). The recommendation
                pill renders when the launcher's recommendation differs from
                the audit-default (text_embedded for strong threads + quote-
                style posts); a click on the pill snaps to that mode.
              */}
              {type === 'image' && !writerSource ? (
                <div className="rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">Attachment Mode</p>
                      <p className="mt-1 text-sm text-sky-900">
                        Choose how text and image relate. The renderer skips the deterministic overlay in <span className="font-semibold">Post + Image</span> mode.
                      </p>
                    </div>
                    {recommendedAttachmentMode && recommendedAttachmentMode !== standaloneAttachmentMode ? (
                      <button
                        type="button"
                        onClick={() => setStandaloneAttachmentMode(recommendedAttachmentMode)}
                        className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                        title="Use the recommended attachment mode"
                      >
                        Recommended:&nbsp;
                        {recommendedAttachmentMode === 'embedded_copy' ? 'Text Inside Image' : 'Post + Image'}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      {
                        value: 'supporting_visual' as AttachmentMode,
                        label: 'Post + Image',
                        description: 'Post text stays outside the image. The image visually complements your content.',
                      },
                      {
                        value: 'embedded_copy' as AttachmentMode,
                        label: 'Text Inside Image',
                        description: 'Headline, hook, and CTA are embedded directly inside the image.',
                      },
                    ].map((option) => {
                      const selected = standaloneAttachmentMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setStandaloneAttachmentMode(option.value)}
                          aria-pressed={selected}
                          data-attachment-mode={option.value}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            selected
                              ? 'border-sky-500 bg-sky-100 text-sky-950 shadow-sm'
                              : 'border-sky-200 bg-white text-sky-900 hover:border-sky-300'
                          }`}
                        >
                          <p className="text-sm font-semibold">{option.label}</p>
                          <p className="mt-1 text-xs leading-5 text-sky-800/80">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isSocialCreativeType(type) && !writerSupportingVisual && (!writerSource ? !(type === 'image' && standaloneAttachmentMode === 'supporting_visual') : writerEmbeddedCopy) ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Platform & Overlay Text</p>
                      <p className="mt-1 text-sm text-emerald-900">
                        This text is rendered programmatically on the final creative. Keep it short and platform-native.
                      </p>
                    </div>
                    {writerSource ? (
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
                        Prefilled from Writer
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Selected Platform</p>
                    {writerSource ? (
                      <p className="mb-2 text-xs leading-5 text-emerald-800">
                        Imported Writer platform is preserved for this creative. Open a new Add Asset flow to target another platform.
                      </p>
                    ) : connectedPlatforms === null ? (
                      <p className="mb-2 text-xs leading-5 text-emerald-700">Loading connected platforms…</p>
                    ) : availablePlatforms.length === 0 ? (
                      <p className="mb-2 text-xs leading-5 text-amber-700">
                        No connected platforms support this content type yet. Connect a platform from Settings to enable publishing for this creative.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {(writerSource ? [selectedPlatform] : availablePlatforms).filter(Boolean).map((platform) => (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => { if (!writerSource) setSelectedPlatform(platform); }}
                          disabled={Boolean(writerSource)}
                          className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                            selectedPlatform === platform
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-emerald-200 bg-white text-emerald-800 hover:border-emerald-300'
                          }`}
                        >
                          {humanizeValue(platform)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      { id: 'hook' as const, label: 'Hook', placeholder: 'Short attention hook', max: 76 },
                      { id: 'headline' as const, label: 'Headline', placeholder: 'Main creative headline', max: 84 },
                      { id: 'supportingText' as const, label: 'Supporting Text', placeholder: 'One short proof, context, or benefit line', max: 96 },
                    ].map((field) => {
                      const suggestions = overlayFieldSuggestions[field.id] || [];
                      return (
                        <label key={field.id} className="block">
                          <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                            <span>{field.label}</span>
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOverlayAi(field.id)}
                                disabled={aiBusyKey === `overlay:${field.id}`}
                                className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                                title={`AI write the ${field.label.toLowerCase()}`}
                              >
                                {aiBusyKey === `overlay:${field.id}` ? '…' : '✦ AI'}
                              </button>
                              <span className="font-medium normal-case tracking-normal text-emerald-600">
                                {(overlayText[field.id] || '').length}/{field.max}
                              </span>
                            </span>
                          </span>
                          <input
                            value={overlayText[field.id] || ''}
                            onChange={(event) => setOverlayField(field.id, event.target.value)}
                            placeholder={field.placeholder}
                            maxLength={field.max}
                            className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          />
                          {suggestions.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {suggestions.map((suggestion) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  onClick={() => setOverlayField(field.id, suggestion)}
                                  className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                                  title={`Use: ${suggestion}`}
                                >
                                  {suggestion.length > 36 ? `${suggestion.slice(0, 35).trimEnd()}…` : suggestion}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </label>
                      );
                    })}
                    <label className="block md:col-span-2">
                      <span className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                        <span>Key Insight</span>
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOverlayAi('keyInsight')}
                            disabled={aiBusyKey === 'overlay:keyInsight'}
                            className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                            title="AI write the key insight"
                          >
                            {aiBusyKey === 'overlay:keyInsight' ? '…' : '✦ AI'}
                          </button>
                          <span className="font-medium normal-case tracking-normal text-emerald-600">
                            {(overlayText.keyInsight || '').length}/132
                          </span>
                        </span>
                      </span>
                      <textarea
                        value={overlayText.keyInsight || ''}
                        onChange={(event) => setOverlayField('keyInsight', event.target.value)}
                        rows={2}
                        placeholder="The strongest positioning statement or insight from the Writer content"
                        maxLength={132}
                        className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      {(overlayFieldSuggestions.keyInsight || []).length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {overlayFieldSuggestions.keyInsight.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => setOverlayField('keyInsight', suggestion)}
                              className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                              title={`Use: ${suggestion}`}
                            >
                              {suggestion.length > 56 ? `${suggestion.slice(0, 55).trimEnd()}…` : suggestion}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-emerald-800">
                    The CTA you set in "What action should the viewer take?" below is reused on the creative — set it once and we'll render it on the asset. Platform choice still controls density, CTA weight, and brand treatment.
                  </p>
                </div>
              ) : null}

              {config.fields.map((field) => {
                // Field-id → chip-array mapping. Every freeform text
                // field gets starter chips so the operator always has
                // a clickable suggestion (operator feedback: "for all
                // these issues offer suggestions that can be picked
                // to start with"). For 'single-select' fields we
                // don't render chips because the buttons themselves
                // are the picks.
                const freeformChips: string[] =
                  field.id === 'audience' ? freeformFieldSuggestions.audience
                  : field.id === 'keyMessage' ? freeformFieldSuggestions.keyMessage
                  : field.id === 'cta' ? freeformFieldSuggestions.cta
                  : field.id === 'topic' ? (freeformFieldSuggestions as Record<string, string[]>).topic ?? []
                  : field.id === 'dataPoints' ? (freeformFieldSuggestions as Record<string, string[]>).dataPoints ?? []
                  : field.id === 'refinement' ? (freeformFieldSuggestions as Record<string, string[]>).refinement ?? []
                  : field.id === 'objective' ? (freeformFieldSuggestions as Record<string, string[]>).objective ?? []
                  : [];
                const isTopicField = field.id === 'topic';
                const topicInvalid = isTopicField && topicMissing && !String(answers.topic || '').trim();
                return (
                <div key={field.id} ref={isTopicField ? topicFieldRef : undefined} className="block scroll-mt-24">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                    {field.label}{isTopicField ? <span className="text-rose-500"> *</span> : null}
                  </span>
                  {field.kind === 'single-select' ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      {field.options.map((option) => {
                        const selected = answers[field.id] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setAnswer(field.id, option.value)}
                            className={`rounded-2xl border px-4 py-4 text-left transition ${
                              selected
                                ? 'border-sky-500 bg-sky-50 text-sky-900'
                                : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                            }`}
                          >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className={`mt-1 text-xs leading-5 ${selected ? 'text-sky-700' : 'text-gray-500'}`}>
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : field.kind === 'textarea' ? (
                    <textarea
                      value={answers[field.id] || ''}
                      onChange={(event) => setAnswer(field.id, event.target.value)}
                      rows={field.rows || 3}
                      placeholder={field.placeholder}
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  ) : (
                    <div className="space-y-2">
                      {Array.isArray(field.presets) && field.presets.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {field.presets.map((preset) => {
                            const selected = (answers[field.id] || '').trim().toLowerCase() === preset.toLowerCase();
                            return (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setAnswer(field.id, preset)}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  selected
                                    ? 'border-sky-500 bg-sky-50 text-sky-800'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-slate-300'
                                }`}
                              >
                                {preset}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <input
                        value={answers[field.id] || ''}
                        onChange={(event) => setAnswer(field.id, event.target.value)}
                        placeholder={field.placeholder}
                        aria-invalid={topicInvalid || undefined}
                        className={`w-full rounded-2xl border px-4 py-3 text-sm text-gray-900 outline-none transition ${
                          topicInvalid
                            ? 'border-rose-400 ring-2 ring-rose-200 focus:border-rose-400 focus:ring-rose-200'
                            : 'border-gray-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200'
                        }`}
                      />
                      {topicInvalid ? (
                        <p className="text-xs font-medium text-rose-600">This is required to generate — tell us what the {type} is about.</p>
                      ) : null}
                    </div>
                  )}
                  {freeformChips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {freeformChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setAnswer(field.id, chip)}
                          className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                          title={`Use: ${chip}`}
                        >
                          {chip.length > 56 ? `${chip.slice(0, 55).trimEnd()}…` : chip}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">AI Suggestion</p>
              <p className="mt-2 text-sm leading-relaxed text-sky-900">
                {proposalLine || `AI will propose a ${config.title.toLowerCase()} direction using your ${generationModeLabel} and the choices above.`}
              </p>
            </div>

            {error && (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {notice && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {notice}
              </div>
            )}

            {/* Variant Experience Embedding — surfaces variant
                planner + winner display when the operator's selected
                subtype resolves to a known strategy. Renders nothing
                when subtype is empty or unknown so legacy flows are
                untouched. */}
            <CreatorVariantExperienceSection
              type={type}
              subtype={answers.subtype}
              companyId={selectedCompanyId || ''}
              variantPin={variantPin}
              setVariantPin={setVariantPin}
              variantPlan={variantPlan}
              setVariantPlan={setVariantPlan}
              variantFanOutInFlight={variantFanOutInFlight}
              variantFanOutSummary={variantFanOutSummary}
              onSingleDecisionReady={(family) => {
                // P1-4 — single-decision modes (single_variant /
                // best_variant) auto-fire Generate once the planner
                // settles so operators don't have to click twice.
                setVariantPin(family);
                if (!generationInFlightRef.current && !isGenerating) {
                  void handleGenerate();
                }
              }}
              onFanOut={async (plan) => {
                if (!selectedCompanyId || !plan) return;
                setVariantFanOutInFlight(true);
                setVariantFanOutSummary(null);
                try {
                  // P1-1 — build the canonical payload directly from
                  // current form state so fan-out works on the first
                  // click. Variant pin is null because the runner
                  // adds `variant_family` per decision.
                  const basePayload = buildGenerationBody(null);
                  if (!basePayload) {
                    setVariantFanOutSummary('Please answer the main topic question first so the fan-out can describe the brief.');
                    return;
                  }
                  const result = await runVariantFanOut({
                    companyId: selectedCompanyId,
                    plan,
                    request: { basePayload },
                  });
                  setVariantFanOutSummary(
                    `${result.successCount} of ${result.outcomes.length} variant assets generated`
                    + (result.failureCount > 0 ? ` · ${result.failureCount} failed (see console)` : ''),
                  );
                } catch (err) {
                  setVariantFanOutSummary(err instanceof Error ? err.message : 'Variant fan-out failed.');
                } finally {
                  setVariantFanOutInFlight(false);
                }
              }}
            />

            {/* The last thing before a generation is spent. Every value is read
              * from the state about to be submitted — see CreativeSummaryCard. */}
            {isSocialCreativeType(type) && activeTemplate ? (
              <div className="mt-6">
                <CreativeSummaryCard
                  templateName={activeTemplate.name ?? null}
                  goalLabel={typeof router.query.goal === 'string' && router.query.goal ? String(router.query.goal) : null}
                  choices={guidedChoices ?? EMPTY_GUIDED_CHOICES}
                  attachment={imageAttachment}
                  headline={String(templateValues?.fields?.headline || answers.topic || '').trim() || null}
                  subheadline={String(templateValues?.fields?.subheadline || '').trim() || null}
                  cta={String(templateValues?.fields?.cta || answers.cta || '').trim() || null}
                  platform={selectedPlatform ?? null}
                  brandAware={brandMode === 'brand-aware'}
                />
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating
                  ? 'Generating...'
                  : variantPin
                    ? `Generate ${config.title} — Variant ${variantPin.toUpperCase()}`
                    : `Generate ${config.title}`}
              </button>
            </div>

            {isGenerating && showProgress ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Working on your {config.title.toLowerCase()}</p>
                </div>
                <ol className="space-y-2">
                  {[
                    'Preparing your brief',
                    'Generating image with AI',
                    'Composing overlay text',
                    'Saving the asset',
                  ].map((label, idx) => {
                    const status: 'done' | 'active' | 'pending' =
                      idx < generationStage ? 'done' : idx === generationStage ? 'active' : 'pending';
                    return (
                      <li key={label} className="flex items-start gap-3 text-sm">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                            status === 'done'
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : status === 'active'
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-400'
                          }`}
                          aria-hidden="true"
                        >
                          {status === 'done' ? '✓' : idx + 1}
                        </span>
                        <span
                          className={
                            status === 'pending' ? 'text-slate-400'
                              : status === 'active' ? 'font-semibold text-slate-900'
                                : 'text-slate-700'
                          }
                        >
                          {label}
                          {status === 'active' ? <span className="ml-2 inline-block animate-pulse text-slate-500">…</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-[11px] text-slate-500">
                  Heavy renders can take 15–25 seconds. You can leave this page open — we keep working in the background.
                </p>
              </div>
            ) : null}
          </div>

  );
}
