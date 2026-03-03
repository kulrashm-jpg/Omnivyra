type CapacityValidationStatus = 'valid' | 'invalid' | 'balanced';

export type CapacityValidationResult = {
  status: CapacityValidationStatus;
  override_confirmed: boolean;
  requested_total: number;
  /** Total platform postings per week (sum across platforms). */
  requested_platform_postings_total?: number;
  weekly_capacity_total: number;
  exclusive_campaigns_total: number;
  effective_capacity_total: number;
  available_content_total: number;
  supply_total: number;
  deficit: number;
  requested_by_platform: Record<string, number>;
  suggested_requested_by_platform?: Record<string, number>;
  suggested_adjustments?: {
    reduce_total_by: number;
  };
  explanation: string;
  /** When status === 'balanced': workload after auto rebalance. */
  balanced_requests?: Array<{ platform: string; content_type: string; count_per_week: number }>;
  /** When status === 'balanced': human-readable adjustment reason. */
  planning_adjustment_reason?: string;
  /** When status === 'balanced': concise summary of what was reduced and preserved. */
  planning_adjustments_summary?: { reduced: string[]; preserved: string[]; text: string };
};

function normalizePlatformKey(raw: unknown): string {
  const n = String(raw ?? '').trim().toLowerCase();
  if (n === 'twitter') return 'x';
  return n;
}

function toNonNegativeInt(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function normalizeContentType(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function coerceTotalCount(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'object' && !Array.isArray(value)) {
    let sum = 0;
    for (const v of Object.values(value as Record<string, unknown>)) {
      sum += toNonNegativeInt(v);
    }
    return sum;
  }
  return 0;
}

function coerceExclusiveTotal(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) {
    let sum = 0;
    for (const it of value as any[]) {
      sum += toNonNegativeInt((it as any)?.count_per_week ?? (it as any)?.count ?? (it as any)?.per_week);
    }
    return sum;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return toNonNegativeInt(obj.count ?? obj.exclusive_count ?? obj.exclusiveCampaigns);
  }
  return 0;
}

function parsePlatformContentRequestsRows(value: unknown): Array<{ platform: string; content_type: string; count_per_week: number }> {
  if (value == null) return [];
  const v: unknown = value;
  const out: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
  const add = (platformRaw: unknown, typeRaw: unknown, countRaw: unknown) => {
    const platform = normalizePlatformKey(platformRaw);
    const content_type = normalizeContentType(typeRaw);
    const count = toNonNegativeInt(countRaw);
    if (!platform || !content_type || count <= 0) return;
    out.push({ platform, content_type, count_per_week: count });
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

function computePlatformPostingTotals(rows: Array<{ platform: string; content_type: string; count_per_week: number }>): { total: number; byPlatform: Record<string, number> } {
  const byPlatform: Record<string, number> = {};
  for (const r of rows) {
    if (!r.platform || r.count_per_week <= 0) continue;
    byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + r.count_per_week;
  }
  const total = Object.values(byPlatform).reduce((a, b) => a + (Number(b) || 0), 0);
  return { total, byPlatform };
}

function computeUniqueWeeklyTotal(rows: Array<{ platform: string; content_type: string; count_per_week: number }>, sharingEnabled: boolean): number {
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

function isOverrideConfirmedFromMessage(message: string): boolean {
  const n = String(message || '').toLowerCase();
  return (
    n.includes('override') ||
    n.includes('proceed anyway') ||
    n.includes('ignore capacity') ||
    n.includes('yes proceed') ||
    n.includes('continue anyway')
  );
}

export function validateCapacityVsExpectation(input: {
  available_content: unknown;
  weekly_capacity: unknown;
  exclusive_campaigns: unknown;
  platform_content_requests: unknown;
  cross_platform_sharing?: unknown;
  message?: string;
  override_confirmed?: boolean;
}): CapacityValidationResult | null {
  const rows = parsePlatformContentRequestsRows(input.platform_content_requests);
  const { total: requested_platform_postings_total, byPlatform } = computePlatformPostingTotals(rows);
  if (requested_platform_postings_total <= 0) return null;

  const sharingEnabled = Boolean(
    (typeof input.cross_platform_sharing === 'object' && input.cross_platform_sharing && (input.cross_platform_sharing as any).enabled !== undefined)
      ? (input.cross_platform_sharing as any).enabled
      : false
  );
  const requested_total = computeUniqueWeeklyTotal(rows, sharingEnabled);

  const weekly_capacity_total = coerceTotalCount(input.weekly_capacity);
  const available_content_total = coerceTotalCount(input.available_content);
  const exclusive_campaigns_total = coerceExclusiveTotal(input.exclusive_campaigns);

  // Exclusive campaigns consume capacity first (not availability).
  const effective_capacity_total = Math.max(0, weekly_capacity_total - exclusive_campaigns_total);
  const supply_total = available_content_total + effective_capacity_total;

  const override_confirmed =
    Boolean(input.override_confirmed) || (typeof input.message === 'string' && isOverrideConfirmedFromMessage(input.message));

  const deficit = Math.max(0, requested_total - supply_total);
  const status: CapacityValidationStatus = deficit > 0 ? 'invalid' : 'valid';

  let suggested_requested_by_platform: Record<string, number> | undefined;
  if (status === 'invalid' && requested_total > 0) {
    const ratio = supply_total / requested_total;
    suggested_requested_by_platform = {};
    let allocated = 0;
    const platforms = Object.entries(byPlatform).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]));
    for (const [p, c] of platforms) {
      const next = Math.max(0, Math.floor(c * ratio));
      suggested_requested_by_platform[p] = next;
      allocated += next;
    }
    // Add remainder to the largest platform deterministically.
    const remainder = Math.max(0, supply_total - allocated);
    if (remainder > 0 && platforms.length > 0) {
      const [p0] = platforms[0];
      suggested_requested_by_platform[p0] = (suggested_requested_by_platform[p0] ?? 0) + remainder;
    }
  }

  const explanation =
    status === 'valid'
      ? 'Requested weekly execution is within available_content + weekly_capacity (after exclusive_campaigns consume capacity first).'
      : 'Requested weekly execution exceeds available_content + weekly_capacity (after exclusive_campaigns consume capacity first).';

  return {
    status,
    override_confirmed,
    requested_total,
    requested_platform_postings_total,
    weekly_capacity_total,
    exclusive_campaigns_total,
    effective_capacity_total,
    available_content_total,
    supply_total,
    deficit,
    requested_by_platform: byPlatform,
    suggested_requested_by_platform,
    suggested_adjustments: status === 'invalid' ? { reduce_total_by: deficit } : undefined,
    explanation,
  };
}

