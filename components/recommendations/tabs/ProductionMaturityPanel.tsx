/**
 * Phase 10 — Production Maturity Console.
 *
 * Compact 8-tab consolidated UI for marketplace + production-readiness
 * surfaces. Every action explicit; no autonomous refresh.
 *
 *   • marketplace  — Connector Marketplace
 *   • onboarding   — Enterprise Onboarding Center
 *   • ai_invest    — AI Investigation Workspace
 *   • trends       — Historical Intelligence Trends
 *   • dr           — Disaster Recovery Console
 *   • compliance   — Compliance Readiness Center
 *   • macros       — Analyst Acceleration Toolkit
 *   • safeguards   — Production Safeguards Dashboard
 */

import React, { useCallback, useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type Tab = 'marketplace' | 'onboarding' | 'ai_invest' | 'trends' | 'dr' | 'compliance' | 'macros' | 'safeguards';

type MarketplaceConnector = {
  id: string;
  connector_slug: string;
  display_name: string;
  vendor: string;
  version: string;
  certification_state: string;
  rollout_state: string;
  signature_hash: string;
  updated_at: string;
};

type OnboardingApplication = {
  id: string;
  template_kind: string;
  status: string;
  approved_by: string | null;
  failure_reason: string | null;
  created_at: string;
};

type InvestigationSummary = {
  id: string;
  investigation_kind: string;
  subject_ref: string;
  summary_text: string;
  generation_method: string;
  evidence_refs: Array<{ source_kind: string; source_id: string; weight: number }>;
  created_at: string;
};

type Trend = {
  id: string;
  trend_kind: string;
  window_kind: string;
  window_start: string;
  window_end: string;
  series: Array<{ bucket: string; value: number }>;
  derivation_explanation: string | null;
};

type DrExecution = {
  id: string;
  plan_kind: string;
  status: string;
  approved_by: string | null;
  failure_reason: string | null;
  created_at: string;
};

type ComplianceExport = {
  id: string;
  evidence_kind: string;
  certification_target: string;
  row_count: number;
  byte_size: number;
  payload_hash: string;
  status: string;
  created_at: string;
};

type AnalystMacro = {
  id: string;
  macro_kind: string;
  name: string;
  enabled: boolean;
  shared: boolean;
  updated_at: string;
};

type SafeguardStateRow = {
  id: string;
  safeguard_kind: string;
  state: string;
  threshold_value: number;
  observed_value: number;
  triggered_at: string | null;
  recovered_at: string | null;
};

const TONE: Record<string, string> = {
  uncertified: 'bg-slate-100 text-slate-700',
  review: 'bg-amber-100 text-amber-800',
  certified: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  revoked: 'bg-rose-100 text-rose-800',
  inactive: 'bg-slate-100 text-slate-600',
  staged: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  retired: 'bg-slate-100 text-slate-500',
  previewed: 'bg-slate-100 text-slate-700',
  approved: 'bg-amber-100 text-amber-800',
  applied: 'bg-emerald-100 text-emerald-800',
  rolled_back: 'bg-rose-100 text-rose-800',
  planned: 'bg-slate-100 text-slate-700',
  executing: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-500',
  partial: 'bg-amber-100 text-amber-800',
  armed: 'bg-emerald-100 text-emerald-800',
  tripped: 'bg-rose-100 text-rose-800',
  recovering: 'bg-amber-100 text-amber-800',
  overridden: 'bg-amber-100 text-amber-800',
  disabled: 'bg-slate-100 text-slate-500',
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Chip({ text, tone }: { text: string; tone?: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone ?? 'bg-slate-100 text-slate-700'}`}>{text}</span>;
}

const TREND_KINDS = ['opportunity_long', 'competitor_movement', 'source_quality', 'moderation_trend', 'conversion_trend', 'escalation_pattern'] as const;
const TREND_WINDOWS = ['30d', '90d', '180d', '365d'] as const;
const EVIDENCE_KINDS = ['governance_traceability', 'retention_audit', 'replay_audit', 'access_audit', 'operational_change_log', 'consent_log', 'full_bundle'] as const;
const SAFEGUARD_KINDS_LIST = ['execution_circuit_breaker', 'connector_degradation', 'queue_congestion', 'semantic_overload', 'replay_overload', 'operational_freeze'] as const;
const ONBOARDING_KINDS = ['industry_preset', 'source_recommendation', 'governance_baseline', 'connector_activation', 'rbac_starter', 'retention_preset'] as const;
const INVESTIGATION_KINDS = ['incident_summary', 'cluster_explanation', 'timeline_summary', 'evidence_grouping', 'retrieval_overlay', 'escalation_brief'] as const;
const DR_PLAN_KINDS = ['projection_rebuild', 'queue_recovery', 'semantic_index_rebuild', 'partition_recovery', 'failover_validation', 'full_recovery'] as const;

export default function ProductionMaturityPanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('marketplace');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Marketplace
  const [connectors, setConnectors] = useState<MarketplaceConnector[]>([]);
  const [newConnectorSlug, setNewConnectorSlug] = useState('');
  const [newConnectorVersion, setNewConnectorVersion] = useState('');

  // Onboarding
  const [onboardingApps, setOnboardingApps] = useState<OnboardingApplication[]>([]);
  const [previewKind, setPreviewKind] = useState<string>('industry_preset');

  // AI investigation
  const [investSummaries, setInvestSummaries] = useState<InvestigationSummary[]>([]);
  const [investSubject, setInvestSubject] = useState('');
  const [investKind, setInvestKind] = useState<string>('incident_summary');
  const [investQuery, setInvestQuery] = useState('');

  // Trends
  const [trends, setTrends] = useState<Trend[]>([]);
  const [trendKind, setTrendKind] = useState<string>('opportunity_long');
  const [trendWindow, setTrendWindow] = useState<string>('90d');

  // DR
  const [drExecutions, setDrExecutions] = useState<DrExecution[]>([]);
  const [drPlanKind, setDrPlanKind] = useState<string>('projection_rebuild');

  // Compliance
  const [compExports, setCompExports] = useState<ComplianceExport[]>([]);
  const [evidenceKind, setEvidenceKind] = useState<string>('governance_traceability');

  // Macros
  const [macros, setMacros] = useState<AnalystMacro[]>([]);

  // Safeguards
  const [safeguards, setSafeguards] = useState<SafeguardStateRow[]>([]);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'marketplace') {
        const r = await fetchWithAuth(`/api/active-leads/marketplace-connectors?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`marketplace ${r.status}`);
        setConnectors(((await r.json()) as { items: MarketplaceConnector[] }).items ?? []);
      } else if (which === 'onboarding') {
        const r = await fetchWithAuth(`/api/active-leads/enterprise-onboarding?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`onboarding ${r.status}`);
        setOnboardingApps(((await r.json()) as { items: OnboardingApplication[] }).items ?? []);
      } else if (which === 'ai_invest') {
        const r = await fetchWithAuth(`/api/active-leads/investigation-ai?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`ai_invest ${r.status}`);
        setInvestSummaries(((await r.json()) as { items: InvestigationSummary[] }).items ?? []);
      } else if (which === 'trends') {
        const r = await fetchWithAuth(`/api/active-leads/intelligence-trends?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`trends ${r.status}`);
        setTrends(((await r.json()) as { items: Trend[] }).items ?? []);
      } else if (which === 'dr') {
        const r = await fetchWithAuth(`/api/active-leads/disaster-recovery?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`dr ${r.status}`);
        setDrExecutions(((await r.json()) as { items: DrExecution[] }).items ?? []);
      } else if (which === 'compliance') {
        const r = await fetchWithAuth(`/api/active-leads/compliance-evidence?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`compliance ${r.status}`);
        setCompExports(((await r.json()) as { items: ComplianceExport[] }).items ?? []);
      } else if (which === 'macros') {
        const r = await fetchWithAuth(`/api/active-leads/analyst-macros?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`macros ${r.status}`);
        setMacros(((await r.json()) as { items: AnalystMacro[] }).items ?? []);
      } else if (which === 'safeguards') {
        const r = await fetchWithAuth(`/api/active-leads/production-safeguards?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`safeguards ${r.status}`);
        setSafeguards(((await r.json()) as { items: SafeguardStateRow[] }).items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const registerConnector = useCallback(async () => {
    if (!newConnectorSlug || !newConnectorVersion) return;
    setBusy('register');
    try {
      await fetchWithAuth('/api/active-leads/marketplace-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: 'register',
          connectorSlug: newConnectorSlug,
          displayName: newConnectorSlug,
          vendor: 'self',
          version: newConnectorVersion,
          capabilityTags: ['listening'],
        }),
      });
      setNewConnectorSlug(''); setNewConnectorVersion('');
      await load('marketplace');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, newConnectorSlug, newConnectorVersion, load]);

  const certify = useCallback(async (connectorId: string, newState: string) => {
    setBusy(`certify-${connectorId}`);
    try {
      await fetchWithAuth('/api/active-leads/marketplace-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'certify', connectorId, newState }),
      });
      await load('marketplace');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const rollout = useCallback(async (connectorId: string, rolloutState: string) => {
    setBusy(`rollout-${connectorId}`);
    try {
      await fetchWithAuth('/api/active-leads/marketplace-connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'rollout', connectorId, rolloutState }),
      });
      await load('marketplace');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const previewOnboarding = useCallback(async () => {
    setBusy('preview-onboarding');
    try {
      await fetchWithAuth('/api/active-leads/enterprise-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'preview', templateKind: previewKind, previewPayload: { kind: previewKind } }),
      });
      await load('onboarding');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, previewKind, load]);

  const onboardingAction = useCallback(async (applicationId: string, action: 'approve' | 'apply' | 'rollback') => {
    setBusy(`onb-${applicationId}`);
    try {
      await fetchWithAuth('/api/active-leads/enterprise-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action, applicationId, appliedPayload: action === 'apply' ? { acknowledged: true } : undefined }),
      });
      await load('onboarding');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const generateInvestigation = useCallback(async () => {
    if (!investSubject) return;
    setBusy('gen-invest');
    try {
      await fetchWithAuth('/api/active-leads/investigation-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, investigationKind: investKind, subjectRef: investSubject, queryHint: investQuery || undefined }),
      });
      await load('ai_invest');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, investSubject, investKind, investQuery, load]);

  const materializeTrend = useCallback(async () => {
    setBusy('mat-trend');
    try {
      await fetchWithAuth('/api/active-leads/intelligence-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, trendKind, windowKind: trendWindow }),
      });
      await load('trends');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, trendKind, trendWindow, load]);

  const generateCompliance = useCallback(async () => {
    setBusy('gen-comp');
    try {
      await fetchWithAuth('/api/active-leads/compliance-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, evidenceKind }),
      });
      await load('compliance');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, evidenceKind, load]);

  const safeguardAction = useCallback(async (kind: string, action: 'override' | 'rearm' | 'disable') => {
    setBusy(`sg-${kind}-${action}`);
    try {
      await fetchWithAuth('/api/active-leads/production-safeguards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action, safeguardKind: kind, rationale: `Operator ${action}` }),
      });
      await load('safeguards');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const stageDr = useCallback(async () => {
    setBusy('stage-dr');
    try {
      // First create a quick plan if none, then stage. For brevity, the UI ships read-only here.
      await load('dr');
    } finally { setBusy(null); }
  }, [load]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Production Maturity Console</h3>
          <p className="text-xs text-slate-500">
            Marketplace, onboarding, AI-assisted investigation, long-window trends, DR, compliance, macros, safeguards. Operator-driven.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['marketplace', 'onboarding', 'ai_invest', 'trends', 'dr', 'compliance', 'macros', 'safeguards'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'marketplace' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={newConnectorSlug} onChange={(e) => setNewConnectorSlug(e.target.value)} placeholder="slug (e.g. shopify-listening)" className="w-56 rounded border border-slate-200 px-2 py-1" />
            <input value={newConnectorVersion} onChange={(e) => setNewConnectorVersion(e.target.value)} placeholder="version (e.g. 1.0.0)" className="w-32 rounded border border-slate-200 px-2 py-1" />
            <button type="button" disabled={!newConnectorSlug || !newConnectorVersion || !!busy} onClick={registerConnector} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'register' ? 'Registering…' : 'Register connector'}
            </button>
          </div>
          {connectors.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No marketplace connectors.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {connectors.map((c) => (
                <li key={c.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{c.display_name} <span className="text-[10px] text-slate-500">{c.version}</span></span>
                    <span className="flex gap-1">
                      <Chip text={c.certification_state} tone={TONE[c.certification_state]} />
                      <Chip text={c.rollout_state} tone={TONE[c.rollout_state]} />
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">vendor {c.vendor} · sig {c.signature_hash.slice(0, 16)}…</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.certification_state !== 'certified' && <button type="button" disabled={!!busy} onClick={() => certify(c.id, 'certified')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Certify</button>}
                    {c.certification_state === 'certified' && c.rollout_state !== 'active' && <button type="button" disabled={!!busy} onClick={() => rollout(c.id, 'active')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Activate</button>}
                    {c.rollout_state === 'active' && <button type="button" disabled={!!busy} onClick={() => rollout(c.id, 'retired')} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Retire</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'onboarding' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={previewKind} onChange={(e) => setPreviewKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {ONBOARDING_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={previewOnboarding} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'preview-onboarding' ? 'Previewing…' : 'Preview application'}
            </button>
          </div>
          {onboardingApps.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No onboarding applications.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {onboardingApps.map((a) => (
                <li key={a.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{a.template_kind}</span>
                    <Chip text={a.status} tone={TONE[a.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(a.created_at)}{a.approved_by ? ` · approved by ${a.approved_by}` : ''}</p>
                  {a.failure_reason && <p className="text-rose-700">{a.failure_reason}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.status === 'previewed' && <button type="button" disabled={!!busy} onClick={() => onboardingAction(a.id, 'approve')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Approve</button>}
                    {a.status === 'approved' && <button type="button" disabled={!!busy} onClick={() => onboardingAction(a.id, 'apply')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Mark applied</button>}
                    {(a.status === 'applied' || a.status === 'approved') && <button type="button" disabled={!!busy} onClick={() => onboardingAction(a.id, 'rollback')} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">Rollback</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'ai_invest' && (
        <div className="divide-y divide-slate-100">
          <div className="space-y-2 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <select value={investKind} onChange={(e) => setInvestKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
                {INVESTIGATION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input value={investSubject} onChange={(e) => setInvestSubject(e.target.value)} placeholder="subject ref (e.g. incident:abc-123)" className="w-72 rounded border border-slate-200 px-2 py-1" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={investQuery} onChange={(e) => setInvestQuery(e.target.value)} placeholder="optional retrieval hint" className="w-72 rounded border border-slate-200 px-2 py-1" />
              <button type="button" disabled={!investSubject || !!busy} onClick={generateInvestigation} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
                {busy === 'gen-invest' ? 'Generating…' : 'Generate summary'}
              </button>
            </div>
          </div>
          {investSummaries.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No summaries yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {investSummaries.map((s) => (
                <li key={s.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.investigation_kind}</span>
                    <Chip text={s.generation_method} />
                  </div>
                  <p className="text-[10px] text-slate-500">{s.subject_ref} · {fmtTime(s.created_at)}</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[10px] text-slate-700">{s.summary_text}</pre>
                  {s.evidence_refs.length > 0 && (
                    <p className="mt-1 text-[10px] text-slate-500">
                      Evidence: {s.evidence_refs.slice(0, 5).map((e) => `${e.source_kind}:${e.source_id}@${e.weight.toFixed(2)}`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'trends' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={trendKind} onChange={(e) => setTrendKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {TREND_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={trendWindow} onChange={(e) => setTrendWindow(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {TREND_WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={materializeTrend} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'mat-trend' ? 'Materialising…' : 'Materialise trend'}
            </button>
          </div>
          {trends.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No trends materialised.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {trends.map((t) => (
                <li key={t.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{t.trend_kind} · {t.window_kind}</span>
                    <span className="text-[10px] text-slate-500">{t.series.length} points</span>
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(t.window_start)} → {fmtTime(t.window_end)}</p>
                  {t.derivation_explanation && <p className="text-[10px] text-slate-500">{t.derivation_explanation}</p>}
                  {t.series.length > 0 && (
                    <p className="mt-1 text-slate-700">
                      Range: min {Math.min(...t.series.map((p) => p.value))} · max {Math.max(...t.series.map((p) => p.value))} · last {t.series[t.series.length - 1].value}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'dr' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={drPlanKind} onChange={(e) => setDrPlanKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {DR_PLAN_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled onClick={stageDr} className="rounded bg-slate-300 px-3 py-1 text-white">
              DR plans created via API/IaC
            </button>
          </div>
          {drExecutions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No DR executions.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {drExecutions.map((e) => (
                <li key={e.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{e.plan_kind}</span>
                    <Chip text={e.status} tone={TONE[e.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(e.created_at)}{e.approved_by ? ` · approved by ${e.approved_by}` : ''}</p>
                  {e.failure_reason && <p className="text-rose-700">{e.failure_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'compliance' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={generateCompliance} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'gen-comp' ? 'Generating…' : 'Generate export (SOC2 default)'}
            </button>
          </div>
          {compExports.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No compliance exports.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {compExports.map((e) => (
                <li key={e.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{e.evidence_kind}</span>
                    <Chip text={e.status} tone={TONE[e.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{e.certification_target} · {e.row_count} rows · {e.byte_size} bytes · {fmtTime(e.created_at)}</p>
                  <p className="text-[10px] text-slate-500">hash {e.payload_hash.slice(0, 24)}…</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'macros' && (
        <div className="divide-y divide-slate-100">
          {macros.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No analyst macros. Create via API.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {macros.map((m) => (
                <li key={m.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{m.name}</span>
                    <span className="flex gap-1">
                      <Chip text={m.macro_kind} />
                      <Chip text={m.enabled ? 'enabled' : 'disabled'} tone={m.enabled ? TONE.armed : TONE.disabled} />
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{m.shared ? 'shared' : 'private'} · updated {fmtTime(m.updated_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'safeguards' && (
        <div className="divide-y divide-slate-100">
          <ul className="divide-y divide-slate-100">
            {SAFEGUARD_KINDS_LIST.map((kind) => {
              const sg = safeguards.find((s) => s.safeguard_kind === kind);
              const state = sg?.state ?? 'armed';
              return (
                <li key={kind} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{kind}</span>
                    <Chip text={state} tone={TONE[state]} />
                  </div>
                  <div className="mt-1 text-slate-600">observed {sg?.observed_value ?? 0} · threshold {sg?.threshold_value ?? '—'}</div>
                  {sg?.triggered_at && <p className="text-[10px] text-rose-700">tripped {fmtTime(sg.triggered_at)}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {state === 'tripped' && <button type="button" disabled={!!busy} onClick={() => safeguardAction(kind, 'override')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Override</button>}
                    {(state === 'recovering' || state === 'overridden') && <button type="button" disabled={!!busy} onClick={() => safeguardAction(kind, 'rearm')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Re-arm</button>}
                    {state !== 'disabled' && <button type="button" disabled={!!busy} onClick={() => safeguardAction(kind, 'disable')} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Disable</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
