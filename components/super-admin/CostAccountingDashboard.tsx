/**
 * Cost Accounting Dashboard
 * Unified view of all cost levers: Usage Costs → Infrastructure Costs → Trends
 * Designed for cost accountability: company-level, activity-level, detailed drill-down
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Zap,
  Globe,
  BarChart3,
  Calendar,
  AlertCircle,
  Loader,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { getAuthToken } from '../../utils/getAuthToken';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CostAccountingData {
  period: {
    name: string;
    start_date: string;
    end_date: string;
    days: number;
  };
  summary: {
    total_monthly_cost_usd: number;
    usage_pct: number;
    system_pct: number;
    daily_run_rate_usd: number;
    projected_monthly_usd: number;
    top_cost_driver: {
      category: string;
      name: string;
      cost_usd: number;
      cost_pct: number;
    };
  };
  usage_costs: {
    total_usd: number;
    by_activity: Array<{
      activity_type: string;
      total_cost_usd: number;
      cost_pct: number;
      usage_volume: number;
      unit_cost: number;
      companies: Array<{ company_id: string; cost_usd: number; cost_pct: number; usage_volume: number }>;
      top_models?: Array<{ model_name: string; cost_usd: number; cost_pct: number; tokens: number }>;
    }>;
    by_company: Array<{
      company_id: string;
      total_cost_usd: number;
      cost_pct: number;
      activities: Array<{ activity_type: string; cost_usd: number; cost_pct: number; usage_volume: number }>;
    }>;
  };
  infrastructure_costs: {
    total_usd: number;
    services: Array<{
      service_name: string;
      monthly_cost_usd: number;
      cost_pct: number;
      details: Record<string, number>;
      notes: string[];
    }>;
  };
  cost_drivers: Array<{
    rank: number;
    category: string;
    description: string;
    impact_usd: number;
    impact_pct: number;
  }>;
  comparison?: {
    previous_period_total: number;
    period_over_period_pct: number;
    trend: 'up' | 'down' | 'flat';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  unit = '$',
  trend,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string;
  value: number;
  unit?: string;
  trend?: { direction: 'up' | 'down' | 'flat'; pct: number };
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`${color} p-2.5 rounded-lg`}>{Icon}</div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-xs font-semibold ${
              trend.direction === 'up'
                ? 'text-red-600'
                : trend.direction === 'down'
                  ? 'text-emerald-600'
                  : 'text-slate-500'
            }`}
          >
            {trend.direction === 'up' && <TrendingUp className="w-4 h-4" />}
            {trend.direction === 'down' && <TrendingDown className="w-4 h-4" />}
            {Math.abs(trend.pct).toFixed(1)}%
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">{title}</p>
      <p className="text-3xl font-bold text-slate-900">
        {unit}
        {value.toFixed(2)}
      </p>
      {subtitle && <p className="text-sm text-slate-600 mt-2">{subtitle}</p>}
    </div>
  );
}

function ActivityCard({
  activity,
  expanded,
  onToggle,
}: {
  activity: CostAccountingData['usage_costs']['by_activity'][0];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 capitalize">{activity.activity_type.replace('_', ' ')}</span>
            <span className="text-sm text-slate-500">({activity.usage_volume.toLocaleString()} tokens)</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xl font-bold text-emerald-600">${activity.total_cost_usd.toFixed(2)}</span>
            <span className="text-sm text-slate-600">{activity.cost_pct.toFixed(1)}% of usage</span>
          </div>
        </div>
        <div className="text-slate-400">
          {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-200 px-5 py-4 bg-slate-50 space-y-4">
          {/* Cost per unit */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Cost per token:</span>
            <span className="text-sm font-mono font-semibold text-slate-900">${activity.unit_cost.toFixed(6)}</span>
          </div>

          {/* Top companies */}
          {activity.companies.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Top Companies</p>
              <div className="space-y-2 bg-white rounded p-3">
                {activity.companies.slice(0, 3).map((comp) => (
                  <div key={comp.company_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 font-mono">{comp.company_id.slice(0, 12)}...</span>
                    <span className="text-slate-900 font-medium">${comp.cost_usd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top models */}
          {activity.top_models && activity.top_models.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Top Models</p>
              <div className="space-y-2 bg-white rounded p-3">
                {activity.top_models.map((model) => (
                  <div key={model.model_name} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{model.model_name}</span>
                    <span className="text-slate-900 font-medium">${model.cost_usd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfrastructureCostCard({
  service,
  expanded,
  onToggle,
}: {
  service: CostAccountingData['infrastructure_costs']['services'][0];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex-1">
          <p className="font-semibold text-slate-900">{service.service_name}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-lg font-bold text-blue-600">${service.monthly_cost_usd.toFixed(2)}</span>
            <span className="text-sm text-slate-600">{service.cost_pct.toFixed(1)}% of infra</span>
          </div>
        </div>
        <div className="text-slate-400">
          {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-5 py-4 bg-slate-50 space-y-3">
          {Object.entries(service.details).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-slate-600 capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="text-sm font-mono font-semibold text-slate-900">${val.toFixed(2)}</span>
            </div>
          ))}
          {service.notes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
              {service.notes.map((note, i) => (
                <p key={i} className="text-sm text-slate-600">
                  • {note}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CostAccountingDashboard() {
  const [data, setData] = useState<CostAccountingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'month' | 'quarter' | 'ytd'>('month');
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set());
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/admin/cost-accounting?period=${period}&compare=true`, {
        headers: { ...headers },
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch cost data');
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleActivity = (activity: string) => {
    const newSet = new Set(expandedActivities);
    if (newSet.has(activity)) {
      newSet.delete(activity);
    } else {
      newSet.add(activity);
    }
    setExpandedActivities(newSet);
  };

  const toggleService = (service: string) => {
    const newSet = new Set(expandedServices);
    if (newSet.has(service)) {
      newSet.delete(service);
    } else {
      newSet.add(service);
    }
    setExpandedServices(newSet);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">Error loading cost data</p>
          <p className="text-sm text-red-700 mt-1">{error}</p>
        </div>
        <button onClick={fetchData} className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Header with period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Cost Accounting</h2>
          <p className="text-sm text-slate-600 mt-1">
            Complete visibility into all cost levers: usage, infrastructure, and trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          {['month', 'quarter', 'ytd'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p as any)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                period === p
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
          <button
            onClick={fetchData}
            className="p-2 rounded-lg hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
            title="Refresh"
          >
            <Calendar className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <SummaryCard
          title="Total Monthly Cost"
          value={data.summary.total_monthly_cost_usd}
          color="bg-orange-100"
          icon={<DollarSign className="w-5 h-5 text-orange-600" />}
          subtitle={`Daily run rate: $${data.summary.daily_run_rate_usd.toFixed(2)}`}
        />
        <SummaryCard
          title="Usage Costs"
          value={data.usage_costs.total_usd}
          color="bg-emerald-100"
          icon={<Zap className="w-5 h-5 text-emerald-600" />}
          subtitle={`${data.summary.usage_pct.toFixed(1)}% of total`}
        />
        <SummaryCard
          title="Infrastructure"
          value={data.infrastructure_costs.total_usd}
          color="bg-blue-100"
          icon={<Globe className="w-5 h-5 text-blue-600" />}
          subtitle={`${data.summary.system_pct.toFixed(1)}% of total`}
        />
        <SummaryCard
          title="Projected Monthly"
          value={data.summary.projected_monthly_usd}
          color="bg-purple-100"
          icon={<BarChart3 className="w-5 h-5 text-purple-600" />}
          subtitle={`Based on ${data.period.days}-day sample`}
        />
      </div>

      {/* Period Info & Comparison */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Period</p>
            <p className="text-lg font-bold text-slate-900">{data.period.name}</p>
            <p className="text-sm text-slate-600 mt-1">
              {new Date(data.period.start_date).toLocaleDateString()} - {new Date(data.period.end_date).toLocaleDateString()}
              <span className="ml-2 text-slate-500">({data.period.days} days)</span>
            </p>
          </div>
          {data.comparison && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Period-over-Period</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900">{Math.abs(data.comparison.period_over_period_pct).toFixed(1)}%</span>
                <span
                  className={`text-sm font-semibold ${
                    data.comparison.trend === 'up'
                      ? 'text-red-600'
                      : data.comparison.trend === 'down'
                        ? 'text-emerald-600'
                        : 'text-slate-600'
                  }`}
                >
                  {data.comparison.trend === 'up' && `↑ Higher than last period`}
                  {data.comparison.trend === 'down' && `↓ Lower than last period`}
                  {data.comparison.trend === 'flat' && `→ Flat vs last period`}
                </span>
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Top Cost Driver</p>
            <p className="text-lg font-bold text-slate-900 capitalize">{data.summary.top_cost_driver.name}</p>
            <p className="text-sm text-slate-600 mt-1">
              ${data.summary.top_cost_driver.cost_usd.toFixed(2)} ({data.summary.top_cost_driver.cost_pct.toFixed(1)}% of total)
            </p>
          </div>
        </div>
      </div>

      {/* Usage Costs Section */}
      <div>
        <div className="mb-6">
          <h3 className="text-xl font-bold text-slate-900">Usage Costs (Variable)</h3>
          <p className="text-sm text-slate-600 mt-2">
            Cost broken down by activity, then company, then model. Click to expand for details.
          </p>
        </div>

        {/* By Activity */}
        <div className="mb-8">
          <h4 className="text-base font-bold text-slate-900 mb-4">By Activity (Business Perspective)</h4>
          <div className="space-y-3">
            {data.usage_costs.by_activity.map((activity) => (
              <ActivityCard
                key={activity.activity_type}
                activity={activity}
                expanded={expandedActivities.has(activity.activity_type)}
                onToggle={() => toggleActivity(activity.activity_type)}
              />
            ))}
          </div>
        </div>

        {/* By Company */}
        <div>
          <h4 className="text-base font-bold text-slate-900 mb-4">By Company (Tenant Perspective)</h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.usage_costs.by_company.slice(0, 6).map((company) => (
              <div key={company.company_id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-sm font-semibold text-slate-900">{company.company_id}</span>
                  <span className="text-xl font-bold text-slate-900">${company.total_cost_usd.toFixed(2)}</span>
                </div>
                <p className="text-sm text-slate-600 mb-4">{company.cost_pct.toFixed(1)}% of usage costs</p>
                {company.activities.length > 0 && (
                  <div className="space-y-2 p-3 bg-slate-50 rounded border border-slate-200">
                    {company.activities.slice(0, 2).map((act) => (
                      <div key={act.activity_type} className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 capitalize">{act.activity_type.replace('_', ' ')}</span>
                        <span className="text-sm font-semibold text-slate-900">${act.cost_usd.toFixed(2)}</span>
                      </div>
                    ))}
                    {company.activities.length > 2 && (
                      <p className="text-sm text-slate-600 mt-2">+{company.activities.length - 2} more activities</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Infrastructure Costs Section */}
      <div>
        <div className="mb-6">
          <h3 className="text-xl font-bold text-slate-900">Infrastructure Costs (Fixed)</h3>
          <p className="text-sm text-slate-600 mt-2">
            Recurring infrastructure expenses: Supabase, Redis, Railway, Vercel. Allocated proportionally to companies.
          </p>
        </div>

        <div className="space-y-3">
          {data.infrastructure_costs.services.map((service) => (
            <InfrastructureCostCard
              key={service.service_name}
              service={service}
              expanded={expandedServices.has(service.service_name)}
              onToggle={() => toggleService(service.service_name)}
            />
          ))}
        </div>
      </div>

      {/* Cost Drivers & Insights */}
      {data.cost_drivers && data.cost_drivers.length > 0 && (
        <div className="bg-gradient-to-br from-blue-50 to-slate-50 border border-slate-200 rounded-lg p-6 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-4">Cost Drivers & Insights</h3>
          <div className="space-y-4">
            {data.cost_drivers.slice(0, 5).map((driver) => (
              <div key={`${driver.category}-${driver.description}`} className="flex items-start gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600 mt-2 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-slate-900 font-medium">
                    {driver.description}
                    <span className="ml-2 text-sm text-slate-600 font-normal">
                      (${driver.impact_usd.toFixed(2)} · {driver.impact_pct.toFixed(1)}%)
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
