/**
 * Phase 9 — Enterprise Runtime Console.
 *
 * Compact 7-tab consolidated UI for the Phase 9 surfaces. Each tab loads
 * on demand. No autonomous refresh loop. Every mutation requires an
 * explicit button click and surfaces the resulting state. Read paths
 * stream from the new APIs:
 *
 *   • analytics    — Enterprise Analytics Center (materialise + browse facts)
 *   • semantic     — Semantic Intelligence Workspace (hybrid retrieval + partitions)
 *   • incidents    — Incident Management Console (CRUD + timeline)
 *   • replay       — Replay Coordination Console (partitions + checkpoints)
 *   • collections  — Analyst Collections (saved views + items)
 *   • reports      — Executive Reporting Center (definitions + generation)
 *   • runtime      — Runtime Operations Dashboard (queues + region routing)
 */

import React, { useCallback, useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type Tab = 'analytics' | 'semantic' | 'incidents' | 'replay' | 'collections' | 'reports' | 'runtime';

type WarehouseFact = {
  id: string;
  fact_kind: string;
  bucket_start: string;
  dimensions: Record<string, unknown>;
  measures: Record<string, number>;
};

type Materialization = {
  id: string;
  fact_kind: string;
  window_start: string;
  window_end: string;
  rows_written: number;
  status: string;
  detail: string | null;
  created_at: string;
};

type SemanticPartition = {
  id: string;
  partition_index: number;
  status: string;
  attempts_made: number;
  chunks_indexed: number;
  chunks_failed: number;
  cost_units: number;
  failure_reason: string | null;
  updated_at: string;
};

type RetrievalHit = {
  source_kind: string;
  source_id: string;
  lexical_score: number;
  semantic_score: number;
  combined_score: number;
  preview: string | null;
  explanation: string;
};

type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  category: string;
  owner_user_id: string | null;
  created_at: string;
};

type ReplayPartition = {
  id: string;
  partition_index: number;
  status: string;
  processed_count: number;
  skipped_count: number;
  attempts_made: number;
  failure_reason: string | null;
  updated_at: string;
};

type SavedView = {
  id: string;
  view_kind: string;
  name: string;
  description: string | null;
  shared: boolean;
  updated_at: string;
};

type ReportDefinition = {
  id: string;
  report_kind: string;
  name: string;
  enabled: boolean;
  updated_at: string;
};

type ReportExecution = {
  id: string;
  report_kind: string;
  status: string;
  row_count: number | null;
  byte_size: number | null;
  failure_reason: string | null;
  created_at: string;
};

type RuntimeSnapshot = {
  generated_at: string;
  queues: Array<{
    name: string;
    waiting: number | null;
    active: number | null;
    delayed: number | null;
    failed: number | null;
    completed: number | null;
    congested: boolean;
    threshold: number;
  }>;
  recent_failures: { semantic_partitions: number; replay_partitions: number; executions: number };
};

type RegionRouting = {
  primary_region: string;
  failover_region: string | null;
  failover_strategy: string;
  partition_routing: Record<string, string>;
  updated_at: string;
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-rose-100 text-rose-800',
  triaging: 'bg-amber-100 text-amber-800',
  mitigating: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  postmortem: 'bg-slate-100 text-slate-700',
  closed: 'bg-slate-100 text-slate-500',
  queued: 'bg-slate-100 text-slate-700',
  running: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-500',
  processing: 'bg-amber-100 text-amber-800',
  partial: 'bg-amber-100 text-amber-800',
};

