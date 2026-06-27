/**
 * Generation Review & Traceability — deterministic, read-only projection.
 *
 * Turns the EXISTING creator execution result (`CreatorResult` + the attached
 * `creator_diagnostic_report`) + live progress into a transparent review model:
 * pipeline stages, per-asset status, humanised failures, a summary, a quality
 * summary, and traceability. It NEVER exposes prompts, internals, or stack
 * traces, and NEVER changes generation/rendering — every value is read defensively
 * from data that already exists. No new validation engine, no invented stages.
 */

export type StageStatus = 'done' | 'active' | 'pending' | 'failed' | 'skipped';
export type AssetReviewStatus = 'completed' | 'generating' | 'rendering' | 'queued' | 'failed';
export type OverallStatus = 'success' | 'partial' | 'failed' | 'in_progress';

export interface PipelineStage { key: string; label: string; status: StageStatus; detail?: string }
export interface FailureInfo { stage: string; reason: string; asset: string | null; retryable: boolean }
export interface AssetReview {
  id: string | null;
  label: string;
  assetType: string;
  template: string | null;
  layout: string | null;
  platform: string | null;
  status: AssetReviewStatus;
  previewUrl: string | null;
  failure: FailureInfo | null;
}
export interface GenerationSummary {
  assetsGenerated: number;
  successful: number;
  failed: number;
  warnings: number;
  timeTakenMs: number | null;
  templateUsed: string | null;
  variantUsed: string | null;
  layoutUsed: string | null;
}
export interface QualitySummary {
  readinessPassed: boolean | null;
  templateValidationPassed: boolean | null;
  renderingCompleted: boolean | null;
  warnings: string[];
}
export interface GenerationReviewModel {
  overall: OverallStatus;
  stages: PipelineStage[];
  assets: AssetReview[];
  failures: FailureInfo[];
  summary: GenerationSummary;
  quality: QualitySummary;
}

export interface GenerationReviewInput {
  /** The CreatorResult returned by the generate endpoint (loosely typed). */
  result?: unknown;
  error?: string | null;
  inProgress?: boolean;
  /** renderJobProgress.status, if an async render is polling. */
  progressStatus?: string | null;
}

/* ── Defensive readers (never throw; never surface raw internals) ─────── */

