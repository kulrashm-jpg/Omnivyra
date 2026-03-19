import { supabase } from '../db/supabaseClient';
import type { ExecutionMode } from './executionModeInference';
import type { AccountContext } from '../types/accountContext';

/** Returns true when cross-platform content sharing is enabled (one piece reused across platforms). */
const isCrossPlatformSharingEnabled = (value: unknown): boolean => {
  if (value === true || value === 'true' || value === 'enabled' || value === 1) return true;
  return false;
};

type DeterministicPlanningContext = {
  content_capacity?: unknown;
  available_content?: unknown;
  exclusive_campaigns?: unknown;
  platforms?: unknown;
  platform_content_requests?: unknown;
  cross_platform_sharing?: unknown;
  account_context?: AccountContext | null;
};

export type DeterministicExecutionItem = {
  content_type: string;
  platform_options: string[];
  selected_platforms: string[];
  count_per_week: number;
  /** Per-platform requested counts (postings). */
  platform_counts?: Record<string, number>;
  /** For each unique piece (slot), which platforms will reuse it. */
  slot_platforms?: string[][];
    topic_slots: Array<{
    topic: string | null;
    intent: {
      objective: string | null;
      cta_type: string | null;
      target_audience: string | null;
      writing_angle: string | null;
      brief_summary: string | null;
      strategic_role: string | null;
      pain_point: string | null;
      outcome_promise: string | null;
      recommendation_alignment: {
        source_type: string | null;
        source_value: string | null;
        alignment_reason: string | null;
      };
    };
    /** Stable id for one logical content piece (set when merged into blueprint). Optional for backward compatibility. */
    master_content_id?: string;
    /** Execution ownership (set during weekly enrichment). Frozen type prevents accidental values. */
    execution_mode?: ExecutionMode;
  }>;
};

export type DeterministicWeeklySkeleton = {
  total_weekly_content_count: number;
  /** Total platform postings per week (sum across platforms). */
  platform_postings_total?: number;
  platform_allocation: Record<string, number>;
  content_type_mix: string[];
  execution_items: DeterministicExecutionItem[];
};

export class DeterministicWeeklySkeletonError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DeterministicWeeklySkeletonError';
    this.code = code;
    this.details = details;
  }
}

function normalizePlatformKey(raw: unknown): string {
  const n = String(raw ?? '').trim().toLowerCase();
  if (n === 'twitter') return 'x';
  return n;
}

function normalizeContentType(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function toNonNegativeInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

function parseCountFromString(value: string): number {
  const matches: string[] = value.match(/\b\d+\b/g) ?? [];
  return matches.reduce((sum, m) => sum + (parseInt(m, 10) || 0), 0);
}

function coerceTotalCount(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') return Math.max(0, parseCountFromString(value));
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') {
    let sum = 0;
    for (const v of Object.values(value as Record<string, unknown>)) {
      const n = toNonNegativeInt(v);
      if (n != null) sum += n;
    }
    return sum;
  }
  return 0;
}

function coerceExclusiveReduction(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) {
    let sum = 0;
    for (const item of value as any[]) {
      const n = toNonNegativeInt((item as any)?.count_per_week ?? (item as any)?.count ?? (item as any)?.per_week);
      if (n != null) sum += n;
    }
    return sum;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const n = toNonNegativeInt(obj.count ?? obj.exclusive_count ?? obj.exclusiveCampaigns);
    return n != null ? n : 0;
  }
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return 0;
}

function parsePlatformContentRequests(value: unknown): Array<{ platform: string; content_type: string; count_per_week: number }> {
  if (value == null) return [];
  let v: unknown = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t) {
      try {
        v = JSON.parse(t);
      } catch {
        throw new DeterministicWeeklySkeletonError(
          'DETERMINISTIC_PLATFORM_CONTENT_REQUESTS_INVALID_JSON',
          'platform_content_requests must be valid JSON when provided as a string.',
          { value: t.slice(0, 200) }
        );
      }
    }
  }

  // Array form: [{ platform, content_type, count_per_week }]
  if (Array.isArray(v)) {
    const out: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
    for (const item of v) {
      const platform = normalizePlatformKey((item as any)?.platform ?? (item as any)?.platform_key ?? (item as any)?.selected_platform);
      const content_type = normalizeContentType((item as any)?.content_type ?? (item as any)?.type ?? (item as any)?.contentType);
      const count = toNonNegativeInt((item as any)?.count_per_week ?? (item as any)?.count ?? (item as any)?.per_week);
      if (!platform || !content_type || count == null) continue;
      out.push({ platform, content_type, count_per_week: count });
    }
    return out;
  }

  // Map form: { [platform]: { [content_type]: count } } OR { [platform]: [{content_type,count_per_week}] }
  if (v && typeof v === 'object') {
    const out: Array<{ platform: string; content_type: string; count_per_week: number }> = [];
    for (const [p0, entry] of Object.entries(v as Record<string, unknown>)) {
      const platform = normalizePlatformKey(p0);
      if (!platform) continue;
      if (Array.isArray(entry)) {
        for (const it of entry) {
          const content_type = normalizeContentType((it as any)?.content_type ?? (it as any)?.type ?? (it as any)?.contentType);
          const count = toNonNegativeInt((it as any)?.count_per_week ?? (it as any)?.count ?? (it as any)?.per_week);
          if (!content_type || count == null) continue;
          out.push({ platform, content_type, count_per_week: count });
        }
        continue;
      }
      if (entry && typeof entry === 'object') {
        for (const [ct0, c0] of Object.entries(entry as Record<string, unknown>)) {
          const content_type = normalizeContentType(ct0);
          const count = toNonNegativeInt(c0);
          if (!content_type || count == null) continue;
          out.push({ platform, content_type, count_per_week: count });
        }
      }
    }
    return out;
  }

  throw new DeterministicWeeklySkeletonError(
    'DETERMINISTIC_PLATFORM_CONTENT_REQUESTS_INVALID_SHAPE',
    'platform_content_requests must be an array or object mapping.',
    { type: typeof v }
  );
}

