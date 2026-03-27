'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Activity, TrendingUp, AlertTriangle, ChevronDown, ChevronRight,
  Zap, RefreshCw, AlertCircle,
} from 'lucide-react';

/**
 * RailwayCompanyCostsPanel
 *
 * Displays Railway compute costs hierarchically:
 *  - Companies (tenants) at the top level
 *  - Activities within each company (campaign, publishing, engagement, intelligence, etc.)
 *  - Cost proportions and drill-down insights
 */

interface TopFeature {
  feature: string;
  cost_usd: number;
  calls: number;
}

interface ActivityRow {
  activity_type: string;
  cost_usd: number;
  cost_pct: number;
  calls: number;
  avg_duration_ms: number;
  top_features: TopFeature[];
}

interface ActivitySummary {
  activity_type: string;
  total_cost_usd: number;
  cost_pct: number;
  total_calls: number;
  avg_duration_ms: number;
  top_companies: Array<{ company_id: string; cost_usd: number; cost_pct: number }>;
  top_features: TopFeature[];
}

interface CompanyRow {
  company_id: string;
  total_cost_usd: number;
  cost_pct: number;
  total_calls: number;
  avg_duration_ms: number;
  activities: ActivityRow[];
}

interface ApiResponse {
  summary: {
    total_cost_usd: number;
    estimated_monthly_usd: number;
    total_requests: number;
    company_count: number;
    activity_count: number;
    avg_duration_ms?: number;
  };
  companies: CompanyRow[];
  activities: ActivitySummary[];
  insights: string[];
}

