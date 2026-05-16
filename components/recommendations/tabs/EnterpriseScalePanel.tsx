/**
 * Phase 8 — Enterprise scale console.
 *
 * Compact 7-tab consolidated UI. Each tab loads on demand. No autonomous
 * refresh loop. Every mutation requires an explicit button click. Read
 * paths stream from the new APIs:
 *
 *   • dashboards     — strategic dashboard tiles
 *   • sla            — current SLA snapshot + breaches
 *   • cost           — budgets snapshot + per-category spend
 *   • partitions     — distributed execution leases
 *   • throughput     — recent ingestion windows
 *   • semantic       — semantic indexing jobs
 *   • flags          — feature flags + rollout state
 */

import React, { useCallback, useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type Tile = {
  key: string;
  title: string;
  total?: number;
  breakdown?: Array<{ label: string; value: number }>;
  rationale: string;
};

type SlaVerdict = {
  sla_kind: string;
  observed_value: number;
  warn_threshold: number;
  breach_threshold: number;
  unit: string;
  severity: 'ok' | 'warn' | 'breach' | 'critical';
  rationale: string;
};

type CostCategorySnapshot = {
  category: string;
  current_spend: number;
  soft_ceiling: number;
  hard_ceiling: number;
  soft_pct: number;
  hard_pct: number;
  enabled: boolean;
  anomaly_score: number;
};

type Partition = {
  id: string;
  partition_key: string;
  owner_worker_id: string | null;
  status: string;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
};

type ThroughputState = {
  id: string;
  scope: string;
  bucket: string;
  window_end: string;
  consumed_count: number;
  consumed_credits: number;
  cap_count: number | null;
  cap_credits: number | null;
};

type SemanticJob = {
  id: string;
  source_kind: string;
  status: string;
  chunks_indexed: number;
  chunks_failed: number;
  cost_units: number;
  embedding_provider: string;
  embedding_dim: number;
  created_at: string;
  completed_at: string | null;
};

type FeatureFlag = {
  id: string;
  flag_key: string;
  enabled: boolean;
  rollout_cohort: string | null;
  rollout_percent: number | null;
  activated_at: string | null;
  reverted_at: string | null;
};

const STATUS_TONE: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  breach: 'bg-rose-100 text-rose-800',
  critical: 'bg-rose-100 text-rose-800',
  idle: 'bg-slate-100 text-slate-600',
  leased: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-amber-100 text-amber-800',
  released: 'bg-slate-100 text-slate-500',
  quarantined: 'bg-rose-100 text-rose-800',
  queued: 'bg-slate-100 text-slate-700',
  running: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
};

