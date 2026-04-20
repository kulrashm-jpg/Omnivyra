/**
 * Shared prompt-building utilities used by all newsletter format generators.
 */
import type { NewsletterGenerationRequest } from '../runNewsletterGeneration';
import {
  buildIdentityLock,
  buildAntiGenericRules,
  type CompanyIdentity,
} from '../../content/companyContextBlock';
import type { CompanyContext } from '../../blog/blogRunnerTypes';

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

  // ── Company context (full identity, not just 3 fields) ─────────────────
  const cc = input.companyContext;
  if (cc) {
    const companyLines: string[] = [];
    if (cc.companyName) companyLines.push(`Company: ${cc.companyName}`);
    if (cc.industry) companyLines.push(`Industry: ${cc.industry}`);
    if (cc.audience) companyLines.push(`Audience: ${cc.audience}`);
    if (cc.coreProblemStatement) companyLines.push(`Core problem: ${cc.coreProblemStatement}`);
    if (cc.painSymptoms?.length) companyLines.push(`Pain points: ${cc.painSymptoms.slice(0, 4).join('; ')}`);
    if (cc.uniqueValue) companyLines.push(`Unique value: ${cc.uniqueValue}`);
    if (cc.productsServices) companyLines.push(`Products/services: ${cc.productsServices}`);
    if (cc.authorityDomains?.length) companyLines.push(`Authority domains: ${cc.authorityDomains.slice(0, 4).join(', ')}`);
    if (companyLines.length > 0) {
      parts.push(`COMPANY CONTEXT:\n${companyLines.join('\n')}`);
    }
    if (cc.brand_voice) parts.push(`BRAND VOICE: ${cc.brand_voice}`);
    if (cc.writingStyleInstructions) {
      parts.push(`WRITING STYLE GUIDE:\n${cc.writingStyleInstructions}`);
    }
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

// ---------------------------------------------------------------------------
// System prompt enforcement — identity lock + anti-generic rules for newsletters
// ---------------------------------------------------------------------------

/** Extract CompanyIdentity from the newsletter CompanyContext shape. */
function extractIdentityFromCompanyContext(cc: CompanyContext | undefined): CompanyIdentity {
  if (!cc) return {};
  return {
    companyName: cc.companyName || undefined,
    industry: cc.industry || undefined,
    targetAudience: cc.audience || undefined,
    coreProblem: cc.coreProblemStatement || undefined,
    painPoints: cc.painSymptoms?.filter(Boolean) || undefined,
    uniqueValue: cc.uniqueValue || undefined,
    productsServices: cc.productsServices || undefined,
    desiredTransformation: cc.desiredTransformation || undefined,
    authorityDomains: cc.authorityDomains?.filter(Boolean) || undefined,
    brandVoice: cc.brand_voice || undefined,
    strategyProfile: cc.strategyProfile,
  };
}

/**
 * Enhance any newsletter system prompt with identity lock + anti-generic rules.
 * Call this in every newsletter generator before passing the system prompt to AI.
 *
 * Usage:
 *   const systemPrompt = enhanceNewsletterSystemPrompt(
 *     'You are a senior newsletter writer...',
 *     input.companyContext,
 *   );
 */
export function enhanceNewsletterSystemPrompt(
  basePrompt: string,
  companyContext: CompanyContext | undefined,
): string {
  const identity = extractIdentityFromCompanyContext(companyContext);
  const hasIdentity = !!(identity.companyName || identity.industry || identity.coreProblem);
  if (!hasIdentity) return basePrompt;

  const identityBlock = buildIdentityLock(identity, 'newsletter');
  const antiGeneric = buildAntiGenericRules(identity);

  return `${identityBlock}\n\n${basePrompt}\n${antiGeneric}`;
}
