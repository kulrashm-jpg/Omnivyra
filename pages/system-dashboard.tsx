import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { SystemOverviewResponse } from './api/system/overview';

const RANGE_OPTIONS = [7, 30, 90] as const;

export default function SystemDashboardPage() {
  const [range, setRange] = useState<number>(7);
  const [data, setData] = useState<SystemOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/system/overview?range=${range}`, { credentials: 'include' });
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        setError('Failed to load system overview');
        setData(null);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError('Request failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading && !data) {
    return (
      <>
        <Head><title>System Dashboard</title></Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      </>
    );
  }

  if (forbidden) {
    return (
      <>
        <Head><title>System Dashboard — Access Denied</title></Head>
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-4">Super admin access required.</p>
          <Link href="/" className="text-indigo-600 hover:underline">Back to home</Link>
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <Head><title>System Dashboard</title></Head>
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <p className="text-red-600 mb-4">{error ?? 'No data'}</p>
          <button
            type="button"
            onClick={() => fetchOverview()}
            className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm hover:bg-gray-50"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  const { system_health, ai_consumption, tenant_growth, range_days } = data;
  const statusBadge =
    system_health.status === 'CRITICAL'
      ? { label: 'Critical', bg: 'bg-red-100', text: 'text-red-800' }
      : system_health.status === 'DEGRADED'
      ? { label: 'Degraded', bg: 'bg-amber-100', text: 'text-amber-800' }
      : { label: 'Healthy', bg: 'bg-green-100', text: 'text-green-800' };

  return (
    <>
      <Head><title>System Dashboard</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/super-admin" className="text-gray-600 hover:text-gray-900 text-sm">
                ← Super Admin
              </Link>
              <h1 className="text-lg font-semibold text-gray-900">System Dashboard</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Range:</span>
              {RANGE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRange(d)}
                  className={`px-2.5 py-1 text-sm rounded border ${
                    range === d
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* 1. System Health */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-900">System Health</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}>
                {statusBadge.label}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Jobs completed (24h)</p>
                <p className="font-medium text-gray-900">{system_health.jobs_completed_24h}</p>
              </div>
              <div>
                <p className="text-gray-500">Jobs failed (24h)</p>
                <p className="font-medium text-gray-900">{system_health.jobs_failed_24h}</p>
              </div>
              <div>
                <p className="text-gray-500">Failure rate %</p>
                <p className="font-medium text-gray-900">{system_health.failure_rate_percent}%</p>
              </div>
              <div>
                <p className="text-gray-500">Avg processing time</p>
                <p className="font-medium text-gray-900">
                  {system_health.avg_processing_time_ms != null
                    ? `${system_health.avg_processing_time_ms} ms`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Publish success rate %</p>
                <p className="font-medium text-gray-900">{system_health.publish_success_rate_percent}%</p>
              </div>
            </div>
          </section>

          {/* 2. AI Consumption */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-900 mb-3">AI Consumption</h2>
            <p className="text-xs text-gray-500 mb-3">Last {range_days} days (from usage_events)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
              <div>
                <p className="text-gray-500">Total tokens</p>
                <p className="font-medium text-gray-900">{ai_consumption.total_tokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500">Total cost</p>
                <p className="font-medium text-gray-900">{ai_consumption.total_cost.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-gray-500">LLM calls</p>
                <p className="font-medium text-gray-900">{ai_consumption.llm_calls}</p>
              </div>
              <div>
                <p className="text-gray-500">LLM error rate %</p>
                <p className="font-medium text-gray-900">{ai_consumption.llm_error_rate_percent}%</p>
              </div>
              <div>
                <p className="text-gray-500">Avg latency (ms)</p>
                <p className="font-medium text-gray-900">
                  {ai_consumption.avg_latency_ms != null ? ai_consumption.avg_latency_ms : '—'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">External API calls</p>
                <p className="font-medium text-gray-900">{ai_consumption.external_api_calls}</p>
              </div>
              <div>
                <p className="text-gray-500">Automation executions</p>
                <p className="font-medium text-gray-900">{ai_consumption.automation_executions}</p>
              </div>
            </div>
            {Object.keys(ai_consumption.tokens_by_model).length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Tokens by model</p>
                <ul className="text-sm text-gray-700 space-y-0.5">
                  {Object.entries(ai_consumption.tokens_by_model)
                    .sort((a, b) => b[1] - a[1])
                    .map(([model, tokens]) => (
                      <li key={model}>{model}: {tokens.toLocaleString()}</li>
                    ))}
                </ul>
              </div>
            )}
            {Object.keys(ai_consumption.tokens_by_process_type).length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Tokens by process type</p>
                <ul className="text-sm text-gray-700 space-y-0.5">
                  {Object.entries(ai_consumption.tokens_by_process_type)
                    .sort((a, b) => b[1] - a[1])
                    .map(([pt, tokens]) => (
                      <li key={pt}>{pt}: {tokens.toLocaleString()}</li>
                    ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-1">Top Campaigns by AI Cost</p>
              {data.top_campaigns_by_cost && data.top_campaigns_by_cost.length > 0 ? (
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  {data.top_campaigns_by_cost.map((c) => (
                    <li key={c.campaign_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-gray-900">{c.campaign_name}</span>
                      <span>cost {Number(c.total_cost).toFixed(4)}</span>
                      <span>{c.total_tokens.toLocaleString()} tokens</span>
                      <span className="text-gray-500">({c.percent_of_total_cost}% of total)</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-gray-500">No campaign-level AI usage in selected period.</p>
              )}
            </div>
          </section>

          {/* 3. Tenant Growth & Platform Activity */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Tenant Growth & Platform Activity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Total companies</p>
                <p className="font-medium text-gray-900">{tenant_growth.total_companies}</p>
              </div>
              <div>
                <p className="text-gray-500">Active companies (7d)</p>
                <p className="font-medium text-gray-900">{tenant_growth.active_companies_last_7_days}</p>
              </div>
              <div>
                <p className="text-gray-500">Total campaigns</p>
                <p className="font-medium text-gray-900">{tenant_growth.total_campaigns}</p>
              </div>
              <div>
                <p className="text-gray-500">Active campaigns (7d)</p>
                <p className="font-medium text-gray-900">{tenant_growth.active_campaigns_last_7_days}</p>
              </div>
              <div>
                <p className="text-gray-500">Posts published (7d)</p>
                <p className="font-medium text-gray-900">{tenant_growth.posts_published_last_7_days}</p>
              </div>
              <div>
                <p className="text-gray-500">Strategist usage rate %</p>
                <p className="font-medium text-gray-900">{tenant_growth.strategist_usage_rate_percent}%</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
