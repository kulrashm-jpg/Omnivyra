/**
 * Adaptive Auto Workload Balancing Engine.
 * When requested content exceeds production capacity, rebalances workload intelligently
 * while preserving campaign intent. Additive; does not remove existing validation.
 */

export type BalanceWorkloadInput = {
  platform_content_requests: unknown;
  weekly_capacity_total: number;
  available_content_total: number;
  effective_capacity_total?: number;
  cross_platform_sharing?: boolean | null;
  campaign_intent?: string | null;
  content_types?: string[] | null;
  exclusive_campaigns_total?: number;
};

export type BalanceWorkloadResult = {
  balanced_requests: Array<{ platform: string; content_type: string; count_per_week: number }>;
  adjustments_made: boolean;
  original_requested_total: number;
  balanced_total: number;
  reason: string;
};

const CONTENT_TYPE_PRIORITY: Record<string, number> = {
  video: 4,
  carousel: 3,
  post: 2,
  article: 1,
  reel: 4,
  story: 2,
  poll: 2,
  thread: 2,
};

function priority(contentType: string): number {
  const key = String(contentType ?? '').trim().toLowerCase();
  return CONTENT_TYPE_PRIORITY[key] ?? 1;
}

function normalizePlatformKey(raw: string): string {
  const n = String(raw ?? '').trim().toLowerCase();
  if (n === 'twitter') return 'x';
  return n;
}

function parseRows(value: unknown): Array<{ platform: string; content_type: string; count_per_week: number }> {
  if (value == null) return [];
  const v = value as unknown;
  const out: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
  const add = (platformRaw: unknown, typeRaw: unknown, countRaw: unknown) => {
    const platform = normalizePlatformKey(String(platformRaw ?? ''));
    const content_type = String(typeRaw ?? '').trim().toLowerCase();
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

function computeUniqueTotal(
  rows: Array<{ platform: string; content_type: string; count_per_week: number }>,
  sharingEnabled: boolean
): number {
  if (rows.length === 0) return 0;
  if (!sharingEnabled) {
    return rows.reduce((sum, r) => sum + (r.count_per_week > 0 ? r.count_per_week : 0), 0);
  }
  const maxByType: Record<string, number> = {};
  for (const r of rows) {
    const key = r.content_type;
    const n = r.count_per_week;
    if (!key || n <= 0) continue;
    maxByType[key] = Math.max(maxByType[key] ?? 0, n);
  }
  return Object.values(maxByType).reduce((a, b) => a + (Number(b) || 0), 0);
}

function isConversionProtected(contentType: string, campaignIntent: string | null | undefined): boolean {
  if (!campaignIntent || typeof campaignIntent !== 'string') return false;
  const intent = campaignIntent.toLowerCase();
  const ct = String(contentType ?? '').toLowerCase();
  if (intent.includes('conversion') && (ct.includes('cta') || ct.includes('conversion') || ct.includes('lead'))) return true;
  return false;
}

/**
 * Balance workload to fit within supply. Applies rules:
 * A) Preserve high-value content types first (video > carousel > post > article).
 * B) Prefer repurposing over removal (reduce unique count, keep platform distribution).
 * C) Reduce evenly across platforms (never zero-out unless required).
 * D) If conversion stage, protect action-stage content.
 * Returns null if no balancing needed or supply/request invalid.
 */
export function balanceWorkload(input: BalanceWorkloadInput): BalanceWorkloadResult | null {
  const rows = parseRows(input.platform_content_requests);
  if (rows.length === 0) return null;

  const supplyTotal =
    input.effective_capacity_total ??
    Math.max(0, (input.weekly_capacity_total ?? 0) - (input.exclusive_campaigns_total ?? 0));
  const supply = (input.available_content_total ?? 0) + supplyTotal;
  const sharingEnabled = Boolean(input.cross_platform_sharing);
  const originalTotal = computeUniqueTotal(rows, sharingEnabled);
  if (originalTotal <= 0) return null;
  if (supply <= 0) return null;
  if (originalTotal <= supply) {
    return {
      balanced_requests: rows.map((r) => ({ ...r })),
      adjustments_made: false,
      original_requested_total: originalTotal,
      balanced_total: originalTotal,
      reason: 'Requested volume within capacity; no adjustment needed.',
    };
  }

  const campaignIntent = input.campaign_intent ?? null;

  const byKey = new Map<string, { platform: string; content_type: string; count_per_week: number }>();
  for (const r of rows) {
    const key = `${r.platform}:${r.content_type}`;
    const existing = byKey.get(key);
    if (existing) existing.count_per_week += r.count_per_week;
    else byKey.set(key, { ...r });
  }

  const sortedByPriority = Array.from(byKey.entries())
    .sort((a, b) => {
      const pa = priority(a[1].content_type);
      const pb = priority(b[1].content_type);
      if (pa !== pb) return pa - pb;
      return a[0].localeCompare(b[0]);
    })
    .map(([, v]) => ({ ...v }));

  while (computeUniqueTotal(sortedByPriority, sharingEnabled) > supply) {
    let reduced = false;
    for (const row of sortedByPriority) {
      if (row.count_per_week <= 0) continue;
      if (isConversionProtected(row.content_type, campaignIntent)) continue;
      row.count_per_week -= 1;
      reduced = true;
      break;
    }
    if (!reduced) break;
  }

  const balancedRows = sortedByPriority.filter((r) => r.count_per_week > 0);
  const balancedTotal = computeUniqueTotal(balancedRows, sharingEnabled);

  if (balancedTotal > supply) {
    return null;
  }

  return {
    balanced_requests: balancedRows,
    adjustments_made: true,
    original_requested_total: originalTotal,
    balanced_total: balancedTotal,
    reason:
      'Adjusted posting volume to match production capacity while preserving video and conversion-stage content.',
  };
}
