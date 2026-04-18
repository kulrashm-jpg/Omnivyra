/**
 * Shared prompt-building utilities used by all newsletter format generators.
 */
import type { NewsletterGenerationRequest } from '../runNewsletterGeneration';

// ---------------------------------------------------------------------------
// Context block builder (used at the top of every format-specific prompt)
// ---------------------------------------------------------------------------

export function buildContextParts(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason?: string,
): string[] {
  const parts: string[] = [];
  parts.push(`TOPIC: ${input.topic}`);
  parts.push(`TARGET WORD COUNT: ${targetWords} words minimum`);
  if (input.selected_angle) {
    parts.push(`ANGLE TITLE: ${input.selected_angle.title}`);
    parts.push(`ANGLE SUMMARY: ${input.selected_angle.angle_summary}`);
  }
  if (input.answers?.uniqueness_directive) parts.push(`UNIQUENESS DIRECTIVE: ${input.answers.uniqueness_directive}`);
  if (input.answers?.must_include_points) parts.push(`MUST-INCLUDE POINTS: ${input.answers.must_include_points}`);
  if (input.answers?.campaign_objective) parts.push(`CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
  if (input.answers?.trend_context) parts.push(`TREND CONTEXT: ${input.answers.trend_context}`);
  if (input.companyContext?.audience) parts.push(`AUDIENCE: ${input.companyContext.audience}`);
  if (input.companyContext?.brand_voice) parts.push(`BRAND VOICE: ${input.companyContext.brand_voice}`);
  if (input.companyContext?.industry) parts.push(`INDUSTRY: ${input.companyContext.industry}`);
  if (input.companyContext?.writingStyleInstructions) {
    parts.push(`WRITING STYLE GUIDE:\n${input.companyContext.writingStyleInstructions}`);
  }
  if (retryReason) parts.push(`PREVIOUS DRAFT FAILED BECAUSE: ${retryReason}`);
  return parts;
}

/** Convenience wrapper that joins context parts into the standard header block. */
export function buildContextHeader(
  input: NewsletterGenerationRequest,
  targetWords: number,
  retryReason?: string,
): string {
  return buildContextParts(input, targetWords, retryReason).join('\n\n');
}
