/**
 * Phase 12 — GA Launch Console.
 *
 * Compact 7-tab consolidated UI for final production readiness surfaces.
 *
 *   • stab   — Platform Stabilization Center
 *   • sre    — SRE Operations Console
 *   • supp   — Enterprise Support Workspace
 *   • gov    — Runtime Governance Center
 *   • adv    — Resilience Planning Workspace
 *   • cust   — Customer Operations Dashboard
 *   • obs    — Unified Observability Hub
 *
 * Every action explicit; no autonomous refresh; every mutation calls a
 * Phase 12 API.
 */

import React, { useCallback, useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type Tab = 'stab' | 'sre' | 'supp' | 'gov' | 'adv' | 'cust' | 'obs';

type StabWindow = {
  id: string;
  window_name: string;
  freeze_mode: string;
  freeze_scope: string;
  state: string;
  scheduled_start: string;
  scheduled_end: string;
  rationale: string | null;
};

type SreSnapshot = {
  id: string;
  snapshot_kind: string;
  health_state: string;
  measures: Record<string, number>;
  heatmap: Array<{ label: string; value: number; state: string; note?: string }>;
  derivation_explanation: string | null;
  created_at: string;
};

type SupportSnapshotRow = {
  id: string;
  snapshot_kind: string;
  scope_description: string | null;
  payload_hash: string;
  row_count: number;
  byte_size: number;
  status: string;
  redaction_applied: Array<{ field_path: string; redaction_kind: string }>;
  linked_incident_id: string | null;
  created_at: string;
};

type ConvergenceScore = {
  id: string;
  scope_kind: string;
  convergence_score: number;
  drift_score: number;
  risk_overlays: Array<{ overlay_kind: string; severity: string; detail: string }>;
  contributing_components: Array<{ component_kind: string; weight: number; observed_score: number; passed: boolean; detail: string }>;
  derivation_explanation: string | null;
  created_at: string;
};

type AdvisoryPlan = {
  id: string;
  plan_kind: string;
  trigger_summary: string;
  recommended_steps: Array<{ step_index: number; step_kind: string; detail: string; external_api_hint?: string }>;
  evidence_refs: Array<{ source_kind: string; source_id: string; detail: string }>;
  status: string;
  created_at: string;
};

type CustomerScore = {
  id: string;
  score_kind: string;
  score_value: number;
  components: Array<{ component_kind: string; weight: number; observed_score: number; passed: boolean; detail: string }>;
  rationale: string | null;
  created_at: string;
};

type ObsProjection = {
  id: string;
  projection_kind: string;
  unified_health_state: string;
  drift_detected: boolean;
  resilience_overlays: Array<{ overlay_kind: string; severity: string; detail: string }>;
  bounded_window_start: string;
  bounded_window_end: string;
  derivation_explanation: string | null;
  created_at: string;
};

const TONE: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-700', active: 'bg-amber-100 text-amber-800', closed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-500', expired: 'bg-slate-100 text-slate-500',
  healthy: 'bg-emerald-100 text-emerald-800', degraded: 'bg-amber-100 text-amber-800', critical: 'bg-rose-100 text-rose-800',
  unknown: 'bg-slate-100 text-slate-500',
  complete: 'bg-emerald-100 text-emerald-800', partial: 'bg-amber-100 text-amber-800', failed: 'bg-rose-100 text-rose-800',
  advisory: 'bg-slate-100 text-slate-700', acknowledged: 'bg-emerald-100 text-emerald-800', superseded: 'bg-slate-100 text-slate-500',
  info: 'bg-slate-100 text-slate-700', warn: 'bg-amber-100 text-amber-800',
};

function fmtTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Chip({ text, tone }: { text: string; tone?: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone ?? 'bg-slate-100 text-slate-700'}`}>{text}</span>;
}

const FREEZE_MODES = ['soft', 'hard', 'emergency_pause', 'degradation_only'] as const;
const FREEZE_SCOPES = ['platform', 'rollouts', 'migrations', 'semantic', 'replay', 'connectors', 'executions'] as const;
const SRE_KINDS = ['runtime_dependency_health', 'queue_saturation', 'projection_lag_heatmap', 'semantic_backlog_heatmap', 'replay_backlog', 'connector_degradation_map'] as const;
const SUPPORT_KINDS = ['support_bundle', 'issue_reproduction', 'tenant_diagnostic', 'execution_replay_ref', 'incident_bundle', 'operational_trace'] as const;
const GOV_SCOPES = ['overall', 'rollout', 'safeguards', 'sla', 'resilience', 'operational_risk', 'governance_drift'] as const;
const ADV_KINDS = ['recovery', 'replay', 'stabilization', 'rollback_preparation', 'partition_recovery'] as const;
const CUST_KINDS = ['tenant_readiness', 'rollout_cohort', 'onboarding_completion', 'operational_maturity', 'tenant_health', 'support_escalation_readiness'] as const;
const OBS_KINDS = ['runtime', 'rollout', 'sla', 'semantic', 'replay', 'safeguards', 'governance', 'unified'] as const;

export default function GALaunchPanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('stab');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [stabWindows, setStabWindows] = useState<StabWindow[]>([]);
  const [newStabName, setNewStabName] = useState('');
  const [newStabMode, setNewStabMode] = useState<string>('soft');
  const [newStabScope, setNewStabScope] = useState<string>('platform');

  const [sreKind, setSreKind] = useState<string>('runtime_dependency_health');
  const [sreSnapshots, setSreSnapshots] = useState<SreSnapshot[]>([]);

  const [supportKind, setSupportKind] = useState<string>('support_bundle');
  const [supportSnapshots, setSupportSnapshots] = useState<SupportSnapshotRow[]>([]);

  const [govScope, setGovScope] = useState<string>('overall');
  const [govScores, setGovScores] = useState<ConvergenceScore[]>([]);

  const [advKind, setAdvKind] = useState<string>('recovery');
  const [advTrigger, setAdvTrigger] = useState<string>('');
  const [advPlans, setAdvPlans] = useState<AdvisoryPlan[]>([]);

  const [custKind, setCustKind] = useState<string>('tenant_readiness');
  const [custScores, setCustScores] = useState<CustomerScore[]>([]);

  const [obsKind, setObsKind] = useState<string>('unified');
  const [obsProjections, setObsProjections] = useState<ObsProjection[]>([]);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'stab') {
        const r = await fetchWithAuth(`/api/active-leads/platform-stabilization?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`stab ${r.status}`);
        setStabWindows(((await r.json()) as { items: StabWindow[] }).items ?? []);
      } else if (which === 'sre') {
        const r = await fetchWithAuth(`/api/active-leads/sre-operations?companyId=${encodeURIComponent(companyId)}&snapshotKind=${sreKind}`);
        if (!r.ok) throw new Error(`sre ${r.status}`);
        setSreSnapshots(((await r.json()) as { items: SreSnapshot[] }).items ?? []);
      } else if (which === 'supp') {
        const r = await fetchWithAuth(`/api/active-leads/support-snapshots?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`supp ${r.status}`);
        setSupportSnapshots(((await r.json()) as { items: SupportSnapshotRow[] }).items ?? []);
      } else if (which === 'gov') {
        const r = await fetchWithAuth(`/api/active-leads/governance-convergence?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`gov ${r.status}`);
        setGovScores(((await r.json()) as { items: ConvergenceScore[] }).items ?? []);
      } else if (which === 'adv') {
        const r = await fetchWithAuth(`/api/active-leads/resilience-advisory?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`adv ${r.status}`);
        setAdvPlans(((await r.json()) as { items: AdvisoryPlan[] }).items ?? []);
      } else if (which === 'cust') {
        const r = await fetchWithAuth(`/api/active-leads/customer-operations?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`cust ${r.status}`);
        setCustScores(((await r.json()) as { items: CustomerScore[] }).items ?? []);
      } else if (which === 'obs') {
        const r = await fetchWithAuth(`/api/active-leads/observability-convergence?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`obs ${r.status}`);
        setObsProjections(((await r.json()) as { items: ObsProjection[] }).items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth, sreKind]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const createStab = useCallback(async () => {
    if (!newStabName) return;
    setBusy('create-stab');
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 3600_000);
      await fetchWithAuth('/api/active-leads/platform-stabilization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId, action: 'create',
          windowName: newStabName, freezeMode: newStabMode, freezeScope: newStabScope,
          scheduledStart: now.toISOString(), scheduledEnd: end.toISOString(),
        }),
      });
      setNewStabName('');
      await load('stab');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, newStabName, newStabMode, newStabScope, load]);

  const stabAction = useCallback(async (windowId: string, action: 'activate' | 'close') => {
    setBusy(`stab-${windowId}-${action}`);
    try {
      await fetchWithAuth('/api/active-leads/platform-stabilization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action, windowId }),
      });
      await load('stab');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const sreCapture = useCallback(async () => {
    setBusy('sre');
    try {
      await fetchWithAuth('/api/active-leads/sre-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, snapshotKind: sreKind }),
      });
      await load('sre');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, sreKind, load]);

  const supportGen = useCallback(async () => {
    setBusy('supp');
    try {
      await fetchWithAuth('/api/active-leads/support-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, snapshotKind: supportKind }),
      });
      await load('supp');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, supportKind, load]);

  const govGen = useCallback(async () => {
    setBusy('gov');
    try {
      await fetchWithAuth('/api/active-leads/governance-convergence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, scopeKind: govScope }),
      });
      await load('gov');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, govScope, load]);

  const advGen = useCallback(async () => {
    if (!advTrigger) return;
    setBusy('adv');
    try {
      await fetchWithAuth('/api/active-leads/resilience-advisory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'generate', planKind: advKind, triggerSummary: advTrigger }),
      });
      setAdvTrigger('');
      await load('adv');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, advKind, advTrigger, load]);

  const advTransition = useCallback(async (planId: string, newStatus: 'acknowledged' | 'superseded' | 'expired') => {
    setBusy(`adv-${planId}`);
    try {
      await fetchWithAuth('/api/active-leads/resilience-advisory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'transition', planId, newStatus }),
      });
      await load('adv');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const custGen = useCallback(async () => {
    setBusy('cust');
    try {
      await fetchWithAuth('/api/active-leads/customer-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, scoreKind: custKind }),
      });
      await load('cust');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, custKind, load]);

  const obsGen = useCallback(async () => {
    setBusy('obs');
    try {
      await fetchWithAuth('/api/active-leads/observability-convergence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, projectionKind: obsKind }),
      });
      await load('obs');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, obsKind, load]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">GA Launch Console</h3>
          <p className="text-xs text-slate-500">
            Stabilization, SRE, support, governance convergence, advisory, customer ops, observability convergence. Operator-driven.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['stab', 'sre', 'supp', 'gov', 'adv', 'cust', 'obs'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'stab' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={newStabName} onChange={(e) => setNewStabName(e.target.value)} placeholder="window name" className="w-56 rounded border border-slate-200 px-2 py-1" />
            <select value={newStabMode} onChange={(e) => setNewStabMode(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {FREEZE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={newStabScope} onChange={(e) => setNewStabScope(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {FREEZE_SCOPES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" disabled={!newStabName || !!busy} onClick={createStab} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'create-stab' ? 'Creating…' : 'Create (1h window)'}
            </button>
          </div>
          {stabWindows.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No stabilization windows.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {stabWindows.map((w) => (
                <li key={w.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{w.window_name}</span>
                    <span className="flex gap-1">
                      <Chip text={w.freeze_mode} />
                      <Chip text={w.freeze_scope} />
                      <Chip text={w.state} tone={TONE[w.state]} />
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(w.scheduled_start)} → {fmtTime(w.scheduled_end)}</p>
                  {w.rationale && <p className="text-[10px] text-slate-600">{w.rationale}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.state === 'planned' && <button type="button" disabled={!!busy} onClick={() => stabAction(w.id, 'activate')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Activate</button>}
                    {(w.state === 'planned' || w.state === 'active') && <button type="button" disabled={!!busy} onClick={() => stabAction(w.id, 'close')} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Close</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'sre' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={sreKind} onChange={(e) => setSreKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {SRE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={sreCapture} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'sre' ? 'Capturing…' : 'Capture snapshot'}
            </button>
          </div>
          {sreSnapshots.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No snapshots for this kind.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sreSnapshots.slice(0, 10).map((s) => (
                <li key={s.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.snapshot_kind}</span>
                    <Chip text={s.health_state} tone={TONE[s.health_state]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(s.created_at)} · {s.derivation_explanation ?? '—'}</p>
                  <ul className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-3">
                    {s.heatmap.map((c, idx) => (
                      <li key={idx} className="rounded bg-slate-50 px-2 py-1 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span>{c.label}</span>
                          <Chip text={`${c.value}`} tone={TONE[c.state]} />
                        </div>
                        {c.note && <p className="text-[9px] text-slate-500">{c.note}</p>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'supp' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={supportKind} onChange={(e) => setSupportKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {SUPPORT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={supportGen} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'supp' ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {supportSnapshots.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No support snapshots.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {supportSnapshots.map((s) => (
                <li key={s.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.snapshot_kind}</span>
                    <Chip text={s.status} tone={TONE[s.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{s.row_count} rows · {s.byte_size} bytes · hash {s.payload_hash.slice(0, 16)}… · {fmtTime(s.created_at)}</p>
                  {s.redaction_applied.length > 0 && (
                    <p className="text-[10px] text-slate-500">Redactions: {s.redaction_applied.map((r) => `${r.field_path}(${r.redaction_kind})`).join(' · ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'gov' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={govScope} onChange={(e) => setGovScope(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {GOV_SCOPES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={govGen} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'gov' ? 'Scoring…' : 'Score'}
            </button>
          </div>
          {govScores.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No convergence scores.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {govScores.slice(0, 10).map((g) => (
                <li key={g.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{g.scope_kind}</span>
                    <span className="flex gap-1">
                      <Chip text={`conv ${(g.convergence_score * 100).toFixed(0)}%`} tone="bg-emerald-100 text-emerald-800" />
                      <Chip text={`drift ${(g.drift_score * 100).toFixed(0)}%`} tone={g.drift_score > 0.5 ? 'bg-rose-100 text-rose-800' : g.drift_score > 0.25 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'} />
                    </span>
                  </div>
                  {g.derivation_explanation && <p className="text-[10px] text-slate-500">{g.derivation_explanation}</p>}
                  {g.risk_overlays.length > 0 && (
                    <ul className="mt-1 text-[10px] text-slate-600">
                      {g.risk_overlays.map((o, idx) => (
                        <li key={idx}><Chip text={o.severity} tone={TONE[o.severity]} /> {o.overlay_kind}: {o.detail}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'adv' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={advKind} onChange={(e) => setAdvKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {ADV_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={advTrigger} onChange={(e) => setAdvTrigger(e.target.value)} placeholder="trigger summary" className="w-64 rounded border border-slate-200 px-2 py-1" />
            <button type="button" disabled={!advTrigger || !!busy} onClick={advGen} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'adv' ? 'Generating…' : 'Generate advisory'}
            </button>
          </div>
          {advPlans.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No advisory plans.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {advPlans.map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{p.plan_kind}</span>
                    <Chip text={p.status} tone={TONE[p.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{p.trigger_summary} · {fmtTime(p.created_at)}</p>
                  <ul className="mt-1 text-[10px] text-slate-600">
                    {p.recommended_steps.map((s) => (
                      <li key={s.step_index}>#{s.step_index} {s.step_kind} — {s.detail}{s.external_api_hint ? ` (${s.external_api_hint})` : ''}</li>
                    ))}
                  </ul>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.status === 'advisory' && <button type="button" disabled={!!busy} onClick={() => advTransition(p.id, 'acknowledged')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Acknowledge</button>}
                    {p.status === 'advisory' && <button type="button" disabled={!!busy} onClick={() => advTransition(p.id, 'superseded')} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Supersede</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'cust' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={custKind} onChange={(e) => setCustKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {CUST_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={custGen} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'cust' ? 'Scoring…' : 'Score'}
            </button>
          </div>
          {custScores.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No customer-ops scores.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {custScores.slice(0, 10).map((s) => (
                <li key={s.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.score_kind}</span>
                    <Chip text={`${(s.score_value * 100).toFixed(0)}%`} />
                  </div>
                  {s.rationale && <p className="text-[10px] text-slate-500">{s.rationale}</p>}
                  <ul className="mt-1 text-[10px] text-slate-600">
                    {s.components.map((c, idx) => (
                      <li key={idx}>{c.passed ? '✓' : '✗'} {c.component_kind} (w={c.weight}) — {c.detail}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'obs' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={obsKind} onChange={(e) => setObsKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {OBS_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={obsGen} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'obs' ? 'Projecting…' : 'Project (24h default)'}
            </button>
          </div>
          {obsProjections.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No observability projections.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {obsProjections.slice(0, 10).map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{p.projection_kind}</span>
                    <span className="flex gap-1">
                      <Chip text={p.unified_health_state} tone={TONE[p.unified_health_state]} />
                      {p.drift_detected && <Chip text="drift" tone="bg-rose-100 text-rose-800" />}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(p.bounded_window_start)} → {fmtTime(p.bounded_window_end)} · {p.derivation_explanation ?? '—'}</p>
                  {p.resilience_overlays.length > 0 && (
                    <ul className="mt-1 text-[10px] text-slate-600">
                      {p.resilience_overlays.slice(0, 5).map((o, idx) => (
                        <li key={idx}><Chip text={o.severity} tone={TONE[o.severity]} /> {o.overlay_kind}: {o.detail}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
