/**
 * Stable theme key for lifecycle tracking.
 * Normalizes topic text so slight variations (punctuation, casing, spacing) produce the same key.
 */
export function generateThemeKey(topic: string): string {
  return String(topic ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}