async function buildPlatformOptionsByContentType(): Promise<Map<string, string[]>> {
  const { data: platforms, error: platformsError } = await supabase
    .from('platform_master')
    .select('id, canonical_key, active')
    .eq('active', true);
  if (platformsError) {
    throw new DeterministicWeeklySkeletonError(
      'DETERMINISTIC_PLATFORM_MASTER_READ_FAILED',
      platformsError.message || 'Failed to read platform_master.',
      { table: 'platform_master' }
    );
  }
  const rows = Array.isArray(platforms) ? platforms : [];
  const byId = new Map<string, string>();
  for (const p of rows as any[]) {
    if (!p?.id || !p?.canonical_key) continue;
    byId.set(String(p.id), normalizePlatformKey(p.canonical_key));
  }

  const { data: rules, error: rulesError } = await supabase
    .from('platform_content_rules')
    .select('platform_id, content_type');
  if (rulesError) {
    throw new DeterministicWeeklySkeletonError(
      'DETERMINISTIC_PLATFORM_CONTENT_RULES_READ_FAILED',
      rulesError.message || 'Failed to read platform_content_rules.',
      { table: 'platform_content_rules' }
    );
  }

  const map = new Map<string, Set<string>>();
  (rules || []).forEach((r: any) => {
    const pid = String(r?.platform_id ?? '');
    const ct = normalizeContentType(r?.content_type);
    const pk = byId.get(pid);
    if (!pk || !ct) return;
    const set = map.get(ct) ?? new Set<string>();
    set.add(pk);
    map.set(ct, set);
  });

  const out = new Map<string, string[]>();
  for (const [ct, set] of map.entries()) {
    out.set(ct, Array.from(set).sort());
  }
  return out;
}

/** Backward compatibility: undefined → shared mode (true). */
function applyMaturityFrequencyAdjustment(
  requests: Array<{ platform: string; content_type: string; count_per_week: number }>,
  accountContext: AccountContext | null | undefined
): Array<{ platform: string; content_type: string; count_per_week: number }> {
  if (!accountContext) return requests;

  // Maturity-based frequency multipliers
  const maturityMultipliers: Record<string, number> = {
    'NEW': 0.7,      // Reduce frequency for new accounts (70% of requested)
    'GROWING': 0.9,  // Slight reduction for growing accounts (90% of requested)
    'ESTABLISHED': 1.0 // Full frequency for established accounts
  };

  const multiplier = maturityMultipliers[accountContext.maturityStage] ?? 1.0;

  return requests.map(request => ({
    ...request,
    count_per_week: Math.max(1, Math.floor(request.count_per_week * multiplier))
  }));
}

