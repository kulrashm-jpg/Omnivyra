import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { MessageSquare } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import type { BrandProfile } from '../../components/community-ai/types';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

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

type ForecastItem = {
  date: string;
  platform: string;
  content_type: string;
  predicted_likes: number;
  predicted_comments: number;
  predicted_shares: number;
  predicted_views: number;
  confidence_level: number;
};

type ForecastRisk = {
  platform: string;
  content_type: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
};

type WebhookItem = {
  id: string;
  event_type: string;
  webhook_url: string;
  is_active: boolean;
  created_at: string;
};

export default function CommunityAiHome() {
  const router = useRouter();
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
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [forecastRisks, setForecastRisks] = useState<ForecastRisk[]>([]);
  const [insights, setInsights] = useState<{
    summary_insight: string;
    key_findings: any[];
    recommended_actions: any[];
    risks: any;
    confidence_level: number;
  } | null>(null);
  const [showInsightDetails, setShowInsightDetails] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [canManageWebhooks, setCanManageWebhooks] = useState(false);
  const [webhookEventType, setWebhookEventType] = useState('failed');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
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
      forecast,
      forecast_risks: forecastRisks,
      webhooks,
      insights,
    }),
    [
      tenantId,
      profile,
      dashboard,
      metrics,
      notifications,
      contentKpis,
      trends,
      anomalies,
      forecast,
      forecastRisks,
      webhooks,
      insights,
    ]
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
        const response = await fetchWithAuth(
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
        const response = await fetchWithAuth(
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
        const response = await fetchWithAuth(
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
        const response = await fetchWithAuth(
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
        const response = await fetchWithAuth(
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

  useEffect(() => {
    const loadForecast = async () => {
      if (!tenantId) {
        setForecast([]);
        setForecastRisks([]);
        return;
      }
      setForecastLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/forecast?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load forecast');
        }
        const data = await response.json();
        setForecast(data?.forecast || []);
        setForecastRisks(data?.risk_flags || []);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load forecast');
      } finally {
        setForecastLoading(false);
      }
    };
    loadForecast();
  }, [tenantId]);

  useEffect(() => {
    const loadInsights = async () => {
      if (!tenantId) {
        setInsights(null);
        return;
      }
      try {
        const response = await fetchWithAuth(
          `/api/community-ai/insights?tenant_id=${encodeURIComponent(
            tenantId
          )}&organization_id=${encodeURIComponent(tenantId)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Failed to load insights');
        }
        const data = await response.json();
        setInsights(data);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Failed to load insights');
      }
    };
    loadInsights();
  }, [tenantId]);

  const handleExport = async (format: 'pdf' | 'csv') => {
    if (!tenantId) return;
    try {
      const response = await fetchWithAuth(
        `/api/community-ai/export?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}&type=full-report&format=${format}`
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to export report');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `community-ai-report.${format}`;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to export report');
    }
  };

  const forecastPreview = useMemo(() => {
    const grouped = new Map<string, ForecastItem[]>();
    forecast.forEach((item) => {
      const key = `${item.platform}::${item.content_type}`;
      const bucket = grouped.get(key) || [];
      bucket.push(item);
      grouped.set(key, bucket);
    });
    const previews = Array.from(grouped.values()).map((items) => {
      const sorted = items.slice().sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const total = (entry: ForecastItem) =>
        entry.predicted_likes + entry.predicted_comments + entry.predicted_shares + entry.predicted_views;
      const delta = total(last) - total(first);
      return {
        platform: first.platform,
        content_type: first.content_type,
        predicted_total: total(last),
        trend: delta > 5 ? 'up' : delta < -5 ? 'down' : 'flat',
        confidence: last.confidence_level,
      };
    });
    return previews;
  }, [forecast]);

  const forecastRiskMap = useMemo(() => {
    const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const map = new Map<string, ForecastRisk>();
    forecastRisks.forEach((risk) => {
      const key = `${risk.platform}::${risk.content_type}`;
      const existing = map.get(key);
      if (!existing || severityRank[risk.severity] > severityRank[existing.severity]) {
        map.set(key, risk);
      }
    });
    return map;
  }, [forecastRisks]);

  const loadWebhooks = async () => {
    if (!tenantId) {
      setWebhooks([]);
      setCanManageWebhooks(false);
      return;
    }
    setWebhookLoading(true);
    try {
      const response = await fetchWithAuth(
        `/api/community-ai/webhooks?tenant_id=${encodeURIComponent(
          tenantId
        )}&organization_id=${encodeURIComponent(tenantId)}`
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load webhooks');
      }
      const data = await response.json();
      setWebhooks(data?.webhooks || []);
      setCanManageWebhooks(!!data?.can_manage);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load webhooks');
    } finally {
      setWebhookLoading(false);
    }
  };

  useEffect(() => {
    loadWebhooks();
  }, [tenantId]);

  const handleAddWebhook = async () => {
    if (!tenantId || !webhookUrl) return;
    setWebhookLoading(true);
    try {
      const response = await fetchWithAuth('/api/community-ai/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          event_type: webhookEventType,
          webhook_url: webhookUrl,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to add webhook');
      }
      setWebhookUrl('');
      await loadWebhooks();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to add webhook');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleToggleWebhook = async (id: string, isActive: boolean) => {
    if (!tenantId) return;
    setWebhookLoading(true);
    try {
      const response = await fetchWithAuth('/api/community-ai/webhooks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          id,
          is_active: isActive,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update webhook');
      }
      await loadWebhooks();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update webhook');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!tenantId) return;
    setWebhookLoading(true);
    try {
      const response = await fetchWithAuth('/api/community-ai/webhooks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          organization_id: tenantId,
          id,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to delete webhook');
      }
      await loadWebhooks();
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to delete webhook');
    } finally {
      setWebhookLoading(false);
    }
  };

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

      <SectionCard title="Community Engagement" subtitle="Monitor conversations, identify opportunities, and engage with communities across connected platforms.">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Community Engagement</h3>
              <p className="text-sm text-gray-600 mt-1">
                Monitor conversations, identify opportunities, and engage with communities across connected platforms.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/engagement')}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shrink-0"
          >
            Open Engagement Console
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Monitoring & KPI Overview">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-600">Operational KPIs</div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
              onClick={() => handleExport('pdf')}
            >
              Export PDF
            </button>
            <button
              className="px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
              onClick={() => handleExport('csv')}
            >
              Export CSV
            </button>
          </div>
        </div>
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
          <a href="#webhook-settings" className="text-xs text-indigo-600">
            Manage Webhooks
          </a>
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

      <SectionCard title="Engagement Forecast (Next 7 Days)">
        {forecastLoading && <div className="text-sm text-gray-500">Loading...</div>}
        {!forecastLoading && forecastPreview.length === 0 && (
          <div className="text-sm text-gray-400">No forecast data yet.</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {forecastPreview.slice(0, 6).map((entry) => {
            const risk = forecastRiskMap.get(`${entry.platform}::${entry.content_type}`);
            return (
              <Link
                key={`${entry.platform}-${entry.content_type}`}
                href={{
                  pathname: '/community-ai/forecast',
                  query: tenantId
                    ? { platform: entry.platform, tenant_id: tenantId, organization_id: tenantId }
                    : { platform: entry.platform },
                }}
                className="border rounded-lg p-4 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">{entry.platform}</div>
                  <div className="text-xs text-gray-500">{entry.content_type}</div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Predicted engagement: {Math.round(entry.predicted_total)}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <span>{entry.trend === 'up' ? '↑' : entry.trend === 'down' ? '↓' : '→'}</span>
                  <span>Confidence: {entry.confidence}</span>
                  {risk && (
                    <span
                      className={`px-2 py-0.5 rounded-full border ${
                        risk.severity === 'high'
                          ? 'border-red-200 text-red-600 bg-red-50'
                          : 'border-amber-200 text-amber-600 bg-amber-50'
                      }`}
                      title={risk.reason}
                    >
                      {risk.severity} risk
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
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

      <SectionCard title="AI Insights">
        {!insights && <div className="text-sm text-gray-400">No insights yet.</div>}
        {insights && (
          <div className="space-y-2 text-sm">
            <div className="text-gray-700">{insights.summary_insight || '—'}</div>
            <div className="text-xs text-gray-500">Confidence: {insights.confidence_level}</div>
            <div className="space-y-1">
              {(insights.key_findings || []).slice(0, 3).map((item, index) => (
                <div key={`finding-${index}`} className="text-xs text-gray-600">
                  • {typeof item === 'string' ? item : JSON.stringify(item)}
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {(insights.recommended_actions || []).slice(0, 3).map((item, index) => (
                <div key={`action-${index}`} className="text-xs text-gray-600">
                  • {typeof item === 'string' ? item : JSON.stringify(item)}
                </div>
              ))}
            </div>
            <button
              className="text-xs text-indigo-600"
              onClick={() => setShowInsightDetails(true)}
            >
              View Details
            </button>
          </div>
        )}
      </SectionCard>
      {showInsightDetails && insights && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">AI Insights</h3>
              <button
                className="text-sm text-gray-500"
                onClick={() => setShowInsightDetails(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs text-gray-500">Summary Insight</div>
                <div className="text-gray-700">{insights.summary_insight || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Key Findings</div>
                <ul className="list-disc list-inside text-gray-700">
                  {(insights.key_findings || []).map((item, index) => (
                    <li key={`modal-finding-${index}`}>
                      {typeof item === 'string' ? item : JSON.stringify(item)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs text-gray-500">Recommended Actions</div>
                <ul className="list-disc list-inside text-gray-700">
                  {(insights.recommended_actions || []).map((item, index) => (
                    <li key={`modal-action-${index}`}>
                      {typeof item === 'string' ? item : JSON.stringify(item)}
                    </li>
                  ))}
                </ul>
              </div>
              {insights.risks ? (
                <div>
                  <div className="text-xs text-gray-500">Risks</div>
                  <div className="text-gray-700">
                    {typeof insights.risks === 'string'
                      ? insights.risks
                      : JSON.stringify(insights.risks)}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-gray-500">Confidence Level</div>
                <div className="text-gray-700">{insights.confidence_level}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <SectionCard title="Webhook Integrations" subtitle="Manage external notifications">
        <div id="webhook-settings" className="space-y-3 text-sm">
          {webhookLoading && <div className="text-sm text-gray-500">Loading...</div>}
          {!webhookLoading && webhooks.length === 0 && (
            <div className="text-sm text-gray-400">No webhooks configured.</div>
          )}
          <div className="space-y-2">
            {webhooks.map((hook) => (
              <div key={hook.id} className="border rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500">{hook.event_type}</div>
                  <div className="text-sm text-gray-800">{hook.webhook_url}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-xs text-indigo-600"
                    disabled={!canManageWebhooks || webhookLoading}
                    onClick={() => handleToggleWebhook(hook.id, !hook.is_active)}
                  >
                    {hook.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="text-xs text-red-600"
                    disabled={!canManageWebhooks || webhookLoading}
                    onClick={() => handleDeleteWebhook(hook.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {canManageWebhooks && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="text-xs text-gray-500">Add webhook</div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={webhookEventType}
                  onChange={(event) => setWebhookEventType(event.target.value)}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="failed">failed</option>
                  <option value="high_risk_pending">high_risk_pending</option>
                  <option value="anomaly">anomaly</option>
                  <option value="executed">executed</option>
                </select>
                <input
                  className="border rounded px-2 py-1 text-xs flex-1"
                  placeholder="https://hooks.example.com/..."
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
                <button
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-white"
                  onClick={handleAddWebhook}
                  disabled={webhookLoading || !webhookUrl}
                >
                  Add
                </button>
              </div>
            </div>
          )}
          {!canManageWebhooks && (
            <div className="text-xs text-gray-400">
              You do not have permission to manage webhooks.
            </div>
          )}
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
            {attentionCounts.unanswered > 0 && (
              <button
                type="button"
                onClick={() => router.push('/engagement')}
                className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
              >
                Reply Now →
              </button>
            )}
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

