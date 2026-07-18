import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { runTextGeneration } from '../../backend/services/content/textGenerationOrchestrator';
import { getDefaultThreadTemplates } from './defaultThreadTemplates';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  extractCompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
  scoreCompanyContext,
  getDynamicContextThreshold,
  buildDiagnosticRetryReasons,
} from '../content/companyContextBlock';
// Closure Pass — Phase 4. Thread generation now resolves governance
// and threads it through `runTextGeneration` + the pipeline `item`
// so system prompts pick up the preamble. Reuses the company profile
// already loaded for identity resolution.
import { buildGovernancePromptContext } from '../../backend/services/creator/strategyGovernancePromptContext';
// Writer Wave 1 — immediate durability. Persist a canonical `content` row the
// moment generation completes so closing the browser never loses work. Purely
// additive: a best-effort write wrapped in try/catch that can never break
// generation, plus a new `content_id` field on the response.
import { createContent } from '../../backend/services/content/contentService';
// Writer Wave 2 — Content Intelligence & Originality. All ADDITIVE + FAIL-OPEN.
// Wires the canonical Wave 2 originality gate/memory/regeneration seams into the
// thread generation path. Any failure logs and returns the already-generated
// content unchanged — generation NEVER breaks.
import { assertOriginality } from '../../backend/services/content/originalityGate';
import { regenerateUntilOriginal } from '../../backend/services/content/originalityRegeneration';
import { indexContentUnit, persistOriginality } from '../../backend/services/content/contentMemoryService';
import { recordOriginalitySample } from '../../backend/observability/originalityMetrics';
import type { OriginalityResult } from '../content/originality/types';
// Writer Wave 3 — the single canonical GenerationRuntime. Flag-gated delegation
// (default OFF), fall-back-safe. See the block at the top of runThreadGeneration.
import { generationRuntime } from '../../backend/services/content/runtime/generationRuntime';
// Writer Wave 4 — Quality Engine wiring. All ADDITIVE + FAIL-OPEN. After the
// canonical row (Wave 1) + originality (Wave 2) land, deterministically score the
// master text, persist the scorecard, split into section blocks, and seed the
// collaboration block model. Gated by QUALITY_ENGINE_ENABLED (default ON). Every
// call is best-effort — any failure logs and NEVER breaks generation.
import * as qualityEngine from '../../backend/services/content/qualityEngine';
import * as qualityService from '../../backend/services/content/qualityService';
import * as collaborationService from '../../backend/services/content/collaborationService';
import { splitIntoBlocks } from '../content/quality/sectionBlocks';

/** WAVE 3 — flag-gated cutover to the canonical GenerationRuntime. Default OFF. */
function isWriterRuntimeDelegationEnabled(): boolean {
  return /^(1|true|on|yes)$/.test(String(process.env.WRITER_RUNTIME_DELEGATION_ENABLED ?? '').trim().toLowerCase());
}

// ── Wave 2 originality configuration (env-driven, fail-open) ─────────────────
/** Max total generation attempts (1 initial + N-1 regenerations). Default 2. */
const ORIGINALITY_MAX_ATTEMPTS = (() => {
  const raw = Number(process.env.ORIGINALITY_GATE_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 5) : 2;
})();
/** Minimal REgeneration nudge (NOT a prompt redesign) appended on duplicate. */
const ORIGINALITY_REGEN_NUDGE =
  '## ORIGINALITY: PREVIOUS DRAFT TOO SIMILAR TO EXISTING CONTENT\n' +
  'Produce a materially different angle, hook, and structure from anything previously generated for this company. Do not restate the same framing, examples, or opening line.';
/** Gate flag. Default ON; `false/0/off/no` disables without a code change. */
function isOriginalityGateEnabled(): boolean {
  const raw = String(process.env.ORIGINALITY_GATE_ENABLED ?? '').trim().toLowerCase();
  if (raw === '') return true;
  return !/^(0|false|off|no)$/.test(raw);
}
/** Wave 4 quality-engine gate. Default ON; `false/0/off/no` disables. Fail-open. */
function isQualityEngineEnabled(): boolean {
  const raw = String(process.env.QUALITY_ENGINE_ENABLED ?? '').trim().toLowerCase();
  if (raw === '') return true;
  return !/^(0|false|off|no)$/.test(raw);
}
type OriginalityBundle = {
  text: string;
  master: MasterContentPayload;
  variant: PlatformVariantPayload;
};

