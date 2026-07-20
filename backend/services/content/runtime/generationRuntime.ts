/**
 * Writer Wave 3 — AI Runtime Consolidation: THE GENERATION RUNTIME.
 *
 * ONE reusable pipeline that every interactive Writer generation flows through.
 * It is the EXTRACTION of the orchestration runPostGeneration performs today
 * (context → generate master → variants) into a single seam, plus the Wave-2
 * originality gate and Wave-1 canonical persistence, wired under the Wave-3 task
 * policy / retry / observability primitives. It does NOT reimplement generation,
 * originality, or persistence — it composes the existing services in a fixed,
 * observable order.
 *
 * PIPELINE (in order):
 *   1. Context Resolution     → resolveContentContext + getBrandMemory (+ platform profile)
 *   2. Prompt Assembly        → promptAssembler.assemble (the single assembly path)
 *   3. Originality Preparation→ retrieveRelevant (light history retrieval)
 *   4. Generation             → generateMasterContentFromIntent via executeWithRetry(getTaskPolicy)
 *   5. Originality Validation → assertOriginality + regenerateUntilOriginal
 *   6. Persistence            → createContent + indexContentUnit + persistOriginality
 *   7. Variant Generation     → buildPlatformVariantsFromMaster + deterministicFormatter
 *   8. Observability          → runtimeMetrics at each stage
 *
 * FAIL-OPEN CONTRACT — everything AFTER generation (originality validation,
 * persistence, variants, observability) is best-effort. A failure in any of those
 * stages is recorded (runtime.failures) and swallowed; it can NEVER break the
 * generation. Only stages 1–4 (producing the master) can fail the call, exactly
 * as the underlying primitives do today.
 */

import type {
  ContextResolver,
  GenerationContext,
  GenerationOutput,
  GenerationRequest,
  GenerationRuntime,
  ImagePromptSpec,
  SemanticContinuity,
  SemanticRoot,
  VisualBrief,
} from './contracts';
import {
  buildSemanticContinuity,
  buildSemanticRoot,
  deriveImagePromptSpec,
  deriveVisualBrief,
  isSemanticRootEnabled,
} from './semanticSpine';
import {
  assertStageContinuity,
  assertValidSemanticRoot,
  assertVariantsPreserveIntent,
  checkArtifactInheritsRoot,
  SemanticContinuityError,
  stampVariantSemanticIdentity,
} from './semanticContinuityGuard';
import type { CanonicalContentType } from '../../../../lib/content/canonicalContent';
import type { OriginalityResult } from '../../../../lib/content/originality/types';
import type {
  DailyExecutionItemLike,
  MasterContentPayload,
  PlatformVariantPayload,
} from '../../contentGeneration/types';

import { getTaskPolicy } from './taskPolicyRegistry';
import { executeWithRetry } from './retryPolicy';
import { runtimeMetrics } from './runtimeMetrics';
import { assembleGenerationPrompt } from './promptAssembler';
import { deterministicFormatter } from './deterministicFormatter';

import { resolveContentContext } from '../../context/canonicalContentContextResolver';
import { getPlatformProfile } from '../../../../lib/content/platformAdaptationProfiles';
import {
  getBrandMemory,
  retrieveRelevant,
  indexContentUnit,
  persistOriginality,
} from '../contentMemoryService';
import { assertOriginality } from '../originalityGate';
import { regenerateUntilOriginal } from '../originalityRegeneration';
import { createContent, type CreateContentInput } from '../contentService';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../contentGenerationPipeline';
import { startTimer } from '../../../observability/metrics';

/** Originality regeneration attempts (distinct from transient-error retries). */
const ORIGINALITY_MAX_ATTEMPTS = Math.max(
  1,
  Math.trunc(Number(process.env.RUNTIME_ORIGINALITY_MAX_ATTEMPTS) || 2),
);
/** Candidate history depth for the light originality-prep retrieval. */
const ORIGINALITY_PREP_LIMIT = 25;

