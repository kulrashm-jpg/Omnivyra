type MetricBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  lastAt: string | null;
};

type MetricSnapshot = MetricBucket & {
  avgMs: number;
};

const buckets = new Map<string, MetricBucket>();
const MAX_KEYS = 80;

function bucketKey(scope: string, tags: Record<string, string | null | undefined> = {}): string {
  const suffix = Object.entries(tags)
    .filter(([, value]) => value != null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value).slice(0, 40)}`)
    .join('|');
  return suffix ? `${scope}|${suffix}` : scope;
}

export function recordCreatorDuration(
  scope: string,
  durationMs: number,
  tags: Record<string, string | null | undefined> = {},
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const key = bucketKey(scope, tags);
  if (!buckets.has(key) && buckets.size >= MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }
  const current = buckets.get(key) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastAt: null,
  };
  current.count += 1;
  current.totalMs += Math.round(durationMs);
  current.maxMs = Math.max(current.maxMs, Math.round(durationMs));
  current.lastMs = Math.round(durationMs);
  current.lastAt = new Date().toISOString();
  buckets.set(key, current);
}

export async function measureCreatorDuration<T>(
  scope: string,
  tags: Record<string, string | null | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    recordCreatorDuration(scope, Date.now() - startedAt, tags);
  }
}

export function getCreatorRuntimeMetricsSnapshot(): Record<string, MetricSnapshot> {
  return Object.fromEntries(
    Array.from(buckets.entries()).map(([key, value]) => [
      key,
      {
        ...value,
        avgMs: value.count > 0 ? Math.round(value.totalMs / value.count) : 0,
      },
    ]),
  );
}

export function resetCreatorRuntimeMetrics(): void {
  buckets.clear();
}
