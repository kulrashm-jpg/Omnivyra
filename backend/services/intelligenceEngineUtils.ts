import { createHash } from 'node:crypto';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function safeAverage(total: number, count: number): number {
  if (count <= 0) return 0;
  return total / count;
}

export function roundNumber(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function stableUuid(parts: Array<string | number | null | undefined>): string {
  const input = parts.map((part) => String(part ?? '')).join('::');
  const hex = createHash('sha1').update(input).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