/** The canonical ordered stage names — the observable pipeline contract. */
export const RUNTIME_STAGES = [
  'context',
  'prompt_assembly',
  'originality_prep',
  'generation',
  'originality_validation',
  'persistence',
  'variants',
  'observability',
] as const;

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function reqField<T = unknown>(req: GenerationRequest, key: string): T | undefined {
  return (req as Record<string, unknown>)[key] as T | undefined;
}

function targetPlatformsOf(req: GenerationRequest): string[] {
  const raw = reqField<unknown>(req, 'targetPlatforms');
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((p) => String(p ?? '').toLowerCase()).filter(Boolean);
  }
  if (req.platform) return [String(req.platform).toLowerCase()];
  return ['linkedin'];
}

// ── Stage 1 — Context Resolution ──────────────────────────────────────────────

/**
 * Default context resolver: reuses the canonical content-context resolver plus
 * the Wave-2 brand rollup and the canonical platform-adaptation profile. Never
 * throws — a failed brand read degrades to null (getBrandMemory is fail-safe).
 */
export const contextResolver: ContextResolver = {
  async resolve(req: GenerationRequest): Promise<GenerationContext> {
    const norm = await resolveContentContext(req.companyId, {
      objective: req.objective ?? null,
    });
    const brandMemory = await getBrandMemory(req.companyId); // fail-safe → null on error

    const platforms = targetPlatformsOf(req);
    const primaryPlatform = platforms[0];
    const platformProfile = getPlatformProfile(primaryPlatform);

    const audience = trimmed(reqField(req, 'audience')) || trimmed(norm.audience);
    const tone = trimmed(reqField(req, 'tone')) || trimmed(norm.tone);

    return {
      companyId: req.companyId,
      contentType: req.contentType,
      platform: primaryPlatform,
      campaignId: req.campaignId,
      objective: norm.objective ?? req.objective ?? undefined,
      audience: audience || undefined,
      tone: tone || undefined,
      brand: { normalized: norm, brandMemory },
      platformProfile,
      originalityContext: undefined,
      brief: req.brief,
      raw: { ...(req as Record<string, unknown>), targetPlatforms: platforms, primaryPlatform },
    };
  },
};

// ── Stage 7 — Variant Generation (fail-open) ─────────────────────────────────

async function runVariantGeneration(
  item: DailyExecutionItemLike,
  master: MasterContentPayload,
  platforms: string[],
): Promise<PlatformVariantPayload[]> {
  const variantItem: DailyExecutionItemLike = {
    ...item,
    master_content: master,
    active_platform_targets: platforms.map((platform) => ({
      platform,
      content_type: String(item.content_type || 'post'),
    })),
  };
  const built = await buildPlatformVariantsFromMaster(variantItem);
  // Apply the canonical deterministic formatter as the final mechanical shaping
  // pass (idempotent, platform-aware) — the ONE formatting seam.
  return built.map((variant) => ({
    ...variant,
    generated_content: deterministicFormatter.format(
      variant.generated_content ?? '',
      variant.platform,
      variant.content_type,
    ),
  }));
}

// ── The runtime ───────────────────────────────────────────────────────────────

/**
 * Execute the canonical generation pipeline. Returns the master, per-platform
 * variants, the persisted content id (or null on a fail-open persistence miss),
 * the originality result, and the per-run metrics envelope.
 */
