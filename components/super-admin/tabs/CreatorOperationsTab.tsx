/**
 * CreatorOperationsTab — Super-admin dashboard surface for BOLT Creator
 * operational health.
 *
 * Renders:
 *   - workflow status badge (healthy / degraded / incident)
 *   - operational health score (0-100)
 *   - rate panel: upload success, publish failure, queue contention,
 *     resumable recovery, attachment readiness conversion
 *   - latency panel: p50/p95/p99 for upload + publish events
 *   - active alerts list (severity-coloured)
 *   - DLQ entries (with manual recover affordance hook)
 *   - queue pressure (waiting/active/delayed)
 *   - anomaly findings
 *
 * Data flows: GET /api/super-admin/creator-operations?window=1h.
 *
 * UI conventions match the existing super-admin tabs (lucide-react icons,
 * panel-card chrome). No new design tokens introduced.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { Activity, AlertTriangle, RefreshCw, Upload, Layers, Gauge, Clock } from 'lucide-react';

type StatusKind = 'healthy' | 'degraded' | 'incident';

type Snapshot = {
  window: '1h' | '24h' | '7d' | '30d';
  status: StatusKind;
  snapshot: {
    total_events: number;
    counts_by_event: Record<string, number>;
    rates: Record<string, number>;
    latencies_ms: Record<string, { p50: number; p95: number; p99: number; max: number; samples: number }>;
    anomalies: Array<{ kind: string; severity: 'info' | 'warning' | 'critical'; message: string; observed: number; baseline: number; ratio: number }>;
    health_score: number;
  };
  dlq: Array<Record<string, unknown>>;
  queue_pressure: { waiting: number; active: number; delayed: number; pressure: 'normal' | 'high' | 'very_high' };
  active_alerts: Array<{ alert_key: string; severity: string; message: string; fire_count: number; last_fired_at: string }>;
};

const WINDOWS: Array<Snapshot['window']> = ['1h', '24h', '7d', '30d'];

export default function CreatorOperationsTab() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [window, setWindow] = useState<Snapshot['window']>('1h');
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ window });
      if (companyFilter.trim()) q.set('company_id', companyFilter.trim());
      const res = await fetchWithAuth(`/api/super-admin/creator-operations?${q.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as Snapshot;
      setData(json);
    } catch (err) {
      setError((err as Error)?.message ?? 'unknown');
    } finally {
      setLoading(false);
    }
  }, [window, companyFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusBadgeClass = (status: StatusKind) =>
    status === 'incident'
      ? 'bg-red-100 text-red-800 border-red-300'
      : status === 'degraded'
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-emerald-100 text-emerald-800 border-emerald-300';

  const sevBadgeClass = (sev: string) =>
    sev === 'critical'
      ? 'bg-red-100 text-red-700'
      : sev === 'warning'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-700';

  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtMs = (n: number) => `${Math.round(n).toLocaleString()} ms`;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-slate-700" />
          <h2 className="text-xl font-semibold text-slate-900">Creator Operations</h2>
          {data && (
            <span className={`text-xs px-2 py-1 rounded-md border ${statusBadgeClass(data.status)}`}>
              {data.status.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            placeholder="company_id filter"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-48"
          />
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as Snapshot['window'])}
            className="text-xs border border-slate-300 rounded px-2 py-1"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-xs px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          Failed to load: {error}
        </div>
      )}

      {data && (
        <>
          {/* Health score + queue pressure */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile icon={<Gauge className="w-4 h-4" />} label="Health score" value={`${data.snapshot.health_score}/100`} />
            <Tile icon={<Upload className="w-4 h-4" />} label="Upload success" value={fmtPct(data.snapshot.rates.upload_success ?? 0)} />
            <Tile icon={<AlertTriangle className="w-4 h-4" />} label="Publish failures" value={fmtPct(data.snapshot.rates.publish_validation_failure ?? 0)} />
            <Tile icon={<Layers className="w-4 h-4" />} label="Queue waiting" value={`${data.queue_pressure.waiting}`} />
          </section>

          {/* Rate panel */}
          <Panel title="Rates" subtitle={`${data.snapshot.total_events} events in window`}>
            <Row label="Resumable recovery" value={fmtPct(data.snapshot.rates.resumable_recovery ?? 0)} />
            <Row label="Queue contention" value={fmtPct(data.snapshot.rates.queue_contention ?? 0)} />
            <Row label="Upload retry / hr" value={`${(data.snapshot.rates.upload_retry_per_hour ?? 0).toFixed(2)}`} />
            <Row label="Orphan cleanup / hr" value={`${(data.snapshot.rates.orphan_cleanup_rate ?? 0).toFixed(2)}`} />
            <Row label="Attachment readiness conversion" value={fmtPct(data.snapshot.rates.attachment_readiness_conversion ?? 0)} />
          </Panel>

          {/* Anomalies */}
          {data.snapshot.anomalies.length > 0 && (
            <Panel title="Anomalies">
              {data.snapshot.anomalies.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-sm py-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${sevBadgeClass(a.severity)}`}>{a.severity}</span>
                  <div className="flex-1">
                    <div className="text-slate-900">{a.message}</div>
                    <div className="text-xs text-slate-500">observed={a.observed} baseline={a.baseline} ratio={a.ratio}</div>
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {/* Active alerts */}
          <Panel title="Active alerts">
            {data.active_alerts.length === 0 ? (
              <div className="text-sm text-slate-500">No active alerts.</div>
            ) : (
              data.active_alerts.map((a) => (
                <div key={a.alert_key} className="flex items-center justify-between gap-2 text-sm py-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${sevBadgeClass(a.severity)}`}>{a.severity}</span>
                    <span className="font-mono text-xs text-slate-700">{a.alert_key}</span>
                  </div>
                  <div className="text-slate-700 flex-1">{a.message}</div>
                  <div className="text-xs text-slate-500">fired {a.fire_count}x</div>
                </div>
              ))
            )}
          </Panel>

          {/* DLQ */}
          <Panel title="Dead-letter queue" subtitle={`${data.dlq.length} poisoned jobs`}>
            {data.dlq.length === 0 ? (
              <div className="text-sm text-slate-500">Empty.</div>
            ) : (
              <ul className="space-y-1">
                {data.dlq.map((j: any) => (
                  <li key={j.id} className="text-xs font-mono text-slate-700 truncate">
                    {j.scheduled_post_id} • {j.last_error_code ?? 'unknown'} • {j.failure_count}x
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Latency */}
          <Panel title="Latencies" subtitle="p50 / p95 / p99 (ms)">
            {Object.entries(data.snapshot.latencies_ms).length === 0 ? (
              <div className="text-sm text-slate-500">No latency samples in window.</div>
            ) : (
              Object.entries(data.snapshot.latencies_ms).map(([event, l]) => (
                <Row
                  key={event}
                  label={event}
                  value={
                    <span className="text-xs font-mono">
                      {fmtMs(l.p50)} / {fmtMs(l.p95)} / {fmtMs(l.p99)}
                    </span>
                  }
                />
              ))
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Tile(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs">{props.icon}{props.label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{props.value}</div>
    </div>
  );
}

function Panel(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-900">{props.title}</h3>
        {props.subtitle && <span className="text-xs text-slate-500">{props.subtitle}</span>}
      </header>
      <div className="space-y-0.5">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-0.5">
      <span className="text-slate-600">{props.label}</span>
      <span className="text-slate-900 font-medium">{props.value}</span>
    </div>
  );
}
