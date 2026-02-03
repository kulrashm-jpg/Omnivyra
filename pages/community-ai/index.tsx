import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import type { BrandProfile } from '../../components/community-ai/types';

type DashboardResponse = {
  priority_items: {
    underperforming_posts: any[];
    unanswered_comments: any[];
    pending_actions: any[];
    influencer_opportunities: any[];
    network_opportunities: any[];
  };
  platform_overview: Array<{
    platform: string;
    engagement_score: number | null;
    pending_actions: number;
    best_content_type: string | null;
    alerts: string[];
  }>;
  content_type_summary: Array<{
    content_type: string;
    engagement_score: number | null;
  }>;
  action_summary: {
    pending: number;
    scheduled: number;
    completed: number;
    skipped: number;
  };
};

type MetricsResponse = {
  total_actions: number;
  actions_by_status: {
    pending: number;
    approved: number;
    scheduled: number;
    executed: number;
    failed: number;
    skipped: number;
  };
  actions_by_risk: {
    low: number;
    medium: number;
    high: number;
  };
  last_24h_executions: number;
  last_24h_failures: number;
  scheduler_running: boolean;
  last_execution_at: string | null;
};

type NotificationItem = {
  id: string;
  action_id: string | null;
  event_type: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type ContentKpiResponse = {
  by_platform: Array<{
    platform: string;
    total_posts: number;
    avg_likes: number;
    avg_comments: number;
    avg_shares: number;
    goal_hit_rate: number;
    underperforming_count: number;
  }>;
  by_content_type: Array<{
    content_type: string;
    total_posts: number;
    avg_engagement: number;
    goal_hit_rate: number;
  }>;
};

type TrendItem = {
  platform: string;
  content_type: string;
  metric: string;
  previous_avg: number;
  current_avg: number;
  delta_percent: number;
  trend: 'up' | 'down' | 'flat';
};

type AnomalyItem = {
  post_id: string;
  platform: string;
  content_type: string;
  metric: string;
  value: number;
  expected_range: { min: number; max: number };
  severity: 'low' | 'medium' | 'high';
  reason: string;
};

export default function CommunityAiHome() {
  const { selectedCompanyId } = useCompanyContext();
  const tenantId = selectedCompanyId || '';

  const [profile] = useState<BrandProfile>({
    tenant_id: tenantId,
    organization_id: tenantId,
    account_name: '',
    industry: '',
    description: '',
    target_audience: '',
    brand_voice: '',
  });
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [contentKpis, setContentKpis] = useState<ContentKpiResponse | null>(null);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      tenant_id: tenantId,
      organization_id: tenantId,
      profile,
      dashboard,
      metrics,
      notifications,
      content_kpis: contentKpis,
      trends,
      anomalies,
    }),
    [tenantId, profile, dashboard, metrics, notifications, contentKpis, trends, anomalies]
  );

  useEffect(() => {
    const loadDashboard = async () => {
      if (!tenantId) {
        setDashboard(null);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(
          `/api/community-ai/dashboard?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load dashboard');
        }
        const data = await response.json();
        setDashboard(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };
    loadDashboard();
  }, [tenantId]);

  useEffect(() => {
    const loadMetrics = async () => {
      if (!tenantId) {
        setMetrics(null);
        return;
      }
      setMetricsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(
          `/api/community-ai/metrics?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load metrics');
        }
        const data = await response.json();
        setMetrics(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load metrics');
      } finally {
        setMetricsLoading(false);
      }
    };
    loadMetrics();
  }, [tenantId]);

  useEffect(() => {
    const loadNotifications = async () => {
      if (!tenantId) {
        setNotifications([]);
        return;
      }
      setNotificationsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(
          `/api/community-ai/notifications?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load notifications');
        }
        const data = await response.json();
        setNotifications(data?.notifications || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load notifications');
      } finally {
        setNotificationsLoading(false);
      }
    };
    loadNotifications();
  }, [tenantId]);

  useEffect(() => {
    const loadContentKpis = async () => {
      if (!tenantId) {
        setContentKpis(null);
        return;
      }
      setKpisLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(
          `/api/community-ai/content-kpis?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load content KPIs');
        }
        const data = await response.json();
        setContentKpis(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load content KPIs');
      } finally {
        setKpisLoading(false);
      }
    };
    loadContentKpis();
  }, [tenantId]);

  useEffect(() => {
    const loadTrends = async () => {
      if (!tenantId) {
        setTrends([]);
        setAnomalies([]);
        return;
      }
      setTrendsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(
          `/api/community-ai/trends?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load trends');
        }
        const data = await response.json();
        setTrends(data?.trends || []);
        setAnomalies(data?.anomalies || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load trends');
      } finally {
        setTrendsLoading(false);
      }
    };
    loadTrends();
  }, [tenantId]);

  const attentionCounts = useMemo(() => {
    const priority = dashboard?.priority_items;
    return {
      underperforming: priority?.underperforming_posts?.length ?? 0,
      unanswered: priority?.unanswered_comments?.length ?? 0,
      pending_actions: priority?.pending_actions?.length ?? 0,
      opportunities:
        (priority?.influencer_opportunities?.length ?? 0) +
        (priority?.network_opportunities?.length ?? 0),
    };
  }, [dashboard]);

  return (
    <CommunityAiLayout title="Community AI Command Center" context={context}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Monitoring & KPI Overview">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 text-sm">
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Action Overview</div>
            <div className="text-lg font-semibold text-gray-900">
              {metrics?.total_actions ?? 0}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Executed today: {metrics?.last_24h_executions ?? 0}
            </div>
            <div className="text-xs text-gray-500">Failed today: {metrics?.last_24h_failures ?? 0}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Risk Overview</div>
            <div className="text-xs text-gray-500 mt-2">Low: {metrics?.actions_by_risk.low ?? 0}</div>
            <div className="text-xs text-gray-500">Medium: {metrics?.actions_by_risk.medium ?? 0}</div>
            <div className="text-xs text-gray-500">High: {metrics?.actions_by_risk.high ?? 0}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">System Health</div>
            <div className="text-xs text-gray-500 mt-2">
              Scheduler running:{' '}
              {metricsLoading ? '—' : metrics?.scheduler_running ? 'yes' : 'no'}
            </div>
            <div className="text-xs text-gray-500">
              Last execution: {metrics?.last_execution_at ?? '—'}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Attention Needed</div>
            <Link
              href={{
                pathname: '/community-ai/actions',
                query: tenantId
                  ? { status: 'failed', tenant_id: tenantId, organization_id: tenantId }
                  : { status: 'failed' },
              }}
              className="text-xs text-indigo-600 mt-2 block"
            >
              Failed actions: {metrics?.actions_by_status.failed ?? 0}
            </Link>
            <Link
              href={{
                pathname: '/community-ai/actions',
                query: tenantId
                  ? { status: 'pending', risk: 'high', tenant_id: tenantId, organization_id: tenantId }
                  : { status: 'pending', risk: 'high' },
              }}
              className="text-xs text-indigo-600"
            >
              High-risk pending: {metrics?.actions_by_risk.high ?? 0}
            </Link>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Notifications & Alerts">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-600">
            Unread: {notifications?.length ?? 0}
          </div>
          <Link
            href={{
              pathname: '/community-ai/actions',
              query: tenantId
                ? { tenant_id: tenantId, organization_id: tenantId }
                : undefined,
            }}
            className="text-xs text-indigo-600"
          >
            View Action Center
          </Link>
        </div>
        {notificationsLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!notificationsLoading && notifications.length === 0 && (
          <div className="text-sm text-gray-400">No unread notifications.</div>
        )}
        <div className="space-y-2">
          {notifications.slice(0, 5).map((note) => (
            <div key={note.id} className="text-sm text-gray-700">
              <div className="font-semibold">{note.event_type}</div>
              <div className="text-xs text-gray-500">{note.message}</div>
              <div className="text-xs text-gray-400">{note.created_at}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Platform Performance">
        {kpisLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!kpisLoading && (!contentKpis || contentKpis.by_platform.length === 0) && (
          <div className="text-sm text-gray-400">No platform KPI data yet.</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {(contentKpis?.by_platform || []).map((entry) => (
            <Link
              key={entry.platform}
              href={{
                pathname: '/community-ai/[platform]',
                query: tenantId
                  ? { platform: entry.platform, tenant_id: tenantId, organization_id: tenantId }
                  : { platform: entry.platform },
              }}
              className="border rounded-lg p-4 hover:border-indigo-300 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{entry.platform}</div>
              <div className="text-xs text-gray-500 mt-1">
                Goal hit rate: {entry.goal_hit_rate}%
              </div>
              <div className="text-xs text-gray-500">
                Underperforming: {entry.underperforming_count}
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Content Type Performance">
        {kpisLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!kpisLoading && (!contentKpis || contentKpis.by_content_type.length === 0) && (
          <div className="text-sm text-gray-400">No content KPI data yet.</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {(contentKpis?.by_content_type || []).map((entry) => (
            <div key={entry.content_type} className="border rounded-lg p-4">
              <div className="text-xs text-gray-500">{entry.content_type}</div>
              <div className="text-xs text-gray-500 mt-1">Goal hit rate: {entry.goal_hit_rate}%</div>
              <div className="text-xs text-gray-500">Avg engagement: {entry.avg_engagement}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Trends">
        {trendsLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!trendsLoading && trends.length === 0 && (
          <div className="text-sm text-gray-400">No trend data yet.</div>
        )}
        <div className="space-y-2 text-sm">
          {trends
            .slice()
            .sort((a, b) => Math.abs(b.delta_percent) - Math.abs(a.delta_percent))
            .slice(0, 5)
            .map((trend, index) => (
              <div key={`${trend.platform}-${trend.content_type}-${trend.metric}-${index}`}>
                <Link
                  href={{
                    pathname: '/community-ai/[platform]',
                    query: tenantId
                      ? {
                          platform: trend.platform,
                          tenant_id: tenantId,
                          organization_id: tenantId,
                        }
                      : { platform: trend.platform },
                  }}
                  className="text-indigo-600 text-xs"
                >
                  {trend.platform}
                </Link>
                <div className="text-xs text-gray-500">
                  {trend.content_type} • {trend.metric} • {trend.trend} ({trend.delta_percent}%)
                </div>
              </div>
            ))}
        </div>
      </SectionCard>

      <SectionCard title="Anomalies / Attention Needed">
        {trendsLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!trendsLoading && anomalies.length === 0 && (
          <div className="text-sm text-gray-400">No anomalies detected.</div>
        )}
        <div className="space-y-2 text-sm">
          {anomalies
            .filter((item) => item.severity === 'high')
            .slice(0, 5)
            .map((item, index) => (
              <div key={`${item.post_id}-${item.metric}-${index}`}>
                <Link
                  href={{
                    pathname: '/community-ai/[platform]/[postId]',
                    query: tenantId
                      ? {
                          platform: item.platform,
                          postId: item.post_id,
                          tenant_id: tenantId,
                          organization_id: tenantId,
                        }
                      : { platform: item.platform, postId: item.post_id },
                  }}
                  className="text-indigo-600 text-xs"
                >
                  {item.platform} • {item.content_type}
                </Link>
                <div className="text-xs text-gray-500">
                  {item.metric}: {item.value} ({item.reason})
                </div>
              </div>
            ))}
        </div>
      </SectionCard>

      <SectionCard title="Needs Attention Now">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Underperforming posts</div>
            <div className="text-lg font-semibold text-gray-900">
              {attentionCounts.underperforming}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Unanswered comments</div>
            <div className="text-lg font-semibold text-gray-900">{attentionCounts.unanswered}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Pending actions</div>
            <div className="text-lg font-semibold text-gray-900">{attentionCounts.pending_actions}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Opportunities</div>
            <div className="text-lg font-semibold text-gray-900">{attentionCounts.opportunities}</div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Platform Overview">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {(dashboard?.platform_overview || []).map((platform) => (
            <Link
              key={platform.platform}
              href={{
                pathname: '/community-ai/[platform]',
                query: tenantId
                  ? { platform: platform.platform, tenant_id: tenantId, organization_id: tenantId }
                  : { platform: platform.platform },
              }}
              className="border rounded-lg p-4 hover:border-indigo-300 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{platform.platform}</div>
              <div className="text-xs text-gray-500 mt-1">
                Engagement score: {platform.engagement_score ?? '—'}
              </div>
              <div className="text-xs text-gray-500">Pending actions: {platform.pending_actions}</div>
              <div className="text-xs text-gray-500">
                Best content type: {platform.best_content_type ?? '—'}
              </div>
              <div className="text-xs text-gray-500">
                Alerts: {platform.alerts?.length ?? 0}
              </div>
            </Link>
          ))}
          {!isLoading && (!dashboard || dashboard.platform_overview.length === 0) && (
            <div className="text-sm text-gray-400">No platform data yet.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Content Type Performance">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {(dashboard?.content_type_summary || []).map((entry) => (
            <div key={entry.content_type} className="border rounded-lg p-4">
              <div className="text-xs text-gray-500">{entry.content_type}</div>
              <div className="text-lg font-semibold text-gray-900">
                {entry.engagement_score ?? '—'}
              </div>
            </div>
          ))}
          {!isLoading && (!dashboard || dashboard.content_type_summary.length === 0) && (
            <div className="text-sm text-gray-400">No content type summary yet.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Action Queue Summary">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Pending</div>
            <div className="text-lg font-semibold text-gray-900">
              {dashboard?.action_summary?.pending ?? 0}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Scheduled</div>
            <div className="text-lg font-semibold text-gray-900">
              {dashboard?.action_summary?.scheduled ?? 0}
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500">Completed</div>
            <div className="text-lg font-semibold text-gray-900">
              {dashboard?.action_summary?.completed ?? 0}
            </div>
          </div>
        </div>
      </SectionCard>
    </CommunityAiLayout>
  );
}