function obj(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function truthyMedia(bundle: Record<string, unknown>): boolean {
  return !!str(bundle.url) || arr(bundle.files).length > 0;
}

const ASSET_LABELS: Record<string, string> = { image: 'Image', banner: 'Banner', carousel: 'Carousel', infographic: 'Infographic', pdf: 'Document', slider: 'Slider' };
function assetLabel(assetType: string | null): string {
  const k = String(assetType ?? '').toLowerCase();
  return ASSET_LABELS[k] ?? (assetType ? assetType.charAt(0).toUpperCase() + assetType.slice(1) : 'Asset');
}

/* ── Failure humanisation (no stack traces, no internals) ────────────── */

const STAGE_KEYS = {
  templateSelected: 'template_selected',
  blueprint: 'blueprint_complete',
  validated: 'content_validated',
  planned: 'content_planned',
  generated: 'asset_generated',
  rendered: 'asset_rendered',
  branded: 'brand_applied',
  exported: 'asset_exported',
  preview: 'preview_available',
} as const;

function humanizeFailure(raw: string | null | undefined, asset: string | null): FailureInfo {
  const s = String(raw ?? '').toLowerCase();
  if (/timeout|timed out|render_job_timeout/.test(s)) return { stage: 'Rendering', reason: 'Generation timed out. Please try again.', asset, retryable: true };
  if (/dead_letter|renderer|render[^a-z]*unavailable|render[^a-z]*fail|worker/.test(s)) return { stage: 'Rendering', reason: 'The renderer was temporarily unavailable. Please retry.', asset, retryable: true };
  if (/publish/.test(s)) return { stage: 'Publishing', reason: 'Publishing is unavailable right now. Your asset is saved — retry publishing shortly.', asset, retryable: true };
  if (/cancel/.test(s)) return { stage: 'Rendering', reason: 'Rendering was cancelled.', asset, retryable: true };
  if (/valid|required|forbidden|claim|rule|reject|missing/.test(s)) return { stage: 'Validation', reason: 'Content validation failed. Adjust the flagged content and retry.', asset, retryable: true };
  return { stage: 'Generation', reason: 'Generation could not be completed. Please retry.', asset, retryable: true };
}

const FAILURE_STAGE_TO_KEY: Record<string, string> = {
  Validation: STAGE_KEYS.validated,
  Rendering: STAGE_KEYS.rendered,
  Publishing: STAGE_KEYS.exported,
  Generation: STAGE_KEYS.generated,
};

/* ── Build ───────────────────────────────────────────────────────────── */

export function buildGenerationReview(input: GenerationReviewInput): GenerationReviewModel {
  const result = obj(input.result);
  const output = obj(result.output);
  const instruction = obj(output.asset_instruction);
  const payload = obj(output.asset_payload);
  const bundle = obj(payload.media_bundle);
  const meta = obj(bundle.metadata);
  const diag = obj(meta.creator_diagnostic_report);
  const diagGen = obj(diag.generation);
  const diagTpl = obj(diag.template);
  const diagRender = obj(diag.rendering);
  const contentVal = obj(diag.contentValidation);
  const visualVal = obj(diag.visualValidation);
  const scores = obj(diag.scores);
  const appliedVariant = obj(meta.applied_variant);
  const generatedAssets = arr(result.generated_assets);

  const hasMedia = truthyMedia(bundle);
  const success = result.success === true;
  const errorRaw = str(input.error);
  const inProgress = !!input.inProgress;

  // Overall status.
  const fanoutFailed = generatedAssets.length > 0 && generatedAssets.every((a) => obj(a).ok === false);
  const fanoutPartial = generatedAssets.length > 0 && generatedAssets.some((a) => obj(a).ok === false) && generatedAssets.some((a) => obj(a).ok !== false);
  let overall: OverallStatus;
  if (inProgress && !errorRaw) overall = 'in_progress';
  else if (errorRaw || fanoutFailed) overall = 'failed';
  else if (fanoutPartial) overall = 'partial';
  else if (success || hasMedia) overall = 'success';
  else overall = 'in_progress';

  // Stage signals (from existing execution data).
  const signals: Record<string, boolean> = {
    [STAGE_KEYS.templateSelected]: !!(str(diagTpl.id) || str(instruction.template_id)),
    [STAGE_KEYS.blueprint]: Object.keys(obj(instruction.blueprint)).length > 0 || !!(str(diagTpl.id) || str(instruction.template_id)),
    [STAGE_KEYS.validated]: Object.keys(contentVal).length > 0,
    [STAGE_KEYS.planned]: Object.keys(obj(instruction.structure)).length > 0,
    [STAGE_KEYS.generated]: success || Object.keys(output).length > 0,
    [STAGE_KEYS.rendered]: hasMedia || typeof visualVal.passed === 'boolean',
    [STAGE_KEYS.branded]: !!str(diagRender.brandingProfile) || Object.keys(obj(scores.brandCompliance)).length > 0,
    [STAGE_KEYS.exported]: !!str(result.persisted_asset_id) || hasMedia,
    [STAGE_KEYS.preview]: hasMedia,
  };

  const STAGE_DEFS: Array<{ key: string; label: string }> = [
    { key: STAGE_KEYS.templateSelected, label: 'Template selected' },
    { key: STAGE_KEYS.blueprint, label: 'Blueprint complete' },
    { key: STAGE_KEYS.validated, label: 'Content validated' },
    { key: STAGE_KEYS.planned, label: 'Content planned' },
    { key: STAGE_KEYS.generated, label: 'Asset generated' },
    { key: STAGE_KEYS.rendered, label: 'Asset rendered' },
    { key: STAGE_KEYS.branded, label: 'Brand applied' },
    { key: STAGE_KEYS.exported, label: 'Asset exported' },
    { key: STAGE_KEYS.preview, label: 'Preview available' },
  ];

  const primaryFailure = errorRaw ? humanizeFailure(errorRaw, null) : null;
  const failureKey = primaryFailure ? FAILURE_STAGE_TO_KEY[primaryFailure.stage] ?? STAGE_KEYS.generated : null;
  const failureIndex = failureKey ? STAGE_DEFS.findIndex((d) => d.key === failureKey) : -1;
  const firstNotDone = STAGE_DEFS.findIndex((d) => !signals[d.key]);

  const stages: PipelineStage[] = STAGE_DEFS.map((d, i) => {
    let status: StageStatus;
    if (overall === 'success' || overall === 'partial') status = 'done';
    else if (overall === 'failed') status = d.key === failureKey ? 'failed' : (failureIndex >= 0 && i < failureIndex ? 'done' : signals[d.key] ? 'done' : 'skipped');
    else status = signals[d.key] ? 'done' : (i === firstNotDone ? 'active' : 'pending');
    return { key: d.key, label: d.label, status };
  });

  // Assets.
  const baseAssetType = str(output.asset_type) ?? str(diagGen.assetType);
  const baseTemplate = str(diagTpl.name) ?? str(diagTpl.id) ?? str(instruction.template_id);
  const baseLayout = str(diagRender.layoutProfile) ?? str(meta.infographic_layout) ?? null;
  const basePlatform = str(diagGen.platform) ?? str(result.primary_platform);
  const basePreview = str(bundle.url) ?? str(arr(bundle.files)[0]);

  const liveStatus = (): AssetReviewStatus => {
    const ps = String(input.progressStatus ?? '').toLowerCase();
    if (/active|running/.test(ps)) return 'rendering';
    if (/queued|waiting/.test(ps)) return 'queued';
    return 'generating';
  };

  let assets: AssetReview[];
  if (generatedAssets.length > 0) {
    assets = generatedAssets.map((a, i) => {
      const ga = obj(a);
      const ok = ga.ok !== false;
      const at = str(ga.asset_type) ?? baseAssetType;
      const failure = ok ? null : humanizeFailure(str(ga.error), assetLabel(at) + (num(ga.rank) != null ? ` #${num(ga.rank)}` : ''));
      return {
        id: str(ga.persisted_asset_id),
        label: assetLabel(at) + (generatedAssets.length > 1 ? ` ${i + 1}` : ''),
        assetType: at ?? 'asset',
        template: str(ga.template_id) ?? baseTemplate,
        layout: baseLayout,
        platform: basePlatform,
        status: ok ? (inProgress ? liveStatus() : 'completed') : 'failed',
        previewUrl: i === 0 ? basePreview : null,
        failure,
      };
    });
  } else {
    assets = [{
      id: str(result.persisted_asset_id),
      label: assetLabel(baseAssetType),
      assetType: baseAssetType ?? 'asset',
      template: baseTemplate,
      layout: baseLayout,
      platform: basePlatform,
      status: overall === 'failed' ? 'failed' : overall === 'in_progress' ? liveStatus() : 'completed',
      previewUrl: basePreview,
      failure: overall === 'failed' ? primaryFailure : null,
    }];
  }

  const failures: FailureInfo[] = [
    ...(primaryFailure ? [primaryFailure] : []),
    ...assets.map((a) => a.failure).filter((f): f is FailureInfo => !!f),
  ];

  // Summary.
  const warningsList: string[] = [
    ...arr(contentVal.warnings).map((w) => String(w)),
    ...arr(contentVal.missingRequiredTerms).map((t) => `Missing required term: ${String(t)}`),
    ...arr(visualVal.failures).map((f) => { const fo = obj(f); return str(fo.message) ?? str(fo.check) ?? 'Visual check warning'; }),
  ];
  const successful = generatedAssets.length > 0 ? generatedAssets.filter((a) => obj(a).ok !== false).length : (overall === 'success' ? 1 : 0);
  const failed = generatedAssets.length > 0 ? generatedAssets.filter((a) => obj(a).ok === false).length : (overall === 'failed' ? 1 : 0);

  const summary: GenerationSummary = {
    assetsGenerated: generatedAssets.length > 0 ? generatedAssets.length : (hasMedia || success ? 1 : 0),
    successful,
    failed,
    warnings: warningsList.length,
    timeTakenMs: num(diagGen.durationMs),
    templateUsed: baseTemplate,
    variantUsed: str(appliedVariant.variant_family) ?? str(obj(generatedAssets[0]).variant_family),
    layoutUsed: baseLayout,
  };

  // Quality (reuse existing validation; no second engine).
  const overallReadinessScore = num(obj(scores.overallReadiness).value);
  const quality: QualitySummary = {
    readinessPassed: overall === 'failed' ? false : overall === 'in_progress' ? null : (overallReadinessScore != null ? overallReadinessScore >= 60 : true),
    templateValidationPassed: Object.keys(contentVal).length > 0 ? arr(contentVal.missingRequiredTerms).length === 0 : (overall === 'success' ? true : null),
    renderingCompleted: typeof visualVal.passed === 'boolean' ? (visualVal.passed as boolean) : (hasMedia ? true : overall === 'failed' ? false : null),
    warnings: warningsList,
  };

  return { overall, stages, assets, failures, summary, quality };
}

/** Display glyph for a pipeline stage. */
export function stageGlyph(status: StageStatus): string {
  return status === 'done' ? '✓' : status === 'failed' ? '✕' : status === 'active' ? '⟳' : status === 'skipped' ? '–' : '○';
}
