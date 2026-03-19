/**
 * Hybrid Template + AI Layer — Optimization 3
 *
 * For common content patterns (how-to, list, case-study, announcement, question),
 * return a deterministic ContentBlueprint template WITHOUT any GPT call.
 *
 * Only falls through to GPT when no template matches.
 * Estimated savings: ~30–40% of generateContentBlueprint calls at zero cost.
 *
 * Usage:
 *   const template = tryTemplateBlueprintFor(item);
 *   if (template) return template;
 *   // ... proceed to GPT
 */

import type { ContentBlueprint } from './contentBlueprintCache';
import { recordTemplateHit } from './metricsCollector';

interface TemplateInput {
  topic: string;
  contentType: string;
  objective?: string;
  targetAudience?: string;
  painPoint?: string;
  outcomePromise?: string;
  ctaType?: string;
}

type TemplateFn = (input: TemplateInput) => ContentBlueprint;

// ── Pattern matchers ──────────────────────────────────────────────────────────

const HOW_TO_PATTERN = /\b(how\s+to|step[- ]by[- ]step|guide|tutorial|tips?|learn|getting\s+started)\b/i;
const LIST_PATTERN   = /\b(\d+\s+ways?|\d+\s+reasons?|\d+\s+tips?|\d+\s+steps?|\d+\s+mistakes?|top\s+\d+)\b/i;
const CASE_STUDY_PATTERN = /\b(case\s+study|success\s+story|how\s+.+\s+(achieved|grew|scaled|increased|reduced)|results?\b)/i;
const ANNOUNCEMENT_PATTERN = /\b(launch|announcing|new\s+feature|introducing|release|update|upgrade)\b/i;
const QUESTION_PATTERN = /\b(why\s+do|why\s+does|do\s+you|are\s+you|have\s+you|what\s+if|is\s+your)\b/i;
const MISTAKE_PATTERN = /\b(mistake|error|avoid|don'?t|stop\s+doing|wrong\s+way|common\s+problem)\b/i;

// ── Template factories ────────────────────────────────────────────────────────

const howToTemplate: TemplateFn = ({ topic, targetAudience, outcomePromise, ctaType }) => ({
  hook: `Here's exactly how to ${topic.toLowerCase().replace(/^how\s+to\s+/i, '')} — step by step.`,
  key_points: [
    `Start with the fundamentals that ${targetAudience || 'most people'} often skip`,
    `The single most important action that drives 80% of the result`,
    `Common mistakes to avoid along the way`,
    outcomePromise ? `Result: ${outcomePromise}` : 'Track your progress and iterate',
  ],
  cta: ctaType === 'Hard CTA'
    ? 'Start now — save this for later.'
    : 'Found this useful? Share it with someone who needs it.',
});

const listTemplate: TemplateFn = ({ topic, targetAudience, ctaType }) => {
  const match = topic.match(/(\d+)/);
  const count = match ? parseInt(match[1]) : 5;
  return {
    hook: `${count} things ${targetAudience || 'professionals'} need to know about ${topic.replace(/\d+\s+(ways?|tips?|steps?|reasons?)/i, '').trim() || topic}.`,
    key_points: [
      'Most people overlook the fundamentals — start here',
      'The counterintuitive insight that changes how you approach this',
      'The practical action you can take today',
      `Apply all ${count} and the compounding effect kicks in`,
    ],
    cta: ctaType === 'Hard CTA'
      ? 'Save this list — you\'ll reference it again.'
      : 'Which of these surprised you most? Comment below.',
  };
};

const caseStudyTemplate: TemplateFn = ({ topic, targetAudience, painPoint, outcomePromise }) => ({
  hook: `Real results: how ${topic.replace(/case\s+study:?\s*/i, '').trim() || 'a team like yours'} solved ${painPoint || 'a major challenge'}.`,
  key_points: [
    `The problem: ${painPoint || 'inefficiency that was costing time and money'}`,
    'The approach: what they tried and what actually worked',
    `The outcome: ${outcomePromise || 'measurable improvement within weeks'}`,
    `What ${targetAudience || 'you'} can replicate starting today`,
  ],
  cta: 'Want the same result? Let\'s talk about your situation.',
});

const announcementTemplate: TemplateFn = ({ topic, targetAudience, outcomePromise }) => ({
  hook: `Exciting news: ${topic}.`,
  key_points: [
    `What this means for ${targetAudience || 'you'}`,
    'Why we built this and the problem it solves',
    outcomePromise ? `The outcome you can expect: ${outcomePromise}` : 'How to get started right now',
    'Available immediately — here\'s how to access it',
  ],
  cta: 'Try it today and let us know what you think.',
});

const questionTemplate: TemplateFn = ({ topic, targetAudience, painPoint, outcomePromise }) => ({
  hook: topic.endsWith('?') ? topic : `${topic}?`,
  key_points: [
    `Most ${targetAudience || 'people'} answer this wrong — here's why`,
    `The real issue is ${painPoint || 'something most overlook'}`,
    'The framework that changes how you think about this',
    outcomePromise ? `Once you shift your approach: ${outcomePromise}` : 'Small shifts, big outcomes',
  ],
  cta: 'What\'s your take? Drop your answer in the comments.',
});

const mistakeTemplate: TemplateFn = ({ topic, targetAudience, painPoint }) => ({
  hook: `Stop making this mistake — it\'s costing ${targetAudience || 'you'} more than you think.`,
  key_points: [
    `The mistake: ${painPoint || topic.replace(/\b(mistake|avoid|stop)\b.*/i, '').trim() || topic}`,
    'Why it happens (it\'s not what you think)',
    'The correct approach that actually works',
    'How to catch yourself before you do it again',
  ],
  cta: 'Tag someone who needs to see this.',
});

// ── Pattern → template mapping ────────────────────────────────────────────────

interface PatternEntry {
  pattern: RegExp;
  template: TemplateFn;
}

const PATTERNS: PatternEntry[] = [
  { pattern: MISTAKE_PATTERN,      template: mistakeTemplate },
  { pattern: CASE_STUDY_PATTERN,   template: caseStudyTemplate },
  { pattern: ANNOUNCEMENT_PATTERN, template: announcementTemplate },
  { pattern: HOW_TO_PATTERN,       template: howToTemplate },
  { pattern: LIST_PATTERN,         template: listTemplate },
  { pattern: QUESTION_PATTERN,     template: questionTemplate },
];

// Content types that are structurally complex enough to always need GPT
const GPT_REQUIRED_TYPES = new Set(['thread', 'newsletter', 'long_form', 'whitepaper']);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Try to return a deterministic ContentBlueprint without calling GPT.
 * Returns null if no template matches (caller should fall through to GPT).
 *
 * @param topic         - Content topic / title
 * @param contentType   - e.g. 'post', 'carousel', 'video', 'thread'
 * @param objective     - Campaign objective
 * @param targetAudience - Who the content is for
 * @param painPoint     - Audience pain point
 * @param outcomePromise - What the reader will get
 * @param ctaType       - 'Soft CTA' | 'Hard CTA' | etc.
 */
export function tryTemplateBlueprintFor(
  topic: string,
  contentType: string,
  objective?: string,
  targetAudience?: string,
  painPoint?: string,
  outcomePromise?: string,
  ctaType?: string,
): ContentBlueprint | null {
  if (!topic || GPT_REQUIRED_TYPES.has(contentType?.toLowerCase())) return null;

  const input: TemplateInput = {
    topic,
    contentType,
    objective,
    targetAudience,
    painPoint,
    outcomePromise,
    ctaType,
  };

  for (const { pattern, template } of PATTERNS) {
    if (pattern.test(topic)) {
      recordTemplateHit();
      return template(input);
    }
  }

  return null;
}
