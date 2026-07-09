/** Part 1/2 of SystemStateDashboard.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Database,
  FileText,
  Globe2,
  Link2,
  Megaphone,
  MessageSquare,
  Plug,
  Radio,
  RefreshCw,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';


type HealthState = 'active' | 'error' | 'disconnected';

type TimelinePoint = {
  label: string;
  value: number;
};

type SectionKey =
  | 'overview'
  | 'integrationStatus'
  | 'trafficState'
  | 'systemUsage'
  | 'contentState'
  | 'campaignState'
  | 'engagementState'
  | 'billingAccount'
  | 'intelligenceActivity';

export type DashboardPayload = {
  generatedAt: string;
  companyId: string;
  meta: {
    version: 'v1';
    lastUpdated: string;
    sectionUpdatedAt: Record<SectionKey, string>;
    featureFlags: {
      trafficState: boolean;
      platformState: boolean;
      billingAccount: boolean;
      intelligenceActivity: boolean;
      crmBridge: boolean;
    };
  };
  overview: {
    platformsConnected: number;
    platformsReady: number;
    activeIntegrations: number;
    activeCampaigns: number;
    totalContentAssets: number;
    activeUsers: number;
  };
  integrationStatus: {
    platforms: Array<{
      key: string;
      label: string;
      status: HealthState;
      accountCount: number;
      lastSyncAt: string | null;
      postsPublished: number;
      engagementCount: number;
      trend: TimelinePoint[];
    }>;
    apis: Array<{
      id: string;
      name: string;
      category: string;
      status: HealthState;
      lastSyncAt: string | null;
    }>;
    flags: {
      googleAnalyticsConnected: boolean;
      crmConnected: boolean;
    };
  };
  trafficState: {
    enabled: boolean;
    status?: 'live' | 'partial' | 'stale' | 'failed' | 'no_analytics';
    degraded?: boolean;
    reason?: string | null;
    lastSuccessfulIngestionAt?: string | null;
    latestIngestionStatus?: string | null;
    errors?: Array<{
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
    usage: Array<{
      key: 'llm_tokens' | 'external_api_calls' | 'automation_executions';
      label: string;
      used: number;
      limit: number | null;
    }>;
  };
  intelligenceActivity: {
    recommendationsCount: number;
    reportsCount: number;
    lastReportRun: string | null;
  };
};

export const API_ENDPOINT = '/api/analytics/v1/system-state';
export const REFRESH_INTERVAL_MS = 60_000;

export const STATUS_STYLES: Record<HealthState, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  error: 'bg-amber-50 text-amber-700 ring-amber-200',
  disconnected: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const CHART_THEME = {
  primary: '#1d4ed8',
  secondary: '#0f766e',
  tertiary: '#ea580c',
  quaternary: '#334155',
  gridText: '#64748b',
  usageBar: '#334155',
  pie: ['#1d4ed8', '#0f766e', '#ea580c', '#7c3aed'],
};

export const SURFACE_CARD =
  'box-border overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 p-4';

const SHELL_CARD =
  'box-border overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.05)] sm:p-6';

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString();
}

export function statusLabel(value: HealthState) {
  if (value === 'active') return 'Active';
  if (value === 'error') return 'Error';
  return 'Disconnected';
}

export function percentage(used: number, limit: number | null) {
  if (!limit || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function usePageVisibility() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const updateVisibility = () => {
      setVisible(document.visibilityState !== 'hidden');
    };

    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);

    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  return visible;
}

type SectionState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  globalUpdatedAt: string | null;
  featureFlags: DashboardPayload['meta']['featureFlags'] | null;
};

// Single-flight fetch: the dashboard renders ~9 sections, each of which used to
// independently fetch the FULL system-state aggregation endpoint (17 table reads
// + external Google API calls). That fired ~9 identical heavy requests per refresh
// tick, saturating serverless concurrency and causing slow/partial loads that
// reset to "refreshing". Now all sections for a given (companyId, refreshTick)
// share ONE in-flight request and each slices out its own key.
let sharedStateKey: string | null = null;
let sharedStatePromise: Promise<DashboardPayload> | null = null;
function fetchSystemStateShared(companyId: string, refreshTick: number): Promise<DashboardPayload> {
  const key = `${companyId}:${refreshTick}`;
  if (sharedStateKey !== key || !sharedStatePromise) {
    sharedStateKey = key;
    sharedStatePromise = fetch(`${API_ENDPOINT}?companyId=${encodeURIComponent(companyId)}`, {
      credentials: 'include',
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to load analytics system state');
      }
      return (await response.json()) as DashboardPayload;
    });
    // On failure, drop the cache so a later retry re-fetches instead of every
    // section replaying the same rejected promise.
    sharedStatePromise.catch(() => {
      if (sharedStateKey === key) {
        sharedStateKey = null;
        sharedStatePromise = null;
      }
    });
  }
  return sharedStatePromise;
}

export function useSystemStateSection<K extends SectionKey>(
  companyId: string,
  sectionKey: K,
  refreshTick: number
): SectionState<DashboardPayload[K]> {
  const [state, setState] = useState<SectionState<DashboardPayload[K]>>({
    data: null,
    loading: true,
    error: null,
    lastUpdated: null,
    globalUpdatedAt: null,
    featureFlags: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSection() {
      if (!companyId) {
        setState({
          data: null,
          loading: false,
          error: 'Company not available',
          lastUpdated: null,
          globalUpdatedAt: null,
          featureFlags: null,
        });
        return;
      }

      setState((current) => ({ ...current, loading: true, error: null }));

      try {
        const payload = await fetchSystemStateShared(companyId, refreshTick);
        if (cancelled) return;

        setState({
          data: payload[sectionKey],
          loading: false,
          error: null,
          lastUpdated: payload.meta.sectionUpdatedAt[sectionKey] ?? payload.meta.lastUpdated,
          globalUpdatedAt: payload.meta.lastUpdated,
          featureFlags: payload.meta.featureFlags,
        });
      } catch (error) {
        console.error(`[SystemStateDashboard:${sectionKey}]`, error);
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: 'Unable to load this section right now.',
        }));
      }
    }

    void loadSection();

    return () => {
      cancelled = true;
    };
  }, [companyId, refreshTick, sectionKey]);

  return state;
}

export function EmptyState({
  title,
  body,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="box-border flex h-auto max-h-[180px] min-h-[140px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-5 text-slate-500">{body}</p>
      {ctaLabel && ctaHref ? (
        <Link
          href={ctaHref}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
        >
          <Link2 className="h-4 w-4" />
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/75 ${className}`} />;
}

export function SectionSkeleton({
  chart = true,
  stats = 3,
}: {
  chart?: boolean;
  stats?: number;
}) {
  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${stats > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {Array.from({ length: stats }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-3 h-8 w-20" />
          </div>
        ))}
      </div>
      {chart ? <SkeletonBlock className="h-72 w-full" /> : null}
    </div>
  );
}

export function SectionShell({
  title,
  description,
  children,
  lastUpdated,
  linkHref,
  linkLabel,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  lastUpdated?: string | null;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <section className={SHELL_CARD}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {lastUpdated ? <span>Updated {formatDateTime(lastUpdated)}</span> : null}
          {linkHref && linkLabel ? (
            <Link
              href={linkHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              <Link2 className="h-3.5 w-3.5" />
              {linkLabel}
            </Link>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  category,
}: {
  label: string;
  value: string;
  category?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 shadow-sm">
      {category ? (
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-700">{category}</div>
      ) : null}
      <div className={`${category ? 'mt-1' : ''} text-xs font-medium uppercase tracking-[0.16em] text-slate-400`}>{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
    </div>
  );
}

export function SmallLineChart({
  data,
  color = CHART_THEME.primary,
}: {
  data: TimelinePoint[];
  color?: string;
}) {
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.25} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