export default function RailwayCompanyCostsPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/railway-company-costs?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(`Failed to load: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleCompany = (companyId: string) => {
    const newSet = new Set(expandedCompanies);
    if (newSet.has(companyId)) newSet.delete(companyId);
    else newSet.add(companyId);
    setExpandedCompanies(newSet);
  };

  const toggleActivity = (key: string) => {
    const newSet = new Set(expandedActivities);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setExpandedActivities(newSet);
  };

  if (loading) {
    return (
      <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-8 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-400">Loading Railway company costs...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full bg-slate-950 border border-red-800 rounded-lg p-6">
        <div className="flex gap-3 items-center text-red-400 mb-2">
          <AlertCircle className="w-5 h-5" />
          <span className="font-semibold">Error Loading Data</span>
        </div>
        <p className="text-slate-400 text-sm mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { summary, companies, activities, insights } = data;

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-bold text-white">Railway Compute by Company & Activity</h2>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={hours}
            onChange={(e) => setHours(parseInt(e.target.value))}
            className="px-3 py-2 bg-slate-800 text-white border border-slate-700 rounded text-sm"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
          </select>
          <button
            onClick={fetchData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-orange-900 to-slate-900 border border-orange-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-orange-400 mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Total Cost</span>
          </div>
          <div className="text-2xl font-bold text-white">${summary.total_cost_usd.toFixed(3)}</div>
          <div className="text-xs text-orange-300 mt-2">
            Monthly: <span className="font-semibold">${summary.estimated_monthly_usd.toFixed(2)}</span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-900 to-slate-900 border border-purple-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-purple-400 mb-2">
            <Building2 className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Companies</span>
          </div>
          <div className="text-2xl font-bold text-white">{summary.company_count}</div>
          <div className="text-xs text-slate-400 mt-2">With compute activity</div>
        </div>

        <div className="bg-gradient-to-br from-blue-900 to-slate-900 border border-blue-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <Activity className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Activities</span>
          </div>
          <div className="text-2xl font-bold text-white">{summary.activity_count}</div>
          <div className="text-xs text-slate-400 mt-2">Activity types tracked</div>
        </div>

        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 border border-emerald-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Requests</span>
          </div>
          <div className="text-2xl font-bold text-white">{summary.total_requests.toLocaleString()}</div>
          <div className="text-xs text-emerald-300 mt-2">
            Avg: {summary.avg_duration_ms}ms
          </div>
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-400 mb-3">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="font-semibold">Key Insights</h3>
          </div>
          <div className="space-y-2">
            {insights.map((insight, idx) => (
              <div key={idx} className="text-sm text-slate-300 flex gap-2">
                <span className="text-amber-400 flex-shrink-0 mt-0.5">•</span>
                <span>{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Companies with Activities */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white px-2">Costs by Company</h3>
        {companies.map((company) => (
          <div key={company.company_id} className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
            {/* Company Header */}
            <button
              onClick={() => toggleCompany(company.company_id)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-800 transition"
            >
              <div className="flex-shrink-0">
                {expandedCompanies.has(company.company_id) ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
              </div>

              <div className="flex-shrink-0">
                <Building2 className="w-5 h-5 text-purple-400" />
              </div>

              <div className="flex-1 text-left min-w-0">
                <div className="font-semibold text-white">{company.company_id}</div>
                <div className="text-xs text-slate-400">{company.total_calls} requests</div>
              </div>

              <div className="flex-shrink-0 text-right">
                <div className="text-sm font-semibold text-orange-400">
                  ${company.total_cost_usd.toFixed(3)}
                </div>
                <div className="text-xs text-slate-400">{company.cost_pct.toFixed(1)}% of total</div>
              </div>
            </button>

            {/* Company Cost Bar */}
            <div className="px-4 py-2 bg-slate-950 border-t border-slate-700">
              <div className="w-full h-2 bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-purple-500"
                  style={{ width: `${Math.max(company.cost_pct, 2)}%` }}
                />
              </div>
            </div>

            {/* Company Activities */}
            {expandedCompanies.has(company.company_id) && (
              <div className="px-4 py-3 bg-slate-950 border-t border-slate-700 space-y-2">
                {company.activities.map((activity) => {
                  const activityKey = `${company.company_id}::${activity.activity_type}`;
                  return (
                    <div key={activityKey} className="border border-slate-800 rounded p-2">
                      {/* Activity Header */}
                      <button
                        onClick={() => toggleActivity(activityKey)}
                        className="w-full flex items-center gap-2 hover:bg-slate-900 transition px-2 py-1.5"
                      >
                        <div className="flex-shrink-0">
                          {expandedActivities.has(activityKey) ? (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                        </div>

                        <Activity className="w-4 h-4 text-blue-400 flex-shrink-0" />

                        <div className="flex-1 text-left min-w-0">
                          <div className="text-sm font-medium text-white">{activity.activity_type}</div>
                          <div className="text-xs text-slate-500">{activity.calls} calls</div>
                        </div>

                        <div className="flex-shrink-0 text-right">
                          <div className="text-xs font-semibold text-blue-400">
                            ${activity.cost_usd.toFixed(3)}
                          </div>
                          <div className="text-xs text-slate-500">{activity.cost_pct.toFixed(1)}%</div>
                        </div>
                      </button>

                      {/* Activity Cost Bar */}
                      <div className="px-2 py-1">
                        <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${Math.max(activity.cost_pct / 2, 2)}%` }}
                          />
                        </div>
                      </div>

                      {/* Top Features in Activity */}
                      {expandedActivities.has(activityKey) && activity.top_features.length > 0 && (
                        <div className="px-2 py-2 mt-2 bg-slate-900 rounded text-xs border border-slate-700">
                          <div className="font-semibold text-slate-300 mb-1">Top features:</div>
                          {activity.top_features.map((feat, idx) => (
                            <div key={idx} className="flex items-center justify-between text-slate-400 py-0.5">
                              <span>{feat.feature}</span>
                              <span className="text-slate-500">${feat.cost_usd.toFixed(3)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Activities Summary */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white px-2">Costs by Activity Type</h3>
        {activities.map((activity) => (
          <div key={activity.activity_type} className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  {activity.activity_type}
                </div>
                <div className="text-xs text-slate-400 mt-1">{activity.total_calls} total requests</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-emerald-400">
                  ${activity.total_cost_usd.toFixed(3)}
                </div>
                <div className="text-xs text-slate-400">{activity.cost_pct.toFixed(1)}% of total</div>
              </div>
            </div>

            {/* Cost Bar */}
            <div className="w-full h-2 bg-slate-800 rounded overflow-hidden mb-3">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.max(activity.cost_pct, 2)}%` }}
              />
            </div>

            {/* Top Companies for this Activity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Top companies</div>
                {activity.top_companies.slice(0, 3).map((company) => (
                  <div key={company.company_id} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-300">{company.company_id}</span>
                    <span className="text-slate-500">${company.cost_usd.toFixed(3)}</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Top features</div>
                {activity.top_features.slice(0, 3).map((feat, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-300">{feat.feature}</span>
                    <span className="text-slate-500">${feat.cost_usd.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
