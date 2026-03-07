/**
 * Prompt Compiler Layer for Omnivyra Prompt Architecture.
 * Injects shared system instructions, format rules, and structure into prompts.
 */

import type { CampaignContext } from '../services/contextCompressionService';

export const SYSTEM_TEMPLATE = `You are an expert AI marketing strategist.

Follow these rules:
• Maintain the campaign tone
• Be concise and structured
• Use high-quality marketing language`;

export const FORMAT_RULES = `Output must be structured and deterministic.
Avoid unnecessary explanations.`;

export type CompilePromptInput = {
  /** System role and base instructions. Defaults to SYSTEM_TEMPLATE if omitted. */
  system?: string;
  /** Task-specific instructions for the LLM to execute. */
  task: string;
  /** Context data (campaign context, topics, etc.) for the LLM to use. */
  context: string;
  /** Override format rules. Defaults to FORMAT_RULES if omitted. */
  formatRules?: string;
};

/**
 * Compile a prompt with shared system instructions, context, rules, and task.
 * Produces deterministic output for consistent LLM behavior.
 */
export function compilePrompt(input: CompilePromptInput): string {
  const system = input.system ?? SYSTEM_TEMPLATE;
  const formatRules = input.formatRules ?? FORMAT_RULES;

  return `SYSTEM
${system}

CONTEXT
${input.context}

RULES
${formatRules}

TASK
${input.task}`;
}

/** Build the shared campaign context block from CampaignContext. */
export function buildCampaignContextBlock(context: CampaignContext): string {
  const eligibleLine =
    context.eligible_platforms?.length
      ? `\nEligible platforms (choose ONLY from these): ${context.eligible_platforms.join(', ')}`
      : '';

  return `Campaign topic: ${context.topic}
Tone: ${context.tone}

Key themes:
${context.themes.length ? context.themes.map((t) => `- ${t}`).join('\n') : '(Derive from topic)'}

Top performing platforms: ${context.top_platforms.length ? context.top_platforms.join(', ') : 'linkedin, x'}
Top performing content types: ${context.top_content_types.length ? context.top_content_types.join(', ') : 'post, video, article'}${eligibleLine}`;
}
