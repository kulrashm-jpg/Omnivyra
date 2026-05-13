/**
 * Theme Angle Engine
 * Generates diverse, editorial-quality strategic themes from topics.
 * Rule-based only (no LLM). Deterministic, <1ms, no external API calls.
 */

import type { CampaignTone } from './languageRefinementService';
import { refineCampaignTopicForHeadlines, refineStrategicCardTitle } from './editorialTextRefinementService';

export type Tone = CampaignTone;

type ThemeAngle = 'trend' | 'problem' | 'opportunity' | 'contrarian' | 'future' | 'strategy';

const THEME_ANGLES: ThemeAngle[] = [
  'trend',
  'problem',
  'opportunity',
  'contrarian',
  'future',
  'strategy',
];

const ANGLE_TEMPLATES: Record<ThemeAngle, string[]> = {
  trend: [
    'Why {topic} Is Changing the Game',
    'The Rise of {topic}',
    'How {topic} Is Reshaping the Landscape',
  ],
  problem: [
    'The Hidden Cost of Ignoring {topic}',
    'Why Most Teams Struggle With {topic}',
    'The {topic} Problem No One Talks About',
  ],
  opportunity: [
    'The Untapped Power of {topic}',
    'How {topic} Unlocks New Growth',
    'Why {topic} Is Your Biggest Missed Opportunity',
  ],
  contrarian: [
    'What Everyone Gets Wrong About {topic}',
    'The {topic} Myth, Debunked',
    'Stop Doing {topic} the Hard Way',
  ],
  future: [
    'Where {topic} Is Headed',
    'The Future Belongs to {topic}',
    'What {topic} Looks Like in Two Years',
  ],
  strategy: [
    'A Smarter Way to Approach {topic}',
    'How to Win With {topic}',
    'The Practical Guide to {topic}',
  ],
};

/** Acronyms to preserve in title case (e.g. AI, API, SEO) */
const ACRONYMS = ['AI', 'API', 'SEO', 'SaaS', 'CRM', 'B2B', 'B2C', 'ROI', 'KPI', 'UX', 'UI', 'HR'];

/** Simple djb2-style hash for deterministic angle/template selection */
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
  }
  return h >>> 0;
}

/** Normalize topic: trim and remove trailing punctuation */
function normalizeTopic(topic: string): string {
  return topic.trim().replace(/[.,!?;:]+$/, '');
}

