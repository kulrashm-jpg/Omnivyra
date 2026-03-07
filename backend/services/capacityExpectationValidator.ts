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

/** Map platform content_type to capacity key (post, video, blog, story, thread). */
function contentTypeToCapacityKey(ct: string): keyof CapacityByType {
  const n = ct.replace(/[\s_-]+/g, '').toLowerCase();
  if (n === 'post' || n === 'posts' || n === 'textpost' || n === 'textposts' || n === 'text post' || n === 'text posts' ||
      n === 'carousel' || n === 'carousels' || n === 'image' || n === 'images') return 'post';
  if (n === 'video' || n === 'videos' || n === 'reel' || n === 'reels' || n === 'short' || n === 'shorts' ||
      n === 'podcast' || n === 'podcasts' || n === 'song' || n === 'songs' || n === 'audio' || n === 'space' || n === 'spaces') return 'video';
  if (n === 'blog' || n === 'blogs' || n === 'article' || n === 'articles' || n === 'newsletter' || n === 'newsletters' ||
      n === 'whitepaper' || n === 'slide' || n === 'slides' || n === 'slideware' || n === 'webinar' || n === 'webinars') return 'blog';
  if (n === 'story' || n === 'stories') return 'story';
  if (n === 'thread' || n === 'threads') return 'thread';
  return 'post';
}

type CapacityByType = { post: number; video: number; blog: number; story: number; thread: number };

const EMPTY_BY_TYPE: CapacityByType = { post: 0, video: 0, blog: 0, story: 0, thread: 0 };

function parseCapacityByType(value: unknown): CapacityByType {
  if (value == null) return { ...EMPTY_BY_TYPE };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out = { ...EMPTY_BY_TYPE };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'breakdown' || k === '_declared_none' || k === 'declared_none' || k === 'declaredNone') continue;
      const n = toNonNegativeInt(v);
      if (n <= 0) continue;
      const key = contentTypeToCapacityKey(k);
      out[key] += n;
    }
    return out;
  }
  return { ...EMPTY_BY_TYPE };
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

/**
 * Two scenarios for capacity calculation:
 *
 * 1. NO SHARING (everything unique): requested = sum of all platform postings.
 *    Each platform slot needs its own piece. Simple addition.
 *
 * 2. SHARING ENABLED: 1 unique piece can fill N platform slots (N = platforms that support that content type).
 *    - Look at which platforms the user selected and which content types each supports.
 *    - 1 post across 4 post-supporting platforms = 1 capacity unit fills 4 slots.
 *    - So: requested_unique = max per content_type across platforms (that request that type).
 *    - Example: 2 posts/week on each of 4 platforms → need 2 unique posts (2 × 4 slots filled).
 */
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

/** When content repurposing is enabled, 1 source piece can be adapted for multiple platforms (e.g. 1 article → post, thread, fb post, x post). */
const REPURPOSING_FACTOR = 4;

/**
 * Per-content-type validation. For each type:
 * - Supply = available[type] + (weekly_capacity[type] × campaign_weeks)
 * - Platforms supporting type = from platform_content_requests (only platforms that request that type)
 * - With sharing: 1 piece fills N platform slots → demand_unique = max per platform
 * - Without sharing: demand_unique = sum of all postings for that type
 * Valid when supply >= demand_unique for EVERY type.
 */