export async function buildDeterministicWeeklySkeleton(
  planningContext: DeterministicPlanningContext
): Promise<DeterministicWeeklySkeleton> {
  const requests = parsePlatformContentRequests(planningContext.platform_content_requests);
  if (requests.length === 0) {
    throw new DeterministicWeeklySkeletonError(
      'DETERMINISTIC_PLATFORM_CONTENT_REQUESTS_EMPTY',
      'platform_content_requests is required and must be non-empty to build a deterministic weekly skeleton.'
    );
  }

  // Apply maturity-based frequency adjustment
  const adjustedRequests = applyMaturityFrequencyAdjustment(requests, planningContext.account_context);

  const platformOptionsByContentType = await buildPlatformOptionsByContentType();

  const execution_items: DeterministicExecutionItem[] = [];
  const platform_allocation: Record<string, number> = {};
  const postingsTotalsByType: Record<string, number> = {};
  const sharingEnabled = isCrossPlatformSharingEnabled((planningContext as any)?.cross_platform_sharing);
  const byType = new Map<string, Map<string, number>>();

  for (const r of adjustedRequests) {
    const platform = normalizePlatformKey(r.platform);
    const content_type = normalizeContentType(r.content_type);
    const count = toNonNegativeInt(r.count_per_week) ?? 0;

    if (!platform || !content_type) continue;
    if (count <= 0) continue;

    // Use platform_content_rules as a hint; fall back to the explicitly requested platform
    // so company-admin-configured content types (e.g. "blog") are always accepted.
    const rulesOptions = platformOptionsByContentType.get(content_type) ?? [];
    const platform_options = rulesOptions.includes(platform)
      ? rulesOptions
      : rulesOptions.length > 0
        ? [...rulesOptions, platform]
        : [platform];

    platform_allocation[platform] = (platform_allocation[platform] ?? 0) + count;
    postingsTotalsByType[content_type] = (postingsTotalsByType[content_type] ?? 0) + count;

    const perPlatform = byType.get(content_type) ?? new Map<string, number>();
    perPlatform.set(platform, (perPlatform.get(platform) ?? 0) + count);
    byType.set(content_type, perPlatform);
  }

  const platform_postings_total = Object.values(platform_allocation).reduce((a, b) => a + (Number(b) || 0), 0);
  if (platform_postings_total <= 0) {
    throw new DeterministicWeeklySkeletonError(
      'DETERMINISTIC_PLATFORM_CONTENT_REQUESTS_ZERO_TOTAL',
      'platform_content_requests resolved to zero total weekly content count.'
    );
  }

  const uniqueTotalsByType: Record<string, number> = {};
  for (const [type, perPlatform] of byType.entries()) {
    const counts = Array.from(perPlatform.values());
    const unique = sharingEnabled
      ? Math.max(0, ...counts)
      : counts.reduce((a, b) => a + (Number(b) || 0), 0);
    if (unique > 0) uniqueTotalsByType[type] = unique;
  }
  const total_weekly_content_count = Object.values(uniqueTotalsByType).reduce((a, b) => a + (Number(b) || 0), 0);

  const content_type_mix = Object.entries(uniqueTotalsByType)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${count} ${type}`);

  // Capacity/frequency validation is handled by capacityFrequencyValidationGateway.
  // Callers (e.g. campaignAiOrchestrator) run validateCapacityAndFrequency() first and
  // only call buildDeterministicWeeklySkeleton when valid or override confirmed.
  // No capacity error thrown here.

  // Build execution items at the UNIQUE piece level (sharing-aware).
  for (const [content_type, perPlatform] of byType.entries()) {
    const selected_platforms = Array.from(perPlatform.keys()).sort((a, b) => a.localeCompare(b));
    const platform_options = platformOptionsByContentType.get(content_type) ?? selected_platforms;
    const unique = uniqueTotalsByType[content_type] ?? 0;
    if (unique <= 0) continue;

    const platform_counts: Record<string, number> = {};
    for (const [p, c] of perPlatform.entries()) {
      const n = Math.max(0, Math.floor(Number(c) || 0));
      if (n > 0) platform_counts[p] = n;
    }

    const slot_platforms: string[][] = [];
    if (sharingEnabled) {
      const remaining: Record<string, number> = { ...platform_counts };
      for (let i = 0; i < unique; i += 1) {
        const platformsForSlot = selected_platforms
          .filter((p) => (remaining[p] ?? 0) > 0)
          .sort((a, b) => (remaining[b] ?? 0) - (remaining[a] ?? 0) || a.localeCompare(b));
        if (platformsForSlot.length === 0) break;
        slot_platforms.push(platformsForSlot);
        for (const p of platformsForSlot) remaining[p] = Math.max(0, (remaining[p] ?? 0) - 1);
      }
    } else {
      for (const p of selected_platforms) {
        const count = platform_counts[p] ?? 0;
        for (let i = 0; i < count; i += 1) slot_platforms.push([p]);
      }
    }

    execution_items.push({
      content_type,
      platform_options,
      selected_platforms,
      count_per_week: unique,
      platform_counts,
      slot_platforms,
      topic_slots: Array.from({ length: unique }, () => ({
        topic: null,
        intent: {
          objective: null,
          cta_type: null,
          target_audience: null,
          writing_angle: null,
          brief_summary: null,
          strategic_role: null,
          pain_point: null,
          outcome_promise: null,
          recommendation_alignment: {
            source_type: null,
            source_value: null,
            alignment_reason: null,
          },
        },
      })),
    });
  }

  return {
    total_weekly_content_count,
    platform_postings_total,
    platform_allocation,
    content_type_mix,
    execution_items,
  };
}