/** Title-case a phrase, preserving known acronyms */
function titleCasePreservingAcronyms(text: string): string {
  if (!text || !text.trim()) return text;
  return text
    .trim()
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.includes(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Remove cases where a key word from the topic appears verbatim in the template suffix.
 *  e.g. "The Rise of Social Media Marketing" when topic is "Social Media Marketing" is fine,
 *  but "Why Social Media Strategy Is Shaping the Next Era of Strategy" drops the tail "of Strategy". */
function removeDuplicateWords(text: string): string {
  // Remove exact consecutive duplicate words
  let result = text.replace(/\b(\w{4,})\s+\1\b/gi, '$1');
  // Remove trailing "of X" / "in X" / "with X" where X already appears earlier in the string
  result = result.replace(/\s+(?:of|in|with|for)\s+(\w[\w\s]{2,25})\s*$/i, (match, tail) => {
    const earlier = result.slice(0, result.length - match.length);
    const words = tail.trim().split(/\s+/);
    const majorWord = words.find((w) => w.length >= 5);
    if (majorWord && new RegExp(`\\b${majorWord}\\b`, 'i').test(earlier)) return '';
    return match;
  });
  return result.replace(/\s+/g, ' ').trim();
}

function templateMatchesStructure(template: string, structure: string): boolean {
  const lower = structure.toLowerCase();
  if (lower === 'how') return /^How\b|^A Smarter|^A Practical|^The Practical/i.test(template);
  if (lower === 'why') return /^Why\b/i.test(template);
  if (lower === 'what') return /^What\b/i.test(template);
  if (lower === 'future') return /^The Future|^Where\b|^What .* Looks Like/i.test(template);
  if (lower === 'hidden_cost') return /Hidden Cost/i.test(template);
  return false;
}

function templateStartsWith(template: string, prefix: string): boolean {
  const first = (template.split(/\s+/)[0] ?? '').toLowerCase();
  return first === (prefix ?? '').toLowerCase();
}

/**
 * Generate a strategic theme from a topic using editorial angle templates.
 * Deterministic: same topic + seed yields same output.
 * When preferredStructure is set, prioritize templates matching that structure.
 * When avoidPrefix is set, exclude templates that produce that leading word.
 */
export function generateThemeFromTopic(
  topic: string,
  _campaign_tone?: Tone,
  diversity_seed?: number,
  preferredStructure?: string,
  avoidPrefix?: string
): string {
  const normalized = normalizeTopic(topic);
  if (!normalized) return 'Strategic Theme';

  const titleCased = refineCampaignTopicForHeadlines(titleCasePreservingAcronyms(normalized));
  const base = hash(normalized.toLowerCase());
  const seed = diversity_seed ?? 0;

  const angleIndex = (base + seed) % THEME_ANGLES.length;
  const angle = THEME_ANGLES[angleIndex];
  let templates = ANGLE_TEMPLATES[angle];

  if (avoidPrefix && avoidPrefix.trim()) {
    const filtered = templates.filter((tmpl) => !templateStartsWith(tmpl, avoidPrefix));
    if (filtered.length > 0) templates = filtered;
  }

  let template: string;
  if (preferredStructure && preferredStructure.trim()) {
    const matching = templates.filter((t) => templateMatchesStructure(t, preferredStructure));
    if (matching.length > 0) {
      template = matching[(base >>> 8) % matching.length];
    } else {
      template = templates[(base >>> 8) % templates.length];
    }
  } else {
    template = templates[(base >>> 8) % templates.length];
  }

  let result = template.replace(/\{topic\}/g, titleCased);
  result = removeDuplicateWords(result);
  return refineStrategicCardTitle(result, normalized);
}

/**
 * Stage-specific angle templates for marketing narrative progression.
 * Used by Strategic Theme Progression Engine.
 */
export const PROGRESSION_ANGLE_TEMPLATES: Record<string, string[]> = {
  Awareness: [
    'Why {topic} matters right now',
    'The rise of {topic}',
    'How {topic} is changing the game',
    'What {topic} actually means for you',
  ],
  Education: [
    'What you need to know about {topic}',
    'How {topic} really works',
    'The essentials of {topic}',
    'Breaking down {topic}',
  ],
  Problem: [
    'Why most people get {topic} wrong',
    'The common mistakes with {topic}',
    "What's holding teams back from {topic}",
    'The real challenge with {topic}',
  ],
  Solution: [
    'A better approach to {topic}',
    'How to do {topic} the right way',
    'Making {topic} actually work',
    'The fix for your {topic} problems',
  ],
  Proof: [
    'Real results from {topic}',
    'What success looks like with {topic}',
    'Stories of {topic} working in practice',
    'Proof that {topic} delivers',
  ],
  Conversion: [
    'Your next step with {topic}',
    'How to get started with {topic}',
    'Putting {topic} into action today',
    'From zero to results with {topic}',
  ],
};

/**
 * Generate an editorial angle for a progression stage.
 * Deterministic: same topic + stage + weekIndex yields same output.
 * Falls back to the raw topic when template lookup fails.
 */
export function generateThemeAngleForProgression(
  topic: string,
  stage: string,
  weekIndex: number
): string {
  const normalized = normalizeTopic(topic);
  if (!normalized) return topic;

  const templates = PROGRESSION_ANGLE_TEMPLATES[stage];
  if (!templates || templates.length === 0) {
    return normalized;
  }

  const titleCased = refineCampaignTopicForHeadlines(titleCasePreservingAcronyms(normalized));
  const seed = hash(`${normalized.toLowerCase()}-${stage}-${weekIndex}`);
  const template = templates[seed % templates.length];
  const result = template.replace(/\{topic\}/g, titleCased);
  return refineStrategicCardTitle(result, normalized, weekIndex)?.trim() || normalized;
}

/** Map angle name to index in THEME_ANGLES */
const ANGLE_INDEX: Record<string, number> = {
  trend: 0,
  problem: 1,
  opportunity: 2,
  contrarian: 3,
  future: 4,
  strategy: 5,
};

/**
 * Compute diversity_seed that will make generateThemeFromTopic use the given angle.
 * Used by angleDistributionEngine for weekly angle distribution.
 */
export function getDiversitySeedForAngle(topic: string, angleName: string): number {
  const normalized = normalizeTopic(topic);
  if (!normalized) return 0;
  const idx = ANGLE_INDEX[angleName.toLowerCase()];
  if (idx === undefined) return 0;
  const base = hash(normalized.toLowerCase());
  return (idx - (base % THEME_ANGLES.length) + THEME_ANGLES.length) % THEME_ANGLES.length;
}
