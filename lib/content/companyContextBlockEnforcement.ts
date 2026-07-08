/** Part of companyContextBlock (Agent-B split — barrel keeps the original path). */
import { type CompanyIdentity, type CompanyContextScoreResult, buildCompanyContextBlock } from './companyContextBlockBuilders';
import type { CompanyProfile, EntityArchetypeIntelligence, UserGuidedIntelligence } from '../../backend/services/companyProfile/types';
import { buildArchetypePromptContext, isBusinessFirstOnlyArchetype } from '../../backend/services/companyProfile/entityArchetype';
import {
  buildStructuredCompetitorDimensionBlock,
  shouldUseAudienceLedSynthesis,
} from '../../backend/services/companyProfile/competitorSynthesis';
import { getContentValidationMode, validateContentVariation } from './contentVariationValidator';
import {
  type StrategyProfile,
  buildStrategyInstructions,
  extractStrategyProfile,
  validateStrategicPerspective,
} from './companyStrategyPerspective';

// ── 7a. Blocking Helpers (Validation Enforcement) ───────────────────────────
// Convert scoring into hard gates. Callers either retry on failure or abort.

/**
 * Fallback threshold for scoreCompanyContext (0–100).
 * Prefer getDynamicContextThreshold(contentType, wordCount) at new call sites
 * — this constant is kept only for callers that cannot supply a content type.
 */
export const DEFAULT_CONTEXT_SCORE_THRESHOLD = 60;

/**
 * Dynamic, content-type- and length-aware threshold for scoreCompanyContext.
 * Banding:
 *   - Long-form (>= 1500 words OR contentType in {blog, article, guide, whitepaper}): 65–70
 *   - Mid-form  (800–1499 words OR contentType in {newsletter, story, case-study}):  60–65
 *   - Short-form (<800 words OR contentType in {post, thread, carousel, ...}):       55–60
 *
 * The word count takes precedence when provided — a 2000-word newsletter is
 * held to long-form standards even though its type is mid-form.
 */
export function getDynamicContextThreshold(
  contentType: string,
  wordCount?: number,
): number {
  const t = String(contentType || '').trim().toLowerCase();
  const isLongType = ['blog', 'article', 'guide', 'whitepaper'].includes(t);
  const isMidType  = ['newsletter', 'story', 'case_study', 'case-study'].includes(t);

  if (wordCount != null && Number.isFinite(wordCount)) {
    if (wordCount >= 1500) return isLongType ? 68 : 65;
    if (wordCount >= 800)  return isLongType ? 63 : isMidType ? 62 : 60;
    // < 800 words falls through to type-based
  }
  if (isLongType) return 62;
  if (isMidType)  return 58;
  return 55;
}

/**
 * Retry cap applied to the company-context retry loop. Hard ceiling on
 * generation calls per request to bound latency and cost.
 */
export const MAX_CONTEXT_RETRIES = 2;

/**
 * Minimum score improvement between consecutive retry attempts. If a retry
 * lifts the score by fewer than this many points, the loop exits early — the
 * model has plateaued and further retries won't help.
 */
export const MIN_RETRY_IMPROVEMENT_POINTS = 5;

// ── 7a.i Section Splitting ──────────────────────────────────────────────────
// Shared section parser used by long-form and template validation paths.
// Goal: one consistent, testable segmentation that under-segments on purpose.

export const SECTION_MIN_WORDS = 40;

