/**
 * Phase 4 — Anti-generic writing enforcement.
 *
 * Detects 10 categories of generic / SEO-fluff / filler phrasing in a
 * generated section. Each detection contributes a penalty to a
 * genericityPressureScore (0 = perfect, 100 = saturated with filler).
 *
 * Hard-blocks generation when:
 *   - pressure score ≥ ceiling (caller-configurable; default 60)
 *   - OR any 2+ high-severity detections
 *
 * Patterns are intentionally conservative — false positives hurt more than
 * occasional misses. The orchestrator's retry loop catches what slips through.
 */

import type {
  GenericWritingDetection,
  GenericWritingDetectionType,
  GenericWritingSuppressionResult,
} from './longFormRecommendationTypes';

interface PatternRule {
  type: GenericWritingDetectionType;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
  penalty: number;
}

const PATTERN_RULES: PatternRule[] = [
  // GENERIC_INTRO_HOOK
  { type: 'GENERIC_INTRO_HOOK', pattern: /\bin today'?s (fast-?paced|digital|modern|competitive|ever[- ]?changing)\b/i, severity: 'high', penalty: 25 },
  { type: 'GENERIC_INTRO_HOOK', pattern: /\b(in this (article|guide|post|blog),? we'?ll|let'?s (dive in|explore|take a look))\b/i, severity: 'medium', penalty: 12 },
  { type: 'GENERIC_INTRO_HOOK', pattern: /\b(at the end of the day|the bottom line is)\b/i, severity: 'medium', penalty: 10 },

  // BUSINESSES_TODAY
  { type: 'BUSINESSES_TODAY', pattern: /\b(businesses|companies|organizations) (today|of all sizes|across industries)\b/i, severity: 'high', penalty: 20 },
  { type: 'BUSINESSES_TODAY', pattern: /\b(in the modern (business|enterprise) (world|landscape))\b/i, severity: 'medium', penalty: 12 },

  // LEVERAGING_AI
  { type: 'LEVERAGING_AI', pattern: /\bleverag(e|ing) (ai|artificial intelligence|machine learning|automation)\b/i, severity: 'high', penalty: 20 },
  { type: 'LEVERAGING_AI', pattern: /\bharness(ing)? the power of\b/i, severity: 'medium', penalty: 12 },
  { type: 'LEVERAGING_AI', pattern: /\bunlock(s|ing)? (the )?(power|potential) of\b/i, severity: 'medium', penalty: 10 },

  // EMPTY_BEST_PRACTICES
  { type: 'EMPTY_BEST_PRACTICES', pattern: /\b(industry|proven) best practices\b/i, severity: 'medium', penalty: 12 },
  { type: 'EMPTY_BEST_PRACTICES', pattern: /\b(follow(ing)? best practices|adhere to best practices)\b/i, severity: 'medium', penalty: 10 },

  // ULTIMATE_GUIDE (section-level — narrative shape catches batch-level)
  { type: 'ULTIMATE_GUIDE', pattern: /\b(ultimate|complete|definitive|everything you need to know)\b.*\bguide\b/i, severity: 'medium', penalty: 12 },

  // GENERIC_FILLER
  { type: 'GENERIC_FILLER', pattern: /\bit(?:'?s| is) important to (note|remember|understand|consider)\b/i, severity: 'low', penalty: 6 },
  { type: 'GENERIC_FILLER', pattern: /\b(in conclusion|to summarize|to wrap up|all in all)\b/i, severity: 'low', penalty: 5 },
  { type: 'GENERIC_FILLER', pattern: /\b(when it comes to|the fact (is|of the matter))\b/i, severity: 'low', penalty: 6 },
  { type: 'GENERIC_FILLER', pattern: /\b(plays? a (crucial|vital|key|critical|pivotal) role|game[- ]chang(er|ing))\b/i, severity: 'medium', penalty: 10 },

  // SHALLOW_TRANSITION (penalize ONLY when used in dense clusters; we count multi-occurrences below)
  { type: 'SHALLOW_TRANSITION', pattern: /\b(moreover|furthermore|additionally|in addition)\b/i, severity: 'low', penalty: 0 },

  // SEO_FLUFF
  { type: 'SEO_FLUFF', pattern: /\b(how to monitor|how to scale|how to optimize|how to manage|how to leverage)\b/i, severity: 'low', penalty: 4 },
  { type: 'SEO_FLUFF', pattern: /\b(top \d+ (ways|tips|reasons|tools))\b/i, severity: 'medium', penalty: 12 },

  // GENERIC_CTA
  { type: 'GENERIC_CTA', pattern: /\b(get started today|sign up (now|today)|contact us (today|now)|learn more about)\b/i, severity: 'medium', penalty: 10 },
  { type: 'GENERIC_CTA', pattern: /\b(book a demo (today|now)|request a (demo|trial))\b/i, severity: 'low', penalty: 6 },
];

const SHALLOW_TRANSITION_WORDS = ['moreover', 'furthermore', 'additionally', 'in addition'];
const REPEATED_RHETORIC_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b(not just .* but)\b/i, label: 'not just X but Y' },
  { regex: /\b(it'?s not (a|an|the) .* it'?s (a|an|the))\b/i, label: "it's not X it's Y" },
  { regex: /\b(more than just .*, it'?s)\b/i, label: 'more than just X, it\'s Y' },
];

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function findAllOccurrences(text: string, pattern: RegExp): Array<{ span: string; index: number }> {
  const out: Array<{ span: string; index: number }> = [];
  // Re-create regex with global + insensitive flags.
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const g = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    out.push({ span: m[0], index: m.index });
    if (g.lastIndex === m.index) g.lastIndex += 1;
  }
  return out;
}

export interface SuppressGenericInput {
  sectionText: string;
  genericityCeiling?: number; // default 60
}

export function suppressGenericWriting(input: SuppressGenericInput): GenericWritingSuppressionResult {
  const plainText = stripHtml(input.sectionText);
  const textLength = Math.max(plainText.length, 1);
  const ceiling = input.genericityCeiling ?? 60;

  const detections: GenericWritingDetection[] = [];
  let pressure = 0;
  let highSeverityCount = 0;

  for (const rule of PATTERN_RULES) {
    if (rule.penalty === 0) continue; // handled separately (shallow transitions)
    const matches = findAllOccurrences(plainText, rule.pattern);
    for (const match of matches) {
      detections.push({
        type: rule.type,
        span: match.span,
        positionPercent: Math.round((match.index / textLength) * 100),
        severity: rule.severity,
      });
      pressure += rule.penalty;
      if (rule.severity === 'high') highSeverityCount += 1;
    }
  }

  // Shallow transition cluster check.
  let transitionCount = 0;
  for (const w of SHALLOW_TRANSITION_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, 'gi');
    transitionCount += (plainText.match(re) ?? []).length;
  }
  if (transitionCount >= 3) {
    detections.push({
      type: 'SHALLOW_TRANSITION',
      span: SHALLOW_TRANSITION_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(plainText)).join(', '),
      positionPercent: 50,
      severity: transitionCount >= 5 ? 'high' : 'medium',
    });
    pressure += transitionCount >= 5 ? 18 : 10;
    if (transitionCount >= 5) highSeverityCount += 1;
  }

  // Repeated rhetoric — soft pattern check.
  for (const r of REPEATED_RHETORIC_PATTERNS) {
    const matches = findAllOccurrences(plainText, r.regex);
    if (matches.length >= 2) {
      detections.push({
        type: 'REPEATED_RHETORIC',
        span: `${r.label} (x${matches.length})`,
        positionPercent: 50,
        severity: matches.length >= 3 ? 'high' : 'medium',
      });
      pressure += matches.length >= 3 ? 15 : 8;
      if (matches.length >= 3) highSeverityCount += 1;
    }
  }

  // Density correction — long sections can naturally accumulate more matches.
  // Normalize by sqrt(length / 1000) so short sections aren't unfairly slammed.
  const density = Math.sqrt(textLength / 1000);
  const normalizedPressure = density > 0 ? pressure / Math.max(density, 1) : pressure;

  const genericityPressureScore = clamp100(normalizedPressure);
  const hardBlocked = genericityPressureScore >= ceiling || highSeverityCount >= 2;

  return { genericityPressureScore, hardBlocked, detections };
}
