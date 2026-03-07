/**
 * Theme Phrase Normalizer
 * Removes redundant domain constructs from theme titles before language refinement.
 * Rule-based, deterministic, <1ms.
 */

/**
 * Normalize theme phrase: remove redundant "Marketing with X Marketing", "Using X in Marketing", duplicate domain words.
 */
export function normalizeThemePhrase(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let result = text.trim();
  if (!result) return '';

  result = result.replace(/\bmarketing\s+with\s+([a-z0-9\- ]+?\s+marketing)\b/gi, '$1');
  result = result.replace(/\busing\s+([a-z0-9\- ]+?)\s+in\s+marketing\b/gi, 'Using $1');
  result = result.replace(/\b(marketing|strategy|content)\s+\1\b/gi, '$1');
  result = result.replace(/\s+/g, ' ').trim();
  return result || text;
}