type Tab = 'dashboards' | 'sla' | 'cost' | 'partitions' | 'throughput' | 'semantic' | 'flags';

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${Math.round(value * 100)}%`;
}

export default function EnterpriseScalePanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('dashboards');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [sla, setSla] = useState<{ verdicts: SlaVerdict[] } | null>(null);
  const [cost, setCost] = useState<{ per_category: CostCategorySnapshot[] } | null>(null);
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [throughput, setThroughput] = useState<ThroughputState[]>([]);
  const [semantic, setSemantic] = useState<SemanticJob[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'dashboards') {
        const r = await fetchWithAuth(`/api/active-leads/dashboards?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`dashboards ${r.status}`);
        const json = (await r.json()) as { tiles: Tile[] };
        setTiles(json.tiles ?? []);
      } else if (which === 'sla') {
        const r = await fetchWithAuth(`/api/active-leads/sla?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`sla ${r.status}`);
        const json = (await r.json()) as { verdicts: SlaVerdict[] };
        setSla(json);
      } else if (which === 'cost') {
        const r = await fetchWithAuth(`/api/active-leads/cost-governance?companyId=${encodeURIComponent(companyId)}&snapshot=1`);
        if (!r.ok) throw new Error(`cost ${r.status}`);
        const json = (await r.json()) as { per_category: CostCategorySnapshot[] };
        setCost(json);
      } else if (which === 'partitions') {
        const r = await fetchWithAuth(`/api/active-leads/partitions?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`partitions ${r.status}`);
        const json = (await r.json()) as { items: Partition[] };
        setPartitions(json.items ?? []);
      } else if (which === 'throughput') {
        const r = await fetchWithAuth(`/api/active-leads/throughput?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`throughput ${r.status}`);
        const json = (await r.json()) as { items: ThroughputState[] };
        setThroughput(json.items ?? []);
      } else if (which === 'semantic') {
        const r = await fetchWithAuth(`/api/active-leads/semantic-indexing?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`semantic ${r.status}`);
        const json = (await r.json()) as { items: SemanticJob[] };
        setSemantic(json.items ?? []);
      } else if (which === 'flags') {
        const r = await fetchWithAuth(`/api/active-leads/feature-flags?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`flags ${r.status}`);
        const json = (await r.json()) as { items: FeatureFlag[] };
        setFlags(json.items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const recoverPartitions = useCallback(async () => {
    setBusy('recover');
    try {
      await fetchWithAuth('/api/active-leads/partitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'recover' }),
      });
      await load('partitions');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, load]);

  const toggleFlag = useCallback(async (flagId: string, activate: boolean) => {
    setBusy(flagId);
    try {
      await fetchWithAuth('/api/active-leads/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: activate ? 'activate' : 'revert', flagId }),
      });
      await load('flags');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, load]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Enterprise Scale Console</h3>
          <p className="text-xs text-slate-500">
            Dashboards, SLA, cost, partitions, throughput, semantic indexing, feature flags. Every action attributed.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['dashboards', 'sla', 'cost', 'partitions', 'throughput', 'semantic', 'flags'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'dashboards' && (
        tiles.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No dashboard data yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tiles.map((tile) => (
              <li key={tile.key} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{tile.title}</span>
                  {typeof tile.total === 'number' && <span className="text-[11px] font-semibold text-slate-700">total {tile.total}</span>}
                </div>
                <p className="mt-1 text-slate-600">{tile.rationale}</p>
                {tile.breakdown && tile.breakdown.length > 0 && (
                  <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] md:grid-cols-3">
                    {tile.breakdown.map((b, idx) => (
                      <li key={`${tile.key}-${idx}`} className="text-slate-700"><strong>{b.label}</strong>: {b.value}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'sla' && (
        !sla || sla.verdicts.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No SLA verdicts yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sla.verdicts.map((v) => (
              <li key={v.sla_kind} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[v.severity] ?? 'bg-slate-100 text-slate-600'}`}>{v.severity}</span>
                  <span className="text-sm font-semibold text-slate-900">{v.sla_kind}</span>
                  <span className="text-[11px] text-slate-500">observed {v.observed_value} {v.unit}</span>
                </div>
                <p className="mt-1 text-slate-700">{v.rationale}</p>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'cost' && (
        !cost || cost.per_category.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No cost budgets configured yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cost.per_category.map((c) => (
              <li key={c.category} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{c.category}</span>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${c.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{c.enabled ? 'enabled' : 'disabled'}</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-slate-700 md:grid-cols-4">
                  <span>Spent <strong>{c.current_spend}</strong></span>
                  <span>Soft <strong>{c.soft_ceiling}</strong> ({fmtPct(c.soft_pct)})</span>
                  <span>Hard <strong>{c.hard_ceiling}</strong> ({fmtPct(c.hard_pct)})</span>
                  <span>Anomaly <strong>{c.anomaly_score}</strong></span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'partitions' && (
        <div>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs">
            <span className="text-slate-500">{partitions.length} partition(s)</span>
            <button type="button" onClick={() => void recoverPartitions()} disabled={busy === 'recover'} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Recover expired
            </button>
          </div>
          {partitions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No partitions yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {partitions.map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[p.status] ?? 'bg-slate-100 text-slate-600'}`}>{p.status}</span>
                    <span className="text-sm font-semibold text-slate-900">{p.partition_key}</span>
                    <span className="text-[10px] text-slate-500">owner {p.owner_worker_id ?? '—'}</span>
                    <span className="text-[10px] text-slate-500">expires {fmtTime(p.lease_expires_at)}</span>
                    <span className="text-[10px] text-slate-500">heartbeat {fmtTime(p.heartbeat_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'throughput' && (
        throughput.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No throughput windows yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {throughput.slice(0, 20).map((t) => (
              <li key={t.id} className="px-4 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{t.scope}/{t.bucket}</span>
                  <span className="text-[11px] text-slate-700">window ends {fmtTime(t.window_end)}</span>
                  <span className="text-[11px] text-slate-700">count {t.consumed_count}{t.cap_count != null && ` / ${t.cap_count}`}</span>
                  <span className="text-[11px] text-slate-700">credits {t.consumed_credits}{t.cap_credits != null && ` / ${t.cap_credits}`}</span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'semantic' && (
        semantic.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No semantic indexing jobs yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {semantic.map((j) => (
              <li key={j.id} className="px-4 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[j.status] ?? 'bg-slate-100 text-slate-600'}`}>{j.status}</span>
                  <span className="text-sm font-semibold text-slate-900">{j.source_kind}</span>
                  <span className="text-[10px] text-slate-500">{j.embedding_provider} · dim {j.embedding_dim}</span>
                  <span className="text-[11px] text-slate-700">indexed {j.chunks_indexed}</span>
                  <span className="text-[11px] text-slate-700">failed {j.chunks_failed}</span>
                  <span className="text-[11px] text-slate-700">cost {j.cost_units}</span>
                  <span className="text-[10px] text-slate-400">· {fmtTime(j.completed_at ?? j.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'flags' && (
        flags.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No feature flags configured.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {flags.map((f) => (
              <li key={f.id} className="px-4 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{f.flag_key}</span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${f.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{f.enabled ? 'enabled' : 'disabled'}</span>
                      {f.rollout_percent != null && f.rollout_percent < 100 && (
                        <span className="text-[10px] text-slate-500">rollout {f.rollout_percent}%</span>
                      )}
                      {f.rollout_cohort && <span className="text-[10px] text-slate-500">cohort: {f.rollout_cohort}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => void toggleFlag(f.id, !f.enabled)} disabled={busy === f.id} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {f.enabled ? 'Revert' : 'Activate'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
