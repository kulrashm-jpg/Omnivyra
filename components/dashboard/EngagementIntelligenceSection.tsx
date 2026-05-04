import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, MessageSquareMore, Sparkles, TrendingUp } from 'lucide-react';
import EmptyState from '../shared/EmptyState';
import ExamplePreview from '../shared/ExamplePreview';
import { trackActivationEvent } from '../../lib/analytics/activationEvents';

type DashboardResponse = {
  priority_items?: {
    underperforming_posts?: unknown[];
    unanswered_comments?: unknown[];
    pending_actions?: unknown[];
    influencer_opportunities?: unknown[];
    network_opportunities?: unknown[];
  };
  platform_overview?: Array<{
    platform: string;
    engagement_score: number | null;
    pending_actions: number;
    best_content_type: string | null;
    alerts: string[];
  }>;
};

type ContentKpiResponse = {
  by_platform?: Array<{
    platform: string;
    goal_hit_rate: number;
    underperforming_count: number;
  }>;
};

type TrendItem = {
  platform: string;
  content_type: string;
  metric: string;
  delta_percent: number;
  trend: 'up' | 'down' | 'flat';
};

type AnomalyItem = {
  platform: string;
  content_type: string;
  metric: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
};

type InsightsResponse = {
  summary_insight?: string;
  recommended_actions?: Array<{ action?: string; title?: string; recommendation?: string }>;
};