export interface ThreadGenerationRequest {
  company_id: string;
  topic: string;
  platform?: string;
  intent?: string;
  objective?: string;
  target_audience?: string;
  tone?: string;
  cta?: string;
  template_name?: string;
  extra_instruction?: string;
}

export interface ThreadGenerationResult {
  success: true;
  content_type: 'thread';
  template_used: string | null;
  master_content: MasterContentPayload;
  platform_variant: PlatformVariantPayload;
  /**
   * Writer Wave 1 — id of the durable canonical `content` row persisted at
   * generation time. `null` when the best-effort persistence failed (generation
   * itself always succeeds). Additive: never removes/renames existing fields.
   */
  content_id: string | null;
}

function resolveTemplateInstruction(templateName?: string): string | undefined {
  if (!templateName || !templateName.trim()) return undefined;
  const normalized = templateName.trim().toLowerCase();
  const template = getDefaultThreadTemplates().find(
    (entry) => entry.name.trim().toLowerCase() === normalized,
  );
  if (!template) return `Use the "${templateName.trim()}" thread style with strong pacing and standalone posts.`;
  return `Use the "${template.name}" template style. ${template.description}`;
}

// ── WAVE3 (item 1) — canonical-runtime delegation, DEFERRED (safety-first) ──
// This entry point is the short-form "thread" surface that the canonical
// GenerationRuntime (backend/services/content/runtime/generationRuntime.ts) is
// designed to own. The intended Wave-3 shape is a pure delegation:
//
//   const out = await generationRuntime.generate({
//     contentType: 'thread', company_id, topic, platform, intent, objective,
//     target_audience, tone, cta, template_name, extra_instruction,
//   }); // GenerationOutput { master, variants, contentId, originality }
//
//   return {
//     success: true,
//     content_type: 'thread',
//     template_used: input.template_name?.trim() || null,
//     master_content: out.master,          // MasterContentPayload
//     platform_variant: out.variants[0],   // PlatformVariantPayload
//     content_id: out.contentId,           // string | null
//   };
//
// The mapping above is byte-identical to this function's current return shape,
// so callers (pages/api/threads/generate.ts → res.json(result)) are unaffected.
//
// DEFERRED — NOT wired here yet: generationRuntime.ts is authored concurrently
// and is NOT present in this worktree. Adding a hard/dynamic import to a missing
// module would break tsc AND the Next build, taking the LIVE /api/threads/generate
// endpoint down — a direct violation of the "backward compatible, callers
// unaffected" constraint. Per the Wave-3 safety rule ("prefer safety over
// aggressive removal; when unsure, keep + WAVE3-TODO"), the full inline
// orchestration below is preserved verbatim (Wave 0 objective + Wave 1
// persist/content_id + Wave 2 originality/regeneration) and remains the source
// of truth until the runtime lands, at which point this body is replaced by the
// delegation above.
export async function runThreadGeneration(
  input: ThreadGenerationRequest,
): Promise<ThreadGenerationResult> {
  // ── WAVE 3 (item 1) — canonical-runtime delegation, FLAG-GATED + FALL-BACK-SAFE ──
  // Default OFF ⇒ inline path unchanged. ON ⇒ route through the runtime; an
  // incomplete runtime result falls through to inline (can never break generation).
  if (isWriterRuntimeDelegationEnabled()) {
    try {
      const out = await generationRuntime.generate({
        contentType: 'thread',
        companyId: input.company_id,
        topic: input.topic,
        platform: input.platform,
        objective: input.objective,
        extraInstruction: input.extra_instruction,
        intent: input.intent,
        target_audience: input.target_audience,
        tone: input.tone,
        cta: input.cta,
        template_name: input.template_name,
      });
      const master = out.master as MasterContentPayload | undefined;
      const variant = (Array.isArray(out.variants) ? out.variants[0] : undefined) as PlatformVariantPayload | undefined;
      if (master && variant) {
        return {
          success: true,
          content_type: 'thread',
          template_used: input.template_name?.trim() || null,
          master_content: master,
          platform_variant: variant,
          content_id: out.contentId ?? null,
        };
      }
      console.warn('[runThreadGeneration] runtime returned no usable master/variant; falling back to inline path');
    } catch (err) {
      console.error('[runThreadGeneration] runtime delegation failed; falling back to inline path', err);
    }
  }

  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : 'x';

  // Objective Preservation (Wave 0): resolve the caller's real objective once
  // (objective → free-form intent). Empty when genuinely absent — never
  // fabricated — so every downstream stage omits rather than invents it.
  const resolvedObjective =
    (typeof input.objective === 'string' && input.objective.trim())
      ? input.objective.trim()
      : (typeof input.intent === 'string' && input.intent.trim())
        ? input.intent.trim()
        : '';

  // D1 + A4 parity: resolve identity and inject shared enforcement (identity
  // lock + anti-generic) into the prompt the downstream pipeline sees.
  const profile = await getProfile(input.company_id, { autoRefine: false, languageRefine: false }).catch(() => null);
  const identity = extractCompanyIdentity(profile);
  const companyEnforcement = (identity.companyName || identity.industry || identity.coreProblem)
    ? `${buildIdentityLock(identity, 'thread')}\n\n${buildAntiGenericRules(identity)}`
    : '';

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const extraInstruction = [
    companyEnforcement || undefined,
    templateInstruction,
    typeof input.extra_instruction === 'string' && input.extra_instruction.trim()
      ? input.extra_instruction.trim()
      : undefined,
  ].filter(Boolean).join('\n\n');

  // Phase 1 unification — initial generation routed through the shared
  // textGenerationOrchestrator. The company-context regen pass below
  // still uses the underlying pipeline directly because it needs to pass
  // a modified extra_instruction WITH the original item shape; that
  // path is preserved as a behavior-equivalent retry surface until the
  // orchestrator exposes a retry hook.
  // Closure Pass — Phase 4. Build the governance context from the
  // already-loaded company profile (best-effort; null when no profile).
  const governance = profile
    ? buildGovernancePromptContext({
        companyContext: {
          industry: profile.industry ?? null,
          industry_list: profile.industry_list ?? null,
          category: profile.category ?? null,
          category_list: profile.category_list ?? null,
        },
        contentType: 'image', // threads share the image-lane policy
        selectedStrategy: null,
      })
    : null;
  const initial = await runTextGeneration({
    origin: 'thread-api',
    companyId: input.company_id,
    topic: input.topic,
    contentType: 'thread',
    targetPlatforms: [platform],
    audience: input.target_audience,
    objective: resolvedObjective || undefined,
    tone: input.tone,
    cta: input.cta,
    templateName: input.template_name,
    extraInstruction: extraInstruction || undefined,
    governance,
  });
  let master_content: MasterContentPayload = initial.masterContent;
  let platform_variant: PlatformVariantPayload = initial.platformVariant;

  // Preserve the original `item` shape for the company-context regen
  // path so its prompt structure is byte-identical to legacy behavior.
  const item = {
    execution_id: `thread-${Date.now()}`,
    company_id: input.company_id,
    platform,
    content_type: 'thread',
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      // Objective Preservation (Wave 0): carry the caller's real objective; OMIT
      // it when absent instead of fabricating "Create a high-retention
      // educational thread." so the blueprint prompt omits the objective line.
      ...(resolvedObjective ? { objective: resolvedObjective } : {}),
      target_audience: input.target_audience || 'Audience looking for concise, high-signal insights',
      tone: input.tone || 'Punchy, clear, and momentum-building',
      cta_type: input.cta || 'Engagement CTA',
    },
    active_platform_targets: [
      {
        platform,
        content_type: 'thread',
      },
    ],
    ...(extraInstruction ? { extra_instruction: extraInstruction } : {}),
    ...(governance ? { governance } : {}),
  };

  // D3: short-form company-context gate. Lightweight single regen on failure.
  if (companyEnforcement) {
    const variantText = [
      platform_variant.generated_content || '',
      master_content.content || '',
    ].filter(Boolean).join('\n\n');

    if (variantText.trim().length >= 40) {
      const wordCount = variantText.split(/\s+/).filter(Boolean).length;
      const threshold = getDynamicContextThreshold('thread', wordCount);
      const score = scoreCompanyContext(variantText, identity, { contentType: 'thread' });
      let retryCount = 0;
      let finalScore = score.score;

      if (score.score < threshold) {
        const diagnostic = buildDiagnosticRetryReasons(score, identity);
        const regenItem = {
          ...item,
          extra_instruction: [
            item.extra_instruction ?? '',
            `\n\n## PREVIOUS DRAFT FAILED COMPANY-CONTEXT CHECK (score ${score.score}/100)\n${diagnostic}`,
          ].filter(Boolean).join(''),
        };
        try {
          retryCount = 1;
          const regenMaster = await generateMasterContentFromIntent(regenItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...regenItem,
            master_content: regenMaster,
          });
          if (regenVariant) {
            const regenText = [
              regenVariant.generated_content || '',
              regenMaster.content || '',
            ].filter(Boolean).join('\n\n');
            const regenScore = scoreCompanyContext(regenText, identity, { contentType: 'thread' });
            if (regenScore.score > score.score) {
              master_content = regenMaster;
              platform_variant = regenVariant;
              finalScore = regenScore.score;
            }
          }
        } catch { /* best-effort regen */ }
      }

      console.info('[content-enforcement]', {
        contentType: 'thread',
        target_words: wordCount,
        threshold,
        final_score: finalScore,
        retry_count: retryCount,
      });
    }
  }

  // ── Writer Wave 2 — Originality gate + regeneration ─────────────────────────
  // Runs BEFORE persistence so the canonical row is written with the ACCEPTED
  // (de-duplicated) master text. Additive + FAIL-OPEN: on any failure we log and
  // keep the already-generated content. Gated by ORIGINALITY_GATE_ENABLED.
  let originalityOutcome: {
    result: OriginalityResult;
    regenerationCount: number;
    retrievalLatencyMs: number;
  } | null = null;
  if (isOriginalityGateEnabled()) {
    try {
      const gateStarted = Date.now();
      const initialBundle: OriginalityBundle = {
        text: master_content.content ?? '',
        master: master_content,
        variant: platform_variant,
      };
      // Side-effect capture so we never hard-depend on the exact return shape of
      // the concurrently-authored regenerateUntilOriginal (fail-open contract).
      let acceptedBundle: OriginalityBundle = initialBundle;
      let acceptedResult: OriginalityResult | null = null;
      let generateCalls = 0;

      const raw = (await regenerateUntilOriginal<OriginalityBundle>({
        maxAttempts: ORIGINALITY_MAX_ATTEMPTS,
        generate: async (attempt: number): Promise<{ text: string; result: OriginalityBundle }> => {
          generateCalls = Math.max(generateCalls, attempt + 1);
          if (attempt === 0) { acceptedBundle = initialBundle; return { text: initialBundle.text, result: initialBundle }; }
          // REgeneration: minimal different-angle nudge on the SAME thread item.
          const nudgedItem = {
            ...item,
            extra_instruction: [item.extra_instruction ?? '', ORIGINALITY_REGEN_NUDGE]
              .filter(Boolean).join('\n\n'),
          };
          const regenMaster = await generateMasterContentFromIntent(nudgedItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...nudgedItem,
            master_content: regenMaster,
          });
          const bundle: OriginalityBundle = {
            text: regenMaster.content ?? '',
            master: regenMaster,
            variant: regenVariant ?? platform_variant,
          };
          acceptedBundle = bundle;
          return { text: bundle.text, result: bundle };
        },
        assert: async (candidateText: string): Promise<OriginalityResult> => {
          const r = await assertOriginality({
            companyId: input.company_id,
            contentType: 'thread',
            platform,
            candidateText,
          });
          acceptedResult = r;
          return r;
        },
      })) as unknown as {
        value?: OriginalityBundle;
        originality?: OriginalityResult;
        result?: OriginalityResult;
        regenerationCount?: number;
        attempts?: number;
      } | undefined;

      // Prefer the helper's own return; fall back to side-effect captures.
      const finalBundle = raw?.value ?? acceptedBundle;
      const finalResult = raw?.originality ?? raw?.result ?? acceptedResult;
      const regenerationCount =
        typeof raw?.regenerationCount === 'number'
          ? raw.regenerationCount
          : typeof raw?.attempts === 'number'
            ? Math.max(0, raw.attempts - 1)
            : Math.max(0, generateCalls - 1);

      if (finalBundle?.master) {
        master_content = finalBundle.master;
        platform_variant = finalBundle.variant ?? platform_variant;
      }
      if (finalResult) {
        originalityOutcome = {
          result: finalResult,
          regenerationCount,
          retrievalLatencyMs: Date.now() - gateStarted,
        };
        recordOriginalitySample({
          contentType: 'thread',
          decision: finalResult.decision,
          score: finalResult.score,
          isDuplicate: finalResult.decision === 'duplicate' || finalResult.isOriginal === false,
          regenerationCount,
          retrievalLatencyMs: originalityOutcome.retrievalLatencyMs,
        });
      }
    } catch (originalityError) {
      console.error('[threads/generate] originality gate failed (continuing with original content):', originalityError);
    }
  }

  // Writer Wave 1 — persist the canonical master text BEFORE returning so the
  // editor/scheduler can read this generation by id and closing the browser
  // never loses work. Best-effort + additive: on any failure we log and return
  // the generated content unchanged (content_id null), never breaking generation.
  let content_id: string | null = null;
  try {
    const persisted = await createContent({
      companyId: input.company_id,
      contentType: 'thread',
      title: input.topic.trim(),
      body: master_content.content ?? '',
      topic: input.topic.trim(),
      objective: resolvedObjective || null,
      audience: input.target_audience ?? null,
      tone: input.tone ?? null,
      brief: {
        template_name: input.template_name?.trim() || null,
        cta: input.cta ?? null,
        platform,
      },
      sourceMetadata: {
        master_content,
        platform_variant,
      },
      lifecycleStatus: 'generated',
    });
    content_id = persisted.id;
  } catch (persistError) {
    console.error('[threads/generate] canonical content persistence failed (continuing):', persistError);
  }

  // ── Writer Wave 2 — Content Memory index + originality metadata ──────────────
  // Best-effort/fail-safe: index the accepted master into Content Memory and
  // persist the originality decision alongside the canonical row (item 9). Each
  // write is isolated so one failing never blocks the other, and neither can
  // break the response.
  if (isOriginalityGateEnabled() && originalityOutcome) {
    try {
      await indexContentUnit({
        companyId: input.company_id,
        contentId: content_id ?? undefined,
        contentType: 'thread',
        platform,
        lifecycleStatus: 'generated',
        text: master_content.content ?? '',
      });
    } catch (indexError) {
      console.error('[threads/generate] content-memory index failed (continuing):', indexError);
    }
    try {
      await persistOriginality({
        companyId: input.company_id,
        contentId: content_id ?? undefined,
        originalityScore: originalityOutcome.result.score,
        decision: originalityOutcome.result.decision,
        nearestMatches: originalityOutcome.result.nearestMatches,
        similarityDimensions: originalityOutcome.result.dimensions,
        regenerationCount: originalityOutcome.regenerationCount,
        generationFingerprint: originalityOutcome.result.fingerprint?.exactHash,
      });
    } catch (persistOrigError) {
      console.error('[threads/generate] originality persistence failed (continuing):', persistOrigError);
    }
  }

  // ── Writer Wave 4 — Quality Engine: score + section-block seeding ────────────
  // Best-effort + FAIL-OPEN. Runs only when the canonical row exists (needs a
  // content_id to persist against). Deterministically evaluate the ACCEPTED
  // master text, persist the scorecard, split into section blocks, and seed the
  // collaboration block model. Gated by QUALITY_ENGINE_ENABLED (default ON).
  // Every sub-step is isolated so one failing never blocks the others, and none
  // can break the response. Existing response fields are untouched.
  if (isQualityEngineEnabled() && content_id) {
    try {
      const masterText = master_content.content ?? '';
      const scorecard = await qualityEngine.evaluate({
        companyId: input.company_id,
        contentType: 'thread',
        platform,
        text: masterText,
        objective: resolvedObjective || undefined,
        audience: input.target_audience ?? undefined,
        originalityScore: originalityOutcome?.result.score,
      });
      if (!scorecard.evaluatedAt) scorecard.evaluatedAt = new Date().toISOString();
      try {
        await qualityService.persistScorecard({ companyId: input.company_id, contentId: content_id, scorecard });
      } catch (persistScoreError) {
        console.error('[threads/generate] quality scorecard persistence failed (continuing):', persistScoreError);
      }
      try {
        const blocks = splitIntoBlocks(masterText, 'thread');
        await collaborationService.upsertBlocks(input.company_id, content_id, blocks as never);
      } catch (blockError) {
        console.error('[threads/generate] section-block seeding failed (continuing):', blockError);
      }
    } catch (qualityError) {
      console.error('[threads/generate] quality engine failed (continuing):', qualityError);
    }
  }

  return {
    success: true,
    content_type: 'thread',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
    content_id,
  };
}
