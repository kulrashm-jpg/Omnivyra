/**
 * System Workers Dashboard
 * Dead letter queue entries and worker health metrics.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { AlertCircle, RefreshCw, Activity, Inbox } from 'lucide-react';

type DeadLetterEntry = {
  id: string;
  worker_name: string;
  failure_reason: string | null;
  attempt_count: number;
  created_at: string;
};

type HealthMetric = {
  id: string;
  component: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string | null;
  observed_at: string;
  metadata: Record<string, unknown> | null;
};

const WORKER_COMPONENTS = [
  'conversation_memory_worker',
  'response_performance_evaluation_worker',
  'reply_intelligence_worker',
  'engagement_opportunity_detection_worker',
  'conversation_triage_worker',
  'response_strategy_learning_worker',
  'engagement_digest_worker',
];

export default function SystemWorkersPage() {
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>([]);
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dlRes, metricsRes] = await Promise.all([
        fetch('/api/system/dead-letters?limit=50', { credentials: 'include' }),
        fetch('/api/system/health/metrics?limit=200&time_window=24', { credentials: 'include' }),
      ]);

      if (!dlRes.ok) {
        if (dlRes.status === 403) throw new Error('Access denied');
        throw new Error(dlRes.statusText);
      }
      const dlJson = await dlRes.json();
      setDeadLetters(dlJson.items ?? []);

      if (metricsRes.ok) {
        const mJson = await metricsRes.json();
        setMetrics((mJson.metrics ?? []).filter(
          (m: HealthMetric) => WORKER_COMPONENTS.some((c) => m.component === c)
        ));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setDeadLetters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const byComponent = new Map<string, { lastRun: string; processed: number; errors: number }>();
  for (const m of metrics) {
    const cur = byComponent.get(m.component) ?? { lastRun: '', processed: 0, errors: 0 };
    if (m.metric_name === 'worker_run' || m.metric_name === 'processing_duration_ms') {
      cur.lastRun = m.observed_at;
    }
    if (m.metric_name === 'jobs_processed') cur.processed = m.metric_value;
    if (m.metric_name === 'errors') cur.errors = m.metric_value;
    byComponent.set(m.component, cur);
  }

  return (
    <>
      <Head>
        <title>System Workers | Omnivyra</title>
      </Head>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4">
        <div className="max-w-4xl mx-auto">
          <header className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">System Workers</h1>
              <p className="text-sm text-slate-600">Dead letter queue and worker health</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/super-admin" className="text-sm text-blue-600 hover:text-blue-800">
                ← Super Admin
              </Link>
              <Link href="/system/engagement-controls" className="text-sm text-blue-600 hover:text-blue-800">
                Engagement Controls
              </Link>
              <button
                type="button"
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </header>

          {error && (
            <div className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm flex items-center gap-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
              <Activity className="w-4 h-4" />
              Worker Health (24h)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {WORKER_COMPONENTS.map((comp) => {
                const d = byComponent.get(comp);
                return (
                  <div key={comp} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium text-slate-700 truncate">{comp}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Last run: {d?.lastRun ? new Date(d.lastRun).toLocaleString() : '—'}
                    </div>
                    {(d?.processed !== undefined || d?.errors !== undefined) && (
                      <div className="mt-1 text-xs text-slate-500">
                        Processed: {d?.processed ?? 0} | Errors: {d?.errors ?? 0}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
              <Inbox className="w-4 h-4" />
              Dead Letter Queue ({deadLetters.length})
            </h2>
            {deadLetters.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
                No dead letter entries
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-2 px-3 font-medium text-slate-700">Worker</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-700">Failure</th>
                      <th className="text-right py-2 px-3 font-medium text-slate-700">Attempts</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-700">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deadLetters.map((e) => (
                      <tr key={e.id} className="border-b border-slate-100">
                        <td className="py-2 px-3 text-slate-800">{e.worker_name}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-xs truncate" title={e.failure_reason ?? ''}>
                          {e.failure_reason ?? '—'}
                        </td>
                        <td className="py-2 px-3 text-right">{e.attempt_count}</td>
                        <td className="py-2 px-3 text-slate-600">{new Date(e.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
