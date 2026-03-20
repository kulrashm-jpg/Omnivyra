/**
 * Unified Content Processor — the single canonical pipeline for ALL platform content.
 *
 * Every piece of content destined for a user or social platform MUST pass through
 * processContent() before it is returned from an API route or published.
 *
 * Pipeline stages (in order):
 *   0. Platform intent injection  — thread separation, TikTok line-breaks, carousel delimiters
 *   1. Artifact stripping         — remove AI markdown fences, system tags, excess whitespace
 *   2. Language refinement        — filler removal → tone alignment → card formatting → punctuation
 *   3A. Structural formatting     — CTA placement, paragraph grouping, sentence-per-line
 *   3B. Visual structuring        — hook spacing, slide separation, thread pacing, whitespace
 *   4.  Sentence-aware truncation — preserve full sentences within platform char ceiling
 *   5.  Content validation        — carousel/thread/hook checks (non-blocking, logged)
 *
 * This service does NOT:
 *   - Call AI (all transforms are deterministic / rule-based)
 *   - Write to the database
 *   - Generate hashtags or media metadata (those happen at AI generation time)
 */

import { refineLanguageOutput, type LanguageRefinementInput } from './languageRefinementService';
import { applyStructuralFormatting } from './platformAlgorithmFormattingRules';
import { applyPlatformIntent } from './platformIntentEngine';
import { applyVisualStructure } from './visualStructuringEngine';
import { validateContentWithConfig, type ContentValidationResult } from './contentValidationService';
import { getActiveExperiment, assignVariant } from './configService';

export type ContentCardType = LanguageRefinementInput['card_type'];

/** Hard character ceilings per platform. Single source of truth for char limit enforcement. */
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  linkedin:  3000,
  instagram: 2200,
  twitter:   280,
  x:         280,
  facebook:  63206,
  youtube:   5000,
  tiktok:    2200,
  pinterest: 500,
  reddit:    40000,
};

export type ProcessContentInput = {
  content: string;
  platform?: string;
  content_type?: string;
  card_type?: ContentCardType;
  campaign_tone?: string;
  /** When true, truncate content to the platform's hard character limit. */
  enforce_char_limit?: boolean;
  /** For carousel validation: expected number of slides. */
  expected_slides?: number;
  /** When true, skip validation stage (e.g. intermediate pipeline steps). */
  skip_validation?: boolean;
  /** Seed for experiment variant assignment (e.g. campaign_id or user_id). */
  experiment_seed?: string;
};

export type ProcessContentOutput = {
  content: string;
  processing_trace: {
    platform: string;
    content_type: string;
    card_type: string;
    original_length: number;
    final_length: number;
    platform_intent_applied: boolean;
    language_refined: boolean;
    structural_formatting_applied: boolean;
    visual_structuring_applied: boolean;
    char_limit_enforced: boolean;
    char_limit: number | null;
    steps_applied: string[];
    validation?: ContentValidationResult;
    /** Active experiment name and variant assigned, if any. */
    experiment?: { name: string; variant: 'a' | 'b' };
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Artifact stripping
// ─────────────────────────────────────────────────────────────────────────────

function stripArtifacts(text: string): string {
  return text
    .replace(/\[KPI Focus:[^\]]*\]/gi, '')
    .replace(/\[Platform:[^\]]*\]/gi, '')
    .replace(/\[Week \d+:[^\]]*\]/gi, '')
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/^(Note|Output|Response|Platform Variant|Master Content)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — Sentence-aware truncation
// Preserves full sentences and CTAs — never cuts mid-word or mid-sentence.
// ─────────────────────────────────────────────────────────────────────────────

function sentenceAwareTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;

  // Reserve 1 char for ellipsis
  const budget = limit - 1;

  // Try to break at last sentence boundary within budget
  const sentenceEnd = /[.!?]\s/g;
  let lastSentencePos = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(text)) !== null) {
    if (match.index + 1 <= budget) lastSentencePos = match.index + 1;
    else break;
  }

  if (lastSentencePos > budget * 0.6) {
    return text.slice(0, lastSentencePos).trimEnd() + '…';
  }

  // Fallback: break at last word boundary
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > budget * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single, canonical content processing pipeline.
 * All social content MUST pass through this function before storage or publication.
 */
