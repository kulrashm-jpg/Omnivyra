/**
 * Creator Orchestrator (Phases 2–4 unification).
 *
 * Single shared façade for all three creator entry flows:
 *   - Direct API     (pages/api/command-center/creator-content/generate.ts)
 *   - BOLT runtime   (backend/services/creatorAssetGenerationRuntime.ts)
 *   - Queue worker   (backend/queue/jobProcessors/creatorContentProcessor.ts)
 *
 * Owns the canonical execution chain:
 *
 *   1. resolve creator execution engine
 *   2. generateFromIntent
 *   3. validateCreatorExecutionOutput
 *   4. adaptForPlatform
 *   5. render dispatch (queue OR inline) — strategy from canonical registry
 *   6. mergeRenderedMedia
 *   7. validateAssetReadiness (optional)
 *   8. persist creator_assets row
 *   9. applyTransition (creator lifecycle FSM)
 *  10. return canonical result
 *
 * Pure orchestration — does NOT touch billing/charging, prompt logic,
 * provider logic, or daily_content_plans row mutation. Callers compose
 * those concerns around the orchestrator.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { createCreatorExecutionEngine } from '../executionEngines/creatorExecutionEngine';
import { renderAsset } from '../creatorAssetRenderer';
import { validateAssetReadiness } from '../creatorAssetValidationService';
import { validateCreatorExecutionOutput } from '../creatorExecutionContracts';
import { enqueueDurableCreatorRenderJob } from '../creatorRenderDurableQueue';
import { createCreatorAuditId } from '../creatorRenderObservability';
import {
  attachCreatorAsset,
  upsertCreatorAssetRecord,
} from '../creatorAssetPersistenceService';
import {
  resolveRenderStrategy as _resolveRenderStrategy,
  resolveWriterOrCanonical,
  normalizeCreatorAsset,
  type RenderStrategy,
} from './intelligence/canonical/creatorAssetRegistry';
import { appendVariantTrackingCta } from './creatorVariantLinkBinding';
import { stampAssetAttribution } from './designAttributionService';
import {
  applyTransition,
  LIFECYCLE_STATES,
  type CreatorLifecycleStateExt,
  type LifecycleTransitionResult,
} from '../../../lib/shared/creatorLifecycleStateMachine';
import {
  onAssetGenerated as onEnterpriseAssetGenerated,
  onQaResult as onEnterpriseQaResult,
  onGovernanceResult as onEnterpriseGovernanceResult,
} from './enterpriseGovernanceIntegration';
import type { CanonicalCreatorOutput, CreatorGenerationContext } from '../executionEngines/types';

/* ── Types ──────────────────────────────────────────────────────────── */

export type CreatorOrchestrationOrigin = 'direct' | 'bolt' | 'queue';

export type CreatorOrchestrationInput = {
  /** Logical campaign / session identifier. Direct flow synthesizes one. */
  campaignId: string;
  /** Activity-consumption correlation envelope (forwarded to LLM + media metering). */
  correlation?: import('../../../lib/shared/observability/correlationRef').CorrelationRef;
  companyId: string;
  userId: string | null;
  topic: string;
  /**
   * Accepts canonical key, runtime alias (`reels`, `youtube_short`,
   * `pdf`, `slider`, …), or writer-side subtype (`supporting_image`,
   * `banner`, `brand_card`, …). Resolved through the registry.
   */
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard?: Record<string, unknown>;
  enrichedIntent?: Record<string, unknown> | null;
  templateId?: string | null;
  existingContent?: Record<string, unknown> | null;

  /** Persistence origin — drives source_type + metadata fields. */
  origin: CreatorOrchestrationOrigin;
  /** Writer source binding (post/thread + sourceId) when origin === 'direct'. */
  source?: { sourceType?: 'post' | 'thread' | null; sourceId?: string | null };
  /** BOLT daily_content_plans row id when origin === 'bolt'. */
  dailyPlanId?: string | null;

  /**
   * Override the registry-derived render strategy. Use sparingly — the
   * default (registry-driven) is what gives the three flows their shared
   * dispatch behaviour. Honoured for forward-compat / migration only.
   */
  renderStrategyOverride?: RenderStrategy;

  /**
   * Skip the validateAssetReadiness post-render check. Direct flow keeps
   * this true today (matched legacy behaviour); BOLT keeps it false
   * (it gates lifecycle on readiness).
   */
  skipReadinessValidation?: boolean;

  /**
   * Skip the persistence + lifecycle steps. Direct flow can still opt
   * out (when callers want to return draft output without committing a
   * creator_assets row), but defaults to FALSE in this phase so Direct
   * becomes standalone-usable (Phase 5).
   */
  skipPersistence?: boolean;

  /**
   * Final Corrective Pass — P1-1. Optional pre-resolved variant
   * applied to this generation. When present, the orchestrator merges
   * `{ variant_id, variant_family, strategy_id }` into the
   * media_bundle.metadata envelope so the canonical
   * `creatorAssetRenderer` picks it up via its existing variant path.
   *
   * Populated by the campaign runner when the campaign carries a
   * persisted `execution_config.variant_strategy`. Direct / writer
   * flows leave this null and behave exactly as before.
   */
  appliedVariant?: {
    strategy_id: string;
    variant_id: string;
    variant_family: string;
  } | null;

  /**
   * UNIFY MASTER GENERATION — the canonical brand voice resolved ONCE by the
   * caller (generate route) via the shared Context Assembly. When present, the
   * orchestrator applies the SAME deterministic copy validation that field
   * assist uses to the generated copy (overlay / slides / sections) before
   * render. No second brand lookup happens here. Null/empty → unchanged.
   */
  canonicalBrandVoice?: import('./creatorCopyContextResolver').CreatorBrandVoice | null;
};

