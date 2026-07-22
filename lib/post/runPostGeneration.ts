import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { getDefaultPostTemplates } from './defaultPostTemplates';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  extractCompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
  scoreCompanyContext,
  getDynamicContextThreshold,
  buildDiagnosticRetryReasons,
} from '../content/companyContextBlock';
// Closure Pass — Phase 4. Post generation now resolves governance
// from the same company profile it already loaded and threads it
// onto the pipeline `item` so system prompts pick up the preamble.
import { buildGovernancePromptContext } from '../../backend/services/creator/strategyGovernancePromptContext';
// Writer Wave 1 — immediate durability. Persist a canonical `content` row the
// moment generation completes so closing the browser never loses work. This is
// purely additive: a best-effort write wrapped in try/catch that can never break
// generation, plus a new `content_id` field on the response.
import { createContent } from '../../backend/services/content/contentService';
// Writer Wave 2 — Content Intelligence & Originality. All ADDITIVE + FAIL-OPEN.
// The originality gate/memory/regeneration modules are the canonical Wave 2
// seams; this file wires them into the post generation path. Any failure logs
// and returns the already-generated content unchanged — generation NEVER breaks.
import { assertOriginality } from '../../backend/services/content/originalityGate';
import { regenerateUntilOriginal } from '../../backend/services/content/originalityRegeneration';
import { indexContentUnit, persistOriginality } from '../../backend/services/content/contentMemoryService';
import { recordOriginalitySample } from '../../backend/observability/originalityMetrics';
import type { OriginalityResult } from '../content/originality/types';
// Writer Wave 3 — the single canonical GenerationRuntime. Flag-gated delegation
// (default OFF) so this entry point can route through the one runtime for cert
// validation without changing default behavior. Fall-back-safe (see below).
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

/** WAVE 3 — flag-gated cutover to the canonical GenerationRuntime. Default OFF
 * so the inline path (Wave 0/1/2 orchestration) stays the byte-identical
 * default; `1/true/on/yes` opts a call into the runtime (fall-back-safe). */
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

export interface PostGenerationRequest {
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

export interface PostGenerationResult {
  success: true;
  content_type: 'post';
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
  const template = getDefaultPostTemplates().find(
    (entry) => entry.name.trim().toLowerCase() === normalized,
  );
  if (!template) return `Use the "${templateName.trim()}" template style while keeping the post concise and platform-native.`;
  return `Use the "${template.name}" template style. ${template.description}`;
}

function extractExplicitTimingReference(topic: string): string | null {
  const monthYearMatch = topic.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/i,
  );
  if (monthYearMatch?.[0]) return monthYearMatch[0];

  const yearMatch = topic.match(/\b20\d{2}\b/);
  if (yearMatch?.[0]) return yearMatch[0];

  return null;
}

function buildPostFactualGuardrails(input: PostGenerationRequest): string {
  // Content-integrity rules (NOT anti-generic rules — those come from the shared
  // buildAntiGenericRules). These prevent hallucinated proof points and wrong
  // timing in launch/announce-style posts.
  const timingReference = extractExplicitTimingReference(input.topic);
  const soundsLikeLaunch = /\b(launch|launching|introducing|announce|announcing|coming soon|officially launch)\b/i.test(
    input.topic,
  ) || /\blaunch\b/i.test(input.template_name || '');

  return [
    'Factual guardrails for this post:',
    '- Do NOT invent testimonials, customer quotes, adoption, user outcomes, case studies, or proof points unless they were explicitly provided.',
    '- Do NOT imply the product is already widely used, proven, or endorsed if that proof was not supplied.',
    '- Do NOT introduce random historical references or past-year framing such as 2023 or 2024 unless the user explicitly asked for that exact year.',
    timingReference
      ? `- Preserve this explicit timing reference exactly: ${timingReference}. Do not replace it with another year or timeline.`
      : null,
    soundsLikeLaunch
      ? '- This is launch-oriented copy. If timing is not fully specified, keep the framing upcoming/present without inventing a month, quarter, or year.'
      : null,
  ].filter(Boolean).join('\n');
}

