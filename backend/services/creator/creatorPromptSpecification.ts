/**
 * Canonical Creator Prompt Specification.
 *
 * The ONE authoritative prompt-composition layer for Creator Content master
 * generation. The execution engine no longer owns the blueprint prompt: it
 * gathers inputs (canonical context, template, user content, generation intent)
 * and asks this layer for a `CreatorPromptSpecification`, then executes it.
 *
 * Responsibility split:
 *   Context Assembly → Prompt Specification (this layer) → Execution Engine → Validation → Rendering
 *
 * This is a BEHAVIOR-PRESERVING externalization: the composed system + user
 * messages are byte-identical to the engine's prior inline construction, so
 * generation behavior, rendering, and templates are unchanged. Adding a new
 * asset family means extending this spec layer only — never the engine.
 */

import { getCreatorSystemPrompt } from '../../prompts/creatorContentPromptsV1';
import { resolveAssetGovernanceProfile } from '../creatorAssetGovernance';

type SystemPromptKind = Parameters<typeof getCreatorSystemPrompt>[0];
type SystemPromptContext = Parameters<typeof getCreatorSystemPrompt>[1];

/** Structured inputs the engine hands to the spec layer (no prompt strings). */
export interface CreatorBlueprintPromptInput {
  assetType: string;
  /** Blueprint family used to select the canonical system instructions. */
  blueprintType: SystemPromptKind | 'image';
  /** Context for the system-instruction factory (theme/visual tone/etc.). */
  creatorContext: SystemPromptContext;
  /** The structured input block serialized into the user prompt. */
  promptInput: Record<string, unknown>;
  analyticsPromptBlock?: string | null;
  analyticsLowConfidenceNote?: string | null;
  /** Template alignment instruction (template-derived, computed by caller). */
  templateAlignmentInstruction: string;
  completionRetryHint?: string | null;
  qualityRetryHint?: string | null;
  /** CREATOR-061: canonical blueprint visual directives (from the single
   *  BlueprintPromptAssembler). Additive — when null/empty the user prompt is
   *  byte-identical to legacy. Enriches visual intent; never overrides the goal. */
  blueprintDirectives?: string | null;
}

/** The prompt specification the execution engine consumes unchanged. */
export interface CreatorPromptSpecification {
  system: string;
  user: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  operation: string;
  temperature: number;
  response_format: { type: 'json_object' };
}

/**
 * Compose the canonical blueprint prompt specification. Byte-identical to the
 * engine's prior inline `systemPrompt` + `prompt` construction.
 */
export function buildCreatorBlueprintPromptSpecification(
  input: CreatorBlueprintPromptInput,
): CreatorPromptSpecification {
  // System instructions — image blueprints reuse the video_script factory
  // (no dedicated image factory), exactly as before.
  const system = getCreatorSystemPrompt(
    input.blueprintType === 'image' ? 'video_script' : input.blueprintType,
    input.creatorContext,
  );

  // Generate-to-fit: the copy is composited onto a fixed-size visual, so tell the
  // model the per-block word budget (from the asset's governance profile) and
  // require complete copy within it. This is what keeps the downstream governance
  // trim / renderer clip from ever having to cut text mid-thought.
  const wordBudget = resolveAssetGovernanceProfile(input.assetType).maxWordsPerSlide;
  const copyBudgetInstruction =
    typeof wordBudget === 'number' && wordBudget > 0
      ? `Text length & completeness (critical — copy is composited onto a fixed visual and MUST NOT be cut off):
- Keep EACH text block (headline, body, and every slide's copy) within about ${wordBudget} words. Count words.
- Every block must be a COMPLETE thought that ends cleanly — never write copy that would need truncation to fit, and never end mid-phrase or with an ellipsis.
- If an idea will not fit, tighten it into a shorter complete statement rather than letting it overflow.\n\n`
      : '';

  const user = `Generate a creator asset blueprint.

Input:
${JSON.stringify(input.promptInput, null, 2)}

${copyBudgetInstruction}Analytics intelligence guidance:
${input.analyticsPromptBlock ?? 'No analytics/search intelligence is available. Use only the supplied creator and campaign context.'}
${input.analyticsLowConfidenceNote ? `\nConfidence note: ${input.analyticsLowConfidenceNote}` : ''}

Template alignment rule:
${input.templateAlignmentInstruction}

${input.assetType === 'image' ? 'Single-image output rule: include top-level "headline" and "visual_description" fields. The visual_description must describe the actual preview composition, focal object, layout, palette, hierarchy, and intended viewer reaction. Do not return only generic placeholder language.' : ''}
${input.completionRetryHint ? `\n${input.completionRetryHint}\n` : ''}${input.qualityRetryHint ? `\n${input.qualityRetryHint}\n` : ''}${input.blueprintDirectives ? `\nVisual blueprint direction (enrich visual intent; never override the business goal/brand/audience above):\n${input.blueprintDirectives}\n` : ''}
Return JSON only.`;

  return {
    system,
    user,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    operation: `creator_execution_blueprint_${input.assetType}`,
    temperature: 0,
    response_format: { type: 'json_object' },
  };
}
