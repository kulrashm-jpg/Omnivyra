export type ContentTypeIntegrityPhase =
  | 'planner'
  | 'generation'
  | 'refinement'
  | 'variant_generation'
  | 'scheduling'
  | 'calendar'
  | 'workspace'
  | 'preview'
  | 'publishing';

const COERCION_WATCHLIST = new Set(['poll', 'story', 'thread', 'article']);

export function normalizeLogicalContentType(value: unknown, fallback = 'post'): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || fallback;
}

export function readLogicalContentType(source: Record<string, unknown> | null | undefined, fallback?: unknown): string {
  if (!source || typeof source !== 'object') return normalizeLogicalContentType(fallback);
  return normalizeLogicalContentType(
    source.logical_content_type ??
      source.logicalContentType ??
      source.asset_type ??
      source.content_type ??
      source.contentType ??
      fallback,
  );
}

export function resolveLogicalContentType(input: {
  logical?: unknown;
  contentType?: unknown;
  content?: unknown;
  fallback?: string;
}): string {
  const direct = normalizeLogicalContentType(input.logical, '');
  if (direct) return direct;
  const parsed = tryParseObject(input.content);
  if (parsed) return readLogicalContentType(parsed, input.contentType ?? input.fallback);
  return normalizeLogicalContentType(input.contentType, input.fallback ?? 'post');
}

export function withLogicalContentType<T extends Record<string, unknown>>(
  target: T,
  logicalType: unknown,
): T & { logical_content_type: string } {
  return {
    ...target,
    logical_content_type: normalizeLogicalContentType(logicalType),
  };
}

export function emitTypeIntegrityTelemetry(input: {
  logicalType: unknown;
  publishType?: unknown;
  source: string;
  phase: ContentTypeIntegrityPhase;
}): void {
  const logical = normalizeLogicalContentType(input.logicalType);
  const publish = normalizeLogicalContentType(input.publishType, logical);
  const coerced = logical !== publish;
  const watchedCoercion = coerced && COERCION_WATCHLIST.has(logical) && publish === 'post';
  console.info('[type-integrity]', {
    phase: input.phase,
    source: input.source,
    logical_content_type: logical,
    publish_content_type: publish,
    coerced,
    watched_coercion: watchedCoercion,
  });
}

function tryParseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

