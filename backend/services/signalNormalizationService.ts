/**
 * Normalizes signal.source before it enters the trend-processing pipeline.
 * Handles string, object { id?, name? }, and other types to prevent runtime errors from .toLowerCase().
 */
export function normalizeSignalSource(source: unknown): string {
  if (!source) return '';

  if (typeof source === 'string') {
    return source.toLowerCase();
  }

  if (typeof source === 'object') {
    const obj = source as { name?: unknown; id?: unknown };
    if (typeof obj.name === 'string') {
      return obj.name.toLowerCase();
    }
    if (typeof obj.id === 'string') {
      return obj.id.toLowerCase();
    }
  }

  return String(source).toLowerCase();
}
