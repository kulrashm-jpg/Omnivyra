export type MessageTimeLike = {
  id?: string | null;
  created_at?: string | null;
  platform_created_at?: string | null;
  normalized_time?: string | null;
  raw_time?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export function parseMessageDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function rawPayload(row: MessageTimeLike): Record<string, unknown> {
  return row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
}

export function getTimestampConfidence(row: MessageTimeLike): string | null {
  const rp = rawPayload(row);
  const value = rp.timestamp_confidence;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

export function hasLowConfidencePlatformTime(row: MessageTimeLike): boolean {
  return getTimestampConfidence(row) === 'low';
}

export function getEffectiveMessageTimestamp(row: MessageTimeLike): string | null {
  const platformTime = row.platform_created_at ?? row.normalized_time ?? null;
  const createdTime = row.created_at ?? null;
  if (hasLowConfidencePlatformTime(row)) {
    return createdTime ?? platformTime;
  }
  return platformTime ?? createdTime;
}

export function getEffectiveMessageTimeMs(row: MessageTimeLike): number {
  return parseMessageDateMs(getEffectiveMessageTimestamp(row)) ?? 0;
}

export function compareMessagesAscending(a: MessageTimeLike, b: MessageTimeLike): number {
  const effectiveDelta = getEffectiveMessageTimeMs(a) - getEffectiveMessageTimeMs(b);
  if (effectiveDelta !== 0) return effectiveDelta;

  const createdDelta =
    (parseMessageDateMs(a.created_at ?? null) ?? 0)
    - (parseMessageDateMs(b.created_at ?? null) ?? 0);
  if (createdDelta !== 0) return createdDelta;

  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

export function compareMessagesDescending(a: MessageTimeLike, b: MessageTimeLike): number {
  return compareMessagesAscending(b, a);
}

function isIsoLike(value: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(value) && parseMessageDateMs(value) !== null;
}

export function getLowConfidenceRawTimeLabel(row: MessageTimeLike): string | null {
  if (!hasLowConfidencePlatformTime(row)) return null;
  const rp = rawPayload(row);
  const raw = typeof row.raw_time === 'string'
    ? row.raw_time
    : typeof rp.raw_time === 'string'
      ? rp.raw_time
      : null;
  const label = raw?.trim();
  if (!label || isIsoLike(label)) return null;
  return label;
}