type EngagementIntelligenceSectionProps = {
  companyId: string;
  apiFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

export default function EngagementIntelligenceSection({
  companyId,
  apiFetch,
}: EngagementIntelligenceSectionProps) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [kpis, setKpis] = useState<ContentKpiResponse | null>(null);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const tenantQuery = `tenant_id=${encodeURIComponent(companyId)}&organization_id=${encodeURIComponent(companyId)}`;
      const [dashboardRes, kpiRes, trendsRes, insightsRes] = await Promise.all([
        apiFetch(`/api/community-ai/dashboard?${tenantQuery}`),
        apiFetch(`/api/community-ai/content-kpis?${tenantQuery}`),
        apiFetch(`/api/community-ai/trends?${tenantQuery}`),
        apiFetch(`/api/community-ai/insights?${tenantQuery}`),
      ]);

      const failed = [dashboardRes, kpiRes, trendsRes, insightsRes].find((res) => !res.ok);
      if (failed) throw new Error(`Failed to load engagement intelligence (${failed.status})`);

      const [dashboardJson, kpiJson, trendsJson, insightsJson] = await Promise.all([
        dashboardRes.json(),
        kpiRes.json(),
        trendsRes.json(),
        insightsRes.json(),
      ]);

      setDashboard(dashboardJson);
      setKpis(kpiJson);
      setTrends(Array.isArray(trendsJson?.trends) ? trendsJson.trends : []);
      setAnomalies(Array.isArray(trendsJson?.anomalies) ? trendsJson.anomalies : []);
      setInsights(insightsJson ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load engagement intelligence');
    } finally {
      setLoading(false);
    }
  }, [companyId, apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const attention = useMemo(() => {
    const priority = dashboard?.priority_items;
    return {
      unanswered: priority?.unanswered_comments?.length ?? 0,
      pending: priority?.pending_actions?.length ?? 0,
      opportunities:
        (priority?.influencer_opportunities?.length ?? 0) +
        (priority?.network_opportunities?.length ?? 0),
      underperforming: priority?.underperforming_posts?.length ?? 0,
    };
  }, [dashboard]);

  const topPlatform = useMemo(() => {
    const list = dashboard?.platform_overview ?? [];
    return [...list]
      .sort((a, b) => Number(b.engagement_score ?? -1) - Number(a.engagement_score ?? -1))[0] ?? null;
  }, [dashboard]);

  const topRisk = useMemo(() => {
    const rank = { high: 3, medium: 2, low: 1 };
    return [...anomalies].sort((a, b) => rank[b.severity] - rank[a.severity])[0] ?? null;
  }, [anomalies]);

  const risingTrends = useMemo(
    () => trends.filter((item) => item.trend === 'up').sort((a, b) => b.delta_percent - a.delta_percent).slice(0, 3),
    [trends]
  );

  const topPlatformKpi = useMemo(() => {
    const list = kpis?.by_platform ?? [];
    return [...list].sort((a, b) => b.goal_hit_rate - a.goal_hit_rate)[0] ?? null;
  }, [kpis]);

  const recommendedActions = useMemo(
    () =>
      (insights?.recommended_actions ?? [])
        .map((item) => item.action || item.title || item.recommendation || '')
        .filter(Boolean)
        .slice(0, 3),
    [insights]
  );

  const hasAnySignal = useMemo(() => {
    return (
      attention.unanswered + attention.pending + attention.opportunities + attention.underperforming > 0 ||
      !!topPlatform ||
      !!topPlatformKpi ||
      risingTrends.length > 0 ||
      !!topRisk ||
      !!insights?.summary_insight ||
      recommendedActions.length > 0
    );
  }, [attention, topPlatform, topPlatformKpi, risingTrends.length, topRisk, insights?.summary_insight, recommendedActions.length]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">
            Engagement Intelligence
          </p>
          <h3 className="mt-2 text-xl font-semibold text-gray-900">
            Signals moved out of the engagement console
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            This section keeps the monitoring, trends, risks, and AI summaries that support engagement
            decisions without crowding the live conversation workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/engagement"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Open Engagement Center
          </Link>
          <Link
            href="/engagement/analytics"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View Analytics
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!error && !loading && !hasAnySignal ? (
        <div className="mt-5">
          <EmptyState
            title="Track your first interaction"
            description="As soon as conversations, replies, and performance signals start coming in, this section will turn them into a clear engagement summary."
            primaryAction={{
              label: 'Open Engagement Center',
              onClick: () => {
                trackActivationEvent('empty_state_primary_clicked', {
                  accountId: companyId,
                  context: 'engagement_intelligence',
                });
                window.location.href = '/engagement';
              },
            }}
            secondaryAction={{
              label: 'Try with sample data',
              onClick: () => {
                trackActivationEvent('sample_used', {
                  accountId: companyId,
                  context: 'engagement_intelligence',
                });
                window.location.href = '/engagement';
              },
            }}
            examplePreview={<ExamplePreview variant="engagement" />}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <MessageSquareMore className="h-4 w-4 text-indigo-600" />
            Attention Queue
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">
            {loading ? '...' : attention.unanswered + attention.pending}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {attention.unanswered} unanswered conversations and {attention.pending} pending actions.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <Activity className="h-4 w-4 text-emerald-600" />
            Strongest Platform
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-900">
            {loading ? 'Loading...' : topPlatform?.platform || topPlatformKpi?.platform || 'Waiting for first signal'}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {topPlatform
              ? `Engagement score ${Number(topPlatform.engagement_score ?? 0).toFixed(1)} with ${topPlatform.pending_actions} pending actions.`
              : topPlatformKpi
              ? `Goal hit rate ${Math.round(topPlatformKpi.goal_hit_rate)}%.`
              : 'Connect a channel and publish one post to see which platform is performing best.'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <TrendingUp className="h-4 w-4 text-sky-600" />
            Rising Topics
          </div>
          <div className="mt-3 space-y-2">
            {loading ? (
              <p className="text-sm text-slate-500">Loading...</p>
            ) : risingTrends.length === 0 ? (
              <p className="text-sm text-slate-500">No rising topics yet. Fresh audience activity will surface the first trend here.</p>
            ) : (
              risingTrends.map((item, index) => (
                <div key={`${item.platform}-${item.content_type}-${index}`} className="text-sm text-slate-700">
                  <span className="font-medium">{item.platform}</span>
                  {' · '}
                  {item.content_type}
                  {' · '}
                  +{Math.round(item.delta_percent)}%
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Biggest Risk
          </div>
          <div className="mt-3 text-sm font-medium text-slate-900">
            {loading ? 'Loading...' : topRisk ? `${topRisk.platform} · ${topRisk.metric}` : 'No major anomalies'}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {topRisk ? topRisk.reason : 'No major engagement risk stands out yet. This will light up when a drop or anomaly needs attention.'}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <Sparkles className="h-4 w-4 text-violet-600" />
            AI Summary
          </div>
          <p className="mt-3 text-sm text-gray-700">
            {loading
              ? 'Loading summary...'
              : insights?.summary_insight || 'Your first engagement summary will appear here once the system has enough live conversation signal.'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Recommended Actions
          </div>
          <div className="mt-3 space-y-2">
            {loading ? (
              <p className="text-sm text-gray-500">Loading actions...</p>
            ) : recommendedActions.length === 0 ? (
              <p className="text-sm text-gray-500">No next actions yet. Once signals appear, this will suggest the clearest move to take.</p>
            ) : (
              recommendedActions.map((action, index) => (
                <div key={`${action}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-gray-700">
                  {action}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
