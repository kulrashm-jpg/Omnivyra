/** Part of the analytics system-state API (Agent-B split — backend module, not a route). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { getGoogleAnalyticsStatus, getGoogleSearchConsoleStatus } from '../../services/analyticsIntegrationService';
import { getGoogleProviderReadiness, type GoogleCapabilityReadiness } from '../../services/googleProviderReadinessService';
import { getAnalyticsReadiness, type AnalyticsReadiness } from '../../services/analyticsDataReadinessService';
import { getLatestCompletedRun, getLatestRun, type IngestionRunRecord } from '../../services/ingestionRunService';
import { resolveOrganizationPlanLimits, type ResolvedPlanLimits } from '../../services/planResolutionService';
import { enforceCompanyAccess, resolveUserContext } from '../../services/userContextService';

export type HealthState = 'active' | 'error' | 'disconnected';

export type GenericRow = Record<string, unknown>;

export type TimelinePoint = {
  label: string;
  value: number;
};

export type OverviewMetric = {
  platformsConnected: number;
  platformsReady: number;
  activeIntegrations: number;
  activeCampaigns: number;
  totalContentAssets: number;
  activeUsers: number;
};

export type IntegrationPlatform = {
  key: string;
  label: string;
  status: HealthState;
  accountCount: number;
  lastSyncAt: string | null;
  postsPublished: number;
  engagementCount: number;
  trend: TimelinePoint[];
};

export type IntegrationApi = {
  id: string;
  name: string;
  category: string;
  status: HealthState;
  lastSyncAt: string | null;
};

export type TrafficState = {
  enabled: boolean;
  status: 'live' | 'partial' | 'stale' | 'failed' | 'no_analytics';
  degraded: boolean;
  reason: string | null;
  lastSuccessfulIngestionAt: string | null;
  latestIngestionStatus: string | null;
  errors: Array<{
    table: string;
    message: string;
  }>;
  sessions7d: number;
  sessions30d: number;
  users30d: number;
  topSources: Array<{
    source: string;
    sessions: number;
  }>;
  trend: Array<{
    label: string;
    sessions: number;
    users: number;
  }>;
};

export type BillingUsageItem = {
  key: 'llm_tokens' | 'external_api_calls' | 'automation_executions';
  label: string;
  used: number;
  limit: number | null;
};

export type SystemStateResponse = {
  generatedAt: string;
  companyId: string;
  meta: {
    version: 'v1';
    lastUpdated: string;
    sectionUpdatedAt: {
      overview: string;
      integrationStatus: string;
      trafficState: string;
      systemUsage: string;
      contentState: string;
      campaignState: string;
      engagementState: string;
      billingAccount: string;
      intelligenceActivity: string;
    };
    featureFlags: {
      trafficState: boolean;
      platformState: boolean;
      billingAccount: boolean;
      intelligenceActivity: boolean;
      crmBridge: boolean;
    };
  };
  overview: OverviewMetric;
  integrationStatus: {
    platforms: IntegrationPlatform[];
    apis: IntegrationApi[];
    flags: {
      googleAnalyticsConnected: boolean;
      googleSearchConsoleConnected: boolean;
      crmConnected: boolean;
    };
    providerReadiness: Record<string, GoogleCapabilityReadiness>;
  };
  trafficState: TrafficState;
  systemUsage: {
    campaignsCreatedTrend: TimelinePoint[];
    contentCreatedTrend: TimelinePoint[];
    postsPublishedTrend: TimelinePoint[];
  };
  contentState: {
    totalContent: number;
    draftCount: number;
    publishedCount: number;
    publishingFrequencyPerWeek: number;
    byType: {
      blogs: number;
      carousels: number;
      banners: number;
      other: number;
    };
  };
  campaignState: {
    active: number;
    paused: number;
    completed: number;
    totalSpend: number;
    totalReach: number;
    totalImpressions: number;
    volumeTrend: TimelinePoint[];
  };
  engagementState: {
    totalConversations: number;
    unansweredConversations: number;
    responseVolume: number;
  };
  billingAccount: {
    plan: string;
    paymentStatus: 'active' | 'free' | 'not_configured';
    usage: BillingUsageItem[];
  };
  intelligenceActivity: {
    recommendationsCount: number;
    reportsCount: number;
    lastReportRun: string | null;
  };
};

export type SystemStateDataError = {
  table: string;
  message: string;
};

export const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  threads: 'Threads',
  reddit: 'Reddit',
  whatsapp: 'WhatsApp',
};

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function safeNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function mostRecentDate(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter(hasText);
  if (valid.length === 0) return null;
  return valid.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

export function classifyApiStatus(row: GenericRow): HealthState {
  const status = String(row.status ?? row.last_test_status ?? '').trim().toLowerCase();
  const isActive = row.is_active === true;
  const hasError = hasText(row.last_error_message) || hasText(row.last_error);

  if (status === 'connected' || status === 'active' || status === 'success' || isActive) return 'active';
  if (status === 'failed' || status === 'error' || hasError) return 'error';
  return 'disconnected';
}

export function classifyContentType(value: unknown): 'blogs' | 'carousels' | 'banners' | 'other' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return 'other';
  if (normalized.includes('blog') || normalized.includes('article') || normalized.includes('newsletter') || normalized.includes('guide')) {
    return 'blogs';
  }
  if (normalized.includes('carousel') || normalized.includes('thread')) {
    return 'carousels';
  }
  if (normalized.includes('banner') || normalized.includes('ad') || normalized.includes('display')) {
    return 'banners';
  }
  return 'other';
}

export function integrationMatches(row: GenericRow, patterns: string[]): boolean {
  const haystack = [
    row.type,
    row.name,
    row.display_name,
    row.provider_key,
    row.category,
    row.purpose,
    typeof row.config === 'object' ? JSON.stringify(row.config) : null,
    typeof row.config_json === 'object' ? JSON.stringify(row.config_json) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return patterns.some((pattern) => haystack.includes(pattern));
}

export async function fetchRows(
  table: string,
  select: string,
  build?: (query: any) => any,
  errors?: SystemStateDataError[],
): Promise<GenericRow[]> {
  try {
    let query = supabase.from(table).select(select);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) {
      errors?.push({ table, message: error.message });
      console.warn('[analytics/system-state] table fetch failed', { table, message: error.message });
      return [];
    }
    return (data ?? []) as unknown as GenericRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors?.push({ table, message });
    console.warn('[analytics/system-state] table fetch threw', { table, message });
    return [];
  }
}

export function buildTimeline(days: number, compute: (dateKey: string, date: Date) => number): TimelinePoint[] {
  const today = startOfDay(new Date());
  const points: TimelinePoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    points.push({
      label: formatShortDate(date),
      value: compute(key, date),
    });
  }
  return points;
}

export function buildWeeklyTimeline(weeks: number, rows: GenericRow[], dateField: string): TimelinePoint[] {
  const now = startOfDay(new Date());
  const buckets = new Map<string, number>();

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - index * 7);
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  for (const row of rows) {
    const raw = String(row[dateField] ?? '').slice(0, 10);
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0 || diffDays >= weeks * 7) continue;
    const weekOffset = Math.floor(diffDays / 7);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - weekOffset * 7);
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, value]) => ({
      label: formatShortDate(new Date(key)),
      value,
    }));
}

