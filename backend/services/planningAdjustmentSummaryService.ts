/**
 * Planning Adjustments Summary — human-readable summary of what was reduced and preserved
 * when the workload balancer adjusts the plan. Additive; no balancing logic changes.
 */

export type PlanningAdjustmentsSummary = {
  reduced: string[];
  preserved: string[];
  text: string;
};

export type BuildPlanningAdjustmentsSummaryInput = {
  /** Original platform_content_requests (rows). */
  original_platform_content_requests: unknown;
  /** Balanced rows after workload balancing. */
  balanced_requests: Array<{ platform: string; content_type: string; count_per_week: number }>;
};

function normalizeType(ct: string): string {
  return String(ct ?? '').trim().toLowerCase();
}

function parseRows(value: unknown): Array<{ platform: string; content_type: string; count_per_week: number }> {
  if (value == null) return [];
  const v = value as unknown;
  const out: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
  const add = (platformRaw: unknown, typeRaw: unknown, countRaw: unknown) => {
    const platform = String(platformRaw ?? '').trim().toLowerCase();
    const content_type = normalizeType(String(typeRaw ?? ''));
    const n = typeof countRaw === 'number' && Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : 0;
    if (!platform || !content_type || n <= 0) return;
    out.push({ platform, content_type, count_per_week: n });
  };

  if (Array.isArray(v)) {
    for (const it of v as any[]) {
      add(
        (it as any)?.platform ?? (it as any)?.platform_key ?? (it as any)?.selected_platform,
        (it as any)?.content_type ?? (it as any)?.type ?? (it as any)?.contentType,
        (it as any)?.count_per_week ?? (it as any)?.count ?? (it as any)?.per_week
      );
    }
  } else if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [p0, entry] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(entry)) {
        for (const it of entry as any[]) {
          add(p0, (it as any)?.content_type ?? (it as any)?.type ?? (it as any)?.contentType, (it as any)?.count_per_week ?? (it as any)?.count ?? (it as any)?.per_week);
        }
      } else if (entry && typeof entry === 'object') {
        for (const [ct0, c0] of Object.entries(entry as Record<string, unknown>)) {
          add(p0, ct0, c0);
        }
      }
    }
  }
  return out;
}

function sumByContentType(
  rows: Array<{ platform: string; content_type: string; count_per_week: number }>
): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const ct = normalizeType(r.content_type);
    if (!ct) continue;
    byType[ct] = (byType[ct] ?? 0) + (r.count_per_week > 0 ? r.count_per_week : 0);
  }
  return byType;
}

const HIGH_VALUE_TYPES = new Set(['video', 'carousel', 'reel']);

/**
 * Build a short human-readable summary of what was reduced and what was preserved.
 * Uses only existing data (original vs balanced requests). No balancing logic.
 */
export function buildPlanningAdjustmentsSummary(
  input: BuildPlanningAdjustmentsSummaryInput
): PlanningAdjustmentsSummary {
  const originalRows = parseRows(input.original_platform_content_requests);
  const origByType = sumByContentType(originalRows);
  const balByType = sumByContentType(input.balanced_requests);

  const reduced: string[] = [];
  const preserved: string[] = [];

  const allTypes = new Set([...Object.keys(origByType), ...Object.keys(balByType)]);

  for (const ct of allTypes) {
    const orig = origByType[ct] ?? 0;
    const bal = balByType[ct] ?? 0;
    const delta = bal - orig;
    const label = ct === 'post' ? 'posts' : ct === 'article' ? 'articles' : ct + 's';
    if (delta < 0) {
      reduced.push(`${label}: ${delta}`);
    } else if (delta === 0 && orig > 0 && HIGH_VALUE_TYPES.has(ct)) {
      preserved.push(label);
    }
  }

  const reducedPhrase =
    reduced.length === 0
      ? ''
      : `reduced ${reduced
          .map((r) => {
            const m = r.match(/^(.+):\s*(-\d+)$/);
            if (!m) return r;
            const [, label, num] = m;
            return `${num.replace('-', '')} ${label}`;
          })
          .join(' and ')}`;

  const preservedPhrase =
    preserved.length === 0 ? '' : `while preserving ${preserved.join(' and ')}`;

  const text = [reducedPhrase, preservedPhrase].filter(Boolean).join(' ');
  const finalText = text
    ? `Adjusted workload: ${text}.`
    : 'Adjusted workload to match your weekly capacity.';

  return {
    reduced,
    preserved,
    text: finalText,
  };
}
