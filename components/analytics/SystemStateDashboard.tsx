import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  Database,
  FileText,
  Globe2,
  Link2,
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

type DashboardPayload = {
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

const API_ENDPOINT = '/api/analytics/v1/system-state';
const REFRESH_INTERVAL_MS = 60_000;

const STATUS_STYLES: Record<HealthState, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  error: 'bg-amber-50 text-amber-700 ring-amber-200',
  disconnected: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const CHART_THEME = {
  primary: '#1d4ed8',
  secondary: '#0f766e',
  tertiary: '#ea580c',
  quaternary: '#334155',
  gridText: '#64748b',
  usageBar: '#334155',
  pie: ['#1d4ed8', '#0f766e', '#ea580c', '#7c3aed'],
};

const SURFACE_CARD =
  'box-border overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 p-4';

const SHELL_CARD =
  'box-border overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.05)] sm:p-6';

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString();
}

function statusLabel(value: HealthState) {
  if (value === 'active') return 'Active';
  if (value === 'error') return 'Error';
  return 'Disconnected';
}

function percentage(used: number, limit: number | null) {
  if (!limit || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

function usePageVisibility() {
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

function useSystemStateSection<K extends SectionKey>(
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
        const response = await fetch(`${API_ENDPOINT}?companyId=${encodeURIComponent(companyId)}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to load analytics system state');
        }

        const payload = (await response.json()) as DashboardPayload;
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

function EmptyState({
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

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/75 ${className}`} />;
}

function SectionSkeleton({
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

function SectionShell({
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

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
    </div>
  );
}

function SmallLineChart({
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

function TopStrip({
  overview,
  loading,
  error,
  onRefresh,
  refreshing,
  globalUpdatedAt,
  variant,
}: {
  overview: DashboardPayload['overview'] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  globalUpdatedAt: string | null;
  variant: 'page' | 'embedded';
}) {
  return (
    <div className="box-border overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_55%,#f8fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.07)] sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          {variant === 'page' ? (
            <>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                <Radio className="h-3.5 w-3.5" />
                Real-time System State
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Analytics</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                Operational visibility across integrations, usage, publishing activity, engagement load, and account status.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">System State Dashboard</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                A neutral view of current operational state across connected systems.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600">
            Updated {formatDateTime(globalUpdatedAt)}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-8 w-16" />
            </div>
          ))}
        </div>
      ) : error || !overview ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 p-5 text-sm text-slate-500">
          System overview is temporarily unavailable.
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Platforms Connected" value={formatNumber(overview.platformsConnected)} />
          <StatTile label="Active Integrations" value={formatNumber(overview.activeIntegrations)} />
          <StatTile label="Active Campaigns" value={formatNumber(overview.activeCampaigns)} />
          <StatTile label="Total Content Assets" value={formatNumber(overview.totalContentAssets)} />
          <StatTile label="Active Users" value={formatNumber(overview.activeUsers)} />
        </div>
      )}
    </div>
  );
}

export default function SystemStateDashboard({
  companyId,
  variant = 'page',
}: {
  companyId: string;
  variant?: 'page' | 'embedded';
}) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pageVisible = usePageVisibility();
  const refreshStartedAt = useRef<number | null>(null);

  const overview = useSystemStateSection(companyId, 'overview', refreshTick);
  const integrationStatus = useSystemStateSection(companyId, 'integrationStatus', refreshTick);
  const trafficState = useSystemStateSection(companyId, 'trafficState', refreshTick);
  const systemUsage = useSystemStateSection(companyId, 'systemUsage', refreshTick);
  const contentState = useSystemStateSection(companyId, 'contentState', refreshTick);
  const campaignState = useSystemStateSection(companyId, 'campaignState', refreshTick);
  const engagementState = useSystemStateSection(companyId, 'engagementState', refreshTick);
  const billingAccount = useSystemStateSection(companyId, 'billingAccount', refreshTick);
  const intelligenceActivity = useSystemStateSection(companyId, 'intelligenceActivity', refreshTick);

  useEffect(() => {
    if (!pageVisible) return undefined;

    const interval = window.setInterval(() => {
      refreshStartedAt.current = Date.now();
      setRefreshing(true);
      setRefreshTick((value) => value + 1);
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [pageVisible]);

  useEffect(() => {
    if (!refreshing || refreshStartedAt.current == null) return;

    const sections = [
      overview,
      integrationStatus,
      trafficState,
      systemUsage,
      contentState,
      campaignState,
      engagementState,
      billingAccount,
      intelligenceActivity,
    ];

    const allSettled = sections.every((section) => !section.loading);
    if (!allSettled) return;

    setRefreshing(false);
    refreshStartedAt.current = null;
  }, [
    refreshing,
    overview,
    integrationStatus,
    trafficState,
    systemUsage,
    contentState,
    campaignState,
    engagementState,
    billingAccount,
    intelligenceActivity,
  ]);

  const triggerRefresh = () => {
    refreshStartedAt.current = Date.now();
    setRefreshing(true);
    setRefreshTick((value) => value + 1);
  };

  const contentDonut = useMemo(() => {
    if (!contentState.data) return [];
    return [
      { name: 'Blogs', value: contentState.data.byType.blogs },
      { name: 'Carousels', value: contentState.data.byType.carousels },
      { name: 'Banners', value: contentState.data.byType.banners },
      { name: 'Other', value: contentState.data.byType.other },
    ].filter((item) => item.value > 0);
  }, [contentState.data]);

  const trafficSources = useMemo(() => {
    if (!trafficState.data) return [];
    return trafficState.data.topSources.map((row) => ({
      source: row.source.replace(/^\w/, (letter) => letter.toUpperCase()),
      sessions: row.sessions,
    }));
  }, [trafficState.data]);

  const billingUsage = useMemo(() => {
    if (!billingAccount.data) return [];
    return billingAccount.data.usage.map((row) => ({
      ...row,
      pct: percentage(row.used, row.limit),
    }));
  }, [billingAccount.data]);

  const globalUpdatedAt =
    overview.globalUpdatedAt ||
    integrationStatus.globalUpdatedAt ||
    trafficState.globalUpdatedAt ||
    systemUsage.globalUpdatedAt ||
    contentState.globalUpdatedAt ||
    campaignState.globalUpdatedAt ||
    engagementState.globalUpdatedAt ||
    billingAccount.globalUpdatedAt ||
    intelligenceActivity.globalUpdatedAt;

  const featureFlags =
    overview.featureFlags ||
    integrationStatus.featureFlags ||
    trafficState.featureFlags ||
    systemUsage.featureFlags ||
    contentState.featureFlags ||
    campaignState.featureFlags ||
    engagementState.featureFlags ||
    billingAccount.featureFlags ||
    intelligenceActivity.featureFlags;

  return (
    <div className={variant === 'page' ? 'space-y-6' : 'space-y-5'}>
      <TopStrip
        overview={overview.data}
        loading={overview.loading}
        error={overview.error}
        onRefresh={triggerRefresh}
        refreshing={refreshing}
        globalUpdatedAt={globalUpdatedAt}
        variant={variant}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/campaigns" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950">
          Campaigns
        </Link>
        <Link href="/content" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950">
          Content
        </Link>
        <Link href="/engagement" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950">
          Engagement
        </Link>
        <Link href="/settings/integrations" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950">
          Integrations
        </Link>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <SectionShell
          title="Traffic State"
          description="Traffic metrics are shown only when Google Analytics data is connected."
          lastUpdated={trafficState.lastUpdated}
          linkHref="/settings/integrations"
          linkLabel="Manage integrations"
        >
          {!featureFlags?.trafficState ? (
            <EmptyState
              title="Traffic data is not enabled"
              body="This workspace does not currently expose traffic-state data."
            />
          ) : trafficState.loading ? (
            <SectionSkeleton />
          ) : trafficState.error || !trafficState.data ? (
            <EmptyState
              title="Traffic data is temporarily unavailable"
              body="Traffic state will appear here again once the analytics service responds."
            />
          ) : trafficState.data.enabled ? (
            <div className="flex min-w-0 flex-col space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label="Sessions (7d)" value={formatNumber(trafficState.data.sessions7d)} />
                <StatTile label="Sessions (30d)" value={formatNumber(trafficState.data.sessions30d)} />
                <StatTile label="Users (30d)" value={formatNumber(trafficState.data.users30d)} />
              </div>
              <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                <div className={SURFACE_CARD}>
                  <div className="mb-3 text-sm font-medium text-slate-600">Sessions trend</div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trafficState.data.trend}>
                        <XAxis dataKey="label" tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                        <YAxis tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="sessions" stroke={CHART_THEME.primary} strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="users" stroke={CHART_THEME.secondary} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className={SURFACE_CARD}>
                  <div className="mb-3 text-sm font-medium text-slate-600">Top traffic sources</div>
                  <div className="space-y-3">
                    {trafficSources.map((row) => (
                      <div key={row.source} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-900">{row.source}</span>
                          <span className="text-sm text-slate-500">{formatNumber(row.sessions)} sessions</span>
                        </div>
                      </div>
                    ))}
                    {trafficSources.length === 0 ? (
                      <EmptyState
                        title="No traffic sources yet"
                        body="Traffic source rows will populate here once synced sessions are available."
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Connect Google Analytics to view traffic data"
              body="Traffic state appears automatically here once Google Analytics is connected and session data starts syncing."
              ctaLabel="Connect Integration"
              ctaHref="/settings/integrations"
            />
          )}
        </SectionShell>

        <SectionShell
          title="API / Integration Health"
          description="Current API connection state and last successful sync time."
          lastUpdated={integrationStatus.lastUpdated}
          linkHref="/settings/integrations"
          linkLabel="Open integrations"
        >
          {integrationStatus.loading ? (
            <SectionSkeleton chart={false} stats={2} />
          ) : integrationStatus.error || !integrationStatus.data ? (
            <EmptyState
              title="Integration health is temporarily unavailable"
              body="API status will reappear here when integration metadata finishes loading."
            />
          ) : integrationStatus.data.apis.length === 0 ? (
            <EmptyState
              title="No integrations configured yet"
              body="Connected APIs and sync health will appear here after setup."
              ctaLabel="Connect Integration"
              ctaHref="/settings/integrations"
            />
          ) : (
            <div className="space-y-3">
              {integrationStatus.data.apis.map((api) => (
                <div key={api.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900">{api.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{api.category}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${STATUS_STYLES[api.status]}`}>
                      {statusLabel(api.status)}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Last sync: {formatDateTime(api.lastSyncAt)}</div>
                </div>
              ))}
            </div>
          )}
        </SectionShell>
      </div>

      <SectionShell
        title="Platform State"
        description="Per-platform connection state, publishing volume, and raw engagement counts."
        lastUpdated={integrationStatus.lastUpdated}
        linkHref="/settings/integrations"
        linkLabel="View platform setup"
      >
        <div className="clear-both min-w-0">
        {!featureFlags?.platformState ? (
          <EmptyState
            title="Platform state is not enabled"
            body="This workspace does not currently expose platform-level system state."
          />
        ) : integrationStatus.loading ? (
          <SectionSkeleton chart={false} stats={3} />
        ) : integrationStatus.error || !integrationStatus.data ? (
          <EmptyState
            title="Platform state is temporarily unavailable"
            body="Platform connectivity will reappear here when social account data finishes loading."
          />
        ) : integrationStatus.data.platforms.length === 0 ? (
          <EmptyState
            title="No social platforms connected yet"
            body="Connected social accounts will appear here with publishing volume and sync health."
            ctaLabel="Connect Integration"
            ctaHref="/settings/integrations"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {integrationStatus.data.platforms.map((platform) => (
              <div key={platform.key} className={SURFACE_CARD}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-950">{platform.label}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {platform.accountCount} connected account{platform.accountCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${STATUS_STYLES[platform.status]}`}>
                    {statusLabel(platform.status)}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Posts published</div>
                    <div className="mt-2 text-xl font-semibold text-slate-950">{formatNumber(platform.postsPublished)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Engagement</div>
                    <div className="mt-2 text-xl font-semibold text-slate-950">{formatNumber(platform.engagementCount)}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Posts over time</div>
                  <SmallLineChart data={platform.trend} color={platform.status === 'error' ? CHART_THEME.tertiary : CHART_THEME.primary} />
                </div>
                <div className="mt-3 text-xs text-slate-500">Last sync: {formatDateTime(platform.lastSyncAt)}</div>
              </div>
            ))}
          </div>
        )}
        </div>
      </SectionShell>

      <SectionShell
        title="System Usage"
        description="Operational activity over time across campaigns, content, and publishing."
        lastUpdated={systemUsage.lastUpdated}
        linkHref="/campaigns"
        linkLabel="Open campaigns"
      >
        {systemUsage.loading ? (
          <SectionSkeleton />
        ) : systemUsage.error || !systemUsage.data ? (
          <EmptyState
            title="Usage data is temporarily unavailable"
            body="System activity charts will return here once activity streams finish loading."
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-3">
            <div className={SURFACE_CARD}>
              <div className="mb-3 text-sm font-medium text-slate-600">Campaigns created</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={systemUsage.data.campaignsCreatedTrend}>
                    <XAxis dataKey="label" tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <YAxis tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill={CHART_THEME.primary} radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className={SURFACE_CARD}>
              <div className="mb-3 text-sm font-medium text-slate-600">Content created</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={systemUsage.data.contentCreatedTrend}>
                    <XAxis dataKey="label" tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <YAxis tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke={CHART_THEME.secondary} strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className={SURFACE_CARD}>
              <div className="mb-3 text-sm font-medium text-slate-600">Posts published</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={systemUsage.data.postsPublishedTrend}>
                    <XAxis dataKey="label" tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <YAxis tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke={CHART_THEME.tertiary} strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </SectionShell>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionShell
          title="Content State"
          description="Current content inventory and distribution by asset type."
          lastUpdated={contentState.lastUpdated}
          linkHref="/content"
          linkLabel="Open content"
        >
          {contentState.loading ? (
            <SectionSkeleton />
          ) : contentState.error || !contentState.data ? (
            <EmptyState
              title="Content state is temporarily unavailable"
              body="Content inventory and asset mix will reappear here once content metadata finishes loading."
            />
          ) : contentState.data.totalContent === 0 ? (
            <EmptyState
              title="No content assets yet"
              body="Created and published assets will appear here as content starts flowing through the system."
              ctaLabel="Open content workspace"
              ctaHref="/content"
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className={SURFACE_CARD}>
                <div className="mb-3 text-sm font-medium text-slate-600">Asset mix</div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={contentDonut}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={95}
                        paddingAngle={3}
                      >
                        {contentDonut.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_THEME.pie[index % CHART_THEME.pie.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <StatTile label="Total content" value={formatNumber(contentState.data.totalContent)} />
                <StatTile label="Publishing / week" value={String(contentState.data.publishingFrequencyPerWeek)} />
                <StatTile label="Draft" value={formatNumber(contentState.data.draftCount)} />
                <StatTile label="Published" value={formatNumber(contentState.data.publishedCount)} />
                <StatTile label="Blogs" value={formatNumber(contentState.data.byType.blogs)} />
                <StatTile label="Carousels" value={formatNumber(contentState.data.byType.carousels)} />
                <StatTile label="Banners" value={formatNumber(contentState.data.byType.banners)} />
                <StatTile label="Other" value={formatNumber(contentState.data.byType.other)} />
              </div>
            </div>
          )}
        </SectionShell>

        <SectionShell
          title="Campaign State"
          description="Current campaign state and overall campaign volume trend."
          lastUpdated={campaignState.lastUpdated}
          linkHref="/campaigns"
          linkLabel="View campaigns"
        >
          {campaignState.loading ? (
            <SectionSkeleton />
          ) : campaignState.error || !campaignState.data ? (
            <EmptyState
              title="Campaign state is temporarily unavailable"
              body="Campaign counts and volume trends will return here once campaign data finishes loading."
            />
          ) : (
            <>
              <div className="mb-5 grid gap-4 sm:grid-cols-3">
                <StatTile label="Active" value={formatNumber(campaignState.data.active)} />
                <StatTile label="Paused" value={formatNumber(campaignState.data.paused)} />
                <StatTile label="Completed" value={formatNumber(campaignState.data.completed)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className={`${SURFACE_CARD} lg:col-span-2`}>
                  <div className="mb-3 text-sm font-medium text-slate-600">Campaign volume trend</div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={campaignState.data.volumeTrend}>
                        <XAxis dataKey="label" tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                        <YAxis tick={{ fill: CHART_THEME.gridText, fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill={CHART_THEME.quaternary} radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="grid gap-4">
                  <StatTile label="Tracked spend" value={formatCurrency(campaignState.data.totalSpend)} />
                  <StatTile label="Reach" value={formatNumber(campaignState.data.totalReach)} />
                  <StatTile label="Impressions" value={formatNumber(campaignState.data.totalImpressions)} />
                </div>
              </div>
            </>
          )}
        </SectionShell>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionShell
          title="Engagement Snapshot"
          description="Current conversation volume and pending response load."
          lastUpdated={engagementState.lastUpdated}
          linkHref="/engagement"
          linkLabel="Open engagement"
        >
          {engagementState.loading ? (
            <SectionSkeleton chart={false} stats={3} />
          ) : engagementState.error || !engagementState.data ? (
            <EmptyState
              title="Engagement state is temporarily unavailable"
              body="Conversation counts will reappear here once engagement telemetry finishes loading."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <StatTile label="Conversations" value={formatNumber(engagementState.data.totalConversations)} />
              <StatTile label="Unanswered" value={formatNumber(engagementState.data.unansweredConversations)} />
              <StatTile label="Response volume" value={formatNumber(engagementState.data.responseVolume)} />
            </div>
          )}
        </SectionShell>

        <SectionShell
          title="Billing / Account"
          description="Plan, usage versus limits, and current billing state."
          lastUpdated={billingAccount.lastUpdated}
        >
          {!featureFlags?.billingAccount ? (
            <EmptyState
              title="Billing state is not enabled"
              body="Plan and usage details are not currently exposed for this workspace."
            />
          ) : billingAccount.loading ? (
            <SectionSkeleton chart={false} stats={1} />
          ) : billingAccount.error || !billingAccount.data ? (
            <EmptyState
              title="Billing data is temporarily unavailable"
              body="Plan and usage details will return here once account data finishes loading."
            />
          ) : (
            <>
              <div className={SURFACE_CARD}>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Plan</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{billingAccount.data.plan}</div>
                <div className="mt-2 text-sm text-slate-500">
                  Payment status:{' '}
                  <span className="font-medium text-slate-700">
                    {billingAccount.data.paymentStatus === 'active'
                      ? 'Active'
                      : billingAccount.data.paymentStatus === 'free'
                        ? 'Free plan'
                        : 'Not configured'}
                  </span>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {billingUsage.map((item) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700">{item.label}</span>
                      <span className="text-sm text-slate-500">
                        {item.limit != null ? `${formatNumber(item.used)} / ${formatNumber(item.limit)}` : formatNumber(item.used)}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-700"
                        style={{ width: `${item.pct ?? 18}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionShell>

        <SectionShell
          title="Intelligence Activity"
          description="Bridge into Intelligence and Reports without surfacing recommendations here."
          lastUpdated={intelligenceActivity.lastUpdated}
        >
          {!featureFlags?.intelligenceActivity ? (
            <EmptyState
              title="Intelligence activity is not enabled"
              body="Recommendation and report counts are not currently exposed for this workspace."
            />
          ) : intelligenceActivity.loading ? (
            <SectionSkeleton chart={false} stats={2} />
          ) : intelligenceActivity.error || !intelligenceActivity.data ? (
            <EmptyState
              title="Intelligence activity is temporarily unavailable"
              body="Counts and report timestamps will reappear here once the intelligence bridge finishes loading."
            />
          ) : (
            <>
              <div className="grid gap-4">
                <StatTile label="Recommendations" value={formatNumber(intelligenceActivity.data.recommendationsCount)} />
                <StatTile label="Reports" value={formatNumber(intelligenceActivity.data.reportsCount)} />
                <div className={SURFACE_CARD}>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Last report run</div>
                  <div className="mt-2 text-sm font-medium text-slate-700">{formatDateTime(intelligenceActivity.data.lastReportRun)}</div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/recommendations"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  <Globe2 className="h-4 w-4" />
                  View Intelligence
                </Link>
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  <FileText className="h-4 w-4" />
                  View Reports
                </Link>
              </div>
            </>
          )}
        </SectionShell>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3 text-slate-700">
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">Versioned API</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">{API_ENDPOINT}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3 text-slate-700">
            <Activity className="h-4 w-4" />
            <span className="text-sm font-medium">Auto refresh</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Every 60 seconds while this tab is active.</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3 text-slate-700">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium">Partial loading</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Each section refreshes independently with its own empty and loading state.</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3 text-slate-700">
            <BarChart3 className="h-4 w-4" />
            <span className="text-sm font-medium">Feature flags</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {featureFlags
              ? `${Object.entries(featureFlags).filter(([, enabled]) => enabled).length} enabled for this workspace.`
              : 'Flags load with section metadata.'}
          </p>
        </div>
      </div>
    </div>
  );
}
