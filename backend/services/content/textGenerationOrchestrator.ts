/**
 * Text Generation Orchestrator (Phase 1 unification).
 *
 * Single shared entry point for text-only content generation across:
 *   - Direct API generateTextContent (post / thread bespoke path)
 *   - runThreadGeneration (thread / post API)
 *   - any future caller that needs master + per-platform variants
 *
 * Delegates to the existing `contentGenerationPipeline` (the canonical
 * master + variant pipeline). Adds:
 *   - normalized input shape,
 *   - normalized output envelope,
 *   - single retry/validation extension point,
 *   - explicit "single platform variant" mode for surfaces that only
 *     need one platform's output (the Direct API surface).
 *
 * Does NOT touch billing, prompts, or provider logic — that all stays
 * inside the underlying pipeline modules.
 */

import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../contentGenerationPipeline';
import type {
  GovernanceExplainabilityMetadata,
  GovernancePromptContext,
} from '../creator/strategyGovernancePromptContext';
// WS-1c-2 (PMO-ADR-08) — canonical GenerationRuntime convergence for the
// persistence-free text path. FLAG-GATED (default OFF) + FALL-BACK-SAFE: on
// flag-OFF or ANY runtime miss/throw, the inline legacy body below runs
// unchanged. See the delegation block in runTextGeneration.
import { generationRuntime } from './runtime/generationRuntime';

export type TextGenerationOrigin =
  | 'direct-api'      // Direct API's post / thread text-only branch
  | 'thread-api'      // /api/threads/generate
  | 'queue'           // future text-content queue jobs
  | 'bolt';           // future BOLT text rows

export type TextGenerationInput = {
  origin: TextGenerationOrigin;
  companyId: string;
  topic: string;
  contentType: 'post' | 'thread';
  /** Primary target platform; first element drives the variant returned. */
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  intent?: string;
  tone?: string;
  cta?: string;
  templateName?: string;
  extraInstruction?: string;
  /** Free-form context (subtype/constraints/etc.) forwarded as enrichment. */
  creatorCard?: Record<string, unknown>;
  /**
   * Creator Governance Parity For Text Content — Phase 1+2+3.
   * Optional governance prompt context. When present and the
   * resolved industry is regulated, the orchestrator appends a
   * compact compliance directive block to the LLM prompt and surfaces
   * the same explainability shape the visual composer does.
   * Null / absent / industry='none' → strict no-op (zero change in
   * the master + variant payloads vs. prior behavior).
   */
  governance?: GovernancePromptContext | null;
};

/**
 * Text-side governance explainability envelope. Mirrors the shape
 * exposed by the visual composer's `composed.governance` so callers
 * see one parity contract across image / carousel / infographic /
 * post / thread.
 */
export type TextGovernanceMetadata = GovernanceExplainabilityMetadata;

export type TextGenerationResult = {
  success: true;
  origin: TextGenerationOrigin;
  contentType: 'post' | 'thread';
  templateUsed: string | null;
  masterContent: MasterContentPayload;
  /** Primary platform variant (one per call, by design). */
  platformVariant: PlatformVariantPayload;
  /** Resolved primary platform (normalized lowercase). */
  primaryPlatform: string;
  /**
   * Creator Governance Parity For Text Content — Phase 5.
   * Always present. industry='none' + warningsApplied=0 when no
   * governance context was supplied.
   */
  governance: TextGovernanceMetadata;
};

/**
 * Build the additive governance instruction block. Returns null when
 * no governance context is supplied OR the resolved industry has no
 * directives — yielding a strict no-op so non-regulated callers see
 * the original prompt unchanged.
 *
 * Phase 2 — compliance directives prepended; Phase 4 — restricted /
 * deprioritized caution line appended.
 */