export function countWordsInText(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isHeadingOnly(text: string): boolean {
  // A chunk that has < 6 words and no sentence-ending punctuation is treated
  // as a heading/label, not a section with substance.
  const words = countWordsInText(text);
  if (words < 6) return true;
  if (!/[.!?]/.test(text)) return true;
  return false;
}

/**
 * Normalize content into sections for per-section validation.
 *
 * Inputs:
 *   - string + content type → HTML (long-form) or plain template text
 *   - string[]              → pre-split sections (array input)
 *
 * Algorithm for HTML/long-form string input:
 *   1. Primary: split on <h2> boundaries, keep content after each.
 *   2. Fallback: if fewer than 3 usable H2 chunks, group paragraphs into
 *      chunks of ~150–300 words (2-paragraph groups) so we don't end up
 *      with one giant section or dozens of tiny ones.
 *
 * Filters:
 *   - Drop sections < 40 words.
 *   - Drop chunks that look like heading-only markers.
 */
export function splitIntoSections(
  content: string | string[],
  contentType: string = 'blog',
): string[] {
  // Array input: caller already segmented (e.g. template paragraph blocks).
  if (Array.isArray(content)) {
    return content
      .map((s) => stripHtmlTags(String(s || '')))
      .filter((s) => countWordsInText(s) >= SECTION_MIN_WORDS)
      .filter((s) => !isHeadingOnly(s));
  }

  const html = String(content || '');
  if (!html.trim()) return [];

  // Primary split: on <h2> boundaries.
  const h2Chunks = html.split(/<h2[^>]*>/i).slice(1); // drop pre-H2 preamble

  let chunks: string[];
  if (h2Chunks.length >= 3) {
    chunks = h2Chunks;
  } else {
    // Fallback: paragraph groups. Group 2 paragraphs per section to land
    // roughly in the 150–300 word range for typical long-form prose.
    const paragraphs = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    if (paragraphs.length === 0) {
      // Nothing structured — treat the whole thing as one chunk.
      chunks = [html];
    } else {
      const groupSize = 2;
      chunks = [];
      for (let i = 0; i < paragraphs.length; i += groupSize) {
        chunks.push(paragraphs.slice(i, i + groupSize).join(' '));
      }
    }
  }

  const normalized = chunks
    .map(stripHtmlTags)
    .filter((s) => countWordsInText(s) >= SECTION_MIN_WORDS)
    .filter((s) => !isHeadingOnly(s));

  return normalized;
}

/**
 * Error thrown when content fails company-context validation after retries.
 * Callers (API routes) can distinguish this from generic errors to return
 * a 422 "content failed quality gate" response instead of 500.
 */
export class CompanyContextEnforcementError extends Error {
  constructor(
    public readonly score: number,
    public readonly threshold: number,
    public readonly issues: string[],
  ) {
    super(`Content failed company context validation (score ${score}/100, threshold ${threshold}). Issues: ${issues.slice(0, 3).join('; ')}`);
    this.name = 'CompanyContextEnforcementError';
  }
}

/**
 * C1 blocking gate. Call at the end of a generation pipeline after all
 * retries have been exhausted. Throws CompanyContextEnforcementError if
 * the final score is below threshold. Callers catch and return 422.
 */
export function assertCompanyContextAcceptable(
  score: CompanyContextScoreResult,
  threshold: number = DEFAULT_CONTEXT_SCORE_THRESHOLD,
): void {
  if (score.score < threshold) {
    throw new CompanyContextEnforcementError(score.score, threshold, score.issues);
  }
}

// ── C5. Section-Level Company Context Validator ─────────────────────────────
// Lightweight per-section check: each section must reference at least one of
// the company name, product/service, ICP, or a pain point. If >20% of
// sections fail, the caller should retry.

export interface SectionCompanyContextResult {
  totalSections: number;
  failingSections: number;
  failingRatio: number;
  failingIndices: number[];
  shouldRetry: boolean;
}

export function validateSectionCompanyContext(
  sections: string[],
  identity: CompanyIdentity,
  options: { maxFailingRatio?: number } = {},
): SectionCompanyContextResult {
  const maxFailingRatio = options.maxFailingRatio ?? 0.2;
  const name = (identity.companyName || '').toLowerCase();
  const productTokens = (identity.productsServices || '')
    .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const icpTokens = ((identity.idealCustomerProfile || '') + ' ' + (identity.targetAudience || ''))
    .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const painTokens: string[] = [];
  for (const p of identity.painPoints?.slice(0, 5) || []) {
    painTokens.push(...p.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  }

  const failingIndices: number[] = [];
  sections.forEach((raw, idx) => {
    const text = (raw || '').toLowerCase();
    if (text.length < 20) return; // skip empty/placeholder sections
    const hasName = name && text.includes(name);
    const hasProduct = productTokens.some((t) => text.includes(t));
    const hasIcp = icpTokens.some((t) => text.includes(t));
    const hasPain = painTokens.some((t) => text.includes(t));
    if (!hasName && !hasProduct && !hasIcp && !hasPain) {
      failingIndices.push(idx);
    }
  });

  const totalSections = sections.filter((s) => (s || '').trim().length >= 20).length;
  const failingSections = failingIndices.length;
  const failingRatio = totalSections > 0 ? failingSections / totalSections : 0;
  return {
    totalSections,
    failingSections,
    failingRatio,
    failingIndices,
    shouldRetry: failingRatio > maxFailingRatio,
  };
}

// ── C6. Section-Level Strategy Presence Validator ───────────────────────────
// Each major section should contain at least one marker of contrarian insight,
// company POV, or strategic angle. If any major section misses all three, the
// caller should retry.

export const CONTRARIAN_MARKERS = [
  'however', 'but ', 'unlike', 'contrary', 'instead', 'despite',
  'most companies', 'most teams', 'conventional wisdom', 'common mistake',
  'the reality is', 'in practice', 'what actually', 'the truth is',
  'not just', 'rather than',
];
export const POV_MARKERS = [
  'we believe', 'our view', 'our approach', 'our perspective', 'we\'ve found',
  'we see', 'we think', 'our experience',
];
export const STRATEGIC_MARKERS = [
  'strategy', 'strategic', 'decision', 'leverage', 'competitive advantage',
  'trade-off', 'tradeoff', 'positioning', 'operating model', 'outcome',
  'lever', 'mechanism', 'second-order',
];

export interface StrategyPresenceResult {
  totalSections: number;
  failingSections: number;
  failingIndices: number[];
  shouldRetry: boolean;
}

export function validateStrategyPresence(
  sections: string[],
  options: { maxFailingRatio?: number } = {},
): StrategyPresenceResult {
  const maxFailingRatio = options.maxFailingRatio ?? 0.2;
  const failingIndices: number[] = [];
  sections.forEach((raw, idx) => {
    const text = (raw || '').toLowerCase();
    if (text.length < 80) return; // skip tiny sections (intros, CTAs)
    const hasContrarian = CONTRARIAN_MARKERS.some((m) => text.includes(m));
    const hasPov = POV_MARKERS.some((m) => text.includes(m));
    const hasStrategic = STRATEGIC_MARKERS.some((m) => text.includes(m));
    if (!hasContrarian && !hasPov && !hasStrategic) {
      failingIndices.push(idx);
    }
  });
  const totalSections = sections.filter((s) => (s || '').trim().length >= 80).length;
  const failingSections = failingIndices.length;
  const failingRatio = totalSections > 0 ? failingSections / totalSections : 0;
  return {
    totalSections,
    failingSections,
    failingIndices,
    shouldRetry: failingRatio > maxFailingRatio,
  };
}

// ── 7b. Diagnostic Retry Message ────────────────────────────────────────────
// Explicit, model-facing failure reasons for retry prompts. Appends to any
// existing retry message so the model knows WHICH enforcement rule failed —
// not just "the draft is too short / too thin".

export function buildDiagnosticRetryReasons(
  score: CompanyContextScoreResult,
  identity: CompanyIdentity,
): string {
  const name = identity.companyName || 'the company';
  const reasons: string[] = [];

  // Company-context failures
  if (score.companyMentions === 0 && identity.companyName) {
    reasons.push(`- Sections lack company-specific context: ${name} is never named in the body.`);
  } else if (score.companyMentions === 1 && identity.companyName) {
    reasons.push(`- Company name appears only once — ${name} is name-dropped, not integrated.`);
  }
  if (score.painPointHits === 0 && identity.painPoints?.length) {
    reasons.push(`- Content is generic: none of ${name}'s known pain points are referenced.`);
  }
  if (score.icpReferences === 0 && (identity.idealCustomerProfile || identity.targetAudience)) {
    reasons.push(`- Audience detail missing: the draft does not reference ${name}'s ICP or target audience.`);
  }

  // Generic-language failures
  if (score.genericPhraseCount >= 3) {
    reasons.push(`- Content is generic or repetitive: ${score.genericPhraseCount} banned buzzwords/filler phrases detected.`);
  }
  if (score.duplicateContentDetected) {
    reasons.push('- Sections are repetitive: duplicate or near-duplicate sections detected.');
  }
  if (score.lowVariationDetected) {
    reasons.push('- Some sections add no new information over earlier sections.');
  }

  // Strategy-perspective failures
  if (score.perspectiveMismatch) {
    reasons.push('- Strategy perspective is missing: the draft reads as generic industry commentary, not this company\'s worldview.');
  }

  // Scenario / concreteness
  if (!score.scenarioPresent) {
    reasons.push('- Content lacks a concrete scenario, workflow, or example — only abstract claims.');
  }

  if (reasons.length === 0) return '';

  return (
    `\nThe draft failed company-context enforcement because:\n${reasons.join('\n')}\n\n` +
    `Rewrite so EVERY major section references ${name}'s specific domain, pain points, audience, and strategic perspective. ` +
    `Generic industry advice is rejected.`
  );
}

// ── 8. Angle Generation Enforcement ──────────────────────────────────────────
// Strict angle generation prompt that forces company-specific angles.

export function buildEnforcedAnglesSystemPrompt(identity: CompanyIdentity): string {
  const name = identity.companyName || 'the company';
  const icp = identity.idealCustomerProfile || identity.targetAudience || 'the target audience';

  return (
    `You are generating editorial angles for ${name}.\n\n` +
    `Each angle MUST be specific to ${name}'s domain. Generic angles that could apply to any company are rejected.\n\n` +
    `ANGLE REQUIREMENTS:\n` +
    `1. Each angle title must reference ${name}'s specific industry, audience, or problem space.\n` +
    `2. Each angle_summary must describe a situation ${icp} actually faces.\n` +
    `3. Each hook must open with a tension or insight specific to ${name}'s domain — not a generic observation.\n` +
    `4. At least one angle must challenge conventional thinking in ${name}'s industry.\n` +
    `5. No angle may use these patterns: "The Ultimate Guide to...", "X Things You Need to Know About...", "Why X Matters".\n\n` +
    `Return JSON: { "angles": [{ "type": "analytical"|"contrarian"|"strategic", "label": string, "title": string, "angle_summary": string, "hook": string }] }\n` +
    `Return exactly 3 angles.`
  );
}

export function buildEnforcedAnglesUserPrompt(
  topic: string,
  identity: CompanyIdentity,
  intent?: string,
): string {
  const lines: string[] = [
    `TOPIC: ${topic}`,
    `CURRENT YEAR: ${new Date().getFullYear()}`,
  ];

  if (intent) lines.push(`INTENT: ${intent}`);

  const contextBlock = buildCompanyContextBlock(identity);
  if (contextBlock) {
    lines.push(`\nCOMPANY CONTEXT:\n${contextBlock}`);
  }

  lines.push(
    `\nGenerate 3 angles that are unmistakably from ${identity.companyName || 'this company'}'s perspective.`,
    `Each angle must address a specific challenge ${identity.idealCustomerProfile || identity.targetAudience || 'the audience'} faces.`,
  );

  return lines.join('\n');
}
