/**
 * Theme Angle Engine
 * Generates diverse, editorial-quality strategic themes from topics.
 * Rule-based only (no LLM). Deterministic, <1ms, no external API calls.
 */

import type { CampaignTone } from './languageRefinementService';

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
    'How {topic} Is Transforming Campaign Execution',
    'The Growing Impact of {topic} on Modern Marketing',
  ],
  problem: [
    'The Hidden Cost of Ignoring {topic}',
    'Why Many Teams Struggle Without {topic}',
  ],
  opportunity: [
    'Why {topic} Is Becoming Essential for Marketing Teams',
    'The Opportunity {topic} Creates for Modern Marketers',
  ],
  contrarian: [
    'What Most Teams Get Wrong About {topic}',
    'Why {topic} Alone Won\'t Fix Marketing Challenges',
  ],
  future: [
    'The Future of Marketing with {topic}',
    'How {topic} Is Shaping the Next Era of Marketing',
  ],
  strategy: [
    'A Practical Approach to Using {topic}',
    'How Marketing Teams Can Use {topic} More Effectively',
  ],
};

/** Acronyms to preserve in title case (e.g. AI, API, SEO) */
const ACRONYMS = ['AI', 'API', 'SEO', 'SaaS', 'CRM', 'B2B', 'B2C'];

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

/** Remove duplicate domain words (e.g. "Marketing in Marketing" → "Marketing") */
function removeDuplicateWords(text: string): string {
  let result = text.replace(/\b(marketing|strategy|content)\s+\1\b/gi, '$1');
  result = result.replace(/\s+in\s+(Marketing|Strategy|Content)\s*$/i, (match, word) => {
    const earlier = result.slice(0, -match.length);
    return new RegExp(`\\b${word}\\b`, 'i').test(earlier) ? '' : match;
  });
  return result.replace(/\s+/g, ' ').trim();
}

function templateMatchesStructure(template: string, structure: string): boolean {
  const lower = structure.toLowerCase();
  if (lower === 'how') return /^How\b|^A Practical Approach/i.test(template);
  if (lower === 'why') return /^Why\b/i.test(template);
  if (lower === 'what') return /^What\b/i.test(template);
  if (lower === 'future') return /The Future|The Growing Impact|The Opportunity/i.test(template);
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

  const titleCased = titleCasePreservingAcronyms(normalized);
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
  return result;
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