export async function generate(req: GenerationRequest): Promise<GenerationOutput> {
  const stages: string[] = [];
  const failures: string[] = [];
  const totalTimer = startTimer();

  const policy = getTaskPolicy(req.contentType);
  const metricLabels = { contentType: String(req.contentType) };
  runtimeMetrics.providerSelection(policy.model, metricLabels);
  // No result cache this wave — the generation always runs fresh.
  if (policy.cache.enabled) runtimeMetrics.cacheHit(metricLabels);
  else runtimeMetrics.cacheMiss(metricLabels);

  // ── Stage 1 — Context Resolution
  stages.push('context');
  const ctx = await contextResolver.resolve(req);
  const primaryPlatform = String(ctx.platform ?? 'linkedin');
  const platforms = (ctx.raw?.targetPlatforms as string[] | undefined) ?? [primaryPlatform];

  // ── WS-1a — Semantic Root (flag-gated, default OFF). Built ONCE per request
  // from the resolved context and threaded through the pipeline so every
  // artifact inherits the same communication objective. Flag OFF ⇒ root stays
  // undefined and the pipeline is byte-identical to pre-WS-1a. Inline (no new
  // RUNTIME_STAGES entry) so the observable stage contract is unchanged.
  const semanticEnabled = isSemanticRootEnabled();
  let semanticRoot: SemanticRoot | undefined;
  if (semanticEnabled) {
    // WS-1b — FAIL-CLOSED continuity enforcement. With the flag ON the operator
    // has opted INTO enforcement: a missing/invalid Semantic Root is a
    // DETERMINISTIC, OBSERVABLE SemanticContinuityError, recorded in `failures`
    // and surfaced to the caller. We deliberately do NOT swallow it and NEVER
    // mint a fresh root to paper over the gap — that silent regeneration is
    // exactly the continuity break WS-1b exists to prevent. The throw sits at the
    // PRE-generation boundary, consistent with the runtime's "stages 1–4 may fail
    // the call" contract; everything AFTER generation stays fail-open below.
    try {
      semanticRoot = buildSemanticRoot(ctx);
      assertValidSemanticRoot(semanticRoot, 'content_brief');
      ctx.semanticRoot = semanticRoot;
    } catch (err) {
      failures.push('semantic_root');
      runtimeMetrics.failure('semantic_root', metricLabels);
      throw err instanceof SemanticContinuityError
        ? err
        : new SemanticContinuityError(
            'content_brief',
            err instanceof Error ? err.message : 'semantic root build failed',
          );
    }
  }

  // ── Stage 2 — Prompt Assembly (single assembly path)
  stages.push('prompt_assembly');
  const promptSet = assembleGenerationPrompt(ctx, policy);
  const item = ((promptSet.meta?.item as DailyExecutionItemLike | undefined) ?? {}) as DailyExecutionItemLike;

  // WS-1b — content_brief → generated_text continuity (FAIL-CLOSED, pre-generation).
  // Before the master is produced, assert the assembled generation item inherited
  // the SAME Semantic Root the brief carries (the assembler stamps
  // `semantic_root_id`). A dropped identity here throws deterministically rather
  // than generating an artifact with no/ambiguous lineage. Flag OFF ⇒ skipped.
  if (semanticRoot) {
    const itemRootId = (item as Record<string, unknown>).semantic_root_id;
    assertStageContinuity('generated_text', {
      root: semanticRoot,
      parentSemanticRootId: typeof itemRootId === 'string' ? itemRootId : 'MISSING',
      parentCommunicationIntent: semanticRoot.communicationIntent,
    });
  }

  // ── Stage 3 — Originality Preparation (light retrieval; fail-open)
  stages.push('originality_prep');
  try {
    const history = await retrieveRelevant(req.companyId, {
      contentType: req.contentType,
      campaignId: req.campaignId ?? undefined,
      limit: ORIGINALITY_PREP_LIMIT,
    });
    ctx.originalityContext = history;
  } catch {
    failures.push('originality_prep');
    runtimeMetrics.failure('originality_prep', metricLabels);
    ctx.originalityContext = [];
  }

  // ── Stage 4 (Generation, retry-wrapped) + Stage 5 (Originality Validation)
  let retries = 0;
  let originalityTimeMs = 0;
  let generationMarked = false;
  const modelTimer = startTimer();

  const outcome = await regenerateUntilOriginal<MasterContentPayload>({
    maxAttempts: ORIGINALITY_MAX_ATTEMPTS,
    generate: async (attempt: number) => {
      if (!generationMarked) {
        generationMarked = true;
        stages.push('generation');
      }
      // Retry wraps ONLY the generation call — persistence is a separate,
      // post-success step, so a retried generation can never double-persist.
      const result = await executeWithRetry(
        () => generateMasterContentFromIntent(item),
        policy.retry,
        { idempotencyKey: `${req.companyId}:${req.contentType}:regen-${attempt}` },
      );
      retries += result.retries;
      const master = result.value;
      return { text: master.content ?? '', result: master };
    },
    assert: async (text: string) => {
      const t = startTimer();
      try {
        return await assertOriginality({
          companyId: req.companyId,
          contentType: req.contentType,
          platform: primaryPlatform,
          campaignId: req.campaignId ?? null,
          candidateText: text,
        });
      } finally {
        originalityTimeMs += t();
      }
    },
  });
  stages.push('originality_validation');

  const modelLatencyMs = modelTimer();
  const master = outcome.result;
  const originality: OriginalityResult = outcome.originality;

  runtimeMetrics.modelLatencyMs(modelLatencyMs, { ...metricLabels, model: policy.model });
  runtimeMetrics.retries(retries, metricLabels);
  runtimeMetrics.originalityTimeMs(originalityTimeMs, metricLabels);

  // ── Stage 6 — Persistence (FAIL-OPEN)
  stages.push('persistence');
  let contentId: string | null = null;
  const persistTimer = startTimer();
  try {
    const created = await createContent({
      companyId: req.companyId,
      contentType: req.contentType as CanonicalContentType,
      title: trimmed(reqField(req, 'topic')) || trimmed(item.topic) || null,
      body: master.content ?? null,
      topic: trimmed(reqField(req, 'topic')) || trimmed(item.topic) || null,
      objective: ctx.objective ?? null,
      audience: ctx.audience ?? null,
      tone: ctx.tone ?? null,
      brief: (req.brief as Record<string, unknown> | undefined) ?? null,
      // WS-1a — persist the Semantic Root id as a SOFT reference in the existing
      // content.source_metadata column. This is the durable link between the
      // immutable generation identity and the canonical content row (NO new
      // store). Absent when the flag is OFF ⇒ createContent call is unchanged.
      ...(semanticRoot
        ? { sourceMetadata: { semanticRootId: semanticRoot.semanticRootId, semanticRoot } }
        : {}),
      lifecycleStatus: (reqField<string>(req, 'lifecycleStatus') as CreateContentInput['lifecycleStatus']) ?? 'draft',
      createdBy: (reqField<string>(req, 'createdBy')) ?? null,
    });
    contentId = created.id;

    // Both of these are fail-safe (return null on error) but are still inside the
    // try so any unexpected throw keeps persistence fail-open as a unit.
    await indexContentUnit({
      companyId: req.companyId,
      contentId,
      campaignId: req.campaignId ?? null,
      contentType: req.contentType,
      platform: primaryPlatform,
      lifecycleStatus: created.lifecycleStatus,
      text: master.content ?? '',
    });
    await persistOriginality({
      companyId: req.companyId,
      contentId,
      originalityScore: originality.score,
      decision: originality.decision,
      nearestMatches: originality.nearestMatches,
      similarityDimensions: originality.dimensions,
      regenerationCount: Math.max(0, outcome.attempts - 1),
      generationFingerprint: originality.fingerprint.exactHash,
    });
  } catch {
    failures.push('persistence');
    runtimeMetrics.failure('persistence', metricLabels);
  }
  const persistenceTimeMs = persistTimer();
  runtimeMetrics.persistenceTimeMs(persistenceTimeMs, metricLabels);

  // ── Stage 7 — Variant Generation (FAIL-OPEN)
  stages.push('variants');
  let variants: PlatformVariantPayload[] = [];
  try {
    variants = await runVariantGeneration(item, master, platforms);
  } catch {
    failures.push('variants');
    runtimeMetrics.failure('variants', metricLabels);
    variants = [];
  }

  // WS-1b — platform adaptations PRESERVE INTENT (FAIL-OPEN, observable). The
  // external variant builder is intent-agnostic, so the runtime stamps each
  // adaptation with the root identity (semantic_root_id + communication_intent)
  // — only presentation differs, the semantic intent is unchanged — then runs a
  // DETERMINISTIC preservation check. Consistent with the post-generation
  // fail-open contract: a break is recorded in `failures`/metrics, never silently
  // repaired with a fresh root. Flag OFF ⇒ variants are byte-identical to today.
  if (semanticRoot && variants.length > 0) {
    variants = variants.map((v) => stampVariantSemanticIdentity(v, semanticRoot!));
    const preserved = assertVariantsPreserveIntent(semanticRoot, variants);
    if (!preserved.ok) {
      failures.push('semantic_continuity_variants');
      runtimeMetrics.failure('semantic_continuity_variants', metricLabels);
    }
  }

  // ── WS-1a — Semantic Continuity + Visual Bridge (flag-gated, orchestration
  // only). Continuity links the immutable root to the persisted content id;
  // the visual bridge derives a VisualBrief (from the content brief) + an
  // ImagePromptSpec (consuming the generated text) that CARRY the same semantic
  // identity toward the frozen image seam — no image is generated or called.
  // All best-effort: a derivation failure never breaks generation.
  let semanticContinuity: SemanticContinuity | undefined;
  let visualBrief: VisualBrief | undefined;
  let imagePromptSpec: ImagePromptSpec | undefined;
  if (semanticRoot) {
    try {
      semanticContinuity = buildSemanticContinuity(semanticRoot, contentId);
      visualBrief = deriveVisualBrief(semanticRoot);
      imagePromptSpec = deriveImagePromptSpec(visualBrief, master.content ?? '');
      // WS-1b — assert the DERIVED visual artifacts inherited the SAME root
      // (visual_brief ← root; image_prompt_spec ← visual_brief). Observable,
      // non-throwing (post-generation fail-open): a divergence is recorded, never
      // silently repaired.
      const vbCheck = checkArtifactInheritsRoot(semanticRoot, visualBrief, 'visual_brief');
      const ipCheck = checkArtifactInheritsRoot(
        semanticRoot,
        imagePromptSpec,
        'image_prompt_spec',
      );
      if (!vbCheck.ok || !ipCheck.ok) {
        failures.push('semantic_continuity_visual');
        runtimeMetrics.failure('semantic_continuity_visual', metricLabels);
      }
    } catch {
      failures.push('semantic_bridge');
    }
  }

  // ── Stage 8 — Observability
  stages.push('observability');
  const latencyMs = totalTimer();
  runtimeMetrics.latencyMs(latencyMs, metricLabels);

  const metrics: Record<string, unknown> = {
    latencyMs,
    modelLatencyMs,
    originalityTimeMs,
    persistenceTimeMs,
    retries,
    attempts: outcome.attempts,
    regenerated: outcome.regenerated,
    cacheHit: policy.cache.enabled,
    model: policy.model,
    primaryPlatform,
    stages,
    failures,
    ...(semanticRoot ? { semanticRootId: semanticRoot.semanticRootId } : {}),
  };

  return {
    master,
    variants,
    contentId,
    originality,
    metrics,
    ...(semanticRoot ? { semanticRoot } : {}),
    ...(semanticContinuity ? { semanticContinuity } : {}),
    ...(visualBrief ? { visualBrief } : {}),
    ...(imagePromptSpec ? { imagePromptSpec } : {}),
  };
}

/** The canonical GenerationRuntime instance — THE runtime seam. */
export const generationRuntime: GenerationRuntime = { generate };