const SEVERITY_TONE: Record<string, string> = {
  sev1: 'bg-rose-100 text-rose-800',
  sev2: 'bg-rose-100 text-rose-700',
  sev3: 'bg-amber-100 text-amber-800',
  sev4: 'bg-slate-100 text-slate-600',
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Chip({ text, tone }: { text: string; tone?: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone ?? 'bg-slate-100 text-slate-700'}`}>{text}</span>;
}

const FACT_KINDS = ['opportunity_daily', 'source_roi_daily', 'escalation_daily', 'execution_daily', 'moderation_daily', 'cost_daily', 'sla_daily'] as const;
const REPORT_KINDS = ['opportunity_trends', 'source_roi', 'escalation_summary', 'competitor_intel', 'operational_health', 'sla_report', 'governance_audit'] as const;
const INCIDENT_CATEGORIES = ['execution_failure', 'semantic_indexing_failure', 'replay_failure', 'projection_drift', 'moderation_outage', 'cost_breach', 'sla_breach', 'connector_outage', 'governance_violation', 'other'] as const;

export default function EnterpriseRuntimePanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('analytics');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Analytics
  const [factKind, setFactKind] = useState<string>('opportunity_daily');
  const [facts, setFacts] = useState<WarehouseFact[]>([]);
  const [materializations, setMaterializations] = useState<Materialization[]>([]);

  // Semantic
  const [semanticJobId, setSemanticJobId] = useState<string>('');
  const [semanticPartitions, setSemanticPartitions] = useState<SemanticPartition[]>([]);
  const [retrievalQuery, setRetrievalQuery] = useState<string>('');
  const [retrievalHits, setRetrievalHits] = useState<RetrievalHit[]>([]);

  // Incidents
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [newIncidentTitle, setNewIncidentTitle] = useState<string>('');
  const [newIncidentCategory, setNewIncidentCategory] = useState<string>('other');

  // Replay
  const [replayOpId, setReplayOpId] = useState<string>('');
  const [replayPartitions, setReplayPartitions] = useState<ReplayPartition[]>([]);

  // Collections
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [newViewName, setNewViewName] = useState<string>('');

  // Reports
  const [reportDefinitions, setReportDefinitions] = useState<ReportDefinition[]>([]);
  const [reportExecutions, setReportExecutions] = useState<ReportExecution[]>([]);
  const [reportKind, setReportKind] = useState<string>('opportunity_trends');

  // Runtime
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [region, setRegion] = useState<RegionRouting | null>(null);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'analytics') {
        const factsRes = await fetchWithAuth(`/api/active-leads/analytics-warehouse?companyId=${encodeURIComponent(companyId)}&factKind=${factKind}`);
        const matsRes = await fetchWithAuth(`/api/active-leads/analytics-warehouse?companyId=${encodeURIComponent(companyId)}&materializations=1`);
        if (!factsRes.ok || !matsRes.ok) throw new Error('analytics failed');
        setFacts(((await factsRes.json()) as { items: WarehouseFact[] }).items ?? []);
        setMaterializations(((await matsRes.json()) as { items: Materialization[] }).items ?? []);
      } else if (which === 'semantic') {
        if (semanticJobId) {
          const r = await fetchWithAuth(`/api/active-leads/semantic-runtime?companyId=${encodeURIComponent(companyId)}&jobId=${encodeURIComponent(semanticJobId)}`);
          setSemanticPartitions(((await r.json()) as { items: SemanticPartition[] }).items ?? []);
        } else {
          const r = await fetchWithAuth(`/api/active-leads/semantic-runtime?companyId=${encodeURIComponent(companyId)}`);
          setSemanticPartitions(((await r.json()) as { items: SemanticPartition[] }).items ?? []);
        }
      } else if (which === 'incidents') {
        const r = await fetchWithAuth(`/api/active-leads/incidents?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`incidents ${r.status}`);
        setIncidents(((await r.json()) as { items: Incident[] }).items ?? []);
      } else if (which === 'replay') {
        const url = replayOpId
          ? `/api/active-leads/replay-coordination?companyId=${encodeURIComponent(companyId)}&replayOperationId=${encodeURIComponent(replayOpId)}`
          : `/api/active-leads/replay-coordination?companyId=${encodeURIComponent(companyId)}`;
        const r = await fetchWithAuth(url);
        setReplayPartitions(((await r.json()) as { items: ReplayPartition[] }).items ?? []);
      } else if (which === 'collections') {
        const r = await fetchWithAuth(`/api/active-leads/analyst-collections?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`collections ${r.status}`);
        setSavedViews(((await r.json()) as { items: SavedView[] }).items ?? []);
      } else if (which === 'reports') {
        const defsRes = await fetchWithAuth(`/api/active-leads/reports?companyId=${encodeURIComponent(companyId)}&definitions=1`);
        const execRes = await fetchWithAuth(`/api/active-leads/reports?companyId=${encodeURIComponent(companyId)}`);
        if (!defsRes.ok || !execRes.ok) throw new Error('reports failed');
        setReportDefinitions(((await defsRes.json()) as { items: ReportDefinition[] }).items ?? []);
        setReportExecutions(((await execRes.json()) as { items: ReportExecution[] }).items ?? []);
      } else if (which === 'runtime') {
        const snapRes = await fetchWithAuth(`/api/active-leads/runtime-observability?companyId=${encodeURIComponent(companyId)}`);
        const regRes = await fetchWithAuth(`/api/active-leads/region-routing?companyId=${encodeURIComponent(companyId)}`);
        if (!snapRes.ok || !regRes.ok) throw new Error('runtime failed');
        setSnapshot(((await snapRes.json()) as { snapshot: RuntimeSnapshot }).snapshot);
        setRegion(((await regRes.json()) as { routing: RegionRouting | null }).routing);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth, factKind, semanticJobId, replayOpId]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const materialize = useCallback(async () => {
    setBusy('materialize');
    try {
      await fetchWithAuth('/api/active-leads/analytics-warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, factKind }),
      });
      await load('analytics');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, factKind, load]);

  const partitionSemantic = useCallback(async () => {
    if (!semanticJobId) return;
    setBusy('partition-semantic');
    try {
      await fetchWithAuth('/api/active-leads/semantic-runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, jobId: semanticJobId }),
      });
      await load('semantic');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, semanticJobId, load]);

  const runRetrieval = useCallback(async () => {
    if (!retrievalQuery.trim()) return;
    setBusy('retrieval');
    try {
      const r = await fetchWithAuth('/api/active-leads/semantic-retrieval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, query: retrievalQuery, mode: 'hybrid' }),
      });
      const json = (await r.json()) as { hits: RetrievalHit[] };
      setRetrievalHits(json.hits ?? []);
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, retrievalQuery]);

  const createIncident = useCallback(async () => {
    if (!newIncidentTitle.trim()) return;
    setBusy('create-incident');
    try {
      await fetchWithAuth('/api/active-leads/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'create', title: newIncidentTitle, category: newIncidentCategory }),
      });
      setNewIncidentTitle('');
      await load('incidents');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, newIncidentTitle, newIncidentCategory, load]);

  const updateIncidentStatus = useCallback(async (incidentId: string, status: string) => {
    setBusy(`incident-${incidentId}`);
    try {
      await fetchWithAuth('/api/active-leads/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'update', incidentId, status }),
      });
      await load('incidents');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const partitionReplay = useCallback(async () => {
    if (!replayOpId) return;
    setBusy('partition-replay');
    try {
      await fetchWithAuth('/api/active-leads/replay-coordination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, replayOperationId: replayOpId }),
      });
      await load('replay');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, replayOpId, load]);

  const createView = useCallback(async () => {
    if (!newViewName.trim()) return;
    setBusy('create-view');
    try {
      await fetchWithAuth('/api/active-leads/analyst-collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'upsert_view', viewKind: 'collection', name: newViewName }),
      });
      setNewViewName('');
      await load('collections');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, newViewName, load]);

  const generateReport = useCallback(async () => {
    setBusy('generate-report');
    try {
      await fetchWithAuth('/api/active-leads/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'generate', reportKind }),
      });
      await load('reports');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, reportKind, load]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Enterprise Runtime Console</h3>
          <p className="text-xs text-slate-500">
            Analytics, semantic, incidents, replay, collections, reports, runtime. Operator-driven; every action attributed.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['analytics', 'semantic', 'incidents', 'replay', 'collections', 'reports', 'runtime'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'analytics' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={factKind} onChange={(e) => setFactKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {FACT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={materialize} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'materialize' ? 'Running…' : 'Materialise default window'}
            </button>
          </div>
          {facts.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No facts materialised for {factKind}.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {facts.slice(0, 25).map((f) => (
                <li key={f.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{fmtTime(f.bucket_start)}</span>
                    <span className="text-[10px] text-slate-500">{Object.keys(f.dimensions).length ? JSON.stringify(f.dimensions) : '—'}</span>
                  </div>
                  <div className="mt-1 text-slate-700">{Object.entries(f.measures).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>
                </li>
              ))}
            </ul>
          )}
          {materializations.length > 0 && (
            <div className="px-4 py-2 text-[11px] text-slate-600">
              Last runs: {materializations.slice(0, 3).map((m) => `${m.fact_kind} (${m.status}, ${m.rows_written} rows)`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {tab === 'semantic' && (
        <div className="divide-y divide-slate-100">
          <div className="space-y-2 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <input value={semanticJobId} onChange={(e) => setSemanticJobId(e.target.value)} placeholder="Semantic indexing job id" className="w-72 rounded border border-slate-200 px-2 py-1" />
              <button type="button" disabled={!semanticJobId || !!busy} onClick={partitionSemantic} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
                {busy === 'partition-semantic' ? 'Partitioning…' : 'Partition + enqueue'}
              </button>
              <button type="button" onClick={() => void load('semantic')} className="rounded bg-slate-100 px-3 py-1 text-slate-700">Refresh</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={retrievalQuery} onChange={(e) => setRetrievalQuery(e.target.value)} placeholder="Hybrid retrieval query" className="w-72 rounded border border-slate-200 px-2 py-1" />
              <button type="button" disabled={!retrievalQuery || !!busy} onClick={runRetrieval} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
                {busy === 'retrieval' ? 'Searching…' : 'Search (hybrid)'}
              </button>
            </div>
          </div>
          {retrievalHits.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {retrievalHits.map((h, idx) => (
                <li key={`${h.source_kind}-${h.source_id}-${idx}`} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{h.source_kind}:{h.source_id}</span>
                    <span className="text-[10px] text-slate-500">combined {h.combined_score.toFixed(3)}</span>
                  </div>
                  <p className="mt-1 text-slate-600">{h.preview}</p>
                  <p className="text-[10px] text-slate-500">{h.explanation}</p>
                </li>
              ))}
            </ul>
          )}
          {semanticPartitions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No partitions for this query.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {semanticPartitions.map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">#{p.partition_index}</span>
                    <Chip text={p.status} tone={STATUS_TONE[p.status]} />
                  </div>
                  <div className="mt-1 text-slate-600">attempts {p.attempts_made} · indexed {p.chunks_indexed} · failed {p.chunks_failed} · cost {p.cost_units}</div>
                  {p.failure_reason && <div className="text-rose-700">{p.failure_reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'incidents' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={newIncidentTitle} onChange={(e) => setNewIncidentTitle(e.target.value)} placeholder="Incident title" className="w-64 rounded border border-slate-200 px-2 py-1" />
            <select value={newIncidentCategory} onChange={(e) => setNewIncidentCategory(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" disabled={!newIncidentTitle || !!busy} onClick={createIncident} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'create-incident' ? 'Creating…' : 'Create incident'}
            </button>
          </div>
          {incidents.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No incidents.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {incidents.map((i) => (
                <li key={i.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{i.title}</span>
                    <span className="flex gap-1">
                      <Chip text={i.severity} tone={SEVERITY_TONE[i.severity]} />
                      <Chip text={i.status} tone={STATUS_TONE[i.status]} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">{i.category} · {fmtTime(i.created_at)}</span>
                    {i.status !== 'resolved' && i.status !== 'closed' && (
                      <button type="button" disabled={busy === `incident-${i.id}`} onClick={() => updateIncidentStatus(i.id, 'resolved')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800 disabled:opacity-50">
                        Resolve
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'replay' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={replayOpId} onChange={(e) => setReplayOpId(e.target.value)} placeholder="Replay operation id (must be approved)" className="w-80 rounded border border-slate-200 px-2 py-1" />
            <button type="button" disabled={!replayOpId || !!busy} onClick={partitionReplay} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'partition-replay' ? 'Partitioning…' : 'Partition + enqueue'}
            </button>
            <button type="button" onClick={() => void load('replay')} className="rounded bg-slate-100 px-3 py-1 text-slate-700">Refresh</button>
          </div>
          {replayPartitions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No replay partitions.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {replayPartitions.map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">#{p.partition_index}</span>
                    <Chip text={p.status} tone={STATUS_TONE[p.status]} />
                  </div>
                  <div className="mt-1 text-slate-600">attempts {p.attempts_made} · processed {p.processed_count} · skipped {p.skipped_count}</div>
                  {p.failure_reason && <div className="text-rose-700">{p.failure_reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'collections' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={newViewName} onChange={(e) => setNewViewName(e.target.value)} placeholder="New collection name" className="w-64 rounded border border-slate-200 px-2 py-1" />
            <button type="button" disabled={!newViewName || !!busy} onClick={createView} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'create-view' ? 'Creating…' : 'Create collection'}
            </button>
          </div>
          {savedViews.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No saved views yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {savedViews.map((v) => (
                <li key={v.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{v.name}</span>
                    <Chip text={v.view_kind} />
                  </div>
                  {v.description && <p className="mt-1 text-slate-600">{v.description}</p>}
                  <p className="text-[10px] text-slate-500">Updated {fmtTime(v.updated_at)} · {v.shared ? 'shared' : 'private'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={reportKind} onChange={(e) => setReportKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {REPORT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={generateReport} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'generate-report' ? 'Generating…' : 'Generate report'}
            </button>
          </div>
          {reportDefinitions.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {reportDefinitions.map((d) => (
                <li key={d.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{d.name}</span>
                    <Chip text={d.report_kind} />
                  </div>
                  <p className="text-[10px] text-slate-500">{d.enabled ? 'Enabled' : 'Disabled'} · updated {fmtTime(d.updated_at)}</p>
                </li>
              ))}
            </ul>
          )}
          {reportExecutions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No report executions yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {reportExecutions.slice(0, 10).map((e) => (
                <li key={e.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{e.report_kind}</span>
                    <Chip text={e.status} tone={STATUS_TONE[e.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{e.row_count ?? '—'} rows · {e.byte_size ?? '—'} bytes · {fmtTime(e.created_at)}</p>
                  {e.failure_reason && <p className="text-rose-700">{e.failure_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'runtime' && (
        <div className="divide-y divide-slate-100">
          {snapshot ? (
            <ul className="divide-y divide-slate-100">
              {snapshot.queues.map((q) => (
                <li key={q.name} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{q.name}</span>
                    <Chip text={q.congested ? 'congested' : 'healthy'} tone={q.congested ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'} />
                  </div>
                  <div className="mt-1 text-slate-600">waiting {q.waiting ?? '—'} · active {q.active ?? '—'} · delayed {q.delayed ?? '—'} · failed {q.failed ?? '—'} · threshold {q.threshold}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-xs text-slate-500">Loading snapshot…</div>
          )}
          {snapshot && (
            <div className="px-4 py-2 text-[11px] text-slate-600">
              Recent failures — semantic {snapshot.recent_failures.semantic_partitions} · replay {snapshot.recent_failures.replay_partitions} · execution {snapshot.recent_failures.executions}
            </div>
          )}
          {region ? (
            <div className="px-4 py-2 text-xs">
              <div className="font-medium text-slate-900">Region routing</div>
              <div className="text-slate-600">
                primary {region.primary_region}{region.failover_region ? ` · failover ${region.failover_region}` : ''} · strategy {region.failover_strategy}
              </div>
              <p className="text-[10px] text-slate-500">Updated {fmtTime(region.updated_at)}</p>
            </div>
          ) : (
            <div className="px-4 py-2 text-xs text-slate-500">No region routing configured.</div>
          )}
        </div>
      )}
    </div>
  );
}
