/**
 * Phase 5 — Combined intelligence panel.
 *
 * Compact tabbed surface that consolidates the Phase 5 reads:
 *   • Source ROI          (source-performance per source + health)
 *   • Alert Center        (recent alerts + ack)
 *   • Identity Links      (candidates / confirmed / rejected with reversibility)
 *   • Graph Overview      (node counts + per-opportunity one-hop view)
 *
 * No layout redesign. Renders below the Phase-4 OpportunityFeedPanel.
 * Designed to be the dense ops surface without bloating the screen with
 * four additional independent panels.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SourceProfile = {
  listening_source_id: string;
  source_type: string;
  source_identifier: string;
  display_name: string;
  status: string;
  platform: string | null;
  execution_count: number;
  partial_count: number;
  failed_count: number;
  total_credits_spent: number;
  signals_persisted: number;
  signals_blocked: number;
  opportunity_count: number;
  buying_intent_count: number;
  quality_scores: {
    quality_score: number;
    noise_score: number;
    intent_density_score: number;
    strategic_value_score: number;
  };
  cost_per_opportunity: number | null;
  cost_per_signal: number | null;
  health: 'strong' | 'moderate' | 'weak' | 'unhealthy';
};

type Alert = {
  id: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  body: string;
  acknowledged_at: string | null;
  created_at: string;
};

type IdentityLink = {
  id: string;
  primary_platform: string;
  primary_handle: string;
  secondary_platform: string;
  secondary_handle: string;
  confidence_score: number;
  evidence_signals: string[];
  link_status: 'candidate' | 'confirmed' | 'rejected';
};

const HEALTH_TONE: Record<SourceProfile['health'], string> = {
  strong: 'bg-emerald-100 text-emerald-800',
  moderate: 'bg-sky-100 text-sky-800',
  weak: 'bg-amber-100 text-amber-800',
  unhealthy: 'bg-rose-100 text-rose-800',
};

const SEVERITY_TONE: Record<Alert['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-sky-100 text-sky-800',
  high: 'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-800',
};

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${Math.round(value * 100)}%`;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

type Tab = 'sources' | 'alerts' | 'identity' | 'graph';

type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

export default function IntelligencePanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('sources');
  const [sources, setSources] = useState<SourceProfile[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [identity, setIdentity] = useState<IdentityLink[]>([]);
  const [graphCounts, setGraphCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/active-leads/source-performance?companyId=${encodeURIComponent(companyId)}`);
      if (!r.ok) throw new Error(`source-performance ${r.status}`);
      const json = (await r.json()) as { items: SourceProfile[] };
      setSources(json.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load source performance');
    }
  }, [companyId, fetchWithAuth]);

  const loadAlerts = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/active-leads/alerts?companyId=${encodeURIComponent(companyId)}`);
      if (!r.ok) throw new Error(`alerts ${r.status}`);
      const json = (await r.json()) as { items: Alert[] };
      setAlerts(json.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load alerts');
    }
  }, [companyId, fetchWithAuth]);

  const loadIdentity = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/active-leads/identity-resolution?companyId=${encodeURIComponent(companyId)}&minConfidence=0.3`);
      if (!r.ok) throw new Error(`identity ${r.status}`);
      const json = (await r.json()) as { items: IdentityLink[] };
      setIdentity(json.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load identity links');
    }
  }, [companyId, fetchWithAuth]);

  const loadGraph = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const r = await fetchWithAuth(`/api/active-leads/graph?companyId=${encodeURIComponent(companyId)}`);
      if (!r.ok) throw new Error(`graph ${r.status}`);
      const json = (await r.json()) as { node_counts: Record<string, number> };
      setGraphCounts(json.node_counts ?? {});
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load graph');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (tab === 'sources') void loadSources();
    if (tab === 'alerts') void loadAlerts();
    if (tab === 'identity') void loadIdentity();
    if (tab === 'graph') void loadGraph();
  }, [tab, loadSources, loadAlerts, loadIdentity, loadGraph]);

  const ackAlert = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await fetchWithAuth('/api/active-leads/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, alertId: id, action: 'acknowledge' }),
      });
      await loadAlerts();
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, loadAlerts]);

  const identityAction = useCallback(async (id: string, action: 'confirm' | 'reject' | 'reopen') => {
    setBusy(id);
    try {
      await fetchWithAuth('/api/active-leads/identity-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, linkId: id, action }),
      });
      await loadIdentity();
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, loadIdentity]);

  const unackCount = useMemo(() => alerts.filter((a) => !a.acknowledged_at).length, [alerts]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Source Intelligence</h3>
          <p className="text-xs text-slate-500">
            Source ROI, alerts, identity links, and graph view. Every relationship is reversible and explainable.
          </p>
        </div>
        <div className="flex gap-1 text-[11px]">
          {(['sources', 'alerts', 'identity', 'graph'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {t === 'alerts' && unackCount > 0 ? `alerts (${unackCount})` : t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
      )}

      {tab === 'sources' && (
        sources.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No source performance data yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sources.map((s) => (
              <li key={s.listening_source_id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{s.display_name}</span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${HEALTH_TONE[s.health]}`}>{s.health}</span>
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{s.platform ?? s.source_type}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-500 md:grid-cols-4">
                      <span>Runs <strong className="text-slate-700">{s.execution_count}</strong> ({s.partial_count}p / {s.failed_count}f)</span>
                      <span>Signals <strong className="text-slate-700">{s.signals_persisted}</strong> · blocked {s.signals_blocked}</span>
                      <span>Opps <strong className="text-slate-700">{s.opportunity_count}</strong> · buying {s.buying_intent_count}</span>
                      <span>Credits <strong className="text-slate-700">{s.total_credits_spent}</strong></span>
                      <span>Quality <strong className="text-slate-700">{fmtPct(s.quality_scores.quality_score)}</strong></span>
                      <span>Noise <strong className="text-slate-700">{fmtPct(s.quality_scores.noise_score)}</strong></span>
                      <span>Intent <strong className="text-slate-700">{fmtPct(s.quality_scores.intent_density_score)}</strong></span>
                      <span>Strategic <strong className="text-slate-700">{fmtPct(s.quality_scores.strategic_value_score)}</strong></span>
                      <span>$/signal <strong className="text-slate-700">{s.cost_per_signal ?? '—'}</strong></span>
                      <span>$/opp <strong className="text-slate-700">{s.cost_per_opportunity ?? '—'}</strong></span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'alerts' && (
        alerts.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No alerts yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {alerts.map((a) => (
              <li key={a.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_TONE[a.severity]}`}>{a.severity}</span>
                      <span className="text-sm font-semibold text-slate-900">{a.title}</span>
                      <span className="text-[10px] text-slate-500">{a.alert_type}</span>
                      <span className="text-[10px] text-slate-400">· {fmtTime(a.created_at)}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{a.body}</p>
                  </div>
                  {!a.acknowledged_at && (
                    <button
                      type="button"
                      onClick={() => void ackAlert(a.id)}
                      disabled={busy === a.id}
                      className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'identity' && (
        identity.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No identity link candidates yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {identity.map((l) => (
              <li key={l.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {l.primary_platform}:{l.primary_handle} ↔ {l.secondary_platform}:{l.secondary_handle}
                      </span>
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        confidence {fmtPct(l.confidence_score)}
                      </span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                        l.link_status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                          : l.link_status === 'rejected' ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}>{l.link_status}</span>
                    </div>
                    {l.evidence_signals.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.evidence_signals.map((e) => (
                          <span key={e} className="rounded bg-slate-50 px-1 py-0.5 text-[10px] text-slate-600">{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {l.link_status !== 'confirmed' && (
                      <button type="button" onClick={() => void identityAction(l.id, 'confirm')} disabled={busy === l.id} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">Confirm</button>
                    )}
                    {l.link_status !== 'rejected' && (
                      <button type="button" onClick={() => void identityAction(l.id, 'reject')} disabled={busy === l.id} className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>
                    )}
                    {l.link_status !== 'candidate' && (
                      <button type="button" onClick={() => void identityAction(l.id, 'reopen')} disabled={busy === l.id} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">Reopen</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'graph' && (
        <div className="px-4 py-3 text-xs">
          <div className="font-semibold text-slate-700">Graph node counts (this org)</div>
          {Object.keys(graphCounts).length === 0 ? (
            <p className="mt-1 text-slate-500">Graph has not been populated yet. Run an execution to generate opportunities.</p>
          ) : (
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-700 md:grid-cols-3">
              {Object.entries(graphCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <li key={type}>{type}: <strong>{count}</strong></li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Deterministic projection. Each opportunity links to at most 1 cluster, 1 source, 1 author, 1 execution, 5 keywords, 3 competitors.
          </p>
        </div>
      )}
    </div>
  );
}
