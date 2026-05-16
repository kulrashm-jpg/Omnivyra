/**
 * Phase 6 — Analyst Workspace.
 *
 * Compact 4-tab consolidated surface:
 *   • Lifecycle board   — counts per state across the org
 *   • Escalations       — recent escalations, severity, status, ack/resolve
 *   • Decision insights — explainable overlays from decisionIntelligenceService
 *   • Source health     — per-source health snapshot + recompute
 *
 * Realtime: subscribes to opportunity_feed + lifecycle + escalations +
 * source_health channels via the tenant-scoped channel directory and
 * refreshes the relevant tab on event. No persistent loop; the subscription
 * lifecycle follows the React component lifecycle.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type LifecycleState =
  | 'detected'
  | 'triaged'
  | 'reviewing'
  | 'qualified'
  | 'monitoring'
  | 'outreach_planned'
  | 'converted'
  | 'dismissed'
  | 'archived';

type Escalation = {
  id: string;
  escalation_type: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  body: string | null;
  assigned_to_user_id: string | null;
  sla_due_at: string | null;
  created_at: string;
};

type DecisionInsight = {
  code: string;
  headline: string;
  severity: 'info' | 'attention' | 'warning';
  window_hours: number;
  evidence: { label: string; value: string | number }[];
};

type SourceHealthRecord = {
  id: string;
  listening_source_id: string;
  health_state: 'healthy' | 'degraded' | 'unstable' | 'silenced';
  rationale: string | null;
  inputs: Record<string, number>;
  computed_at: string;
};

type Props = {
  companyId: string;
  fetchWithAuth: FetchWithAuth;
};

const LIFECYCLE_ORDER: LifecycleState[] = [
  'detected', 'triaged', 'reviewing', 'qualified', 'monitoring',
  'outreach_planned', 'converted', 'dismissed', 'archived',
];

const LIFECYCLE_TONE: Record<LifecycleState, string> = {
  detected: 'bg-slate-200 text-slate-700',
  triaged: 'bg-sky-100 text-sky-800',
  reviewing: 'bg-indigo-100 text-indigo-800',
  qualified: 'bg-emerald-100 text-emerald-800',
  monitoring: 'bg-cyan-100 text-cyan-800',
  outreach_planned: 'bg-amber-100 text-amber-800',
  converted: 'bg-green-200 text-green-900',
  dismissed: 'bg-rose-100 text-rose-800',
  archived: 'bg-slate-100 text-slate-500',
};

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-sky-100 text-sky-800',
  high: 'bg-amber-100 text-amber-800',
  critical: 'bg-rose-100 text-rose-800',
  info: 'bg-slate-100 text-slate-600',
  attention: 'bg-amber-100 text-amber-800',
  warning: 'bg-rose-100 text-rose-800',
};

const HEALTH_TONE: Record<SourceHealthRecord['health_state'], string> = {
  healthy: 'bg-emerald-100 text-emerald-800',
  degraded: 'bg-amber-100 text-amber-800',
  unstable: 'bg-rose-100 text-rose-800',
  silenced: 'bg-slate-100 text-slate-500',
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

type Tab = 'lifecycle' | 'escalations' | 'insights' | 'source_health';

export default function AnalystWorkspacePanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('lifecycle');
  const [lifecycleCounts, setLifecycleCounts] = useState<Record<LifecycleState, number>>({} as Record<LifecycleState, number>);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [insights, setInsights] = useState<DecisionInsight[]>([]);
  const [health, setHealth] = useState<SourceHealthRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setError(null);
    try {
      if (which === 'lifecycle') {
        const r = await fetchWithAuth(`/api/active-leads/lifecycle?companyId=${encodeURIComponent(companyId)}&board=1`);
        if (!r.ok) throw new Error(`lifecycle ${r.status}`);
        const json = (await r.json()) as { counts: Record<LifecycleState, number> };
        if (reqSeq.current === seq) setLifecycleCounts(json.counts ?? ({} as Record<LifecycleState, number>));
      } else if (which === 'escalations') {
        const r = await fetchWithAuth(`/api/active-leads/escalations?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`escalations ${r.status}`);
        const json = (await r.json()) as { items: Escalation[] };
        if (reqSeq.current === seq) setEscalations(json.items ?? []);
      } else if (which === 'insights') {
        const r = await fetchWithAuth(`/api/active-leads/decision-intel?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`insights ${r.status}`);
        const json = (await r.json()) as { items: DecisionInsight[] };
        if (reqSeq.current === seq) setInsights(json.items ?? []);
      } else {
        const r = await fetchWithAuth(`/api/active-leads/source-health?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`source-health ${r.status}`);
        const json = (await r.json()) as { items: SourceHealthRecord[] };
        if (reqSeq.current === seq) setHealth(json.items ?? []);
      }
    } catch (err: any) {
      if (reqSeq.current === seq) setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const updateEscalationStatus = useCallback(async (id: string, status: 'in_review' | 'resolved' | 'dismissed') => {
    if (!companyId) return;
    setBusy(id);
    try {
      await fetchWithAuth('/api/active-leads/escalations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, escalationId: id, action: 'status', status }),
      });
      await load('escalations');
    } finally {
      setBusy(null);
    }
  }, [companyId, fetchWithAuth, load]);

  const totalOpps = useMemo(() => {
    return LIFECYCLE_ORDER.reduce((sum, s) => sum + (lifecycleCounts[s] ?? 0), 0);
  }, [lifecycleCounts]);

  const openEscalationCount = escalations.filter((e) => e.status === 'open' || e.status === 'in_review').length;

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Analyst Workspace</h3>
          <p className="text-xs text-slate-500">
            Lifecycle, escalations, decision overlays and source health. All transitions explicit; all moves auditable.
          </p>
        </div>
        <div className="flex gap-1 text-[11px]">
          {(['lifecycle', 'escalations', 'insights', 'source_health'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {t === 'escalations' && openEscalationCount > 0 ? `escalations (${openEscalationCount})` : t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>
      )}

      {tab === 'lifecycle' && (
        totalOpps === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No opportunities tracked yet.</div>
        ) : (
          <div className="px-4 py-3 text-xs">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {LIFECYCLE_ORDER.map((s) => (
                <div key={s} className="rounded border border-slate-200 p-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${LIFECYCLE_TONE[s]}`}>{s}</span>
                  <div className="mt-1 text-base font-semibold text-slate-900">{lifecycleCounts[s] ?? 0}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Counts derived from the latest lifecycle transition per opportunity. Transitions are append-only and reversible only via the explicit allow-list.
            </p>
          </div>
        )
      )}

      {tab === 'escalations' && (
        escalations.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No escalations yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {escalations.map((e) => (
              <li key={e.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_TONE[e.severity]}`}>{e.severity}</span>
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{e.escalation_type}</span>
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{e.status}</span>
                      <span className="text-sm font-semibold text-slate-900">{e.title}</span>
                    </div>
                    {e.body && <p className="mt-1 text-slate-700">{e.body}</p>}
                    <div className="mt-1 text-[11px] text-slate-500">
                      SLA due: {fmtTime(e.sla_due_at)} · Created: {fmtTime(e.created_at)}
                    </div>
                  </div>
                  {(e.status === 'open' || e.status === 'in_review') && (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button type="button" onClick={() => void updateEscalationStatus(e.id, 'in_review')} disabled={busy === e.id} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">In review</button>
                      <button type="button" onClick={() => void updateEscalationStatus(e.id, 'resolved')} disabled={busy === e.id} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">Resolve</button>
                      <button type="button" onClick={() => void updateEscalationStatus(e.id, 'dismissed')} disabled={busy === e.id} className="rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50">Dismiss</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'insights' && (
        insights.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No actionable insights right now.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {insights.map((i) => (
              <li key={i.code} className="px-4 py-3 text-xs">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_TONE[i.severity]}`}>{i.severity}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{i.headline}</div>
                    <div className="mt-1 text-[11px] text-slate-500">window: {i.window_hours}h</div>
                    {i.evidence.length > 0 && (
                      <ul className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-slate-600 md:grid-cols-3">
                        {i.evidence.map((ev, idx) => (
                          <li key={idx}>{ev.label}: <strong className="text-slate-800">{ev.value}</strong></li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'source_health' && (
        health.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-500">No source health snapshots yet. Run a listening execution to seed.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {health.map((h) => (
              <li key={h.id} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${HEALTH_TONE[h.health_state]}`}>{h.health_state}</span>
                      <span className="text-[11px] text-slate-500">computed {fmtTime(h.computed_at)}</span>
                    </div>
                    {h.rationale && <p className="mt-1 text-slate-700">{h.rationale}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
