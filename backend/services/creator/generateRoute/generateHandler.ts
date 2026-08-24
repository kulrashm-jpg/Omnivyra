/** Part 2/2 of generate.ts — verbatim split (barrel preserved; importers unchanged). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { measureCreatorDuration } from '../../../../backend/services/creatorRuntimeMetrics';
import { isGuidanceOnlyContentType } from '../../../../backend/services/creatorTemplateRegistryService';
import {
  buildAssetCompositionIntent,
  normalizeAttachmentMode,
  normalizeSourceTextTransform,
  normalizeWriterCreatorAssetType,
  resolveAttachmentModeFromIntent,
  validateAttachmentPayload,
  copyPolicyForIntent,
  SUPPORTING_VISUAL_COPY_POLICY,
  type AssetCompositionIntent,
  type AttachmentMode,
} from '../../../../lib/content/writerCreatorAttachmentContracts';
import { containsDirectThreadDuplication, transformThreadForVisual } from '../../../../lib/content/writerCreatorThreadTransform';
import { detectSemanticThreadDuplication } from '../../../../backend/services/creatorSemanticDuplication';
// PHASE 14N: runCreatorOrchestration is DEFERRED (dynamic-imported in the
// handler) so ensureRenderFonts() configures fontconfig BEFORE the orchestrator
// pulls in creatorAssetRenderer → sharp. Mirrors render-inline (which renders
// text correctly). A static import here would load sharp at module-eval, before
// the handler-time font init — the cause of the generate-inline tofu render.
import { ensureRenderFonts } from '../../../../backend/services/creatorRenderFonts';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';
import { logPipelineEvent } from '../../../../lib/shared/observability';
import { creatorRuntimeMode } from '../../../../lib/creator-templates/creatorRuntimeFlag';
import { shadowFromRequest } from '../../../../lib/creator-templates/creatorRuntimeV2';
import { getTemplateById } from '../../../../lib/creator-templates/index';
import { mergeBlueprintIntoCreatorCard } from '../../../../lib/creator-outcomes/blueprintRuntimeBridge';

import { type GenerateCreatorBody, withCreatorTimeout, resolveRequestedContentType, safeObject, normalizeCreatorCardForAttachment, buildBetaCreatorFallback, generateThemeTreatment, resolveGovernanceForLane } from './generatePrep';

function isTextOnlyContentType(contentType: string): boolean {
  const normalized = String(contentType || '').trim().toLowerCase();
  return normalized === 'post' || normalized === 'thread';
}

async function generateTextContent(input: {
  companyId: string;
  userId: string | null;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard: Record<string, unknown>;
}): Promise<any> {
  const isThread = String(input.contentType).toLowerCase() === 'thread';
  const isPostOrThread = isThread || String(input.contentType).toLowerCase() === 'post';
  const platform = (input.targetPlatforms[0] || 'linkedin').toLowerCase();

  // Phase 1 unification — post/thread text generation routes through
  // the shared textGenerationOrchestrator (which delegates to the
  // canonical contentGenerationPipeline). Output is reshaped into the
  // Direct API's existing CanonicalCreatorOutput-shaped response so
  // clients (writer pages, command center route, etc.) see no shape
  // change.
  if (isPostOrThread) {
    const { runTextGeneration } = await import('../../../../backend/services/content/textGenerationOrchestrator');
    const subtype = String(input.creatorCard.subtype || '').trim();
    const tone = String(input.creatorCard.tone || '').trim();
    const cta = String(input.creatorCard.cta || '').trim();
    const constraints = String(input.creatorCard.constraints || '').trim();
    const extraInstruction = [
      subtype ? `Subtype: ${subtype}` : '',
      constraints ? `Constraints: ${constraints}` : '',
      input.summary ? `Key message: ${input.summary}` : '',
    ].filter(Boolean).join('\n\n');
    // Creator Governance Parity For Text Content — Phase 2+3. Post +
    // thread paths now receive the same governance context the
    // visual composer does. Best-effort resolution — failure leaves
    // `governance=null` and prior behavior is preserved.
    const governance = await resolveGovernanceForLane({
      companyId: input.companyId,
      contentType: input.contentType,
      creatorCard: input.creatorCard,
      lane: 'image', // post / thread share the image lane policy
      actorUserId: input.userId,
    });
    const orchestrated = await runTextGeneration({
      origin: 'direct-api',
      companyId: input.companyId,
      topic: input.topic,
      contentType: isThread ? 'thread' : 'post',
      targetPlatforms: [platform],
      audience: input.audience,
      objective: input.objective,
      tone: tone || undefined,
      cta: cta || undefined,
      extraInstruction: extraInstruction || undefined,
      creatorCard: input.creatorCard,
      governance,
    });
    const variant = orchestrated.platformVariant;
    const caption = String(variant.generated_content || orchestrated.masterContent.content || '').trim();
    const hashtags = Array.isArray((variant as any).discoverability_meta?.hashtags)
      ? ((variant as any).discoverability_meta.hashtags as unknown[]).map(String).filter(Boolean)
      : [];
    const trace = orchestrated.masterContent?.decision_trace ?? {};
    const segments = isThread && caption ? caption.split(/\n{2,}/).map((s: string) => s.trim()).filter(Boolean) : [];
    return {
      intent_type: 'creator',
      asset_type: 'image',
      asset_instruction: {
        blueprint: orchestrated.masterContent,
        structure: { output_shape: isThread ? 'thread_sequence' : 'single_post' },
        visual_style: tone || 'native_platform_voice',
        template_id: `text-content-${input.contentType}`,
      },
      asset_payload: {
        asset_kind: 'text_content',
        content_type: input.contentType,
        hook: String((trace as any).hook || '').trim(),
        body: caption,
        cta_line: cta,
        thread_segments: segments,
        media_bundle: {
          metadata: {
            preview_kind: 'text_content',
            content_type: input.contentType,
            platform,
            generated_by: 'creator_text_content',
            // Creator Governance Parity For Text Content — Phase 5.
            // Mirror the text orchestrator's governance metadata onto
            // media_bundle.metadata so downstream surfaces read it off
            // creator_attachment_metadata exactly as they do for
            // visual assets. industry='none' / warnings=0 when no
            // governance applied (back-compat).
            governance: orchestrated.governance,
          },
        },
      },
      packaging: {
        caption,
        hashtags,
        cta: cta || 'Learn more',
        meta_description: caption.slice(0, 160),
        keywords: [input.topic, input.contentType, platform].filter(Boolean),
        platform_variants: {},
      },
      generation_prompt: `creator-text-content:${input.contentType}:${input.topic}`,
      metadata: {
        content_type: input.contentType,
        target_platforms: input.targetPlatforms,
        preview_kind: 'text_content',
        text_only: true,
        // Creator Governance Parity For Text Content — Phase 5.
        // Top-level metadata mirror so callers that don't dig into
        // media_bundle still see the governance summary.
        governance: orchestrated.governance,
      },
    };
  }

  // Phase 2 legacy cleanup — the bespoke `runCompletionWithOperation`
  // fallback for non-post/thread content types has been removed. The
  // only callers reaching `generateTextContent` come from the
  // `isTextOnlyContentType` gate above (`post` / `thread`), so any
  // other content-type arriving here is a contract violation. Throw
  // explicitly instead of silently producing a bespoke output that
  // bypassed the canonical pipeline.
  throw new Error(`creator text content: unsupported content type "${input.contentType}" — only post/thread accepted`);
}

function shouldUseCreatorFallback(error: unknown): boolean {
  const anyError = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  const code = String(anyError?.code || '').toUpperCase();
  const message = String(anyError?.message || (error instanceof Error ? error.message : '') || '').toLowerCase();
  const status = Number(anyError?.statusCode ?? anyError?.status ?? 0);

  if (code === 'PLAN_LIMIT_EXCEEDED' || code === 'COST_BLOCKED') return false;
  if (status === 401 || status === 403 || status === 402) return false;
  if (
    message.includes('pricingservice') ||
    message.includes('credit_rate_usd') ||
    message.includes('monthly llm token limit') ||
    message.includes('cost_blocked') ||
    message.includes('plan_limit_exceeded') ||
    message.includes('missing openai_api_key')
  ) {
    return false;
  }

  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // PHASE 14N — generate-inline font parity. Configure fontconfig at HANDLER
  // time (cwd + traced fonts ready on Vercel) BEFORE the orchestrator/sharp is
  // dynamic-imported below. Identical init to render-inline.
  const fontDiag = ensureRenderFonts();

  // Parity probe (?probe=1): same diagnostics render-inline exposes, but for THIS
  // (generate) function's own runtime/bundle. No auth — renders an internal SVG,
  // returns only font diagnostics.
  if (req.query.probe === '1' || req.query.probe === 'true') {
    const { probeRenderTextCapability, renderProbeImage } = await import('../../../../backend/services/renderTextCapabilityProbe');
    // ?probe=1&img=1 → return the rendered PNG so the actual glyphs can be
    // VISUALLY checked (readable vs tofu/.notdef boxes — ink alone can't tell).
    if (req.query.img === '1') {
      const buf = await renderProbeImage();
      if (buf) { res.setHeader('Content-Type', 'image/png'); return res.status(200).send(buf); }
      return res.status(500).json({ error: 'probe image render failed' });
    }
    const probe = await probeRenderTextCapability();
    return res.status(200).json({
      ok: probe.ok,
      inkRatio: probe.inkRatio,
      resolvedFontDir: fontDiag.resolvedFontDir,
      fontCount: fontDiag.fontCount,
      fontconfigFile: process.env.FONTCONFIG_FILE ?? null,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Deterministic, non-user-facing font diagnostics for this generate request
  // (lands in the Vercel function logs).
  console.info('[creator-font-init]', {
    resolvedFontDir: fontDiag.resolvedFontDir,
    fontCount: fontDiag.fontCount,
    configPath: fontDiag.configPath,
    fontconfigFile: process.env.FONTCONFIG_FILE ?? null,
  });

  const user = await resolveUserContext(req);
  const body = (req.body || {}) as GenerateCreatorBody;
  const companyId = String(body.company_id || user?.defaultCompanyId || '').trim();
  const topic = String(body.topic || '').trim();
  const contentType = resolveRequestedContentType({
    creatorType: body.creator_type,
    contentType: body.content_type,
  });
  const targetPlatforms = Array.isArray(body.target_platforms)
    ? body.target_platforms.map((platform) => String(platform || '').trim().toLowerCase()).filter(Boolean)
    : [];
  // CREATOR-059 follow-up: derive blueprint style/colour/layout guidance from the
  // selected blueprint id (rides on creator_card). Additive `blueprint_*` fields;
  // existing creator_card keys always win; no blueprint ⇒ exact no-op. No engine change.
  const creatorCardInput = mergeBlueprintIntoCreatorCard(
    safeObject(body.creator_card),
    typeof body.blueprint_id === 'string' && body.blueprint_id.trim() ? body.blueprint_id.trim() : null,
  );
  const normalizedAttachment = normalizeCreatorCardForAttachment({
    creatorCard: creatorCardInput,
    creatorType: String(body.creator_type || ''),
    contentType,
  });
  if (normalizedAttachment.errors.length > 0) {
    // Phase A-partial — actionable hints surfaced for the residual validator
    // rule that the normalization layer cannot resolve. Today the only such
    // rule is #3 (paragraphLike): the source snippet is too long for a
    // supporting_visual overlay. UI work that proactively warns / offers
    // condense / mode-switch is deferred to its own phase; this hint at
    // least gives the user a clear next step instead of an opaque rejection.
    const hints: string[] = [];
    if (normalizedAttachment.errors.includes('supporting_visual rejects paragraph overlays')) {
      hints.push(
        'The source snippet is too long to render as a supporting visual overlay. ' +
        'Options: (a) shorten the snippet to under ~160 characters with no long paragraph breaks, ' +
        'or (b) switch the attachment mode to "embedded_copy" which is designed for paragraph-length content.',
      );
    }
    // Phase C — writer rejection telemetry. Each rule the validator fired is
    // emitted at warn level so dashboards can show rejection rate by rule
    // (which UX gap is hitting users most). No content/URL/secrets in tags.
    for (const ruleMessage of normalizedAttachment.errors) {
      logPipelineEvent('writer.attachment_rejected', 'warn', {
        rule: ruleMessage,
        attachment_mode: String(creatorCardInput.attachment_mode ?? 'unset'),
        creator_type: String(body.creator_type ?? 'unset'),
        content_type: String(contentType ?? 'unset'),
        source_type: String(safeObject(creatorCardInput.source_content).source_type ?? 'unset'),
      }, { dedupeKey: `writer.${ruleMessage}`, throttleMs: 10_000 });
    }
    return res.status(400).json({
      error: 'Invalid Writer attachment payload',
      details: normalizedAttachment.errors,
      ...(hints.length > 0 ? { hints } : {}),
    });
  }
  const creatorCard = normalizedAttachment.creatorCard;

  // Objective Preservation (Wave 0): the user's real objective can arrive at the
  // top level (body.objective) OR inside the creator_card (brief-derived, via
  // resolveGeneratorContext). Resolve it ONCE from both — preferring the explicit
  // top-level value — and thread the SAME value to the text / theme / visual
  // (orchestrator → overlay copy + blueprint) paths. Never fabricated: absent ⇒
  // undefined so downstream stages omit rather than invent an objective.
  const resolvedObjective =
    String(body.objective || (creatorCard as Record<string, unknown>).objective || '').trim() || undefined;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic) {
    return res.status(400).json({ error: 'topic required' });
  }
  if (!contentType) {
    return res.status(400).json({ error: 'content_type required' });
  }
  if (targetPlatforms.length === 0) {
    return res.status(400).json({ error: 'target_platforms required' });
  }

  // CREATOR-PROD-002 — Shadow runtime (zero behaviour change). When
  // CREATOR_RUNTIME_V2=shadow, run the deterministic runtime SILENTLY for parity
  // diagnostics. Fully isolated: it never throws, never mutates the response,
  // never blocks rendering. OFF (default) and ON both skip this hook — the
  // legacy runtime remains the only one that renders.
  if (creatorRuntimeMode() === 'shadow') {
    try {
      const shadow = shadowFromRequest({ creatorCard, contentType, topic }, getTemplateById);
      logPipelineEvent('creator.runtime_shadow', shadow.ran && shadow.parityMatch === false ? 'warn' : 'info', {
        ran: String(shadow.ran),
        parity_match: String(shadow.parityMatch ?? 'n/a'),
        field_mismatches: String(shadow.fieldMismatchCount ?? 0),
        slides_legacy: String(shadow.slideCountLegacy ?? 0),
        slides_v2: String(shadow.slideCountV2 ?? 0),
        sections_legacy: String(shadow.sectionCountLegacy ?? 0),
        sections_v2: String(shadow.sectionCountV2 ?? 0),
        recommendation: String(shadow.recommendation ?? ''),
        resolution: String(shadow.resolution ?? ''),
        skip_reason: String(shadow.skipReason ?? ''),
        family: shadow.family,
        duration_ms: String(shadow.durationMs),
      }, { dedupeKey: `creator.shadow.${shadow.family}.${shadow.resolution ?? shadow.skipReason ?? 'x'}`, throttleMs: 10_000 });
    } catch { /* shadow is fully isolated — never affects the response */ }
  }

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Phase 2 Task 4 (Batch D): single-charge per generate request. The three
  // content paths below are mutually exclusive → exactly ONE charge. Internal
  // fan-out (generateFromIntent + adaptForPlatform) and the durable render
  // queue do NOT self-charge (verified: 0 credit calls) → no nesting/double-
  // charge. OFF (default) = byte-identical passthrough.
  const creatorRefId = createHash('sha256')
    .update([companyId, contentType, topic, targetPlatforms.join(',')].join('|'))
    .digest('hex')
    .slice(0, 40);
  const chargeCreator = <T>(run: () => Promise<T>): Promise<T> =>
    wirePhase2Route<T>({
      surface:        'command-center.creator-content.generate',
      organizationId: companyId,
      action:         'creator_content',
      referenceType:  'creator_content',
      referenceId:    creatorRefId,
      run,
    });

  // Text-only formats (post / thread) take a separate path: they produce
  // platform-ready text content directly via LLM. The existing creator
  // engine throws for these (canonical_asset_family: 'text', ai_renderable:
  // false), so we short-circuit to a dedicated text generator that returns
  // a CanonicalCreatorOutput-shaped response.
  if (isTextOnlyContentType(contentType)) {
    try {
      const textOutput = await withCreatorTimeout(
        chargeCreator(() => generateTextContent({
          companyId,
          userId: user?.userId ?? null,
          topic,
          contentType,
          targetPlatforms,
          audience: String(body.audience || '').trim() || undefined,
          objective: resolvedObjective,
          summary: String(body.summary || '').trim() || undefined,
          creatorCard,
        })),
        'Creator text content',
      );
      return res.status(200).json({
        success: true,
        primary_platform: targetPlatforms[0],
        intelligence_brief: null,
        output: textOutput,
      });
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        return res.status(402).json({ error: error.message, code: error.code });
      }
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Failed to generate text content',
      });
    }
  }

  // Guidance-only formats (video / reel / short / podcast) take a separate
  // path: they produce a structured Theme Treatment (scenes, hook, audio
  // cues, CTA, platform notes) and skip the asset renderer entirely. The
  // response shape matches the renderable path so the frontend can switch
  // on `preview_kind === 'theme_treatment'` to render the scene breakdown.
  if (isGuidanceOnlyContentType(contentType)) {
    try {
      const treatment = await withCreatorTimeout(
        chargeCreator(() => generateThemeTreatment({
          companyId,
          userId: user?.userId ?? null,
          topic,
          contentType,
          targetPlatforms,
          audience: String(body.audience || '').trim() || undefined,
          objective: resolvedObjective,
          summary: String(body.summary || '').trim() || undefined,
          creatorCard,
        })),
        'Creator theme treatment',
      );
      return res.status(200).json({
        success: true,
        primary_platform: targetPlatforms[0],
        intelligence_brief: null,
        output: treatment,
      });
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        return res.status(402).json({ error: error.message, code: error.code });
      }
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Failed to generate theme treatment',
      });
    }
  }

  try {
    const intelligenceBrief = null;
    const primaryPlatform = targetPlatforms[0];

    // Campaign Multi-Variant Execution Completion — Phase 2. When the
    // request carries a campaign_id, resolve the FULL variant plan
    // (not just the first decision). `single_variant`/`best_variant`
    // yield 1 decision; `top_3_variants`/`experiment` yield N. Absent
    // or failed resolution leaves `variantPlan=null` and behavior is
    // unchanged (single-asset path).
    let variantPlan: import('../../../../backend/services/creator/campaignVariantApplier').CampaignVariantPlan | null = null;
    const campaignIdForVariant = typeof body.campaign_id === 'string' && body.campaign_id.trim().length > 0
      ? body.campaign_id.trim()
      : null;
    if (campaignIdForVariant) {
      try {
        const { supabase } = await import('../../../../backend/db/supabaseClient');
        const { data: campaignRow } = await supabase
          .from('campaign_versions')
          .select('campaign_snapshot')
          .eq('campaign_id', campaignIdForVariant)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (campaignRow) {
          const { resolveCampaignVariantPlan } = await import('../../../../backend/services/creator/campaignVariantApplier');
          variantPlan = resolveCampaignVariantPlan({
            campaign: campaignRow,
            companyId,
            campaignId: campaignIdForVariant,
            platform: primaryPlatform,
            creatorId: user?.userId ?? null,
          });
        }
      } catch (error) {
        console.warn('[creator-content][campaign-variant-resolve-failed]', {
          campaign_id: campaignIdForVariant,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Single-asset fast path keeps prior shape; multi-asset path
    // surfaces `generated_assets[]` additively (Phase 6 back-compat).
    const isFanOut = variantPlan !== null && variantPlan.decisions.length > 1;
    const singleAppliedVariant = variantPlan && variantPlan.decisions[0]
      ? {
          strategy_id: variantPlan.strategy_id,
          variant_id: variantPlan.decisions[0].variant_id,
          variant_family: variantPlan.decisions[0].variant_family,
        }
      : null;
    // Phase 2/3/4/5 unification — Direct flow now delegates the
    // generate→adapt→render→persist→FSM chain to the shared
    // creatorOrchestrator. Billing wrapper (chargeCreator) + writer
    // attachment validation + timeout + fallback semantics remain owned
    // by this route. The orchestrator additionally persists a
    // creator_assets row (Phase 5) so the Direct flow becomes
    // standalone usable; response gains `persisted_asset_id` (additive).
    const writerSource = (() => {
      const src = safeObject(creatorCard.source_content);
      const sourceType = src.source_type === 'thread' ? 'thread' as const : src.source_type === 'post' ? 'post' as const : null;
      const sourceId = typeof src.source_id === 'string' ? src.source_id : null;
      return sourceType ? { sourceType, sourceId } : undefined;
    })();
    let persistedAssetIdForResponse: string | null = null;
    let generatedAssetsForResponse: Array<{
      rank: number;
      variant_id: string;
      variant_family: string;
      strategy_id: string;
      experiment_id: string | null;
      persisted_asset_id: string | null;
      ok: boolean;
      error?: string;
    }> | null = null;
    // Direct API Adaptation Parity. Capture the per-asset canonical
    // outputs (single OR fan-out) so the post-generation secondary-
    // platform adaptation loop can iterate over them. Each entry's
    // `output` already carries variant_id / variant_family /
    // strategy_id on media_bundle.metadata (set by the orchestrator's
    // `mergeAppliedVariantIntoOutput`), so attribution survives
    // unchanged through adaptation.
    const successfulOutputs: Array<{
      variantKey: string;
      output: import('../../../../backend/services/executionEngines/types').CanonicalCreatorOutput;
    }> = [];
    // UNIFY MASTER GENERATION — resolve the CANONICAL Context Assembly ONCE
    // (shared, cached). The master pipeline consumes the same company + brand
    // context as field assist; no independent company/brand resolution here.
    // Best-effort: failure leaves canonicalContext empty (prior behavior).
    const { resolveCreatorCopyContext } = await import('../../../../backend/services/creator/creatorCopyContextResolver');
    const canonicalContext = await resolveCreatorCopyContext(companyId);
    const baseOrchestratorInput = {
      campaignId: campaignIdForVariant ?? `creator-content-${Date.now()}`,
      companyId,
      userId: user?.userId ?? null,
      /**
       * The Creator draft whose attached assets this generation should use.
       * A LOOKUP KEY ONLY — `companyId` above stays the authorization input, so
       * a token from another tenant resolves to nothing rather than to their
       * references. Absent → generation proceeds exactly as before.
       */
      compositionId: String(body.composition_id || '').trim() || null,
      topic,
      contentType,
      targetPlatforms,
      audience: String(body.audience || '').trim() || undefined,
      objective: resolvedObjective,
      summary: String(body.summary || '').trim() || undefined,
      // Canonical company + brand grounding made available to the generator
      // (single resolution) + the brand voice for deterministic output validation.
      creatorCard: {
        ...creatorCard,
        canonical_company_context: canonicalContext.company,
        canonical_brand_voice: canonicalContext.brandVoice,
      },
      canonicalBrandVoice: canonicalContext.brandVoice,
      enrichedIntent: intelligenceBrief ? {
        analytics_intelligence: {
          content_type: (intelligenceBrief as any).content_type,
          readiness: (intelligenceBrief as any).readiness,
          prompt_block: (intelligenceBrief as any).prompt_block,
          low_confidence_note: (intelligenceBrief as any).low_confidence_note,
          primitives: (intelligenceBrief as any).primitives,
          recommended_uses: (intelligenceBrief as any).recommended_uses,
        },
      } : null,
      origin: 'direct' as const,
      source: writerSource,
      // Match legacy Direct-flow semantics: readiness gating is opt-in
      // for this surface (response was always returned regardless).
      skipReadinessValidation: true,
    };
    const output = await withCreatorTimeout(chargeCreator(() => (async () => {
      // Campaign Multi-Variant Execution Completion — Phase 2.
      // top_3_variants / experiment fan out via the shared runner.
      if (isFanOut && variantPlan) {
        const { runCampaignVariantFanOut } = await import('../../../../backend/services/creator/campaignVariantFanOut');
        const fanOutResult = await measureCreatorDuration('creator_orchestrate', {
          contentType,
          platform: primaryPlatform,
        }, () => runCampaignVariantFanOut({
          plan: variantPlan!,
          orchestratorInput: baseOrchestratorInput,
        }));
        generatedAssetsForResponse = fanOutResult.generated_assets.map((a) => ({
          rank: a.rank,
          variant_id: a.variant_id,
          variant_family: a.variant_family,
          strategy_id: a.strategy_id,
          experiment_id: a.experiment_id,
          persisted_asset_id: a.result?.persistedAssetId ?? null,
          ok: a.ok,
          ...(a.error ? { error: a.error } : {}),
        }));
        for (const a of fanOutResult.generated_assets) {
          if (a.ok && a.result) {
            successfulOutputs.push({ variantKey: a.variant_id, output: a.result.output });
          }
        }
        // Back-compat — return the first successful asset's canonical
        // output as the legacy single-asset payload.
        const first = fanOutResult.generated_asset;
        if (!first || !first.result) {
          throw new Error(`fan-out produced no successful assets (${fanOutResult.generated_assets.length} attempted)`);
        }
        persistedAssetIdForResponse = first.result.persistedAssetId;
        return first.result.output;
      }
      // PHASE 14N: dynamic-import the orchestrator AFTER ensureRenderFonts() ran
      // (handler top) so creatorAssetRenderer → sharp/fontconfig initializes with
      // the vendored fonts already configured — mirroring render-inline.
      const { runCreatorOrchestration } = await import('../../../../backend/services/creator/creatorOrchestrator');
      const orchestrated = await measureCreatorDuration('creator_orchestrate', {
        contentType,
        platform: primaryPlatform,
      }, () => runCreatorOrchestration({
        ...baseOrchestratorInput,
        appliedVariant: singleAppliedVariant,
      }));
      persistedAssetIdForResponse = orchestrated.persistedAssetId;
      successfulOutputs.push({
        variantKey: singleAppliedVariant?.variant_id ?? 'primary',
        output: orchestrated.output,
      });
      return orchestrated.output;
    })()), 'Creator generation').catch((error) => {
      if (error instanceof PaymentRequiredError) {
        throw error; // surface enforcement as 402, never fall back to free output
      }
      if (normalizedAttachment.compositionIntent) {
        throw error;
      }
      if (!shouldUseCreatorFallback(error)) {
        throw error;
      }
      console.warn('[creator-content][fallback-output-used]', {
        company_id: companyId,
        content_type: contentType,
        message: error instanceof Error ? error.message : String(error),
      });
      return buildBetaCreatorFallback({
        topic,
        contentType,
        targetPlatforms,
        audience: String(body.audience || '').trim() || undefined,
        objective: resolvedObjective,
        summary: String(body.summary || '').trim() || undefined,
        creatorCard,
        fallbackReason: error instanceof Error ? error.message : String(error),
      });
    });

    // Direct API Adaptation Parity. After generation completes, run
    // secondary-platform adaptation per asset using the SAME
    // `engine.adaptForPlatform` contract the queue worker already uses
    // (creatorContentProcessor.ts). Best-effort + sequential — a
    // single adaptation failure does NOT fail the request:
    //
    //   - reuses the existing engine + adaptation contract (no new
    //     adaptation architecture)
    //   - primary platform is already adapted+rendered by the
    //     orchestrator → marked OK without re-invoking the engine
    //   - secondary platforms run sequentially with try/catch; failures
    //     captured as { ok: false, error }
    //   - attribution survives: each `output` retains its
    //     media_bundle.metadata.applied_variant envelope from the
    //     orchestrator's pre-render merge
    //   - billing unchanged: adaptation is not separately billed in
    //     the queue worker, and is not separately billed here either
    //   - governance unchanged: adaptation does not touch the
    //     enterprise-governance hooks; those fired inside the
    //     orchestrator
    //
    // Runs OUTSIDE the withCreatorTimeout/chargeCreator block — the
    // generation budget (120s) is preserved for the actual generation
    // step. Adaptation extends the response time but never fails it.
    let perAssetAdaptations: Record<string, Record<string, {
      ok: boolean;
      asset_payload?: Record<string, unknown>;
      packaging?: Record<string, unknown>;
      asset_type?: string;
      error?: string;
    }>> = {};
    if (successfulOutputs.length > 0 && targetPlatforms.length > 0) {
      const { createCreatorExecutionEngine } = await import('../../../../backend/services/executionEngines/creatorExecutionEngine');
      const { runDirectApiSecondaryAdaptation } = await import('../../../../backend/services/creator/directApiAdaptationRunner');
      const engine = createCreatorExecutionEngine();
      perAssetAdaptations = await runDirectApiSecondaryAdaptation({
        engine,
        successfulOutputs,
        primaryPlatform,
        secondaryPlatforms: targetPlatforms.slice(1),
        onFailure: ({ variantKey, platform, message }) => {
          console.warn('[creator-content][secondary-adapt-failed]', {
            variant_id: variantKey,
            platform,
            message,
          });
        },
      });
    }

    return res.status(200).json({
      success: true,
      primary_platform: primaryPlatform,
      intelligence_brief: intelligenceBrief,
      output,
      persisted_asset_id: persistedAssetIdForResponse,
      // Direct API Adaptation Parity. Per-asset secondary-platform
      // adaptation status. Single-asset callers see one entry keyed
      // by variant_id (or 'primary' when no variant was applied).
      ...(Object.keys(perAssetAdaptations).length > 0 ? {
        per_asset_adaptations: perAssetAdaptations,
      } : {}),
      // Campaign Multi-Variant Execution Completion — Phase 6.
      // Multi-asset response payload (additive — single-asset callers
      // ignore this field).
      ...(generatedAssetsForResponse ? {
        generated_assets: generatedAssetsForResponse,
        variant_mode: variantPlan?.mode ?? null,
        variant_strategy_id: variantPlan?.strategy_id ?? null,
        experiment_id: variantPlan?.experiment_id ?? null,
      } : {}),
    });
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      return res.status(402).json({ error: error.message, code: error.code });
    }
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Failed to generate creator content',
    });
  }
}

