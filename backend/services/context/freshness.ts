/**
 * freshness.ts — deterministic freshness derivation for canonical context.
 * `now` is injected so assimilation + tests are deterministic (no hidden clock).
 */
import type { ContextOrigin, Fact, Freshness } from './canonicalContextTypes';

const DAY_MS = 86_400_000;

export function computeFreshness(timestamp: string | number | Date | null | undefined, now: number): Freshness {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return { ageDays: null, label: 'unknown' };
  }
  const t = typeof timestamp === 'number'
    ? timestamp
    : new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return { ageDays: null, label: 'unknown' };

  const ageDays = Math.max(0, Math.floor((now - t) / DAY_MS));
  const label =
    ageDays <= 1 ? 'today' :
    ageDays <= 7 ? 'recent' :
    ageDays <= 30 ? 'aging' :
    'stale';
  return { ageDays, label };
}

/** Human display for a freshness value: "today" / "3 days" / "unknown". */
export function freshnessText(f: Freshness): string {
  if (f.ageDays === null) return 'unknown';
  if (f.ageDays <= 1) return 'today';
  return `${f.ageDays} days`;
}

/** Build a Fact when a value is present, else null (keeps missing fields explicit). */
export function makeFact<T>(
  value: T | null | undefined,
  origin: ContextOrigin,
  confidence: number,
  timestamp: string | number | Date | null | undefined,
  now: number,
): Fact<T> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return {
    value,
    origin,
    confidence: Math.min(1, Math.max(0, confidence)),
    freshness: computeFreshness(timestamp, now),
  };
}
