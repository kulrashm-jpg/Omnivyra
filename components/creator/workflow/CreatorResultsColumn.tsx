'use client';

/**
 * CreatorResultsColumn — the results column (preview, quality, variants, review panels, actions).
 * Extracted VERBATIM from pages/command-center/creator-content/[type].tsx (page < 1000 LOC).
 * All state/handlers live on the page and arrive via CreatorWorkflowCtx.
 */
import React from 'react';
import { Calendar, Send } from 'lucide-react';
import CreatorQualityInspector from '../CreatorQualityInspector';
import GenerationReviewPanel from '../GenerationReviewPanel';
import AssetReviewPanel from '../AssetReviewPanel';
import CampaignPackagePanel from '../CampaignPackagePanel';
import { openCreatorEditor } from '../../../lib/content/openCreatorEditor';
import { resolveReturnDestination } from '../../../lib/content/creatorAttachmentSession';
import { resolvePurposeStrategy } from '../../../backend/services/creator/purposeStrategyRegistry';
import { buildGenerationReview, buildCreatorCampaignPackage } from '../../../lib/creator-templates';
import { getDiagnosticReport, getSavedAssetCreatorType } from '../../../lib/creator-content/creatorTypeWorkflow';
import type { CreatorWorkflowCtx } from './creatorWorkflowCtx';

