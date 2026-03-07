/**
 * Headline Structure Rotation Engine
 * Ensures themes vary opening structures (How, Why, What, Future, Hidden Cost) across weeks.
 * Rule-based, deterministic.
 */

const HEADLINE_STRUCTURES = ['how', 'why', 'what', 'future', 'hidden_cost'] as const;

export type HeadlineStructure = (typeof HEADLINE_STRUCTURES)[number];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic offset (0–4) per topic for structure rotation.
 */
export function getHeadlineStructureOffset(topic: string): number {
  const t = (topic ?? '').trim().toLowerCase();
  return hashString(t) % HEADLINE_STRUCTURES.length;
}

/**
 * Get headline structure for a given week. Deterministic: topic + weekIndex.
 */
export function getHeadlineStructure(topic: string, weekIndex: number): HeadlineStructure {
  const offset = getHeadlineStructureOffset(topic);
  const idx = (weekIndex + offset) % HEADLINE_STRUCTURES.length;
  return HEADLINE_STRUCTURES[idx];
}

/**
 * Extract leading word from theme text for collision detection.
 * "Why AI Marketing Matters" → "why"
 * "The Future of AI Marketing" → "the"
 */
export function getHeadlinePrefix(text: string): string {
  const firstWord = (text ?? '').trim().split(/\s+/)[0];
  return firstWord ? firstWord.toLowerCase() : '';
}
