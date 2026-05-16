/**
 * Phase 11 — Production Launch Console.
 *
 * Compact 8-tab consolidated UI. Every action explicit; no autonomous
 * refresh; every mutation calls a Phase 11 API.
 *
 *   • rollout     — Production Rollout Center
 *   • safety      — Operational Safety Console
 *   • copilot     — AI Copilot Workspace
 *   • health      — Deployment Observability Dashboard
 *   • tenant      — Tenant Onboarding Runtime
 *   • migration   — Migration Operations Console
 *   • resilience  — Resilience Validation Center
 *   • cert        — Production Certification Workspace
 */

import React, { useCallback, useEffect, useState } from 'react';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Props = { companyId: string; fetchWithAuth: FetchWithAuth };

type Tab = 'rollout' | 'safety' | 'copilot' | 'health' | 'tenant' | 'migration' | 'resilience' | 'cert';

type RolloutPlan = {
  id: string;
  plan_name: string;
  rollout_kind: string;
  status: string;
  bounded_batch_size: number;
  ordered_stages: Array<{ stage_index: number; stage_kind: string; description: string }>;
  approved_by: string | null;
  updated_at: string;
};

type RolloutStageExec = {
  id: string;
  plan_id: string;
  stage_index: number;
  stage_kind: string;
  status: string;
  failure_reason: string | null;
};

type SafetyRail = {
  id: string;
  rail_kind: string;
  state: string;
  threshold_value: number;
  observed_value: number;
  acknowledged_at: string | null;
};

type CopilotResp = {
  id: string;
  copilot_intent: string;
  subject_ref: string;
  response_text: string;
  reasoning_summary: string | null;
  evidence_refs: Array<{ source_kind: string; source_id: string; weight: number }>;
  generation_method: string;
  created_at: string;
};

type DeploymentSnapshot = {
  id: string;
  snapshot_kind: string;
  health_state: string;
  measures: Record<string, number>;
  derivation_explanation: string | null;
  created_at: string;
};

type TenantStage = {
  id: string;
  stage_kind: string;
  status: string;
  readiness_score: number;
  acknowledged_at: string | null;
};

type MigrationDryRun = {
  id: string;
  migration_kind: string;
  migration_identifier: string;
  status: string;
  health_verdict: string | null;
  dependency_checks: Array<{ check_kind: string; passed: boolean; detail: string }>;
  updated_at: string;
};

type ResilienceRun = {
  id: string;
  validation_kind: string;
  status: string;
  observed_results: Array<{ check_kind: string; passed: boolean; detail: string }>;
  failure_explanation: string | null;
  created_at: string;
};

type CertReport = {
  id: string;
  certification_kind: string;
  certification_score: number;
  status: string;
  components: Array<{ component_kind: string; weight: number; observed_score: number; passed: boolean }>;
  derivation_explanation: string | null;
  created_at: string;
};

const TONE: Record<string, string> = {
  drafted: 'bg-slate-100 text-slate-700', approved: 'bg-amber-100 text-amber-800', executing: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800', failed: 'bg-rose-100 text-rose-800', rolled_back: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-500', pending: 'bg-slate-100 text-slate-700', verified: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-slate-100 text-slate-500',
  green: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', triggered: 'bg-rose-100 text-rose-800',
  overridden: 'bg-amber-100 text-amber-800', frozen: 'bg-slate-100 text-slate-700', disabled: 'bg-slate-100 text-slate-500',
  healthy: 'bg-emerald-100 text-emerald-800', degraded: 'bg-amber-100 text-amber-800', critical: 'bg-rose-100 text-rose-800',
  unknown: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-amber-100 text-amber-800', blocked: 'bg-rose-100 text-rose-800',
  previewed: 'bg-slate-100 text-slate-700', executed: 'bg-emerald-100 text-emerald-800', partial: 'bg-amber-100 text-amber-800',
};

function fmtTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Chip({ text, tone }: { text: string; tone?: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone ?? 'bg-slate-100 text-slate-700'}`}>{text}</span>;
}

const ROLLOUT_KINDS = ['tenant_activation', 'connector_rollout', 'semantic_rollout', 'feature_rollout', 'runtime_upgrade', 'full_production'] as const;
const SAFETY_RAIL_KINDS = ['execution_safety', 'replay_safety', 'semantic_indexing_safety', 'connector_degradation', 'rollout_freeze', 'runtime_overload', 'operator_ack_gate'] as const;
const COPILOT_INTENTS = ['investigation_assist', 'retrieval_summary', 'trend_interpret', 'opportunity_explain', 'escalation_draft', 'report_draft', 'governance_guidance'] as const;
const SNAPSHOT_KINDS = ['rollout_progress', 'migration_progress', 'connector_rollout', 'semantic_rollout', 'replay_drift', 'deployment_health_overview'] as const;
const TENANT_STAGE_KINDS = ['workspace_setup', 'rbac_verification', 'governance_verification', 'connector_readiness', 'semantic_readiness', 'retention_setup', 'final_acknowledgement'] as const;
const MIGRATION_KINDS = ['schema', 'data_backfill', 'config', 'feature_flag', 'retention', 'custom'] as const;
const VALIDATION_KINDS = ['replay_integrity', 'semantic_consistency', 'projection_consistency', 'partition_health', 'connector_resilience', 'failover_readiness'] as const;
const CERT_KINDS = ['operational_readiness', 'governance_readiness', 'deployment_readiness', 'sla_readiness', 'resilience_certification', 'audit_readiness'] as const;

export default function ProductionLaunchPanel({ companyId, fetchWithAuth }: Props) {
  const [tab, setTab] = useState<Tab>('rollout');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [rolloutPlans, setRolloutPlans] = useState<RolloutPlan[]>([]);
  const [activePlanStages, setActivePlanStages] = useState<Record<string, RolloutStageExec[]>>({});
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanKind, setNewPlanKind] = useState<string>('tenant_activation');

  const [safetyRails, setSafetyRails] = useState<SafetyRail[]>([]);

  const [copilotIntent, setCopilotIntent] = useState<string>('investigation_assist');
  const [copilotSubject, setCopilotSubject] = useState('');
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [copilotQuery, setCopilotQuery] = useState('');
  const [copilotResponses, setCopilotResponses] = useState<CopilotResp[]>([]);

  const [snapshotKind, setSnapshotKind] = useState<string>('deployment_health_overview');
  const [snapshots, setSnapshots] = useState<DeploymentSnapshot[]>([]);

  const [tenantStages, setTenantStages] = useState<TenantStage[]>([]);
  const [tenantAggregate, setTenantAggregate] = useState<{ score: number; stages_complete: number; stages_total: number } | null>(null);

  const [migrationKind, setMigrationKind] = useState<string>('schema');
  const [migrationIdentifier, setMigrationIdentifier] = useState('');
  const [migrationDryRuns, setMigrationDryRuns] = useState<MigrationDryRun[]>([]);

  const [validationKind, setValidationKind] = useState<string>('replay_integrity');
  const [resilienceRuns, setResilienceRuns] = useState<ResilienceRun[]>([]);

  const [certKind, setCertKind] = useState<string>('operational_readiness');
  const [certReports, setCertReports] = useState<CertReport[]>([]);

  const load = useCallback(async (which: Tab) => {
    if (!companyId) return;
    setError(null);
    try {
      if (which === 'rollout') {
        const r = await fetchWithAuth(`/api/active-leads/production-rollout?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`rollout ${r.status}`);
        const plans = ((await r.json()) as { items: RolloutPlan[] }).items ?? [];
        setRolloutPlans(plans);
      } else if (which === 'safety') {
        const r = await fetchWithAuth(`/api/active-leads/safety-rails?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`safety ${r.status}`);
        setSafetyRails(((await r.json()) as { items: SafetyRail[] }).items ?? []);
      } else if (which === 'copilot') {
        const r = await fetchWithAuth(`/api/active-leads/copilot?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`copilot ${r.status}`);
        setCopilotResponses(((await r.json()) as { items: CopilotResp[] }).items ?? []);
      } else if (which === 'health') {
        const r = await fetchWithAuth(`/api/active-leads/deployment-telemetry?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`health ${r.status}`);
        setSnapshots(((await r.json()) as { items: DeploymentSnapshot[] }).items ?? []);
      } else if (which === 'tenant') {
        const r = await fetchWithAuth(`/api/active-leads/tenant-onboarding-runtime?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`tenant ${r.status}`);
        const json = (await r.json()) as { items: TenantStage[]; aggregate: { score: number; stages_complete: number; stages_total: number } };
        setTenantStages(json.items ?? []);
        setTenantAggregate(json.aggregate ?? null);
      } else if (which === 'migration') {
        const r = await fetchWithAuth(`/api/active-leads/migration-tooling?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`migration ${r.status}`);
        setMigrationDryRuns(((await r.json()) as { items: MigrationDryRun[] }).items ?? []);
      } else if (which === 'resilience') {
        const r = await fetchWithAuth(`/api/active-leads/resilience-validation?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`resilience ${r.status}`);
        setResilienceRuns(((await r.json()) as { items: ResilienceRun[] }).items ?? []);
      } else if (which === 'cert') {
        const r = await fetchWithAuth(`/api/active-leads/production-certification?companyId=${encodeURIComponent(companyId)}`);
        if (!r.ok) throw new Error(`cert ${r.status}`);
        setCertReports(((await r.json()) as { items: CertReport[] }).items ?? []);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    }
  }, [companyId, fetchWithAuth]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const loadStagesFor = useCallback(async (planId: string) => {
    try {
      const r = await fetchWithAuth(`/api/active-leads/production-rollout?companyId=${encodeURIComponent(companyId)}&planId=${encodeURIComponent(planId)}&stages=1`);
      if (!r.ok) return;
      const items = ((await r.json()) as { items: RolloutStageExec[] }).items ?? [];
      setActivePlanStages((prev) => ({ ...prev, [planId]: items }));
    } catch { /* ignore */ }
  }, [companyId, fetchWithAuth]);

  const createPlan = useCallback(async () => {
    if (!newPlanName) return;
    setBusy('create-plan');
    try {
      await fetchWithAuth('/api/active-leads/production-rollout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId, action: 'create', planName: newPlanName, rolloutKind: newPlanKind,
          orderedStages: [
            { stage_index: 0, stage_kind: 'preflight', description: 'preflight checks' },
            { stage_index: 1, stage_kind: 'activate', description: 'activate cohort' },
            { stage_index: 2, stage_kind: 'verify', description: 'verify health' },
          ],
        }),
      });
      setNewPlanName('');
      await load('rollout');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, newPlanName, newPlanKind, load]);

  const planAction = useCallback(async (planId: string, action: 'approve' | 'rollback') => {
    setBusy(`plan-${planId}-${action}`);
    try {
      await fetchWithAuth('/api/active-leads/production-rollout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action, planId }),
      });
      await load('rollout');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const executeStage = useCallback(async (planId: string, expectedStageIndex: number) => {
    setBusy(`stage-${planId}-${expectedStageIndex}`);
    try {
      await fetchWithAuth('/api/active-leads/production-rollout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'execute', planId, expectedStageIndex }),
      });
      await load('rollout');
      await loadStagesFor(planId);
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load, loadStagesFor]);

  const railAction = useCallback(async (railKind: string, action: 'override' | 'ack' | 'freeze' | 'rearm') => {
    setBusy(`rail-${railKind}-${action}`);
    try {
      await fetchWithAuth('/api/active-leads/safety-rails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action, railKind, rationale: `operator ${action}` }),
      });
      await load('safety');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const generateCopilot = useCallback(async () => {
    if (!copilotSubject || !copilotPrompt) return;
    setBusy('gen-copilot');
    try {
      await fetchWithAuth('/api/active-leads/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, copilotIntent, subjectRef: copilotSubject, prompt: copilotPrompt, queryHint: copilotQuery || undefined }),
      });
      await load('copilot');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, copilotIntent, copilotSubject, copilotPrompt, copilotQuery, load]);

  const captureSnapshot = useCallback(async () => {
    setBusy('snapshot');
    try {
      await fetchWithAuth('/api/active-leads/deployment-telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, snapshotKind }),
      });
      await load('health');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, snapshotKind, load]);

  const updateTenantStage = useCallback(async (stageKind: string, status: string, readinessScore: number) => {
    setBusy(`tenant-${stageKind}`);
    try {
      await fetchWithAuth('/api/active-leads/tenant-onboarding-runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, stageKind, status, readinessScore }),
      });
      await load('tenant');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const previewMigration = useCallback(async () => {
    if (!migrationIdentifier) return;
    setBusy('prev-mig');
    try {
      await fetchWithAuth('/api/active-leads/migration-tooling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'preview', migrationKind, migrationIdentifier }),
      });
      setMigrationIdentifier('');
      await load('migration');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, migrationKind, migrationIdentifier, load]);

  const migrationTransition = useCallback(async (migrationId: string, newStatus: string) => {
    setBusy(`mig-${migrationId}`);
    try {
      await fetchWithAuth('/api/active-leads/migration-tooling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, action: 'transition', migrationId, newStatus }),
      });
      await load('migration');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, load]);

  const runValidation = useCallback(async () => {
    setBusy('val');
    try {
      await fetchWithAuth('/api/active-leads/resilience-validation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, validationKind }),
      });
      await load('resilience');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, validationKind, load]);

  const generateCert = useCallback(async () => {
    setBusy('cert');
    try {
      await fetchWithAuth('/api/active-leads/production-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, certificationKind: certKind }),
      });
      await load('cert');
    } finally { setBusy(null); }
  }, [companyId, fetchWithAuth, certKind, load]);

  if (!companyId) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Production Launch Console</h3>
          <p className="text-xs text-slate-500">
            Rollout, safety, copilot, deployment health, tenant onboarding, migration, resilience, certification. Operator-driven.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(['rollout', 'safety', 'copilot', 'health', 'tenant', 'migration', 'resilience', 'cert'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 ${tab === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {tab === 'rollout' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <input value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} placeholder="plan name" className="w-64 rounded border border-slate-200 px-2 py-1" />
            <select value={newPlanKind} onChange={(e) => setNewPlanKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {ROLLOUT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!newPlanName || !!busy} onClick={createPlan} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'create-plan' ? 'Creating…' : 'Create plan (3 default stages)'}
            </button>
          </div>
          {rolloutPlans.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No rollout plans.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rolloutPlans.map((p) => (
                <li key={p.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{p.plan_name}</span>
                    <span className="flex gap-1">
                      <Chip text={p.rollout_kind} />
                      <Chip text={p.status} tone={TONE[p.status]} />
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{p.ordered_stages.length} stages · batch {p.bounded_batch_size} · {fmtTime(p.updated_at)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.status === 'drafted' && <button type="button" disabled={!!busy} onClick={() => planAction(p.id, 'approve')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Approve</button>}
                    {(p.status === 'approved' || p.status === 'executing') && (
                      <>
                        <button type="button" disabled={!!busy} onClick={() => loadStagesFor(p.id)} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">Show stages</button>
                        {p.ordered_stages.map((s) => (
                          <button key={s.stage_index} type="button" disabled={!!busy} onClick={() => executeStage(p.id, s.stage_index)} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                            Run stage #{s.stage_index}
                          </button>
                        ))}
                      </>
                    )}
                    {['approved', 'executing', 'failed'].includes(p.status) && (
                      <button type="button" disabled={!!busy} onClick={() => planAction(p.id, 'rollback')} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">Rollback</button>
                    )}
                  </div>
                  {activePlanStages[p.id] && (
                    <ul className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-3">
                      {activePlanStages[p.id].map((s) => (
                        <li key={s.id} className="rounded bg-slate-50 px-2 py-1 text-[10px]">
                          <div className="flex items-center justify-between">
                            <span>#{s.stage_index} {s.stage_kind}</span>
                            <Chip text={s.status} tone={TONE[s.status]} />
                          </div>
                          {s.failure_reason && <p className="text-rose-700">{s.failure_reason}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'safety' && (
        <ul className="divide-y divide-slate-100">
          {SAFETY_RAIL_KINDS.map((kind) => {
            const r = safetyRails.find((s) => s.rail_kind === kind);
            const state = r?.state ?? 'green';
            return (
              <li key={kind} className="px-4 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{kind}</span>
                  <Chip text={state} tone={TONE[state]} />
                </div>
                <div className="mt-1 text-slate-600">observed {r?.observed_value ?? 0} · threshold {r?.threshold_value ?? '—'}{r?.acknowledged_at ? ' · acknowledged' : ''}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {state === 'triggered' && <button type="button" disabled={!!busy} onClick={() => railAction(kind, 'ack')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Ack</button>}
                  {state !== 'green' && <button type="button" disabled={!!busy} onClick={() => railAction(kind, 'override')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Override</button>}
                  {state !== 'frozen' && <button type="button" disabled={!!busy} onClick={() => railAction(kind, 'freeze')} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">Freeze</button>}
                  {state !== 'green' && <button type="button" disabled={!!busy} onClick={() => railAction(kind, 'rearm')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Re-arm</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'copilot' && (
        <div className="divide-y divide-slate-100">
          <div className="space-y-2 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <select value={copilotIntent} onChange={(e) => setCopilotIntent(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
                {COPILOT_INTENTS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input value={copilotSubject} onChange={(e) => setCopilotSubject(e.target.value)} placeholder="subject ref" className="w-64 rounded border border-slate-200 px-2 py-1" />
            </div>
            <textarea value={copilotPrompt} onChange={(e) => setCopilotPrompt(e.target.value)} placeholder="prompt (≤4000 chars)" rows={2} className="w-full rounded border border-slate-200 px-2 py-1" />
            <div className="flex flex-wrap items-center gap-2">
              <input value={copilotQuery} onChange={(e) => setCopilotQuery(e.target.value)} placeholder="optional retrieval hint" className="w-72 rounded border border-slate-200 px-2 py-1" />
              <button type="button" disabled={!copilotSubject || !copilotPrompt || !!busy} onClick={generateCopilot} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
                {busy === 'gen-copilot' ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
          {copilotResponses.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No copilot responses yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {copilotResponses.map((r) => (
                <li key={r.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{r.copilot_intent}</span>
                    <Chip text={r.generation_method} />
                  </div>
                  <p className="text-[10px] text-slate-500">{r.subject_ref} · {fmtTime(r.created_at)}</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[10px] text-slate-700">{r.response_text}</pre>
                  {r.reasoning_summary && <p className="mt-1 text-[10px] text-slate-500">Reasoning: {r.reasoning_summary}</p>}
                  {r.evidence_refs.length > 0 && (
                    <p className="text-[10px] text-slate-500">
                      Evidence: {r.evidence_refs.slice(0, 5).map((e) => `${e.source_kind}:${e.source_id}@${e.weight.toFixed(2)}`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'health' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={snapshotKind} onChange={(e) => setSnapshotKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {SNAPSHOT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={captureSnapshot} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'snapshot' ? 'Capturing…' : 'Capture snapshot'}
            </button>
          </div>
          {snapshots.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No snapshots yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {snapshots.slice(0, 15).map((s) => (
                <li key={s.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.snapshot_kind}</span>
                    <Chip text={s.health_state} tone={TONE[s.health_state]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(s.created_at)} · {s.derivation_explanation ?? '—'}</p>
                  <p className="text-[10px] text-slate-700">{Object.entries(s.measures).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'tenant' && (
        <div className="divide-y divide-slate-100">
          {tenantAggregate && (
            <div className="px-4 py-2 text-xs text-slate-600">
              Aggregate readiness: {(tenantAggregate.score * 100).toFixed(1)}% · {tenantAggregate.stages_complete}/{tenantAggregate.stages_total} stages complete
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {TENANT_STAGE_KINDS.map((kind) => {
              const s = tenantStages.find((x) => x.stage_kind === kind);
              const status = s?.status ?? 'pending';
              return (
                <li key={kind} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{kind}</span>
                    <Chip text={status} tone={TONE[status]} />
                  </div>
                  <div className="mt-1 text-slate-600">readiness {(s?.readiness_score ?? 0).toFixed(2)}{s?.acknowledged_at ? ` · acked ${fmtTime(s.acknowledged_at)}` : ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {status !== 'complete' && (
                      <>
                        <button type="button" disabled={!!busy} onClick={() => updateTenantStage(kind, 'in_progress', 0.5)} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Mark in_progress</button>
                        <button type="button" disabled={!!busy} onClick={() => updateTenantStage(kind, 'complete', 1)} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Complete</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'migration' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={migrationKind} onChange={(e) => setMigrationKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {MIGRATION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={migrationIdentifier} onChange={(e) => setMigrationIdentifier(e.target.value)} placeholder="migration identifier" className="w-64 rounded border border-slate-200 px-2 py-1" />
            <button type="button" disabled={!migrationIdentifier || !!busy} onClick={previewMigration} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'prev-mig' ? 'Previewing…' : 'Preview dry-run'}
            </button>
          </div>
          {migrationDryRuns.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No migration dry-runs.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {migrationDryRuns.map((m) => (
                <li key={m.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{m.migration_identifier}</span>
                    <span className="flex gap-1">
                      <Chip text={m.migration_kind} />
                      <Chip text={m.status} tone={TONE[m.status]} />
                    </span>
                  </div>
                  {m.health_verdict && <p className="text-[10px] text-slate-500">{m.health_verdict}</p>}
                  <ul className="mt-1 text-[10px] text-slate-600">
                    {m.dependency_checks.map((c, idx) => (
                      <li key={idx}>{c.passed ? '✓' : '✗'} {c.check_kind} — {c.detail}</li>
                    ))}
                  </ul>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.status === 'previewed' && <button type="button" disabled={!!busy} onClick={() => migrationTransition(m.id, 'verified')} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Verify</button>}
                    {m.status === 'verified' && <button type="button" disabled={!!busy} onClick={() => migrationTransition(m.id, 'executed')} className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Mark executed</button>}
                    {['executed', 'verified'].includes(m.status) && <button type="button" disabled={!!busy} onClick={() => migrationTransition(m.id, 'rolled_back')} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">Rollback</button>}
                    {m.status !== 'cancelled' && m.status !== 'rolled_back' && m.status !== 'executed' && <button type="button" disabled={!!busy} onClick={() => migrationTransition(m.id, 'blocked')} className="rounded bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">Block</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'resilience' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={validationKind} onChange={(e) => setValidationKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {VALIDATION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={runValidation} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'val' ? 'Running…' : 'Run validation'}
            </button>
          </div>
          {resilienceRuns.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No validation runs.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {resilienceRuns.map((r) => (
                <li key={r.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{r.validation_kind}</span>
                    <Chip text={r.status} tone={TONE[r.status]} />
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(r.created_at)}</p>
                  {r.failure_explanation && <p className="text-rose-700">{r.failure_explanation}</p>}
                  <ul className="mt-1 text-[10px] text-slate-600">
                    {r.observed_results.map((c, idx) => (
                      <li key={idx}>{c.passed ? '✓' : '✗'} {c.check_kind} — {c.detail}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'cert' && (
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <select value={certKind} onChange={(e) => setCertKind(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
              {CERT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="button" disabled={!!busy} onClick={generateCert} className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
              {busy === 'cert' ? 'Generating…' : 'Generate certification'}
            </button>
          </div>
          {certReports.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-500">No certification reports.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {certReports.map((c) => (
                <li key={c.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{c.certification_kind}</span>
                    <span className="flex gap-1">
                      <Chip text={`score ${(c.certification_score * 100).toFixed(1)}%`} />
                      <Chip text={c.status} tone={TONE[c.status]} />
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{fmtTime(c.created_at)} · {c.derivation_explanation ?? '—'}</p>
                  <ul className="mt-1 text-[10px] text-slate-600">
                    {c.components.map((cp, idx) => (
                      <li key={idx}>{cp.passed ? '✓' : '✗'} {cp.component_kind} — score {(cp.observed_score * 100).toFixed(1)}% (w={cp.weight})</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
