/**
 * RailwayEfficiencyPanel — monitoring + cost control panel for Railway compute.
 *
 * Tabs:
 *   Overview — total cost, insights, top features
 *   API Endpoints — drill-down into endpoint costs
 *   Queue Jobs — drill-down into queue job costs
 *   Cron Jobs — drill-down into cron job frequency
 *
 * Top section:
 *   Cost Summary — total monthly estimate, computation hours
 *   Insights — root cause analysis + recommendations
 *   Quick Actions — one-click preset optimizations
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, TrendingUp, Clock, Zap, AlertTriangle, AlertCircle,
  ChevronDown, ChevronRight, BarChart2, Settings, Lightbulb,
  Activity, Target,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface ComputeMetricsResponse {
  timestamp: string;
  period_hours: number;
  overview: {
    total_cost_usd: number;
    estimated_monthly_cost_usd: number;
    total_compute_time_hours: string;
    avg_request_duration_ms: number;
    total_requests: number;
  };
  topExpensive: Array<{ feature: string; cost_pct: number; calls: number; cost_usd: number }>;
  bySourceType: {
    api: { cost_pct: number; cost_usd: number; calls: number };
    queue: { cost_pct: number; cost_usd: number; calls: number };
    cron: { cost_pct: number; cost_usd: number; calls: number };
  };
  apiEndpoints: Array<{ feature: string; endpoint: string; avg_time_ms: number; calls: number; cost: number }>;
  queueJobs: Array<{ name: string; calls: number; avg_time_ms: number }>;
  cronJobs: Array<{ name: string; calls: number; avg_time_ms: number }>;
  insights: string[];
  controls: Array<{
    id: string;
    title: string;
    description: string;
    estimated_savings_pct: number;
    difficulty: string;
  }>;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RailwayEfficiencyPanel() {
  const [data, setData] = useState<ComputeMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'endpoints' | 'queue' | 'cron'>('overview');
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/railway-efficiency?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(`Failed to load metrics: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-8 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-400">Loading Railway compute metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full bg-slate-950 border border-red-800 rounded-lg p-6">
        <div className="flex gap-3 items-center text-red-400 mb-2">
          <AlertCircle className="w-5 h-5" />
          <span className="font-semibold">Error Loading Metrics</span>
        </div>
        <p className="text-slate-400 text-sm mb-4">{error}</p>
        <button
          onClick={fetchMetrics}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="w-full space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-6 h-6 text-yellow-400" />
          <h2 className="text-xl font-bold text-white">Railway Efficiency</h2>
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
            onClick={fetchMetrics}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Overview Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cost Card */}
        <div className="bg-gradient-to-br from-orange-900 to-slate-900 border border-orange-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-orange-400 mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Estimated Cost</span>
          </div>
          <div className="mb-3">
            <div className="text-3xl font-bold text-white">
              ${data.overview.total_cost_usd.toFixed(3)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Last {hours}h</div>
          </div>
          <div className="text-xs text-orange-300">
            Monthly estimate: <span className="font-semibold">${data.overview.estimated_monthly_cost_usd.toFixed(2)}</span>
          </div>
        </div>

        {/* Compute Time Card */}
        <div className="bg-gradient-to-br from-blue-900 to-slate-900 border border-blue-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <Clock className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Compute Time</span>
          </div>
          <div className="mb-3">
            <div className="text-3xl font-bold text-white">
              {data.overview.total_compute_time_hours}h
            </div>
            <div className="text-xs text-slate-400 mt-1">Total duration</div>
          </div>
          <div className="text-xs text-blue-300">
            Avg request: <span className="font-semibold">{data.overview.avg_request_duration_ms}ms</span>
          </div>
        </div>

        {/* Request Volume Card */}
        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 border border-emerald-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <Activity className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Request Count</span>
          </div>
          <div className="mb-3">
            <div className="text-3xl font-bold text-white">
              {data.overview.total_requests.toLocaleString()}
            </div>
            <div className="text-xs text-slate-400 mt-1">Last {hours}h</div>
          </div>
          <div className="text-xs text-emerald-300">
            Rate: <span className="font-semibold">{Math.round(data.overview.total_requests / hours)}/h</span>
          </div>
        </div>
      </div>

      {/* ── Insights Section ──────────────────────────────────────────────── */}
      {data.insights.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-400 mb-3">
            <Lightbulb className="w-5 h-5" />
            <h3 className="font-semibold">Insights & Recommendations</h3>
          </div>
          <div className="space-y-2">
            {data.insights.map((insight, idx) => (
              <div key={idx} className="text-sm text-slate-300 flex gap-2">
                <span className="text-amber-400 flex-shrink-0 mt-0.5">•</span>
                <span>{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Control Actions ────────────────────────────────────────────────── */}
      {data.controls.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 text-cyan-400 mb-3">
            <Settings className="w-5 h-5" />
            <h3 className="font-semibold">Optimization Actions</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.controls.map((control) => (
              <div key={control.id} className="bg-slate-800 border border-slate-700 rounded p-3 hover:border-cyan-600 transition">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-white text-sm">{control.title}</h4>
                  <div className="text-xs font-bold text-emerald-400 bg-emerald-900 px-2 py-1 rounded">
                    Save {control.estimated_savings_pct}%
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-3">{control.description}</p>
                <button className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded">
                  Review →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-700">
        <div className="flex gap-6">
          {[
            { id: 'overview' as const, label: 'Overview', icon: BarChart2 },
            { id: 'endpoints' as const, label: 'API Endpoints', icon: Activity },
            { id: 'queue' as const, label: 'Queue Jobs', icon: Zap },
            { id: 'cron' as const, label: 'Cron Jobs', icon: Clock },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`pb-3 px-1 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${
                activeTab === id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="p-6">
            <h3 className="font-semibold text-white mb-4">Top Expensive Features</h3>
            <div className="space-y-3">
              {data.topExpensive.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-800 border border-slate-700 rounded p-3 cursor-pointer hover:border-slate-600 transition"
                  onClick={() => setExpandedFeature(expandedFeature === item.feature ? null : item.feature)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-semibold text-white text-sm">{item.feature}</span>
                      <span className="text-xs text-slate-500">({item.calls} calls)</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-orange-400">${item.cost_usd.toFixed(4)}</div>
                      <div className="text-xs text-slate-400">{Math.round(item.cost_pct)}% of total</div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 ml-2 transition ${expandedFeature === item.feature ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Cost percentage bar */}
                  <div className="w-full bg-slate-700 rounded h-1.5 mb-3">
                    <div
                      className="bg-orange-500 h-1.5 rounded transition-all"
                      style={{ width: `${item.cost_pct}%` }}
                    />
                  </div>

                  {/* Expanded details */}
                  {expandedFeature === item.feature && (
                    <div className="text-xs text-slate-300 space-y-1 border-t border-slate-700 pt-3">
                      <div className="flex justify-between">
                        <span>Calls:</span>
                        <span className="text-orange-400">{item.calls.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Estimated Cost:</span>
                        <span className="text-orange-400">${item.cost_usd.toFixed(4)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Source Type Breakdown */}
            <h3 className="font-semibold text-white mt-6 mb-4">By Source Type</h3>
            <div className="grid grid-cols-3 gap-3">
              {['api', 'queue', 'cron'].map((source) => {
                const src = data.bySourceType[source as keyof typeof data.bySourceType];
                return (
                  <div key={source} className="bg-slate-800 border border-slate-700 rounded p-3">
                    <div className="capitalize font-semibold text-white text-sm mb-2">{source} Compute</div>
                    <div className="text-lg font-bold text-cyan-400 mb-2">
                      ${(src.cost_usd || 0).toFixed(4)}
                    </div>
                    <div className="text-xs text-slate-400">
                      {src.calls || 0} executions ({Math.round(src.cost_pct)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Endpoints Tab */}
        {activeTab === 'endpoints' && (
          <div className="p-6">
            <h3 className="font-semibold text-white mb-4">Top API Endpoints by Cost</h3>
            <div className="space-y-2">
              {data.apiEndpoints.length === 0 ? (
                <p className="text-slate-400 text-sm">No endpoint data available</p>
              ) : (
                data.apiEndpoints.map((ep, idx) => (
                  <div key={idx} className="bg-slate-800 border border-slate-700 rounded p-3 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-white">{ep.feature}</span>
                      <span className="text-cyan-400 font-bold">${ep.cost.toFixed(4)}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-400">
                      <span>⏱️ {ep.avg_time_ms}ms avg</span>
                      <span>📞 {ep.calls} calls</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Queue Tab */}
        {activeTab === 'queue' && (
          <div className="p-6">
            <h3 className="font-semibold text-white mb-4">Queue Job Cost Breakdown</h3>
            <div className="space-y-2">
              {data.queueJobs.length === 0 ? (
                <p className="text-slate-400 text-sm">No queue job data available</p>
              ) : (
                data.queueJobs.map((job, idx) => (
                  <div key={idx} className="bg-slate-800 border border-slate-700 rounded p-3 text-sm">
                    <div className="font-semibold text-white mb-2">{job.name}</div>
                    <div className="flex gap-4 text-xs text-slate-400">
                      <span>⏱️ {job.avg_time_ms}ms avg</span>
                      <span>📊 {job.calls} executions</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Cron Tab */}
        {activeTab === 'cron' && (
          <div className="p-6">
            <h3 className="font-semibold text-white mb-4">Cron Job Configuration</h3>
            <div className="space-y-2">
              {data.cronJobs.length === 0 ? (
                <p className="text-slate-400 text-sm">No cron job data available</p>
              ) : (
                data.cronJobs.map((job, idx) => (
                  <div key={idx} className="bg-slate-800 border border-slate-700 rounded p-3 text-sm">
                    <div className="font-semibold text-white mb-2">{job.name}</div>
                    <div className="flex gap-4 text-xs text-slate-400">
                      <span>⏱️ {job.avg_time_ms}ms per run</span>
                      <span>🔄 {job.calls} runs in period</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="text-xs text-slate-500 text-center">
        Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