export function validateCapacityVsExpectation(input: {
  available_content: unknown;
  weekly_capacity: unknown;
  exclusive_campaigns: unknown;
  platform_content_requests: unknown;
  cross_platform_sharing?: unknown;
  content_repurposing?: unknown;
  /** Campaign duration in weeks. Supply = available + (capacity × weeks). Default 1 when missing. */
  campaign_duration_weeks?: number | null;
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
  const repurposingEnabled = Boolean(
    (typeof input.content_repurposing === 'object' && input.content_repurposing != null && (input.content_repurposing as any).enabled !== undefined)
      ? (input.content_repurposing as any).enabled
      : input.content_repurposing === true
  );
  const campaignWeeks = Math.max(1, toNonNegativeInt(input.campaign_duration_weeks) || 1);

  const availableByType = parseCapacityByType(input.available_content);
  const capacityByType = parseCapacityByType(input.weekly_capacity);
  const exclusive_campaigns_total = coerceExclusiveTotal(input.exclusive_campaigns);
  const totalCapacity = (capacityByType.post + capacityByType.video + capacityByType.blog + capacityByType.story + capacityByType.thread) * campaignWeeks;
  const exclusiveShare = (typeCapacity: number) =>
    totalCapacity > 0 ? Math.max(0, exclusive_campaigns_total * (typeCapacity * campaignWeeks) / totalCapacity) : 0;

  const demandByType: Record<keyof CapacityByType, { total: number; maxPerPlatform: number; platforms: Set<string> }> = {
    post: { total: 0, maxPerPlatform: 0, platforms: new Set() },
    video: { total: 0, maxPerPlatform: 0, platforms: new Set() },
    blog: { total: 0, maxPerPlatform: 0, platforms: new Set() },
    story: { total: 0, maxPerPlatform: 0, platforms: new Set() },
    thread: { total: 0, maxPerPlatform: 0, platforms: new Set() },
  };
  const maxByTypeAndPlatform: Record<string, Record<keyof CapacityByType, number>> = {};
  for (const r of rows) {
    const key = contentTypeToCapacityKey(r.content_type) as keyof CapacityByType;
    const d = demandByType[key];
    d.total += r.count_per_week;
    d.platforms.add(r.platform);
    if (!maxByTypeAndPlatform[r.platform]) maxByTypeAndPlatform[r.platform] = { ...EMPTY_BY_TYPE };
    maxByTypeAndPlatform[r.platform][key] = Math.max(maxByTypeAndPlatform[r.platform][key] ?? 0, r.count_per_week);
    d.maxPerPlatform = Math.max(d.maxPerPlatform, maxByTypeAndPlatform[r.platform][key]);
  }

  let worstDeficit = 0;
  let failingType: keyof CapacityByType | null = null;
  const types: (keyof CapacityByType)[] = ['post', 'video', 'blog', 'story', 'thread'];
  for (const t of types) {
    const demand = demandByType[t];
    if (demand.total <= 0) continue;
    const demandUniqueForCampaign = sharingEnabled
      ? demand.maxPerPlatform * campaignWeeks
      : demand.total * campaignWeeks;
    const typeCapacity = capacityByType[t] * campaignWeeks;
    const typeExclusive = exclusiveShare(capacityByType[t]);
    const supply = availableByType[t] + Math.max(0, typeCapacity - typeExclusive);
    const deficit = Math.max(0, demandUniqueForCampaign - supply);
    if (deficit > worstDeficit) {
      worstDeficit = deficit;
      failingType = t;
    }
  }

  const baselineUnique = computeUniqueWeeklyTotal(rows, sharingEnabled);
  const repurposingImplied = Math.max(1, Math.ceil(requested_platform_postings_total / REPURPOSING_FACTOR));
  const requested_total = repurposingEnabled
    ? Math.min(baselineUnique, repurposingImplied)
    : baselineUnique;

  const weekly_capacity_total = coerceTotalCount(input.weekly_capacity);
  const available_content_total = coerceTotalCount(input.available_content);
  const effective_capacity_total = Math.max(0, weekly_capacity_total * campaignWeeks - exclusive_campaigns_total);
  const supply_total = available_content_total + Math.max(0, (weekly_capacity_total * campaignWeeks) - exclusive_campaigns_total);

  const override_confirmed =
    Boolean(input.override_confirmed) || (typeof input.message === 'string' && isOverrideConfirmedFromMessage(input.message));

  const deficit = worstDeficit > 0 ? worstDeficit : Math.max(0, requested_total - supply_total);
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

