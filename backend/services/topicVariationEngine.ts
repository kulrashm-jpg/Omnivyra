/**
 * Topic Variation Engine
 * Generates semantic variations of topic phrases for use across campaign weeks.
 * Rule-based, deterministic, no LLM.
 */

/**
 * Generate deterministic topic variants. Removes duplicates (case-insensitive).
 * Works with AI-prefixed topics and generic patterns.
 */
export function generateTopicVariants(topic: string): string[] {
  const t = (topic ?? '').trim();
  if (!t) return [];

  const raw: string[] = [t];

  if (/^AI\s+/i.test(t)) {
    raw.push(t.replace(/^AI\s+/i, 'AI-driven '));
    raw.push(t.replace(/^AI\s+/i, 'AI-powered '));
    raw.push(t.replace(/^AI\s+/i, 'AI-enabled '));
  }

  if (/\bmarketing\b/i.test(t)) {
    raw.push(t.replace(/\bmarketing\b/i, 'marketing automation'));
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of raw) {
    const key = v.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v.trim());
    }
  }
  return result.length > 0 ? result : [t];
}
