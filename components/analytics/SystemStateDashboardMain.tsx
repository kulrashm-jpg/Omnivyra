/** Part 2/2 of SystemStateDashboard.tsx — verbatim split (barrel preserved; importers unchanged). */
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

import { type DashboardPayload, API_ENDPOINT, REFRESH_INTERVAL_MS, STATUS_STYLES, CHART_THEME, SURFACE_CARD, formatNumber, formatCurrency, formatDateTime, statusLabel, percentage, usePageVisibility, useSystemStateSection, EmptyState, SkeletonBlock, SectionSkeleton, SectionShell, StatTile, SmallLineChart } from './SystemStateDashboardPanels';

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
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile
            category="Platforms"
            label="Ready / Connected"
            value={`${formatNumber(overview.platformsReady)} / ${formatNumber(overview.platformsConnected)}`}
          />
          <StatTile category="Integrations" label="Active" value={formatNumber(overview.activeIntegrations)} />
          <StatTile category="Campaigns" label="Active" value={formatNumber(overview.activeCampaigns)} />
          <StatTile category="Content" label="Total Assets" value={formatNumber(overview.totalContentAssets)} />
          <StatTile category="Users" label="Active" value={formatNumber(overview.activeUsers)} />
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

      <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4">
        <Link
          href="/campaigns"
          className="group inline-flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
        >
          <span className="inline-flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-slate-500 transition group-hover:text-slate-700" />
            Campaigns
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
        </Link>
        <Link
          href="/content"
          className="group inline-flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
        >
          <span className="inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500 transition group-hover:text-slate-700" />
            Content
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
        </Link>
        <Link
          href="/engagement"
          className="group inline-flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
        >
          <span className="inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-500 transition group-hover:text-slate-700" />
            Engagement
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
        </Link>
        <Link
          href="/integrations?focus=data"
          className="group inline-flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
        >
          <span className="inline-flex items-center gap-2">
            <Plug className="h-4 w-4 text-slate-500 transition group-hover:text-slate-700" />
            Integrations
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
        </Link>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <SectionShell
          title="Traffic State"
          description="Traffic metrics are shown only when Google Analytics data is connected."
          lastUpdated={trafficState.lastUpdated}
          linkHref="/integrations?focus=data"
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
              {trafficState.data.degraded ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="font-semibold">Analytics data is degraded</div>
                  <div className="mt-1">
                    {trafficState.data.reason || 'Traffic metrics are available with reduced freshness or confidence.'}
                  </div>
                  <div className="mt-1 text-xs text-amber-700">
                    Last successful ingestion: {formatDateTime(trafficState.data.lastSuccessfulIngestionAt ?? null)}
                    {trafficState.data.latestIngestionStatus ? ` • latest run: ${trafficState.data.latestIngestionStatus}` : ''}
                  </div>
                </div>
              ) : null}
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
              ctaHref="/integrations?focus=data"
            />
          )}
        </SectionShell>

        <SectionShell
          title="API / Integration Health"
          description="Current API connection state and last successful sync time."
          lastUpdated={integrationStatus.lastUpdated}
          linkHref="/integrations?focus=data"
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
              ctaHref="/integrations?focus=data"
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
        linkHref="/integrations?focus=data"
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
            ctaHref="/integrations?focus=data"
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

