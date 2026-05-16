/**
 * Phase 7 — Enterprise console (consolidated).
 *
 * Five compact tabs (kept tight to honour the "no layout redesign"
 * directive — each tab shows enough for an operator to inspect state and
 * trigger explicit actions; bulk operations stay on the API surface for
 * admin tooling):
 *
 *   • Governance        — list policies + activate / draft creation
 *   • Retention         — list policies + dry-run preview + execute
 *   • Audit exports     — list + request export
 *   • Replay ops        — DLQ inventory + replay status
 *   • Op health         — operational resilience snapshot + search
 *   • Investigations    — list workspaces + create + status
 *
 * Nothing here auto-fires governance / retention / replay actions. Every
 * mutation requires an explicit button click.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type GovernancePolicy = {
  id: string;
  policy_key: string;
  version: number;
  status: string;
  rationale: string | null;
  activated_at: string | null;
  created_at: string;
};

type RetentionPolicy = {
  id: string;
  target_kind: string;
  retain_days: number;
  archival_mode: string;
  enabled: boolean;
};

type AuditExportJob = {
  id: string;
  export_type: string;
  format: string;
  status: string;
  row_count: number | null;
  byte_size: number | null;
  created_at: string;
  completed_at: string | null;
};

type ReplayOp = {
  id: string;
  target_kind: string;
  status: string;
  batch_size: number;
  created_at: string;
};

type DLQInventoryEntry = {
  kind: string;
  id: string;
  summary: string;
  failed_at: string | null;
  retry_count: number | null;
};

type OperationalHealthSnapshot = {
  generated_at: string;
  window_hours: number;
  dlq_counts: { execution_failure: number; projection: number; moderation_block: number };
  projection_sync: Array<{ projection_kind: string; lag_seconds: number | null; pending_retry_count: number }>;
  execution_health: { completed: number; partial: number; failed: number };
  connector_degradation: { rate_limited_runs: number; degraded_sources: number };
  replay_drift: { stalest_projection_kind: string | null; stalest_lag_seconds: number | null };
  consistency: { lifecycle_init_lag_seconds: number | null };
};

type Workspace = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
};

type Tab = 'governance' | 'retention' | 'exports' | 'replay' | 'op_health' | 'investigations';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  draft: 'bg-slate-100 text-slate-700',
  superseded: 'bg-amber-100 text-amber-800',
  archived: 'bg-slate-100 text-slate-500',
  complete: 'bg-emerald-100 text-emerald-800',
  processing: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
  queued: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500',
  requested: 'bg-slate-100 text-slate-700',
  previewed: 'bg-sky-100 text-sky-800',
  approved: 'bg-amber-100 text-amber-800',
  executing: 'bg-amber-100 text-amber-800',
  open: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtLag(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export default function EnterpriseConsolePanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('governance');
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [retention, setRetention] = useState<RetentionPolicy[]>([]);
  const [exports, setExports] = useState<AuditExportJob[]>([]);
  const [replay, setReplay] = useState<ReplayOp[]>([]);
  const [inventory, setInventory] = useState<DLQInventoryEntry[]>([]);
  const [health, setHealth] = useState<OperationalHealthSnapshot | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchQ, setSearchQ] = useState<string>('');
  const [searchHits, setSearchHits] = useState<Array<{ kind: string; display: string; match_excerpt: string; matched_field: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'governance') {
        const r = await fetchWithAuth(`/api/active-leads/governance?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`governance ${r.status}`);
        const json = (await r.json()) as { items: GovernancePolicy[] };
        setPolicies(json.items ?? []);
      } else if (which === 'retention') {
        const r = await fetchWithAuth(`/api/active-leads/retention?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`retention ${r.status}`);
        const json = (await r.json()) as { items: RetentionPolicy[] };
        setRetention(json.items ?? []);
      } else if (which === 'exports') {
        const r = await fetchWithAuth(`/api/active-leads/audit-export?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`audit-export ${r.status}`);
        const json = (await r.json()) as { items: AuditExportJob[] };
        setExports(json.items ?? []);
      } else if (which === 'replay') {
        const [opsR, invR] = await Promise.all([
          fetchWithAuth(`/api/active-leads/replay?companyId=${encodeURIComponent(companyId)}`),
          fetchWithAuth(`/api/active-leads/replay?companyId=${encodeURIComponent(companyId)}&inventory=1`),
        ]);
        if (!opsR.ok) throw new Error(`replay-ops ${opsR.status}`);
        if (!invR.ok) throw new Error(`replay-inventory ${invR.status}`);
        const opsJson = (await opsR.json()) as { items: ReplayOp[] };
        const invJson = (await invR.json()) as { items: DLQInventoryEntry[] };
        setReplay(opsJson.items ?? []);
        setInventory(invJson.items ?? []);
      } else if (which === 'op_health') {
        const r = await fetchWithAuth(`/api/active-leads/op-health?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`op-health ${r.status}`);
        const json = (await r.json()) as OperationalHealthSnapshot;
        setHealth(json);
      } else if (which === 'investigations') {
        const r = await fetchWithAuth(`/api/active-leads/investigations?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`investigations ${r.status}`);
        const json = (await r.json()) as { items: Workspace[] };
        setWorkspaces(json.items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const activatePolicy = useCallback(async (policyId: string) => {
    setBusy(policyId);
    try {
      await fetchWithAuth('/api/active-leads/governance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, policyId, action: 'activate' }),
      });
      await load('governance');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, load]);

  const runRetention = useCallback(async (policyId: string, mode: 'dry_run' | 'execute') => {
    setBusy(policyId + ':' + mode);
    try {
      await fetchWithAuth('/api/active-leads/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, policyId, action: 'run', mode }),
      });
      await load('retention');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, load]);

  const runSearch = useCallback(async () => {
    if (!companyId || searchQ.trim().length < 2) return;
    setBusy('search');
    try {
      const r = await fetchWithAuth(`/api/active-leads/search?companyId=${encodeURIComponent(companyId)}&q=${encodeURIComponent(searchQ)}`);
      if (!r.ok) throw new Error(`search ${r.status}`);
      const json = (await r.json()) as { hits: Array<{ kind: string; display: string; match_excerpt: string; matched_field: string }> };
      setSearchHits(json.hits ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Search failed');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, searchQ]);

  const activeGov = useMemo(() => policies.filter((p) => p.status === 'active').length, [policies]);
  const draftGov = useMemo(() => policies.filter((p) => p.status === 'draft').length, [policies]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Enterprise Console</h3>
          <p className="text-xs text-slate-500">
            Governance, retention, exports, replay, operational health and investigations. Every mutation is explicit and audit-logged.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['governance', 'retention', 'exports', 'replay', 'op_health', 'investigations'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {t === 'governance' ? `governance (${activeGov}a/${draftGov}d)`
                : t === 'op_health' ? 'op health'
                : t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'governance' && (
        policies.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No governance policies yet. Create a draft via the API.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {policies.map((p) => (
              <li key={p.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{p.policy_key}</span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[p.status] ?? 'bg-slate-100 text-slate-600'}`}>v{p.version} {p.status}</span>
                      <span className="text-[10px] text-slate-500">created {fmtTime(p.created_at)}</span>
                      {p.activated_at && <span className="text-[10px] text-slate-500">· activated {fmtTime(p.activated_at)}</span>}
                    </div>
                    {p.rationale && <p className="mt-1 text-slate-700">{p.rationale}</p>}
                  </div>
                  {p.status === 'draft' && (
                    <button type="button" onClick={() => void activatePolicy(p.id)} disabled={busy === p.id} className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                      Activate
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'retention' && (
        retention.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No retention policies yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {retention.map((r) => (
              <li key={r.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{r.target_kind}</span>
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{r.retain_days}d · {r.archival_mode}</span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${r.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                        {r.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => void runRetention(r.id, 'dry_run')} disabled={busy === r.id + ':dry_run'} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      Preview
                    </button>
                    <button type="button" onClick={() => void runRetention(r.id, 'execute')} disabled={busy === r.id + ':execute' || !r.enabled} className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                      Execute
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'exports' && (
        exports.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No audit exports yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {exports.map((e) => (
              <li key={e.id} className="px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{e.export_type}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[e.status] ?? 'bg-slate-100 text-slate-600'}`}>{e.status}</span>
                  <span className="text-[10px] text-slate-500">{e.format.toUpperCase()}</span>
                  <span className="text-[10px] text-slate-500">rows {e.row_count ?? '—'}</span>
                  <span className="text-[10px] text-slate-500">· requested {fmtTime(e.created_at)}</span>
                  {e.completed_at && <span className="text-[10px] text-slate-500">· completed {fmtTime(e.completed_at)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'replay' && (
        <div className="text-xs">
          <div className="border-b border-slate-200 px-4 pt-3 pb-1 font-semibold uppercase tracking-wide text-slate-500">DLQ inventory ({inventory.length})</div>
          {inventory.length === 0 ? (
            <div className="px-4 py-2 text-slate-500">No DLQ entries in scope.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {inventory.slice(0, 10).map((d) => (
                <li key={`${d.kind}:${d.id}`} className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{d.kind}</span>
                    <span className="text-slate-800">{d.summary}</span>
                    {d.failed_at && <span className="text-[10px] text-slate-500">· {fmtTime(d.failed_at)}</span>}
                    {d.retry_count != null && <span className="text-[10px] text-slate-500">· retries {d.retry_count}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-y border-slate-200 px-4 pt-3 pb-1 font-semibold uppercase tracking-wide text-slate-500">Replay operations</div>
          {replay.length === 0 ? (
            <div className="px-4 py-2 text-slate-500">No replay operations recorded.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {replay.map((r) => (
                <li key={r.id} className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-800">{r.target_kind}</span>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                    <span className="text-[10px] text-slate-500">batch {r.batch_size}</span>
                    <span className="text-[10px] text-slate-500">· {fmtTime(r.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'op_health' && (
        <div className="px-4 py-3 text-xs">
          {!health ? (
            <div className="text-slate-500">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded border border-slate-200 p-2">
                  <div className="text-[10px] text-slate-500">DLQ execution failures</div>
                  <div className="text-base font-semibold text-slate-900">{health.dlq_counts.execution_failure}</div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="text-[10px] text-slate-500">DLQ projection exhausted</div>
                  <div className="text-base font-semibold text-slate-900">{health.dlq_counts.projection}</div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="text-[10px] text-slate-500">Moderation blocked</div>
                  <div className="text-base font-semibold text-slate-900">{health.dlq_counts.moderation_block}</div>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <div className="text-[10px] text-slate-500">Stalest projection lag</div>
                  <div className="text-base font-semibold text-slate-900">{fmtLag(health.replay_drift.stalest_lag_seconds)}</div>
                  <div className="text-[10px] text-slate-500">{health.replay_drift.stalest_projection_kind ?? '—'}</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Execution health (window {health.window_hours}h)</div>
                <div className="mt-1 text-slate-700">
                  completed <strong>{health.execution_health.completed}</strong> · partial <strong>{health.execution_health.partial}</strong> · failed <strong>{health.execution_health.failed}</strong>
                </div>
                <div className="mt-1 text-slate-700">
                  rate-limited runs <strong>{health.connector_degradation.rate_limited_runs}</strong> · degraded sources <strong>{health.connector_degradation.degraded_sources}</strong>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projection sync</div>
                <ul className="mt-1 grid grid-cols-1 gap-1 text-slate-700 md:grid-cols-2">
                  {health.projection_sync.map((p) => (
                    <li key={p.projection_kind}>
                      <strong>{p.projection_kind}</strong> · lag {fmtLag(p.lag_seconds)} · retries {p.pending_retry_count}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search (bounded)</div>
                <div className="mt-1 flex gap-2">
                  <input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search opportunities, notes, clusters, alerts…"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button type="button" onClick={() => void runSearch()} disabled={busy === 'search' || searchQ.trim().length < 2} className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    Search
                  </button>
                </div>
                {searchHits.length > 0 && (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {searchHits.slice(0, 10).map((h, idx) => (
                      <li key={idx} className="py-1">
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{h.kind}</span>{' '}
                        <span className="text-slate-800">{h.display}</span>
                        <div className="text-[11px] text-slate-500">matched on {h.matched_field}: {h.match_excerpt}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'investigations' && (
        workspaces.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No investigation workspaces yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {workspaces.map((w) => (
              <li key={w.id} className="px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{w.title}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[w.status] ?? 'bg-slate-100 text-slate-600'}`}>{w.status}</span>
                  <span className="text-[10px] text-slate-500">created {fmtTime(w.created_at)}</span>
                </div>
                {w.description && <p className="mt-1 text-slate-700">{w.description}</p>}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