function buildTextGovernanceInstruction(
  governance: GovernancePromptContext | null | undefined,
): string | null {
  if (!governance) return null;
  const { governanceContextHasAnyDirective } =
    require('../creator/strategyGovernancePromptContext') as typeof import('../creator/strategyGovernancePromptContext');
  if (!governanceContextHasAnyDirective(governance)) return null;
  const lines: string[] = [];
  if (governance.industry !== 'none' && governance.compliancePromptDirectives.length > 0) {
    lines.push(`Compliance directives (${governance.industry} industry policy, risk: ${governance.riskLevel}):`);
    for (const d of governance.compliancePromptDirectives) lines.push(`- ${d}`);
  }
  if (governance.selectedStrategyIsRestricted) {
    lines.push(
      `Use extra caution because the selected strategy "${governance.selectedStrategy ?? 'unknown'}" is governed by industry policy: ${governance.selectedStrategyGovernanceReason ?? 'restricted by policy'}.`,
    );
  } else if (governance.selectedStrategyIsDeprioritized) {
    lines.push(
      `The selected strategy "${governance.selectedStrategy ?? 'unknown'}" is deprioritized by industry policy: ${governance.selectedStrategyGovernanceReason ?? 'deprioritized by policy'}. Apply the compliance directives above with extra discipline.`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build the explainability metadata envelope. Always returns a
 * stable shape so callers don't need to handle "governance absent".
 */
function buildTextGovernanceMetadata(
  governance: GovernancePromptContext | null | undefined,
  warningsApplied: number,
): TextGovernanceMetadata {
  if (!governance) {
    return {
      industry: 'none',
      riskLevel: 'none',
      selectedStrategy: null,
      warningsApplied: 0,
      selectedStrategyIsRestricted: false,
      selectedStrategyIsDeprioritized: false,
    };
  }
  return {
    industry: governance.industry,
    riskLevel: governance.riskLevel,
    selectedStrategy: governance.selectedStrategy,
    warningsApplied,
    selectedStrategyIsRestricted: governance.selectedStrategyIsRestricted,
    selectedStrategyIsDeprioritized: governance.selectedStrategyIsDeprioritized,
  };
}

/**
 * Build the pipeline's `item` envelope from the normalized orchestrator
 * input. Mirrors the construction inside `runThreadGeneration` so both
 * callers feed the pipeline the same shape.
 */
function buildPipelineItem(input: TextGenerationInput, primaryPlatform: string): Record<string, unknown> {
  const isThread = input.contentType === 'thread';
  // Objective Preservation (Wave 0): thread the caller's REAL objective; OMIT
  // `intent.objective` when genuinely absent so the downstream blueprint prompt
  // omits the objective line instead of steering the model with a fabricated
  // "high-retention educational thread." / "platform-native post." goal.
  const resolvedObjective =
    (typeof input.objective === 'string' && input.objective.trim())
      ? input.objective.trim()
      : (typeof input.intent === 'string' && input.intent.trim())
        ? input.intent.trim()
        : '';
  const item: Record<string, unknown> = {
    execution_id: `${input.contentType}-${Date.now()}`,
    company_id: input.companyId,
    platform: primaryPlatform,
    content_type: input.contentType,
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      ...(resolvedObjective ? { objective: resolvedObjective } : {}),
      target_audience: input.audience || 'Audience aligned to the topic and company context',
      tone: input.tone || (isThread
        ? 'Punchy, clear, and momentum-building'
        : 'Direct and platform-native'),
      cta_type: input.cta || 'Engagement CTA',
    },
    active_platform_targets: [
      {
        platform: primaryPlatform,
        content_type: input.contentType,
      },
    ],
  };
  // Compose the final extra_instruction by prefixing any governance
  // compliance block (when present) to the caller-supplied
  // extraInstruction. Both are optional — the merged value is set
  // only when at least one is non-empty. Additive: legacy callers
  // without governance see the previous extraInstruction string
  // unchanged.
  const governanceBlock = buildTextGovernanceInstruction(input.governance ?? null);
  const callerInstruction = input.extraInstruction?.trim() || '';
  const merged = [governanceBlock, callerInstruction].filter(Boolean).join('\n\n');
  if (merged) {
    item.extra_instruction = merged;
  }
  if (input.creatorCard && Object.keys(input.creatorCard).length > 0) {
    item.creator_card = input.creatorCard;
  }
  // Creator System-Prompt Governance Integration. Thread the
  // governance context through to the pipeline as a top-level item
  // field so blueprintGenerator + platformVariantGenerator can read
  // it when building their system prompts. Additive — when null,
  // pipeline sites that read it via `item.governance` get null and
  // skip the preamble injection (byte-identical to legacy callers).
  if (input.governance) {
    item.governance = input.governance;
  }
  return item;
}

/**
 * WS-1c-2 (PMO-ADR-08) — cutover flag for the canonical GenerationRuntime.
 * Default OFF ⇒ the inline legacy body runs unchanged. Scoped to this
 * orchestrator (distinct from WRITER_RUNTIME_DELEGATION_ENABLED) so #7 can be
 * enabled independently and reversibly.
 */
function isTextgenRuntimeDelegationEnabled(): boolean {
  return /^(1|true|on|yes)$/.test(
    String(process.env.TEXTGEN_RUNTIME_DELEGATION_ENABLED ?? '').trim().toLowerCase(),
  );
}

export async function runTextGeneration(input: TextGenerationInput): Promise<TextGenerationResult> {
  if (!input.companyId) throw new Error('text orchestrator: companyId required');
  if (!input.topic || !input.topic.trim()) throw new Error('text orchestrator: topic required');
  if (input.contentType !== 'post' && input.contentType !== 'thread') {
    throw new Error(`text orchestrator: unsupported contentType "${input.contentType}"`);
  }
  if (!Array.isArray(input.targetPlatforms) || input.targetPlatforms.length === 0) {
    throw new Error('text orchestrator: targetPlatforms required');
  }
  const primaryPlatform = String(input.targetPlatforms[0] || 'linkedin').toLowerCase();
  const item = buildPipelineItem(input, primaryPlatform);

  // ── WS-1c-2 — CANONICAL RUNTIME DELEGATION (FLAG-GATED, default OFF, FALL-BACK-SAFE).
  // This orchestrator is persistence-free + originality-free by contract, so the
  // PARITY-MATCHING runtime config is { persist:false, runOriginality:false } — a
  // pure generation engine that produces master + variants WITHOUT touching the
  // canonical content store or the originality gate. Every field the runtime's
  // prompt assembler consumes is read off the ALREADY-BUILT `item`, so the
  // reconstructed generation item is faithful to the legacy path (same resolved
  // objective/audience/tone/cta, same merged governance+extra instruction, same
  // governance object). On flag-OFF or ANY runtime miss/throw, control falls
  // through to the inline legacy body below (unchanged) — enabling the flag can
  // NEVER break generation.
  if (isTextgenRuntimeDelegationEnabled()) {
    try {
      const builtIntent = (item.intent ?? {}) as Record<string, unknown>;
      const asString = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() ? v : undefined;
      const out = await generationRuntime.generate({
        persist: false,
        runOriginality: false,
        companyId: input.companyId,
        contentType: input.contentType,
        topic: asString(item.topic) ?? input.topic.trim(),
        platform: primaryPlatform,
        targetPlatforms: input.targetPlatforms
          .map((p) => String(p || '').toLowerCase())
          .filter(Boolean),
        objective: asString(builtIntent.objective),
        audience: asString(builtIntent.target_audience),
        tone: asString(builtIntent.tone),
        cta: asString(builtIntent.cta_type),
        extraInstruction: asString(item.extra_instruction),
        creatorCard: (item.creator_card as Record<string, unknown> | undefined) ?? undefined,
        governance: (item.governance as GovernancePromptContext | undefined) ?? undefined,
      });
      const runtimeMaster = out.master as MasterContentPayload | undefined;
      const runtimeVariant = (Array.isArray(out.variants) ? out.variants[0] : undefined) as
        | PlatformVariantPayload
        | undefined;
      if (runtimeMaster?.content && runtimeVariant?.generated_content) {
        // Governance explainability is a static contract of THIS surface (not the
        // runtime's concern) — compute it exactly as the legacy return does.
        const govBlock = buildTextGovernanceInstruction(input.governance ?? null);
        const govWarnings = govBlock
          ? govBlock.split('\n').filter((l) => l.trim().startsWith('-')).length
          : 0;
        return {
          success: true,
          origin: input.origin,
          contentType: input.contentType,
          templateUsed: input.templateName?.trim() || null,
          masterContent: runtimeMaster,
          platformVariant: runtimeVariant,
          primaryPlatform,
          governance: buildTextGovernanceMetadata(input.governance ?? null, govWarnings),
        };
      }
      console.warn(
        '[textGenerationOrchestrator] runtime returned no usable master/variant; falling back to inline path',
      );
    } catch (err) {
      console.error(
        '[textGenerationOrchestrator] runtime delegation failed; falling back to inline path',
        err,
      );
    }
  }

  const masterContent = await generateMasterContentFromIntent(item);
  const variants = await buildPlatformVariantsFromMaster({
    ...item,
    master_content: masterContent,
  });
  const platformVariant = variants[0];
  if (!platformVariant) {
    throw new Error(`text orchestrator: failed to produce variant for platform "${primaryPlatform}"`);
  }

  // Creator Governance Parity For Text Content — Phase 5.
  // Explainability metadata: warningsApplied = number of compliance
  // directive lines actually injected into the prompt.
  const governanceBlock = buildTextGovernanceInstruction(input.governance ?? null);
  const warningsApplied = governanceBlock
    ? governanceBlock.split('\n').filter((l) => l.trim().startsWith('-')).length
    : 0;
  const governanceMetadata = buildTextGovernanceMetadata(input.governance ?? null, warningsApplied);

  return {
    success: true,
    origin: input.origin,
    contentType: input.contentType,
    templateUsed: input.templateName?.trim() || null,
    masterContent,
    platformVariant,
    primaryPlatform,
    governance: governanceMetadata,
  };
}