// ── WAVE3 (item 1) — canonical-runtime delegation, DEFERRED (safety-first) ──
// This entry point is the short-form "post" surface that the canonical
// GenerationRuntime (backend/services/content/runtime/generationRuntime.ts) is
// designed to own. The intended Wave-3 shape is a pure delegation:
//
//   const out = await generationRuntime.generate({
//     contentType: 'post', company_id, topic, platform, intent, objective,
//     target_audience, tone, cta, template_name, extra_instruction,
//   }); // GenerationOutput { master, variants, contentId, originality }
//
//   return {
//     success: true,
//     content_type: 'post',
//     template_used: input.template_name?.trim() || null,
//     master_content: out.master,          // MasterContentPayload
//     platform_variant: out.variants[0],   // PlatformVariantPayload
//     content_id: out.contentId,           // string | null
//   };
//
// The mapping above is byte-identical to this function's current return shape,
// so callers (pages/api/posts/generate.ts → res.json(result)) are unaffected.
//
// DEFERRED — NOT wired here yet: generationRuntime.ts is authored concurrently
// and is NOT present in this worktree. Adding a hard/dynamic import to a missing
// module would break tsc AND the Next build, taking the LIVE /api/posts/generate
// endpoint down — a direct violation of the "backward compatible, callers
// unaffected" constraint. Per the Wave-3 safety rule ("prefer safety over
// aggressive removal; when unsure, keep + WAVE3-TODO"), the full inline
// orchestration below is preserved verbatim (Wave 0 objective + Wave 1
// persist/content_id + Wave 2 originality/regeneration) and remains the source
// of truth until the runtime lands, at which point this body is replaced by the
// delegation above.
export async function runPostGeneration(
  input: PostGenerationRequest,
): Promise<PostGenerationResult> {
  // Shared input assembly — hoisted ABOVE the Wave-3 delegation branch so BOTH the
  // canonical runtime and the inline legacy path feed the generation primitive the
  // SAME extra_instruction + governance + lifecycle (parity fix WRITER-CERT-006).
  // Reads only from `input`; behaviour with the flag OFF is unchanged.
  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : 'linkedin';

  // Resolve company identity for shared prompt-level enforcement (A4 parity
  // with long-form). Identity lock + anti-generic rules are the SAME builders
  // used by blog/article/whitepaper — no duplicated inline rules here.
  const profile = await getProfile(input.company_id, { autoRefine: false, languageRefine: false }).catch(() => null);
  const identity = extractCompanyIdentity(profile);
  const companyEnforcement = (identity.companyName || identity.industry || identity.coreProblem)
    ? `${buildIdentityLock(identity, 'post')}\n\n${buildAntiGenericRules(identity)}`
    : '';

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const masterNeutralityInstruction = [
    'Master-content rule for this post:',
    '- Write the master draft as platform-agnostic source content.',
    '- Do NOT optimize the master draft specifically for LinkedIn or any other single platform.',
    '- Do NOT use platform-specific cues such as "LinkedIn post", "professional network", or channel-native formatting in the master draft.',
    '- Save platform-native shaping for the variant generation step only.',
  ].join('\n');
  const extraInstruction = [
    companyEnforcement || undefined,
    templateInstruction,
    masterNeutralityInstruction,
    buildPostFactualGuardrails(input),
    typeof input.extra_instruction === 'string' && input.extra_instruction.trim()
      ? input.extra_instruction.trim()
      : undefined,
  ].filter(Boolean).join('\n\n');

  // Closure Pass — Phase 4. Build the governance context from the
  // already-loaded company profile. The post path normally has no
  // operator-selected purpose strategy, so `selectedStrategy=null`;
  // industry-level directives still apply.
  const governance = profile
    ? buildGovernancePromptContext({
        companyContext: {
          industry: profile.industry ?? null,
          industry_list: profile.industry_list ?? null,
          category: profile.category ?? null,
          category_list: profile.category_list ?? null,
        },
        contentType: 'image', // posts share the image-lane policy
        selectedStrategy: null,
      })
    : null;

  // ── WAVE 3 (item 1) — canonical-runtime delegation, FLAG-GATED + FALL-BACK-SAFE ──
  // Default OFF ⇒ the inline orchestration below runs unchanged. When ON, route
  // through the single GenerationRuntime; if it does not return a complete
  // master+variant (its post-generation stages are fail-open), fall through to
  // the inline path — so enabling the flag can NEVER break generation.
  if (isWriterRuntimeDelegationEnabled()) {
    try {
      const out = await generationRuntime.generate({
        contentType: 'post',
        companyId: input.company_id,
        topic: input.topic,
        platform: input.platform,
        objective: input.objective,
        // Parity (WRITER-CERT-006): feed the runtime the SAME assembled guidance +
        // governance + lifecycle the legacy path uses, so delegation is faithful.
        extraInstruction: extraInstruction || input.extra_instruction,
        governance,
        lifecycleStatus: 'generated',
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
          content_type: 'post',
          template_used: input.template_name?.trim() || null,
          master_content: master,
          platform_variant: variant,
          content_id: out.contentId ?? null,
        };
      }
      console.warn('[runPostGeneration] runtime returned no usable master/variant; falling back to inline path');
    } catch (err) {
      console.error('[runPostGeneration] runtime delegation failed; falling back to inline path', err);
    }
  }

  // Objective Preservation (Wave 0): thread the caller's REAL objective through.
  // When genuinely absent we OMIT `intent.objective` entirely (rather than
  // fabricate a generic "Create a strong master post…" instruction) so the
  // downstream blueprint prompt omits the objective line instead of steering the
  // model with an invented marketing goal.
  const resolvedObjective =
    (typeof input.objective === 'string' && input.objective.trim())
      ? input.objective.trim()
      : (typeof input.intent === 'string' && input.intent.trim())
        ? input.intent.trim()
        : '';

  const masterItem = {
    execution_id: `post-${Date.now()}`,
    company_id: input.company_id,
    platform: 'multi',
    content_type: 'post',
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      ...(resolvedObjective ? { objective: resolvedObjective } : {}),
      target_audience: input.target_audience || 'Professional audience aligned to company context',
      tone: input.tone || 'Clear, credible, and engaging',
      cta_type: input.cta || 'Soft CTA',
    },
    active_platform_targets: [
      {
        platform: 'multi',
        content_type: 'post',
      },
    ],
    ...(extraInstruction ? { extra_instruction: extraInstruction } : {}),
    ...(governance ? { governance } : {}),
  };

  const variantItem = {
    ...masterItem,
    platform,
    intent: {
      ...masterItem.intent,
      // Same objective as the master item; omitted when the caller gave none —
      // never fabricate a "platform-native authority post" objective.
      ...(resolvedObjective ? { objective: resolvedObjective } : {}),
    },
    active_platform_targets: [
      {
        platform,
        content_type: 'post',
      },
    ],
  };

  let master_content = await generateMasterContentFromIntent(masterItem);
  let [platform_variant] = await buildPlatformVariantsFromMaster({
    ...variantItem,
    master_content,
  });

  if (!platform_variant) {
    throw new Error(`Failed to generate post variant for platform "${platform}"`);
  }

  // D3: short-form company-context gate. If the variant scores below threshold,
  // regenerate once with a diagnostic message appended so the model treats the
  // company-context failures as mandatory fixes. Lightweight — single regen,
  // no deep structural parsing.
  if (companyEnforcement) {
    const variantText = [
      platform_variant.generated_content || '',
      master_content.content || '',
    ].filter(Boolean).join('\n\n');

    if (variantText.trim().length >= 40) {
      const wordCount = variantText.split(/\s+/).filter(Boolean).length;
      const threshold = getDynamicContextThreshold('post', wordCount);
      const score = scoreCompanyContext(variantText, identity, { contentType: 'post' });
      let retryCount = 0;
      let finalScore = score.score;

      if (score.score < threshold) {
        const diagnostic = buildDiagnosticRetryReasons(score, identity);
        const regenMasterItem = {
          ...masterItem,
          extra_instruction: [
            masterItem.extra_instruction ?? '',
            `\n\n## PREVIOUS DRAFT FAILED COMPANY-CONTEXT CHECK (score ${score.score}/100)\n${diagnostic}`,
          ].filter(Boolean).join(''),
        };
        try {
          retryCount = 1;
          const regenMaster = await generateMasterContentFromIntent(regenMasterItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...variantItem,
            master_content: regenMaster,
          });
          if (regenVariant) {
            const regenText = [
              regenVariant.generated_content || '',
              regenMaster.content || '',
            ].filter(Boolean).join('\n\n');
            const regenScore = scoreCompanyContext(regenText, identity, { contentType: 'post' });
            // Keep the regen only if it actually improved the score — never
            // ship something worse than the first attempt.
            if (regenScore.score > score.score) {
              master_content = regenMaster;
              platform_variant = regenVariant;
              finalScore = regenScore.score;
            }
          }
        } catch { /* regen is best-effort; keep original on transient failure */ }
      }

      console.info('[content-enforcement]', {
        contentType: 'post',
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
          // REgeneration: minimal different-angle nudge on the SAME master item.
          const nudgedMasterItem = {
            ...masterItem,
            extra_instruction: [masterItem.extra_instruction ?? '', ORIGINALITY_REGEN_NUDGE]
              .filter(Boolean).join('\n\n'),
          };
          const regenMaster = await generateMasterContentFromIntent(nudgedMasterItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...variantItem,
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
            contentType: 'post',
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
          contentType: 'post',
          decision: finalResult.decision,
          score: finalResult.score,
          isDuplicate: finalResult.decision === 'duplicate' || finalResult.isOriginal === false,
          regenerationCount,
          retrievalLatencyMs: originalityOutcome.retrievalLatencyMs,
        });
      }
    } catch (originalityError) {
      console.error('[posts/generate] originality gate failed (continuing with original content):', originalityError);
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
      contentType: 'post',
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
    console.error('[posts/generate] canonical content persistence failed (continuing):', persistError);
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
        contentType: 'post',
        platform,
        lifecycleStatus: 'generated',
        text: master_content.content ?? '',
      });
    } catch (indexError) {
      console.error('[posts/generate] content-memory index failed (continuing):', indexError);
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
      console.error('[posts/generate] originality persistence failed (continuing):', persistOrigError);
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
        contentType: 'post',
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
        console.error('[posts/generate] quality scorecard persistence failed (continuing):', persistScoreError);
      }
      try {
        const blocks = splitIntoBlocks(masterText, 'post');
        await collaborationService.upsertBlocks(input.company_id, content_id, blocks as never);
      } catch (blockError) {
        console.error('[posts/generate] section-block seeding failed (continuing):', blockError);
      }
    } catch (qualityError) {
      console.error('[posts/generate] quality engine failed (continuing):', qualityError);
    }
  }

  return {
    success: true,
    content_type: 'post',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
    content_id,
  };
}