export type CreatorOrchestrationResult = {
  /** Canonical engine output after generate→adapt→render. */
  output: CanonicalCreatorOutput;
  /** Render dispatch path actually taken. */
  renderStrategy: RenderStrategy;
  /** Durable render job handle when renderStrategy === 'queue'. */
  renderJob?: { id: string; audit_id: string } | null;
  /** `creator_assets.id` when persisted; null when skipped. */
  persistedAssetId: string | null;
  /** Per-row readiness result when validation was run. */
  readiness?: { ready: boolean; failure_reason?: string };
  /** FSM transition result; callers may persist the lifecycle history. */
  lifecycleTransition: LifecycleTransitionResult | null;
};

/* ── Helpers ────────────────────────────────────────────────────────── */

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hashAsset(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function mergeRenderedMedia(
  output: CanonicalCreatorOutput,
  rendered: { url?: string | null; files?: string[] | null; metadata?: Record<string, unknown> | null },
): CanonicalCreatorOutput {
  const payload = safeObject(output.asset_payload);
  const mediaBundle = safeObject(payload.media_bundle);
  const url = typeof rendered.url === 'string' ? rendered.url : undefined;
  const files = Array.isArray(rendered.files) ? rendered.files.filter(Boolean).map(String) : undefined;
  return {
    ...output,
    asset_payload: {
      ...payload,
      media_bundle: {
        ...mediaBundle,
        ...(url ? { url } : {}),
        ...(files && files.length > 0 ? { files } : {}),
        metadata: {
          ...safeObject(mediaBundle.metadata),
          ...safeObject(rendered.metadata),
        },
      },
    },
  };
}

function extractMediaUrls(output: CanonicalCreatorOutput): string[] {
  const payload = safeObject(output.asset_payload);
  const mediaBundle = safeObject(payload.media_bundle);
  const url = typeof mediaBundle.url === 'string' ? mediaBundle.url : '';
  const files = Array.isArray(mediaBundle.files) ? mediaBundle.files.map(String) : [];
  return [url, ...files].map((s) => s.trim()).filter(Boolean);
}

/**
 * Persist a creator_assets row. Phase 4 unification — routes through the
 * canonical creatorAssetPersistenceService instead of an ad-hoc upsert.
 *
 * - BOLT origin: continues to use the legacy `bolt-render-<rowId>-<hash:16>`
 *   id directly via `ownedDbTable.upsert` so re-runs against
 *   pre-Phase-4 rows upsert in place (no orphan migration).
 * - Direct / queue origin: uses `attachCreatorAsset` when writer source
 *   binding is present (writes BOTH creator_assets AND
 *   creator_asset_attachments) — convergent with the writer's POST to
 *   `/api/creator-assets/attachments`, eliminating the divergent
 *   parallel write path. Falls back to `upsertCreatorAssetRecord`
 *   (creator_assets only) when there is no writer binding.
 */
async function persistCreatorAssetRow(input: {
  origin: CreatorOrchestrationOrigin;
  campaignId: string;
  companyId: string;
  userId: string | null;
  output: CanonicalCreatorOutput;
  contentType: string;
  primaryPlatform: string;
  dailyPlanId?: string | null;
  source?: { sourceType?: 'post' | 'thread' | null; sourceId?: string | null };
  lifecycleHistory?: { from: string | null; to: string; at: string; reason?: string } | null;
  lifecycleState?: string | null;
}): Promise<string | null> {
  const mediaBundle = safeObject(safeObject(input.output.asset_payload).media_bundle);
  const urls = extractMediaUrls(input.output);
  const sourceType = input.source?.sourceType ?? null;
  const sourceId = input.dailyPlanId ?? input.source?.sourceId ?? null;
  const assetHashBolt = hashAsset({
    row: sourceId,
    asset_type: input.output.asset_type,
    payload: input.output.asset_payload,
    caption: input.output.packaging.caption,
  });
  const renderIdentityHash = assetHashBolt; // deterministic content fingerprint reused across origins
  const title = String(
    safeObject(input.output.metadata).topic
      || input.output.packaging.meta_description
      || 'Creator asset'
  ).trim() || 'Creator asset';

  const sharedMetadata: Record<string, unknown> = {
    ...safeObject(mediaBundle.metadata),
    origin: input.origin,
    campaign_id: input.campaignId,
    daily_plan_id: input.dailyPlanId ?? null,
    writer_source_id: input.source?.sourceId ?? null,
    writer_source_type: sourceType,
    content_type: input.contentType,
    asset_type: input.output.asset_type,
    export_ready: urls.length > 0,
    ...(input.lifecycleState ? { creator_lifecycle_state: input.lifecycleState } : {}),
    ...(input.lifecycleHistory ? { creator_lifecycle_last_transition: input.lifecycleHistory } : {}),
  };
  const previewKind = String(safeObject(mediaBundle.metadata).preview_kind || input.output.asset_type);
  const creatorType = String(input.contentType || input.output.asset_type);

  // ── CANONICAL DESIGN ATTRIBUTION SEAM ──────────────────────────────────
  // Stamp the immutable Template / Collection / Campaign-Design-System
  // provenance onto the asset metadata exactly ONCE, here — the single point
  // where every origin (bolt + direct/queue) and every family (image / carousel
  // / infographic) converges on `sharedMetadata` before persistence. The stamp
  // rides the existing metadata unchanged through publishing + analytics
  // (additive only; no generation/render change). Immutable once set.
  const card = safeObject(sharedMetadata.creator_card);
  const attrTemplateId = (typeof sharedMetadata.template_id === 'string' && sharedMetadata.template_id.trim()) ? sharedMetadata.template_id.trim()
    : (typeof sharedMetadata.infographic_template_id === 'string' && sharedMetadata.infographic_template_id.trim()) ? sharedMetadata.infographic_template_id.trim()
      : (typeof card.template_id === 'string' && card.template_id.trim()) ? card.template_id.trim() : null;
  const attrVersionRaw = sharedMetadata.template_version ?? card.template_version;
  const attrTemplateVersion = typeof attrVersionRaw === 'number' ? attrVersionRaw
    : Number.isFinite(Number(attrVersionRaw)) ? Number(attrVersionRaw) : null;
  const attributedMetadata = await stampAssetAttribution(sharedMetadata, {
    campaignId: input.campaignId,
    templateId: attrTemplateId,
    templateVersion: attrTemplateVersion,
  });

  // BOLT branch — preserves legacy `bolt-render-<rowId>-<hash:16>` id so
  // pre-existing creator_assets rows from the prior runtime are upserted
  // in place (no orphan creation, no destructive migration).
  if (input.origin === 'bolt') {
    const assetId = `bolt-render-${(sourceId || input.campaignId)}-${assetHashBolt.slice(0, 16)}`;
    const row = {
      id: assetId,
      tenant_id: input.companyId,
      company_id: input.companyId,
      user_id: input.userId,
      source_type: sourceType,
      source_id: sourceId,
      creator_type: creatorType,
      title,
      url: urls[0] ?? null,
      files: urls,
      preview_kind: previewKind,
      platform_context: String(input.primaryPlatform || ''),
      metadata: attributedMetadata,
      source_content: input.output as unknown as Record<string, unknown>,
      render_identity_hash: renderIdentityHash,
      updated_at: new Date().toISOString(),
    };
    const { error } = await ownedDbTable('creator_assets').upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn('[creator-orchestrator][asset-persist-failed]', {
        origin: input.origin,
        campaign_id: input.campaignId,
        source_id: sourceId,
        message: error.message,
      });
      return null;
    }
    return assetId;
  }

  // Direct / queue branch — delegate to the canonical persistence
  // service. When the request carries a writer source binding, use
  // attachCreatorAsset so BOTH creator_assets AND creator_asset_attachments
  // converge on the same id (eliminating the prior dual-write
  // divergence between the orchestrator and the attachments endpoint).
  try {
    const userId = input.userId || input.companyId;
    if (sourceType && sourceId) {
      const result = await attachCreatorAsset({
        tenantId: input.companyId,
        companyId: input.companyId,
        userId,
        sourceType,
        sourceId,
        creatorType,
        title,
        url: urls[0] ?? null,
        files: urls,
        previewKind,
        platformContext: input.primaryPlatform || null,
        attachmentOrder: 0,
        metadata: attributedMetadata,
        sourceContent: input.output as unknown as Record<string, unknown>,
        renderIdentityHash,
      });
      return String((result as Record<string, unknown>).creator_asset_id ?? (result as Record<string, unknown>).id ?? '');
    }
    const asset = await upsertCreatorAssetRecord({
      tenantId: input.companyId,
      companyId: input.companyId,
      userId,
      sourceType: null,
      sourceId: null,
      creatorType,
      title,
      url: urls[0] ?? null,
      files: urls,
      previewKind,
      platformContext: input.primaryPlatform || null,
      metadata: attributedMetadata,
      sourceContent: input.output as unknown as Record<string, unknown>,
      renderIdentityHash,
    });
    return String((asset as Record<string, unknown>).id ?? '');
  } catch (error) {
    console.warn('[creator-orchestrator][asset-persist-failed]', {
      origin: input.origin,
      campaign_id: input.campaignId,
      source_id: sourceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/* ── Render dispatch (Phase 3) ──────────────────────────────────────── */

async function runRenderDispatch(input: {
  output: CanonicalCreatorOutput;
  contentType: string;
  primaryPlatform: string;
  companyId: string;
  userId: string | null;
  campaignId: string | null;
  strategy: RenderStrategy;
}): Promise<{ output: CanonicalCreatorOutput; renderJob: { id: string; audit_id: string } | null }> {
  const renderInput = safeObject(input.output.asset_payload);

  if (input.strategy === 'queue') {
    const auditId = createCreatorAuditId({
      companyId: input.companyId,
      contentType: input.contentType,
      platform: input.primaryPlatform,
      renderInput,
    });
    const renderJob = await enqueueDurableCreatorRenderJob({
      idempotencyKey: `creator-render:${input.companyId}:${input.contentType}:${input.primaryPlatform}:${JSON.stringify(renderInput).slice(0, 500)}`,
      renderer: input.contentType as 'carousel' | 'pdf' | 'slider' | 'infographic',
      auditId,
      timeoutMs: 180_000,
      maxAttempts: 3,
      payload: {
        assetPayload: renderInput,
        options: {
          campaignId: input.campaignId,
          userId: input.userId,
          companyId: input.companyId,
        },
      },
    });
    const merged = mergeRenderedMedia(input.output, {
      metadata: {
        render_async: true,
        render_job: renderJob,
        render_audit_id: auditId,
      },
    });
    return { output: merged, renderJob: { id: String((renderJob as any)?.id ?? auditId), audit_id: auditId } };
  }

  if (input.strategy === 'inline') {
    // PART A — register a user template_id before the inline render.
    try {
      const { ensureUserTemplateRegisteredForAsset } = await import('./userTemplateService');
      await ensureUserTemplateRegisteredForAsset(renderInput);
    } catch { /* best-effort */ }
    const rendered = await renderAsset(renderInput, {
      campaignId: input.campaignId,
      userId: input.userId,
      companyId: input.companyId,
    });
    return { output: mergeRenderedMedia(input.output, rendered), renderJob: null };
  }

  // skipped — leave the adapted output untouched
  return { output: input.output, renderJob: null };
}

/* ── Public orchestrator entry point ────────────────────────────────── */

export async function runCreatorOrchestration(
  input: CreatorOrchestrationInput,
): Promise<CreatorOrchestrationResult> {
  if (!input.companyId) throw new Error('creator orchestrator: companyId required');
  if (!input.topic) throw new Error('creator orchestrator: topic required');
  if (!input.contentType) throw new Error('creator orchestrator: contentType required');
  if (!Array.isArray(input.targetPlatforms) || input.targetPlatforms.length === 0) {
    throw new Error('creator orchestrator: targetPlatforms required');
  }

  // Normalize the content type → canonical key for downstream decisions.
  // Falls back to the raw string so legacy callsites continue to work.
  const canonicalKey = resolveWriterOrCanonical(input.contentType) ?? normalizeCreatorAsset(input.contentType);
  const effectiveContentType = canonicalKey ?? input.contentType;
  const strategy: RenderStrategy = input.renderStrategyOverride
    ?? _resolveRenderStrategy(input.contentType);

  const engine = createCreatorExecutionEngine();
  const primaryPlatform = String(input.targetPlatforms[0] || 'linkedin').toLowerCase();

  // CAMPAIGN-003 — template-aware plan gate at the single canonical generation
  // entry. When an asset selects a template that RESOLVES, the planned asset
  // must be compatible with the template's contract (family / slide / section /
  // layout / CTA) BEFORE generation. Unresolved template ids are a no-op (the
  // renderer falls back to the default style → legacy/stale campaigns unbroken).
  {
    const card = safeObject(input.creatorCard);
    if (typeof card.template_id === 'string' && card.template_id.trim()) {
      const { validatePlannedCard } = await import('./campaignPlanValidationService');
      const planCheck = await validatePlannedCard(card, effectiveContentType);
      if (planCheck && !planCheck.ok) {
        throw new Error(`Invalid campaign plan — generated asset rejected before generation: ${planCheck.errors.join(' ')}`);
      }
    }
  }

  // Final Corrective Pass — P2-2. Generation telemetry. The orchestrator
  // is the single canonical entry point for asset generation (direct +
  // BOLT + queue origins), so measuring duration here populates the
  // `generation` telemetry category for ALL surfaces.
  const generationStartedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  let generationOk = false;

  try {

  // 1) generate
  const generationCtx: CreatorGenerationContext = {
    campaignId: input.campaignId,
    correlation: input.correlation ?? { referenceType: 'creator_asset', referenceId: input.campaignId, parentActivityId: input.campaignId },
    companyId: input.companyId,
    userId: input.userId,
    topic: input.topic,
    contentType: effectiveContentType,
    targetPlatforms: input.targetPlatforms,
    audience: input.audience,
    objective: input.objective,
    summary: input.summary,
    creatorCard: input.creatorCard,
    enrichedIntent: input.enrichedIntent ?? undefined,
    // Carousel Phase A — Commit 1 (arc wiring). Thread the PurposeStrategy
    // selector key from the canonical creatorCard chain so the engine can
    // resolve the arc for all surfaces (direct + BOLT + queue). Optional and
    // null-safe: legacy rows without a key fall back to existing behavior.
    purposeKey: (() => {
      const card = safeObject(input.creatorCard);
      const key = String(
        card.purpose_key
        || card.infographic_layout
        || card.subtype
        || ''
      ).trim();
      return key || null;
    })(),
    templateId: input.templateId ?? null,
    existingContent: input.existingContent ?? null,
  };
  const generated = await (engine as any).generateFromIntent(
    generationCtx,
    { companyId: input.companyId },
    { assetOverride: safeObject(safeObject(input.existingContent).asset_payload || safeObject(input.existingContent).creator_asset) },
  ) as CanonicalCreatorOutput;

  // Final Corrective Pass — P1-1. Merge the campaign-resolved variant
  // (if any) into media_bundle.metadata BEFORE adapt + render so the
  // renderer's existing variant path picks it up. No behavior change
  // when appliedVariant is null.
  const generatedWithVariant: CanonicalCreatorOutput = input.appliedVariant
    ? mergeAppliedVariantIntoOutput(generated, input.appliedVariant)
    : generated;

  const generatedValidation = validateCreatorExecutionOutput(generatedWithVariant);
  if (!generatedValidation.ok) {
    throw new Error(`creator orchestrator: generation output failed validation: ${generatedValidation.issues.join('; ')}`);
  }

  // 2) adapt
  const adapted = await engine.adaptForPlatform(generatedWithVariant, primaryPlatform) as CanonicalCreatorOutput;

  // 2b) Template Content Ingestion — when a creator template supplied
  //     user-entered structured content (carousel slides / infographic
  //     sections), it is AUTHORITATIVE. Authored entries are honored verbatim
  //     (no rewrite / reorder / summarization); only EMPTY carousel slots are
  //     filled from the generated draft (deterministic partial generation).
  //     No-op for non-template and AI-only flows → byte-identical passthrough.
  const { applyAuthoritativeTemplateContent } =
    require('./templateContentIngestion') as typeof import('./templateContentIngestion');
  const ingestion = applyAuthoritativeTemplateContent(
    adapted as unknown as Record<string, unknown>,
    safeObject(input.creatorCard),
    effectiveContentType,
  );
  let renderReady = ingestion.output as unknown as CanonicalCreatorOutput;
  if (ingestion.applied) {
    console.info('[creator-orchestrator][template-content-ingested]', {
      applied: ingestion.applied,
      authored: ingestion.authoredCount,
      filled_from_generated: ingestion.filledFromGenerated,
      content_type: effectiveContentType,
    });
  }

  // 2c) UNIFY MASTER GENERATION — apply the SAME canonical deterministic copy
  //     validation field assist uses to the MASTER-generated copy (overlay /
  //     slides / sections) before render. Uses the brand voice resolved ONCE by
  //     the caller (no second brand lookup). No-op when the brand defines no
  //     constraints, so existing (no-brand-vocabulary) flows are byte-identical.
  let masterCopyViolations: import('./creatorCopyValidation').CopyViolation[] = [];
  if (input.canonicalBrandVoice) {
    const { validateCreatorOutputCopy } =
      require('./creatorCopyValidation') as typeof import('./creatorCopyValidation');
    const copyValidation = validateCreatorOutputCopy(
      safeObject((renderReady as unknown as Record<string, unknown>).asset_payload),
      input.canonicalBrandVoice,
    );
    masterCopyViolations = copyValidation.violations;
    if (copyValidation.repaired) {
      renderReady = {
        ...(renderReady as unknown as Record<string, unknown>),
        asset_payload: copyValidation.assetPayload,
      } as unknown as CanonicalCreatorOutput;
      console.info('[creator-orchestrator][canonical-copy-validated]', {
        violations: copyValidation.violations.length,
        content_type: effectiveContentType,
      });
    }
  }

  // 3) render
  const renderResult = await runRenderDispatch({
    output: renderReady,
    contentType: effectiveContentType,
    primaryPlatform,
    companyId: input.companyId,
    userId: input.userId,
    campaignId: input.campaignId,
    strategy,
  });

  // 3b) CREATOR DIAGNOSTIC REPORT — deterministic, READ-ONLY inspection artifact
  //     assembled from signals already produced (context assembly, content
  //     validation, render metadata, visual validation). Attached to
  //     generation metadata. Never changes generation/rendering. Best-effort.
  try {
    const { buildCreatorDiagnosticReport } =
      require('./creatorDiagnosticReport') as typeof import('./creatorDiagnosticReport');
    const card = safeObject(input.creatorCard);
    const renderedPayload = safeObject((renderResult.output as unknown as Record<string, unknown>).asset_payload);
    const renderMeta = safeObject(safeObject(renderedPayload.media_bundle).metadata);
    const report = buildCreatorDiagnosticReport({
      assetType: effectiveContentType,
      contentType: input.contentType,
      platform: primaryPlatform,
      companyId: input.companyId,
      durationMs: Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - generationStartedAt),
      template: card.template_id ? {
        id: String(card.template_id),
        version: typeof card.template_version === 'number' ? card.template_version : undefined,
        assetFamily: typeof card.template_asset_family === 'string' ? String(card.template_asset_family) : undefined,
        renderingContractVersion: typeof renderMeta.renderingContractVersion === 'string' ? String(renderMeta.renderingContractVersion) : undefined,
      } : undefined,
      companyContext: safeObject(card.canonical_company_context),
      brandVoice: (input.canonicalBrandVoice ?? safeObject(card.canonical_brand_voice)) as Record<string, unknown>,
      contentViolations: masterCopyViolations,
      renderMetadata: renderMeta,
    });
    renderResult.output = {
      ...(renderResult.output as unknown as Record<string, unknown>),
      asset_payload: {
        ...renderedPayload,
        media_bundle: {
          ...safeObject(renderedPayload.media_bundle),
          metadata: { ...renderMeta, creator_diagnostic_report: report },
        },
      },
    } as unknown as CanonicalCreatorOutput;
  } catch (error) {
    console.warn('[creator-orchestrator][diagnostic-report-failed]', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // 4) optional readiness
  let readiness: { ready: boolean; failure_reason?: string } | undefined;
  if (!input.skipReadinessValidation && strategy !== 'skipped') {
    try {
      const readinessResult = await validateAssetReadiness({
        output: renderResult.output,
        platform: primaryPlatform,
      });
      readiness = { ready: !!readinessResult.ready, failure_reason: readinessResult.failure_reason ?? undefined };
    } catch (error) {
      readiness = { ready: false, failure_reason: error instanceof Error ? error.message : String(error) };
    }
  }

  // 4b) Variant link binding — when a variant was applied, bind THIS asset's
  //     own variant identity into a tracking link and append it to the CTA,
  //     BEFORE persist so the persisted content (and downstream scheduling /
  //     publishing) carry omn_variant_id directly. Best-effort: never blocks
  //     generation. Skipped entirely when no variant was applied (legacy
  //     parity). Writes only packaging.cta → BOLT asset-id hash unchanged.
  renderResult.output = await appendVariantTrackingCta(
    renderResult.output,
    { companyId: input.companyId, campaignId: input.campaignId },
    input.appliedVariant,
    primaryPlatform,
    effectiveContentType,
  );

  // 5) lifecycle FSM (compute BEFORE persistence so the transition
  //    history lands on the creator_assets row metadata — making FSM
  //    coverage flow-agnostic across direct / bolt / queue origins).
  let lifecycleTransition: LifecycleTransitionResult | null = null;
  let persistedAssetId: string | null = null;

  if (!input.skipPersistence) {
    const targetState: CreatorLifecycleStateExt = (() => {
      if (strategy === 'skipped') return LIFECYCLE_STATES.AWAITING_MEDIA_UPLOAD;
      if (readiness && !readiness.ready) return LIFECYCLE_STATES.RENDER_FAILED;
      return LIFECYCLE_STATES.RENDER_READY;
    })();

    try {
      lifecycleTransition = applyTransition(
        safeObject(input.existingContent),
        targetState,
        {
          reason: `creator_orchestrator:${input.origin}:${targetState}`,
          contentPatch: {
            render_policy: { mode: strategy === 'queue' ? 'render_async' : strategy === 'inline' ? 'render_inline' : 'attachment_required' },
          },
        },
      );
    } catch (error) {
      // FSM transitions are best-effort for non-BOLT origins (writer/direct
      // assets often have null prior state). Log + continue — persistence
      // proceeds without the transition envelope.
      console.warn('[creator-orchestrator][lifecycle-transition-failed]', {
        origin: input.origin,
        target: targetState,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // 6) persist creator_assets row. Lifecycle history (from step 5)
    //    rides in metadata so the row carries the audit envelope even
    //    when there is no daily_content_plans row to project onto.
    persistedAssetId = await persistCreatorAssetRow({
      origin: input.origin,
      campaignId: input.campaignId,
      companyId: input.companyId,
      userId: input.userId,
      output: renderResult.output,
      contentType: effectiveContentType,
      primaryPlatform,
      dailyPlanId: input.dailyPlanId,
      source: input.source,
      lifecycleHistory: lifecycleTransition?.historyEntry ?? null,
      lifecycleState: lifecycleTransition?.to ?? null,
    });

    // Enterprise governance — best-effort runtime wiring. Feature-flag
    // gated; failures are swallowed and never block the orchestrator.
    if (persistedAssetId) {
      try {
        await onEnterpriseAssetGenerated({
          assetId: persistedAssetId,
          companyId: input.companyId,
          campaignId: input.campaignId,
          actorUserId: input.userId,
          actorRole: null,
        });

        // Wire QA + governance outcomes from the render metadata into
        // the governance facade so escalations + state advancement fire
        // automatically. The renderer writes both envelopes onto
        // `media_bundle.metadata.render_qa` / `media_bundle.metadata.render_governance`;
        // we read them here where the canonical assetId is known.
        const mediaMeta = safeObject(safeObject(renderResult.output.asset_payload).media_bundle).metadata;
        const renderQa = safeObject((mediaMeta as Record<string, unknown> | undefined)?.render_qa);
        const renderGov = safeObject((mediaMeta as Record<string, unknown> | undefined)?.render_governance);
        if (Object.keys(renderQa).length > 0) {
          const qaSeverity = typeof renderQa.qa_severity === 'string'
            ? (renderQa.qa_severity as 'pass' | 'warning' | 'fail' | 'reject')
            : 'pass';
          const qaScore = typeof renderQa.qa_score === 'number' ? renderQa.qa_score : null;
          const govScore = typeof renderGov.governanceScore === 'number' ? renderGov.governanceScore : null;
          const govRejected = renderGov.rejectGeneration === true;
          await onEnterpriseQaResult({
            assetId: persistedAssetId,
            companyId: input.companyId,
            campaignId: input.campaignId,
            qaSeverity,
            qaScore,
            governanceScore: govScore,
            governanceRejected: govRejected,
          });
          if (govScore !== null) {
            await onEnterpriseGovernanceResult({
              assetId: persistedAssetId,
              companyId: input.companyId,
              campaignId: input.campaignId,
              passed: !govRejected,
              governanceScore: govScore,
              rejectionReason: govRejected ? 'governance_engine_rejected' : null,
            });
          }
        }
      } catch (error) {
        console.warn('[creator-orchestrator][enterprise-gov-hook-failed]', {
          assetId: persistedAssetId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Final Corrective Pass — P2-1. Notify the experiment tracker that
  // an asset finished generation. Resolves the variant id from either
  // the explicitly-applied campaign variant OR (fallback) from the
  // rendered media_bundle.metadata.applied_variant envelope written by
  // the renderer when it resolved a variant during render.
  try {
    const renderedMediaMeta = safeObject(safeObject(renderResult.output.asset_payload).media_bundle).metadata as Record<string, unknown> | undefined;
    const applied = renderedMediaMeta && typeof renderedMediaMeta === 'object'
      ? renderedMediaMeta.applied_variant
      : null;
    const fallbackVariantId = applied && typeof applied === 'object' && !Array.isArray(applied)
      ? typeof (applied as Record<string, unknown>).variant_id === 'string'
        ? (applied as Record<string, unknown>).variant_id as string
        : null
      : null;
    const resolvedVariantId = input.appliedVariant?.variant_id ?? fallbackVariantId;
    if (resolvedVariantId) {
      const { notifyExperimentAssetGenerated } =
        require('./variantExperimentLifecycle') as typeof import('./variantExperimentLifecycle');
      notifyExperimentAssetGenerated({
        companyId: input.companyId,
        variantId: resolvedVariantId,
        assetId: persistedAssetId,
      });
    }
  } catch {
    // Best-effort.
  }

  generationOk = true;
  return {
    output: renderResult.output,
    renderStrategy: strategy,
    renderJob: renderResult.renderJob,
    persistedAssetId,
    readiness,
    lifecycleTransition,
  };
  } finally {
    // Final Corrective Pass — P2-2. Record generation duration in
    // ALL cases (success + failure) so the `generation` telemetry
    // category reflects real activity. Bounded ring buffer caps
    // memory.
    try {
      const generationEndedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const { recordVariantTimingSample } =
        require('./variantPerformanceTelemetry') as typeof import('./variantPerformanceTelemetry');
      recordVariantTimingSample(
        'generation',
        generationEndedAt - generationStartedAt,
        generationOk,
        { origin: input.origin, content_type: effectiveContentType, has_variant: Boolean(input.appliedVariant) },
      );
    } catch {
      // Best-effort.
    }
  }
}

/* ── Helper: merge campaign-applied variant into output (P1-1) ───────── */

function mergeAppliedVariantIntoOutput(
  output: CanonicalCreatorOutput,
  applied: { strategy_id: string; variant_id: string; variant_family: string },
): CanonicalCreatorOutput {
  const payload = safeObject(output.asset_payload);
  const mediaBundle = safeObject(payload.media_bundle);
  const existingMeta = safeObject(mediaBundle.metadata);
  // Only set the variant envelope when caller-supplied — never
  // overwrite an upstream-resolved variant_id (defensive).
  const existingAppliedVariant = safeObject(existingMeta.applied_variant);
  const mergedMeta: Record<string, unknown> = {
    ...existingMeta,
    variant_id: existingMeta.variant_id ?? applied.variant_id,
    variant_family: existingMeta.variant_family ?? applied.variant_family,
    applied_variant: {
      ...existingAppliedVariant,
      strategy_id: existingAppliedVariant.strategy_id ?? applied.strategy_id,
      variant_id: existingAppliedVariant.variant_id ?? applied.variant_id,
      variant_family: existingAppliedVariant.variant_family ?? applied.variant_family,
    },
  };
  return {
    ...output,
    asset_payload: {
      ...payload,
      media_bundle: {
        ...mediaBundle,
        metadata: mergedMeta,
      },
    },
  };
}