export async function processContent(input: ProcessContentInput): Promise<ProcessContentOutput> {
  const platform    = (input.platform     ?? '').toLowerCase().trim();
  const contentType = (input.content_type ?? 'post').toLowerCase().trim();
  const cardType: ContentCardType = input.card_type ?? 'platform_variant';
  const stepsApplied: string[] = [];

  let content = input.content;
  const originalLength = content.length;

  const refinementEnabled = process.env.LANGUAGE_REFINEMENT_ENABLED !== 'false';

  // ── Stage 0: Platform intent injection ─────────────────────────────────────
  let platformIntentApplied = false;
  if (platform && contentType) {
    const intentResult = applyPlatformIntent({ content, platform, content_type: contentType });
    if (intentResult.intent_applied) {
      stepsApplied.push(`platform_intent:${intentResult.platform_pattern}`);
      platformIntentApplied = true;
      content = intentResult.content;
    }
  }

  // ── Stage 1: Artifact stripping ─────────────────────────────────────────────
  const stripped = stripArtifacts(content);
  if (stripped !== content) stepsApplied.push('artifact_stripping');
  content = stripped;

  // ── Stage 2: Language refinement ────────────────────────────────────────────
  let languageRefined = false;
  if (refinementEnabled && content.trim()) {
    const refined = await refineLanguageOutput({
      content,
      card_type: cardType,
      campaign_tone: input.campaign_tone,
      platform,
    });
    const refinedStr = typeof refined.refined === 'string' ? refined.refined : content;
    if (refinedStr !== content) {
      stepsApplied.push('language_refinement');
      content = refinedStr;
    }
    languageRefined = refined.metadata?.applied ?? false;
  }

  // ── Stage 3A: Structural formatting ─────────────────────────────────────────
  let structuralFormattingApplied = false;
  if (platform) {
    const { content: formatted } = applyStructuralFormatting(content, platform);
    if (formatted !== content) {
      stepsApplied.push('structural_formatting');
      structuralFormattingApplied = true;
      content = formatted;
    }
  }

  // ── Stage 3B: Visual structuring ────────────────────────────────────────────
  let visualStructuringApplied = false;
  if (platform || contentType) {
    const { content: visually, rules_applied } = applyVisualStructure({
      content,
      platform,
      content_type: contentType,
    });
    if (rules_applied.length > 0) {
      stepsApplied.push(`visual_structuring:${rules_applied.join(',')}`);
      visualStructuringApplied = true;
      content = visually;
    }
  }

  // ── Stage 4: Sentence-aware character limit ─────────────────────────────────
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? null;
  let charLimitEnforced = false;
  if (input.enforce_char_limit && charLimit && content.length > charLimit) {
    content = sentenceAwareTruncate(content, charLimit);
    stepsApplied.push('char_limit_enforcement');
    charLimitEnforced = true;
  }

  // ── Experiment injection (non-blocking, logged to trace) ────────────────────
  let experimentTrace: { name: string; variant: 'a' | 'b' } | undefined;
  try {
    const hookExperiment = await getActiveExperiment('hook_style');
    if (hookExperiment && platform) {
      const seed = input.experiment_seed ?? platform + contentType;
      const variant = assignVariant(hookExperiment, seed);
      const variantConfig = variant === 'a' ? hookExperiment.variant_a : hookExperiment.variant_b;

      // Apply variant overrides to content if specified
      if (variantConfig.enforce_strong_hook === true) {
        // Variant: insert a blank line after first line to emphasise hook
        const lines = content.split('\n');
        if (lines.length > 1 && lines[1].trim() !== '') {
          lines.splice(1, 0, '');
          content = lines.join('\n');
          stepsApplied.push(`experiment:${hookExperiment.experiment_name}:variant_${variant}`);
        }
      }
      experimentTrace = { name: hookExperiment.experiment_name, variant };
    }
  } catch (_) { /* non-blocking */ }

  // ── Stage 5: Content validation (config-aware, non-blocking) ────────────────
  let validation: ContentValidationResult | undefined;
  if (!input.skip_validation && contentType) {
    validation = await validateContentWithConfig(content, contentType, {
      expected_slides: input.expected_slides,
    });
    if (!validation.valid) {
      console.warn('[unified-content-processor][validation-issues]', {
        platform,
        content_type: contentType,
        issues: validation.issues,
      });
    }
  }

  return {
    content,
    processing_trace: {
      platform,
      content_type: contentType,
      card_type: cardType,
      original_length: originalLength,
      final_length: content.length,
      platform_intent_applied: platformIntentApplied,
      language_refined: languageRefined,
      structural_formatting_applied: structuralFormattingApplied,
      visual_structuring_applied: visualStructuringApplied,
      char_limit_enforced: charLimitEnforced,
      char_limit: charLimit,
      steps_applied: stepsApplied,
      validation,
      experiment: experimentTrace,
    },
  };
}

/**
 * Batch-process multiple content strings in parallel.
 * Each item is processed independently; order is preserved.
 */
export async function processContentBatch(
  items: Array<ProcessContentInput & { _id: string }>
): Promise<Array<ProcessContentOutput & { _id: string }>> {
  return Promise.all(
    items.map(async (item) => {
      const result = await processContent(item);
      return { ...result, _id: item._id };
    })
  );
}
