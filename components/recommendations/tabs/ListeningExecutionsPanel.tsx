/**
 * Phase 3 — Compact executions history + "Run Now" surface.
 *
 * Renders under the Phase-1 capability status panel. Lists the most recent
 * executions for the org with status badges, signal counts, moderation
 * counts. Includes a single "Run Now" button per listening source that has
 * a known platform anchor. NO persistent toggles, NO "always listening"
 * affordance — explicitly per the prompt.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ExecutionStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'blocked_by_moderation';

type ListeningExecution = {
  id: string;
  organization_id: string;
  listening_source_id: string;
  execution_mode: 'ON_DEMAND' | 'SCHEDULED';
  execution_status: ExecutionStatus;
  planned_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  estimated_credit_cost: number;
  actual_credit_cost: number;
  moderation_status: string | null;
  ingestion_stats: Record<string, number>;
  signal_stats: {
    signals_detected?: number;
    signals_persisted?: number;
    signals_deduplicated?: number;
    signals_moderation_blocked?: number;
    signals_moderation_flagged?: number;
  };
  error_metadata: { reason?: string } | null;
};

type SourceSummary = {
  id: string;
  display_name: string;
  source_identifier: string;
  status: string;
  metadata?: { platform?: string; keywords?: string[] } & Record<string, unknown>;
};

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
  /** Listening sources the org has at least 'approved' state for. The panel
   *  filters internally to "approved" / "active" since other states cannot
   *  be triggered. */
  sources: SourceSummary[];
};

const STATUS_TONE: Record<ExecutionStatus, string> = {
  planned: 'bg-slate-200 text-slate-700',
  queued: 'bg-sky-100 text-sky-800',
  running: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-600',
  blocked_by_moderation: 'bg-rose-100 text-rose-800',
};

function fmtTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function ListeningExecutionsPanel({ companyId, fetchWithAuth, sources }: Props) {
  const [items, setItems] = useState<ListeningExecution[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const eligibleSources = useMemo(
    () => sources.filter((s) => s.status === 'approved' || s.status === 'active'),
    [sources],
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `/api/active-leads/executions?companyId=${encodeURIComponent(companyId)}`,
      );
      if (!resp.ok) throw new Error(`Failed to load executions (${resp.status})`);
      const json = (await resp.json()) as { items: ListeningExecution[] };
      if (reqSeq.current !== seq) return;
      setItems(json.items ?? []);
    } catch (err: any) {
      if (reqSeq.current !== seq) return;
      setError(err?.message ?? 'Failed to load executions');
    } finally {
      if (reqSeq.current === seq) setLoading(false);
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = useCallback(
    async (source: SourceSummary) => {
      if (!companyId) return;
      setRunning(source.id);
      setError(null);
      try {
        const resp = await fetchWithAuth('/api/active-leads/executions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            listeningSourceId: source.id,
            executionMode: 'ON_DEMAND',
            keywords: source.metadata?.keywords,
          }),
        });
        const json = await resp.json();
        if (!resp.ok || json.ok === false) {
          throw new Error(json?.detail ?? json?.error ?? `Run failed (${resp.status})`);
        }
        await load();
      } catch (err: any) {
        setError(err?.message ?? 'Run failed');
      } finally {
        setRunning(null);
      }
    },
    [companyId, fetchWithAuth, load],
  );

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Listening executions</h3>
          <p className="text-xs text-slate-500">
            Each run is bounded, moderation-gated, and writes only to canonical lead signals.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
      )}

      {eligibleSources.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          No listening sources are approved yet. Approve a source from the listening configuration before running a scan.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {eligibleSources.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="min-w-0 flex-1 pr-3">
                <div className="font-medium text-slate-900">{s.display_name}</div>
                <div className="text-[11px] text-slate-500">
                  {s.metadata?.platform ? `${s.metadata.platform} · ` : ''}
                  {s.source_identifier}
                  {' · '}
                  {s.metadata?.keywords && s.metadata.keywords.length > 0
                    ? `${s.metadata.keywords.length} keyword${s.metadata.keywords.length === 1 ? '' : 's'}`
                    : 'no keywords'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runNow(s)}
                disabled={running === s.id || loading}
                className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running === s.id ? 'Running…' : 'Run Now'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-slate-200 px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Recent runs
      </div>
      {items.length === 0 ? (
        <div className="px-4 pb-3 text-xs text-slate-400">No executions yet.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 10).map((ex) => {
            const det = ex.signal_stats?.signals_detected ?? 0;
            const per = ex.signal_stats?.signals_persisted ?? 0;
            const blk = ex.signal_stats?.signals_moderation_blocked ?? 0;
            const flg = ex.signal_stats?.signals_moderation_flagged ?? 0;
            const dedup = ex.signal_stats?.signals_deduplicated ?? 0;
            return (
              <li key={ex.id} className="px-4 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${STATUS_TONE[ex.execution_status]}`}>
                    {ex.execution_status}
                  </span>
                  <span className="text-slate-500">{fmtTime(ex.completed_at ?? ex.started_at ?? ex.planned_at)}</span>
                </div>
                <div className="mt-1 text-slate-700">
                  Detected <strong>{det}</strong> · Persisted <strong>{per}</strong>
                  {dedup > 0 && <> · Deduped <strong>{dedup}</strong></>}
                  {blk > 0 && <> · Blocked <strong className="text-rose-700">{blk}</strong></>}
                  {flg > 0 && <> · Flagged <strong className="text-amber-700">{flg}</strong></>}
                </div>
                <div className="text-[11px] text-slate-500">
                  Cost est <strong>{ex.estimated_credit_cost}</strong> / actual <strong>{ex.actual_credit_cost}</strong>
                  {ex.error_metadata?.reason && <> · <span className="text-rose-700">{ex.error_metadata.reason}</span></>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
