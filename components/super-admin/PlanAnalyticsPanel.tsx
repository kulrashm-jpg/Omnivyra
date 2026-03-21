/**
 * Plan Analytics Panel
 * Displays comprehensive plan metrics for super admins:
 * - Organization distribution per plan
 * - Average resource consumption (tokens, API calls, automations)
 * - Cost metrics and revenue
 * - Feature adoption rates
 * - Plan popularity and health indicators
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  TrendingUp,
  Users,
  AlertCircle,
  CheckCircle,
  BarChart3,
  Zap,
  Cpu,
  DollarSign,
  Activity,
} from 'lucide-react';

interface PlanAnalytics {
  plan_id: string;
  plan_key: string;
  plan_name: string;
  org_count: number;
  avg_llm_tokens_used: number;
  avg_api_calls_used: number;
  avg_automation_executions: number;
  total_cost_usd: number;
  avg_cost_per_org: number;
  monthly_price: number | null;
  monthly_credits: number | null;
  feature_adoption: Record<string, number>;
  usage_health: 'low' | 'medium' | 'high';
}

interface AnalyticsResponse {
  plans: PlanAnalytics[];
  summary: {
    total_organizations: number;
    total_monthly_revenue: number;
    average_monthly_spend_per_org: number;
    plan_distribution: Record<string, number>;
  };
}

export default function PlanAnalyticsPanel() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'org_count' | 'revenue' | 'avg_cost'>('org_count');

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/plans/analytics', { credentials: 'include' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to load plan analytics');
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-gray-400 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-200 text-sm flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>{error}</div>
      </div>
    );
  }

  if (!data || data.plans.length === 0) {
    return (
      <div className="text-gray-400 text-sm text-center py-12">
        No plan data available yet. Start by adding organizations to plans.
      </div>
    );
  }

  const sortedPlans = [...data.plans].sort((a, b) => {
    switch (sortBy) {
      case 'org_count':
        return b.org_count - a.org_count;
      case 'revenue':
        return b.total_cost_usd - a.total_cost_usd;
      case 'avg_cost':
        return b.avg_cost_per_org - a.avg_cost_per_org;
      default:
        return 0;
    }
  });

  const healthColor = (health: string) => {
    switch (health) {
      case 'high':
        return 'text-green-400';
      case 'medium':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  const healthBg = (health: string) => {
    switch (health) {
      case 'high':
        return 'bg-green-900/20 border-green-800';
      case 'medium':
        return 'bg-yellow-900/20 border-yellow-800';
      default:
        return 'bg-gray-800/50 border-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Plan Analytics</h2>
          <p className="text-xs text-gray-400 mt-0.5">Usage statistics, revenue, and adoption metrics by plan</p>
        </div>
        <button
          onClick={loadAnalytics}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Total Organizations</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white">{data.summary.total_organizations}</div>
          <p className="text-xs text-gray-500 mt-1">Across all active plans</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Monthly Revenue</span>
            <DollarSign className="w-4 h-4 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-white">${data.summary.total_monthly_revenue.toFixed(2)}</div>
          <p className="text-xs text-gray-500 mt-1">From subscription plans</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Avg Spend/Org</span>
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">${data.summary.average_monthly_spend_per_org.toFixed(2)}</div>
          <p className="text-xs text-gray-500 mt-1">Per organization monthly</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Plans Active</span>
            <Activity className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl font-bold text-white">{data.plans.length}</div>
          <p className="text-xs text-gray-500 mt-1">Pricing tiers available</p>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Sort by:</span>
        <div className="flex gap-1">
          {[
            { key: 'org_count', label: 'Popularity' },
            { key: 'revenue', label: 'Revenue' },
            { key: 'avg_cost', label: 'Avg Cost' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key as any)}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                sortBy === opt.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Plan</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Organizations</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Monthly Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Avg Tokens</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Avg API Calls</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Avg Cost/Org</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Total Revenue</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {sortedPlans.map(plan => (
                <tr
                  key={plan.plan_id}
                  className="hover:bg-gray-800/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-white">{plan.plan_name}</div>
                      <div className="text-xs text-gray-500">{plan.plan_key}</div>
                    </div>
                  </td>
                  <td className="text-right px-4 py-3 text-white font-semibold">{plan.org_count}</td>
                  <td className="text-right px-4 py-3 text-gray-300">
                    {plan.monthly_price ? `$${plan.monthly_price.toFixed(0)}` : '—'}
                  </td>
                  <td className="text-right px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-gray-300">
                      <Cpu className="w-3 h-3 text-blue-400" />
                      <span>{plan.avg_llm_tokens_used.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="text-right px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-gray-300">
                      <Zap className="w-3 h-3 text-yellow-400" />
                      <span>{plan.avg_api_calls_used.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="text-right px-4 py-3 text-gray-300">${plan.avg_cost_per_org.toFixed(2)}</td>
                  <td className="text-right px-4 py-3 font-semibold text-green-400">
                    ${plan.total_cost_usd.toFixed(2)}
                  </td>
                  <td className="text-center px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${healthColor(
                        plan.usage_health
                      )}`}
                    >
                      {plan.usage_health === 'high' && <CheckCircle className="w-3 h-3" />}
                      {plan.usage_health === 'medium' && <AlertCircle className="w-3 h-3" />}
                      {plan.usage_health === 'low' && <Activity className="w-3 h-3" />}
                      {plan.usage_health.charAt(0).toUpperCase() + plan.usage_health.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Feature Adoption Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Feature Adoption by Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedPlans.map(plan => (
            <div key={plan.plan_id} className={`border rounded-lg p-4 ${healthBg(plan.usage_health)}`}>
              <div className="font-semibold text-white mb-3">{plan.plan_name}</div>
              <div className="space-y-2 text-xs">
                {Object.entries(plan.feature_adoption).map(([feature, adoption]) => (
                  <div key={feature} className="flex items-center justify-between">
                    <span className="text-gray-400">
                      {feature
                        .split('_')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            adoption > 75 ? 'bg-green-500' : adoption > 50 ? 'bg-yellow-500' : 'bg-gray-600'
                          }`}
                          style={{ width: `${adoption}%` }}
                        />
                      </div>
                      <span className="text-gray-400 w-8 text-right">{adoption}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Credits Reference */}
      <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
        <div className="text-xs text-gray-400 space-y-1">
          <div>
            <strong>Monthly Credits:</strong> Each plan includes a monthly credit allowance. Overages are charged at the
            rate of $0.003 per 1,000 tokens and $0.0001 per API call.
          </div>
          <div className="mt-2">
            <strong>Usage Health:</strong> <span className="text-green-400">High</span> = healthy usage patterns,
            <span className="text-yellow-400 ml-1">Medium</span> = moderate usage,
            <span className="text-gray-400 ml-1">Low</span> = underutilized plan
          </div>
        </div>
      </div>
    </div>
  );
}