export default function CreatorResultsColumn({ ctx }: { ctx: CreatorWorkflowCtx }) {
  const {
    actionInProgress,
    activeTemplate,
    answers,
    attachmentSessionTokenRef,
    config,
    creatorQuality,
    documentFallbackReason,
    documentUrl,
    error,
    generatedSnapshot,
    handleDownloadBrief,
    handleEditorChange,
    handleGenerate,
    handleOpenScheduler,
    handleRefineSuggestion,
    handleRenderInline,
    handleSaveAsBlock,
    inlineRenderError,
    inlineRenderInFlight,
    isDirectionCardPreview,
    isGenerating,
    isProviderImagePreview,
    isSavingBlock,
    isThemeTreatment,
    mediaUrls,
    overlayQuality,
    conditionReferenceFallbackCategory,
    conditionReferenceStatus,
    conditionReferenceUserMessage,
    pdfDocumentFallbackCategory,
    pdfDocumentStatus,
    pdfDocumentUserMessage,
    pdfPreviewPagesAvailable,
    previewAspectRatio,
    previewKind,
    refinePrompt,
    refinedSuggestion,
    regenCount,
    renderJobProgress,
    result,
    resultPanelRef,
    router,
    savedBlock,
    selectedAsset,
    selectedPlatform,
    selectedSuggestionId,
    setError,
    setNotice,
    setRefinePrompt,
    setRefinedSuggestion,
    setSelectedSuggestionId,
    slides,
    socialActionLabel,
    suggestionOptions,
    templateValues,
    themeAspectRatio,
    themeCtaScene,
    themeDurationSeconds,
    themeHookScene,
    themePlatformNotes,
    themeScenes,
    type,
    visualGovernanceWarnings,
    writerSource,
  } = ctx;
  return (
          <div className="space-y-6">
            <div
              ref={resultPanelRef}
              className="rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8 scroll-mt-24"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                {result ? 'Generated Output' : 'Pick A Direction'}
              </p>
              {/* Quality Inspector — read-only panel for the attached diagnostic
                  report (image / carousel / infographic). Renders only when the
                  asset metadata carries a creator_diagnostic_report. */}
              {(() => {
                const diagnosticReport = getDiagnosticReport(result);
                return diagnosticReport ? <CreatorQualityInspector report={diagnosticReport} /> : null;
              })()}
              {!result ? (
                <div className="mt-4 space-y-5">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <p className="text-sm font-medium text-gray-700">
                      AI has prepared starting directions from your selections. Pick one, refine it if needed, then generate.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {suggestionOptions.map((option) => {
                      const selected = selectedSuggestionId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedSuggestionId(option.id);
                            setRefinedSuggestion(null);
                            setNotice(null);
                          }}
                          className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                            selected
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-gray-200 bg-white text-gray-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">{option.label}</p>
                            {selected ? (
                              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                                Selected
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {option.badges.map((badge) => (
                              <span
                                key={badge}
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                                  selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                          <p className={`mt-2 text-sm leading-6 ${selected ? 'text-slate-100' : 'text-gray-700'}`}>
                            {option.summary}
                          </p>
                          <p className={`mt-2 text-xs leading-5 ${selected ? 'text-slate-300' : 'text-gray-500'}`}>
                            {option.rationale}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Refine With AI</p>
                    <p className="mt-2 text-sm leading-6 text-blue-900">
                      Tell AI what to change if the selected direction is close but not quite right.
                    </p>
                    <textarea
                      value={refinePrompt}
                      onChange={(event) => setRefinePrompt(event.target.value)}
                      rows={3}
                      placeholder="Example: make it less corporate, more premium, and more visual-first."
                      className="mt-3 w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={handleRefineSuggestion}
                      disabled={isGenerating || Boolean(actionInProgress)}
                      className="mt-3 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Refine Direction
                    </button>
                    {refinedSuggestion ? (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-white px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Refined Direction</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">{refinedSuggestion}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {result.output.asset_type}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700">
                        {result.primary_platform}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.output.packaging.caption}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {result.output.packaging.hashtags.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                          {tag.startsWith('#') ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* CREATOR-010 — Generation Review & Traceability (read-only,
                      derived from the existing result + diagnostic report). */}
                  {(() => {
                    const review = buildGenerationReview({
                      result,
                      error,
                      inProgress: isGenerating,
                      progressStatus: renderJobProgress?.status ?? null,
                    });
                    return (
                      <GenerationReviewPanel
                        model={review}
                        onRegenerate={handleGenerate}
                        onDownload={handleDownloadBrief}
                        onOpenInEditor={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        downloadBusy={actionInProgress === 'download'}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })()}

                  {/* CREATOR-011 — Asset Review & Quick Refine (read-only review +
                      lightweight refinement of EXISTING editor values). */}
                  {activeTemplate ? (() => {
                    const bundle = (result.output.asset_payload?.media_bundle ?? {}) as { url?: string; files?: string[]; metadata?: Record<string, unknown> };
                    const md = (bundle.metadata ?? {}) as Record<string, unknown>;
                    const diag = getDiagnosticReport(result);
                    const previewUrl = bundle.url ?? (Array.isArray(bundle.files) ? bundle.files[0] : undefined) ?? null;
                    const appliedVariant = (md.applied_variant ?? {}) as Record<string, unknown>;
                    const reviewMeta = { ...((diag?.rendering ?? {}) as Record<string, unknown>), brand_mode: md.brand_mode };
                    const edited = generatedSnapshot ? JSON.stringify(templateValues) !== JSON.stringify(generatedSnapshot) : false;
                    return (
                      <AssetReviewPanel
                        template={activeTemplate}
                        values={templateValues}
                        onChange={handleEditorChange}
                        meta={reviewMeta}
                        previewUrl={previewUrl}
                        assetId={(result as { persisted_asset_id?: string | null }).persisted_asset_id ?? null}
                        assetName={activeTemplate.name}
                        assetType={result.output.asset_type ?? null}
                        platform={result.primary_platform ?? null}
                        variant={typeof appliedVariant.variant_family === 'string' ? appliedVariant.variant_family : null}
                        status={isGenerating ? 'processing' : 'completed'}
                        timestamp={diag?.generatedAt ?? null}
                        templateVersion={diag?.template?.version ?? activeTemplate.version ?? null}
                        originalValues={generatedSnapshot}
                        edited={edited}
                        regenerations={regenCount}
                        onDownload={handleDownloadBrief}
                        onOpenEditor={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        onRegenerate={handleGenerate}
                        onDuplicate={handleSaveAsBlock}
                        downloadBusy={actionInProgress === 'download'}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })() : null}

                  {/* CAMPAIGN-005 / PLATFORM-001 — Campaign Package via the ONE
                      canonical creator-result→package projection (no inline asset
                      assembly). References only; no duplicate storage / re-render. */}
                  {activeTemplate ? (() => {
                    const edited = generatedSnapshot ? JSON.stringify(templateValues) !== JSON.stringify(generatedSnapshot) : false;
                    const pkg = buildCreatorCampaignPackage(result, {
                      templateName: activeTemplate.name,
                      templateId: activeTemplate.id,
                      assetFamily: activeTemplate.assetFamily,
                      selectedPlatform: selectedPlatform || result.primary_platform || null,
                      campaign: {
                        name: (typeof answers.topic === 'string' && answers.topic.trim()) ? answers.topic.trim() : activeTemplate.name,
                        objective: (typeof answers.objective === 'string' && answers.objective.trim()) ? answers.objective.trim() : null,
                        audience: (typeof answers.audience === 'string' && answers.audience.trim()) ? answers.audience.trim() : null,
                        platforms: [selectedPlatform || result.primary_platform].filter((p): p is string => !!p),
                      },
                      edited,
                      regenerations: regenCount,
                      inProgress: isGenerating,
                    });
                    return (
                      <CampaignPackagePanel
                        pkg={pkg}
                        onOpenAsset={() => openCreatorEditor({ assetId: selectedAsset?.id ?? null })}
                        onRegenerate={handleGenerate}
                        onDuplicate={handleSaveAsBlock}
                        regenerateBusy={isGenerating}
                      />
                    );
                  })() : null}

                  {(() => {
                    // Async-render status banner. Carousel / infographic
                    // / pdf / slider go through a durable queue
                    // (creatorAssetRegistry: render_strategy='queue'),
                    // so generation returns before the slide PNGs are
                    // ready. The polling effect at the top of this
                    // component pulls them in once the job completes,
                    // but the operator needs a visible signal that the
                    // rendering is still in flight.
                    const bundleMeta = (result.output.asset_payload.media_bundle?.metadata ?? {}) as Record<string, unknown>;
                    const renderAsync = bundleMeta.render_async === true;
                    const hasFiles = Array.isArray(result.output.asset_payload.media_bundle?.files)
                      && (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean).length > 0;
                    if (!renderAsync || hasFiles) return null;
                    const percent = renderJobProgress?.percent ?? 0;
                    const status = renderJobProgress?.status ?? 'queued';
                    const queuedSeconds = renderJobProgress?.queuedSeconds ?? 0;
                    // If the job sits in queued/waiting for >25s, no
                    // render worker is consuming the queue. In dev that
                    // typically means `npm run dev` (--app-only) was used
                    // instead of `npm run dev:full`. Surface that
                    // explicitly so the operator stops staring at a
                    // frozen 0% bar.
                    const workerStalled = (status === 'queued' || status === 'waiting') && queuedSeconds >= 25;
                    const isQueued = status === 'queued' || status === 'waiting';
                    const isActive = status === 'active';
                    // Status label is fully honest: it never says
                    // "rendering" when the job is in fact just sitting
                    // in a queue waiting for a worker.
                    const statusLabel = workerStalled
                      ? 'Render worker not responding'
                      : isQueued
                        ? `Queued — waiting for a render worker (${queuedSeconds}s)`
                        : isActive
                          ? 'Rendering slides'
                          : status === 'completed'
                            ? 'Finalizing'
                            : 'Rendering slides';
                    const bannerColor = workerStalled ? 'rose' : 'amber';
                    // Progress-bar fill: honest. 0 means 0. We never
                    // paint a fake minimum just to make the bar visible.
                    // While queued, the bar is empty and the (indeterminate)
                    // animated stripe communicates "we're waiting".
                    return (
                      <div className={`rounded-2xl border ${bannerColor === 'rose' ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50'} px-4 py-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                workerStalled
                                  ? 'bg-rose-500'
                                  : isActive
                                    ? 'animate-pulse bg-emerald-500'
                                    : 'animate-pulse bg-amber-500'
                              }`}
                              aria-hidden="true"
                            />
                            <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${workerStalled ? 'text-rose-900' : 'text-amber-900'}`}>
                              {statusLabel}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold tabular-nums ${workerStalled ? 'text-rose-900' : 'text-amber-900'}`}>
                            {percent}%
                          </span>
                        </div>
                        <div
                          className={`mt-3 h-2 w-full overflow-hidden rounded-full ${workerStalled ? 'bg-rose-100' : 'bg-amber-100'}`}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label="Slide rendering progress"
                        >
                          {isQueued && percent === 0 ? (
                            // Indeterminate stripe for the queued state.
                            // No fake fill — the actual value is 0 and the
                            // animated pulse makes that visually honest.
                            <div className="h-full w-full animate-pulse rounded-full bg-amber-200" />
                          ) : (
                            <div
                              className={`h-full rounded-full ${workerStalled ? 'bg-rose-400' : 'bg-amber-500'} transition-[width] duration-700 ease-out`}
                              style={{ width: `${percent}%` }}
                            />
                          )}
                        </div>
                        {workerStalled ? (
                          <>
                            <p className="mt-2 text-sm leading-6 text-rose-900">
                              The render queue has the job but no worker is consuming it. In local dev this usually means the app was started with <code className="rounded bg-rose-100 px-1 py-0.5 text-[12px] font-mono">npm run dev</code> instead of <code className="rounded bg-rose-100 px-1 py-0.5 text-[12px] font-mono">npm run dev:full</code> — the latter starts the creator-render worker.
                            </p>
                            <p className="mt-1 text-[11px] text-rose-700">
                              Or bypass the queue entirely and render synchronously in this request. Slide structure + copy below are preserved either way.
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { void handleRenderInline(); }}
                                disabled={inlineRenderInFlight}
                                className="rounded-2xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {inlineRenderInFlight ? 'Rendering inline… this can take 30–60s' : 'Render inline now'}
                              </button>
                              {inlineRenderError ? (
                                <span className="text-[11px] font-medium text-rose-800">{inlineRenderError}</span>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-amber-900">
                            Slide structure and copy are ready below. Slide images render asynchronously and will appear here automatically — usually within 30–60 seconds. Stay on this page.
                          </p>
                        )}
                        {renderJobProgress?.attempts && renderJobProgress.attempts > 1 ? (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Retry attempt {renderJobProgress.attempts} — the worker had a transient issue and is trying again.
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}

                  {isThemeTreatment && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Theme Treatment</p>
                        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">
                          {String(config.contentType).toUpperCase()}
                        </span>
                        {themeDurationSeconds > 0 ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                            {themeDurationSeconds}s target
                          </span>
                        ) : null}
                        {themeAspectRatio ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                            {themeAspectRatio}
                          </span>
                        ) : null}
                      </div>

                      <p className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-5 text-indigo-900">
                        AI cannot produce the final {String(config.contentType)} file — that requires human production. The treatment below is your shot-by-shot brief: hand it to your editor / producer as-is.
                      </p>

                      {Object.keys(themeHookScene).length > 0 && (
                        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Hook Scene</p>
                          {themeHookScene.duration_seconds ? (
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                              {String(themeHookScene.duration_seconds)}s
                            </p>
                          ) : null}
                          {themeHookScene.visual ? (
                            <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold">Visual: </span>{String(themeHookScene.visual)}</p>
                          ) : null}
                          {themeHookScene.text ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">On-screen / VO: </span>{String(themeHookScene.text)}</p>
                          ) : themeHookScene.dialogue ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Dialogue: </span>{String(themeHookScene.dialogue)}</p>
                          ) : null}
                          {themeHookScene.audio ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Audio: </span>{String(themeHookScene.audio)}</p>
                          ) : null}
                          {themeHookScene.camera_direction ? (
                            <p className="mt-1 text-sm leading-6 text-gray-800"><span className="font-semibold">Camera: </span>{String(themeHookScene.camera_direction)}</p>
                          ) : null}
                        </div>
                      )}

                      {themeScenes.length > 0 && (
                        <div>
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Scenes</p>
                          <div className="space-y-2">
                            {themeScenes.map((scene, index) => (
                              <div key={`scene-${index}`} className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-900">Scene {String(scene.scene_number ?? index + 1)}</span>
                                  {scene.duration_seconds ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{String(scene.duration_seconds)}s</span>
                                  ) : null}
                                  {scene.transition ? (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">→ {String(scene.transition)}</span>
                                  ) : null}
                                </div>
                                {scene.visual ? (
                                  <p className="mt-2 text-sm leading-6 text-gray-700"><span className="font-semibold">Visual: </span>{String(scene.visual)}</p>
                                ) : null}
                                {scene.dialogue ? (
                                  <p className="mt-1 text-sm leading-6 text-gray-700"><span className="font-semibold">Dialogue / VO: </span>{String(scene.dialogue)}</p>
                                ) : null}
                                {scene.audio_cue ? (
                                  <p className="mt-1 text-sm leading-6 text-gray-700"><span className="font-semibold">Audio cue: </span>{String(scene.audio_cue)}</p>
                                ) : null}
                                {scene.pacing_note ? (
                                  <p className="mt-1 text-xs leading-5 text-gray-500"><span className="font-semibold">Pacing: </span>{String(scene.pacing_note)}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {Object.keys(themeCtaScene).length > 0 && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">CTA Scene</p>
                          {themeCtaScene.visual ? (
                            <p className="mt-2 text-sm leading-6 text-emerald-950"><span className="font-semibold">Visual: </span>{String(themeCtaScene.visual)}</p>
                          ) : null}
                          {themeCtaScene.text ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">On-screen / VO: </span>{String(themeCtaScene.text)}</p>
                          ) : null}
                          {themeCtaScene.audio ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">Audio: </span>{String(themeCtaScene.audio)}</p>
                          ) : null}
                          {themeCtaScene.platform_cta ? (
                            <p className="mt-1 text-sm leading-6 text-emerald-950"><span className="font-semibold">Platform CTA: </span>{String(themeCtaScene.platform_cta)}</p>
                          ) : null}
                        </div>
                      )}

                      {Object.keys(themePlatformNotes).length > 0 && (
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-700">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Platform Notes</p>
                          {themePlatformNotes.optimal_aspect_ratio ? <p className="mt-1">Aspect ratio: {String(themePlatformNotes.optimal_aspect_ratio)}</p> : null}
                          {Array.isArray(themePlatformNotes.recommended_platforms) && themePlatformNotes.recommended_platforms.length > 0 ? (
                            <p className="mt-1">Recommended platforms: {(themePlatformNotes.recommended_platforms as unknown[]).map(String).join(', ')}</p>
                          ) : null}
                          {themePlatformNotes.trending_audio_style ? <p className="mt-1">Audio style: {String(themePlatformNotes.trending_audio_style)}</p> : null}
                          {themePlatformNotes.target_retention_point ? <p className="mt-1">Retention target: {String(themePlatformNotes.target_retention_point)}</p> : null}
                        </div>
                      )}
                    </div>
                  )}

                  {mediaUrls.length > 0 && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Preview</p>
                          {isProviderImagePreview ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                              Social creative
                            </span>
                          ) : null}
                          {overlayQuality ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                              Quality {overlayQuality.score ?? 'n/a'}
                            </span>
                          ) : null}
                          {creatorQuality ? (
                            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-semibold text-cyan-800">
                              Clean {creatorQuality.cleanliness ?? 'n/a'} · Read {creatorQuality.readability ?? 'n/a'}
                            </span>
                          ) : null}
                          {isDirectionCardPreview ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                              Direction preview
                            </span>
                          ) : null}
                        </div>
                        <a
                          href={mediaUrls[0]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 3h6v6" />
                            <path d="M10 14 21 3" />
                            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                          </svg>
                          View full size
                        </a>
                      </div>
                      <div className="grid gap-3">
                        {mediaUrls.map((url, index) => (
                          <div key={url} className="max-w-xs overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open full size"
                              className="block"
                            >
                              <img
                                src={url}
                                alt={`${config.title} preview ${index + 1}`}
                                style={{ aspectRatio: previewAspectRatio }}
                                className="w-full bg-gray-100 object-contain"
                                loading="lazy"
                                onError={() => setError('Preview could not load. The generated media URL is still available in the output actions.')}
                              />
                            </a>
                            <div className="border-t border-gray-100 px-3 py-2">
                              <a href={url} target="_blank" rel="noreferrer" className="break-all text-[11px] font-medium text-blue-700 hover:text-blue-900">
                                {url}
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                      {documentUrl ? (
                        <a
                          href={documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          Open downloadable PDF
                        </a>
                      ) : null}
                      {previewKind === 'pdf_document' && !documentUrl ? (
                        <div
                          className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
                          role="status"
                          data-pdf-status={pdfDocumentStatus || 'preview_only'}
                          data-pdf-fallback={pdfDocumentFallbackCategory || 'unknown_storage_error'}
                        >
                          <p className="font-semibold">
                            Preview available · Download unavailable
                            {pdfPreviewPagesAvailable > 0 ? ` · ${pdfPreviewPagesAvailable} page${pdfPreviewPagesAvailable === 1 ? '' : 's'} ready` : ''}
                          </p>
                          <p className="mt-1">
                            {pdfDocumentUserMessage
                              || 'PDF preview pages are ready. Downloadable PDF storage is temporarily unavailable, so use the rendered pages for beta review.'}
                          </p>
                          {pdfDocumentFallbackCategory === 'storage_mime_blocked' ? (
                            <p className="mt-1 text-amber-700/80">
                              Detected: storage MIME restriction — `application/pdf` is not in the bucket allow-list.
                            </p>
                          ) : null}
                          {documentFallbackReason && process.env.NODE_ENV === 'development' ? (
                            <p className="mt-1 font-mono text-[10px] text-amber-700/70">{documentFallbackReason.slice(0, 220)}</p>
                          ) : null}
                        </div>
                      ) : null}
                      {isDirectionCardPreview ? (
                        <p className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                          Image provider preview was not available, so this output is showing a generated direction card. Customize or regenerate to try again.
                        </p>
                      ) : null}
                      {/* The user attached a reference and it could not be applied.
                        * Saying so is the point: without it this result is
                        * indistinguishable from an ordinary generation, and the
                        * attachment panel already told them the image would be
                        * "used as a reference for this design". Same amber
                        * treatment as the degradation notice above. */}
                      {conditionReferenceStatus === 'not_applied' ? (
                        <p
                          className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
                          data-condition-fallback={conditionReferenceFallbackCategory || 'unknown'}
                        >
                          {conditionReferenceUserMessage
                            || 'Your reference image could not be applied, so this result was generated without it. Regenerate to try again.'}
                        </p>
                      ) : null}
                      {overlayQuality?.flags?.length ? (
                        <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                          Internal review flags: {overlayQuality.flags.join(', ')}.
                        </p>
                      ) : null}
                      {visualGovernanceWarnings.length > 0 ? (
                        <p className="mt-2 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                          Visual governance warnings: {visualGovernanceWarnings.join(', ')}.
                          {typeof creatorQuality?.clutterRisk === 'number' ? ` Density score: ${Math.max(0, 100 - creatorQuality.clutterRisk)}.` : ''}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {savedBlock && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Saved Asset Reference</p>
                      <div className="mt-2 space-y-1 text-sm text-amber-900">
                        <p className="font-semibold">{savedBlock.reference}</p>
                        <p>{savedBlock.name}</p>
                        <p className="break-all text-xs text-amber-800">Block ID: {savedBlock.id}</p>
                      </div>
                    </div>
                  )}

                  {selectedAsset && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Reusable Context</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-950">{selectedAsset.name}</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        Source creator type: {getSavedAssetCreatorType(selectedAsset)}
                      </p>
                    </div>
                  )}

                  {writerSource && (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700">Attached To</p>
                      <p className="mt-2 text-sm font-semibold text-indigo-950">{writerSource.title}</p>
                      <p className="mt-1 text-xs text-indigo-800">
                        {writerSource.sourceType === 'thread' ? 'Thread' : 'Post'} source context is preserved for this asset.
                      </p>
                    </div>
                  )}

                  {slides.length > 0 && (() => {
                    // Carousel/Infographic/Slider preview. The actual
                    // slide images come back in `media_bundle.files` (one
                    // URL per slide, same index as `slides`). Pair them
                    // with the slide structure metadata so each slide
                    // renders as a self-contained card with both visual
                    // and copy. The legacy "Preview" block above only
                    // showed the URLs as thumbnails; this block now
                    // makes the carousel preview the primary surface.
                    //
                    // Strategy lookup surfaces the selected strategy's
                    // CTA intensity + the CTA-slide intent text so the
                    // operator can see WHY the LLM is producing a
                    // particular CTA framing for the last slide.
                    const slideMediaUrls = Array.isArray(result?.output.asset_payload.media_bundle?.files)
                      ? (result.output.asset_payload.media_bundle!.files as string[]).filter(Boolean)
                      : [];
                    const slideStrategy = resolvePurposeStrategy(type, answers.subtype);
                    const ctaSlideIntent = slideStrategy?.slideArc
                      ?.find((s) => s.role === 'cta' || s.role === 'next_steps')
                      ?.intent ?? null;
                    return (
                      <div>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                            {type === 'infographic' ? 'Sections' : 'Slide Structure'} · {slides.length} {type === 'infographic' ? 'sections' : 'slides'}
                          </p>
                          {slideStrategy ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
                              CTA intensity: {slideStrategy.ctaIntensity}
                            </span>
                          ) : null}
                        </div>
                        {ctaSlideIntent ? (
                          <div className="mb-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800">
                              Suggested CTA for the closing slide
                            </p>
                            <p className="mt-1 text-sm leading-6 text-emerald-900">{ctaSlideIntent}</p>
                          </div>
                        ) : null}
                        <div className="space-y-3">
                          {slides.map((slide, index) => {
                            const slideUrl = slideMediaUrls[index] || '';
                            const role = String(slide.role ?? 'content');
                            const isCta = role === 'cta' || role === 'next_steps';
                            return (
                              <div
                                key={`${index}-${String(slide.slide_number ?? index + 1)}`}
                                className={`overflow-hidden rounded-2xl border ${isCta ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100 bg-gray-50'}`}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row">
                                  {slideUrl ? (
                                    <a
                                      href={slideUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Open full size"
                                      className="block w-full shrink-0 overflow-hidden bg-gray-100 sm:w-56"
                                    >
                                      <img
                                        src={slideUrl}
                                        alt={`${type} ${role} ${index + 1}`}
                                        loading="lazy"
                                        className="block h-full w-full object-cover"
                                      />
                                    </a>
                                  ) : null}
                                  <div className="flex-1 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                                        {type === 'infographic' ? 'Section' : 'Slide'} {String(slide.slide_number ?? index + 1)} · {role}
                                      </p>
                                      {isCta ? (
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                                          Suggested CTA
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold text-gray-900">{String(slide.headline ?? '')}</p>
                                    <p className="mt-1 text-sm text-gray-600">{String(slide.body_text ?? '')}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Customize With AI</p>
                    <p className="mt-2 text-sm leading-6 text-blue-900">
                      Ask AI to adjust the copy, visual hierarchy, tone, layout direction, CTA, or platform fit, then regenerate a new preview.
                    </p>
                    <textarea
                      value={refinePrompt}
                      onChange={(event) => setRefinePrompt(event.target.value)}
                      rows={3}
                      placeholder="Example: make it more minimal, use stronger CTA language, and make the visual feel less corporate."
                      className="mt-3 w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="mt-3 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGenerating ? 'Customizing...' : 'Customize With AI'}
                    </button>
                  </div>

                  {/*
                    Context-aware action surface (Phase 1–6).
                    Embedded writer flow: the asset is already attached
                    to the writer post/thread automatically when
                    generation succeeds (see appendWriterAttachedAssetDurable
                    above). This block exposes only the actions that make
                    semantic sense INSIDE the writer flow:
                      PRIMARY    → Return to Writer
                      SECONDARY  → Save As Asset · Download · Regenerate
                    Standalone-only / campaign / repurpose / duplicate
                    CTAs are deliberately hidden — they belong to the
                    standalone creator studio surface.
                  */}
                  {writerSource ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          // Return to the Writer draft (never back to Creator). The
                          // return destination is owned by the CreatorAttachmentSession
                          // — no page inspects return_to directly. Fallback to history.
                          const token = attachmentSessionTokenRef.current || (typeof router.query.session === 'string' ? router.query.session : '') || (typeof router.query.prefill === 'string' ? router.query.prefill : '');
                          const returnTo = resolveReturnDestination(token);
                          if (returnTo) { void router.push(returnTo); return; }
                          try { router.back(); } catch { /* router.back may throw if no history */ }
                        }}
                        disabled={Boolean(actionInProgress)}
                        className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Continue with your ${writerSource.sourceType === 'thread' ? 'thread' : 'post'}`}
                      </button>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={handleSaveAsBlock}
                          disabled={isSavingBlock || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingBlock ? 'Saving...' : 'Save As Asset'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBrief}
                          disabled={Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionInProgress === 'download' ? 'Preparing...' : 'Download'}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerate}
                          disabled={isGenerating || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isGenerating ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-500">
                        Asset is auto-attached to your {writerSource.sourceType === 'thread' ? 'thread' : 'post'}. Return to keep editing — or refine above and regenerate before going back.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleOpenScheduler('schedule')}
                          disabled={Boolean(actionInProgress)}
                          className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {actionInProgress === `schedule-${socialActionLabel}` ? 'Opening...' : `Schedule ${socialActionLabel}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenScheduler('publish')}
                          disabled={Boolean(actionInProgress)}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {actionInProgress === `share-${socialActionLabel}` ? 'Opening...' : `Share ${socialActionLabel} now`}
                        </button>
                      </div>
                      <p className="text-[11px] leading-5 text-gray-500">
                        Opens the selected platform with this {socialActionLabel} copy and generated media attached for final review.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={handleSaveAsBlock}
                          disabled={isSavingBlock || Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingBlock ? 'Saving Asset...' : 'Save As Asset'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadBrief}
                          disabled={Boolean(actionInProgress)}
                          className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionInProgress === 'download' ? 'Preparing...' : 'Download'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
  );
}
