import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { fetchWithAuth } from '@/components/community-ai/fetchWithAuth';

type OpsSnapshot = {
  controls?: Record<string, boolean>;
  beta_runtime?: Record<string, boolean | string>;
  beta_health?: Record<string, any>;
  daily_review?: Record<string, any>;
  alert_summary?: Record<string, any>;
  unresolved_purchases?: any[];
  quarantined_reservations?: any[];
  rejected_provider_events?: any[];
  support_cases?: any[];
  support_runbooks?: any[];
  events?: any[];
  drills?: { rows?: any[]; summary?: Record<string, number> };
};

const DRILL_TYPES = [
  'successful_purchase',
  'duplicate_webhook',
  'delayed_webhook',
  'invalid_signature',
  'failed_fulfillment',
  'reconciliation_recovery',
  'freeze_mode',
  'replay_dry_run',
] as const;

function badgeClass(value?: string | null): string {
  if (!value) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (['healthy', 'low', 'passed', 'completed', 'processed', 'resolved'].includes(value)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['watch', 'medium', 'pending', 'planned', 'running', 'support_review'].includes(value)) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (['risk', 'high', 'failed', 'blocked', 'urgent'].includes(value)) return 'bg-orange-50 text-orange-700 border-orange-200';
  if (['critical', 'quarantined'].includes(value)) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function Badge({ value }: { value?: string | null }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass(value)}`}>{value ?? 'n/a'}</span>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900 break-all">{value ?? '—'}</div>
    </div>
  );
}

export default function MonetizationOpsTab() {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drill, setDrill] = useState({
    drill_type: 'successful_purchase',
    status: 'planned',
    expected_outcome: '',
    observed_outcome: '',
    economic_impact_assessment: '',
    anomalies_found: '',
    follow_up_actions: '',
  });

  const controls = snapshot?.controls ?? {};
  const betaRuntime = snapshot?.beta_runtime ?? {};
  const readOnlyReason = useMemo(() => {
    if (controls.globalKillSwitch) return 'Global kill switch is active';
    if (controls.readOnlyAuditMode) return 'Read-only audit mode is active';
    if (betaRuntime.betaFreeze) return 'Beta freeze mode is active';
    return null;
  }, [controls, betaRuntime]);
  const replayPaused = Boolean(controls.replayDryRunOnly || betaRuntime.betaReplayPaused);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/super-admin/monetization/operations?limit=100');
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || 'Failed to load monetization operations');
      setSnapshot(json);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadTimeline = async (item: any) => {
    setSelected(item);
    const params = new URLSearchParams({ view: 'timeline', limit: '100' });
    const orgId = item.organization_id ?? item.organizationId;
    const purchaseId = item.purchase_id ?? item.purchaseId ?? item.id;
    const providerEventId = item.provider_event_id ?? item.providerEventId;
    const reservationId = item.reservation_id ?? item.reservationId;
    if (orgId) params.set('organization_id', String(orgId));
    if (purchaseId && String(purchaseId).includes('-')) params.set('purchase_id', String(purchaseId));
    if (providerEventId) params.set('provider_event_id', String(providerEventId));
    if (reservationId) params.set('reservation_id', String(reservationId));
    const res = await fetchWithAuth(`/api/super-admin/monetization/operations?${params.toString()}`);
    const json = await res.json();
    setTimeline(json.timeline ?? []);
  };

  const postAction = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setActing(String(body.action));
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/super-admin/monetization/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || 'Action failed');
      setMessage('Action recorded.');
      await load();
      if (selected) await loadTimeline(selected);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const recordDrill = async () => {
    await postAction({
      action: 'record_beta_drill',
      drill_type: drill.drill_type,
      status: drill.status,
      expected_outcome: drill.expected_outcome,
      observed_outcome: drill.observed_outcome,
      economic_impact_assessment: drill.economic_impact_assessment,
      anomalies_found: drill.anomalies_found.split('\n').map(s => s.trim()).filter(Boolean),
      follow_up_actions: drill.follow_up_actions.split('\n').map(s => s.trim()).filter(Boolean),
      organization_id: selected?.organization_id ?? selected?.organizationId ?? null,
      purchase_id: selected?.purchase_id ?? selected?.purchaseId ?? null,
      provider_event_id: selected?.provider_event_id ?? selected?.providerEventId ?? null,
    });
  };

  const queueItems = [
    ...(snapshot?.support_cases ?? []),
    ...(snapshot?.unresolved_purchases ?? []),
    ...(snapshot?.quarantined_reservations ?? []),
    ...(snapshot?.rejected_provider_events ?? []),
  ].slice(0, 80);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Monetization Beta Operations</h2>
          <p className="text-sm text-slate-600">Sandbox/test-money incident review, drills, and support-safe recovery controls.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}
      {readOnlyReason && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <PauseCircle className="h-4 w-4" />
          {readOnlyReason}. Economic-impact actions are shown for visibility but should remain paused.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={<ShieldCheck className="h-5 w-5" />} label="Economic Health" value={snapshot?.beta_health?.economic_health} />
        <Metric icon={<ShieldAlert className="h-5 w-5" />} label="Trust Risk" value={snapshot?.beta_health?.trust_risk} />
        <Metric icon={<Clock className="h-5 w-5" />} label="Unresolved Purchases" value={snapshot?.beta_health?.unresolved_purchases ?? 0} />
        <Metric icon={<AlertTriangle className="h-5 w-5" />} label="Human Review" value={snapshot?.daily_review?.human_review_required ? 'required' : 'clear'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="font-semibold text-slate-900">Incident Queue</h3>
            <p className="text-xs text-slate-500">Support cases, unresolved purchases, quarantines, failed events.</p>
          </div>
          <div className="max-h-[560px] divide-y divide-slate-100 overflow-auto">
            {queueItems.length === 0 ? (
              <div className="px-4 py-8 text-sm text-slate-500">No active monetization incidents.</div>
            ) : queueItems.map((item, index) => {
              const title = item.incident_class ?? item.fulfillment_status ?? item.processing_status ?? item.execution_phase ?? 'incident';
              const ref = item.support_reference ?? item.provider_order_id ?? item.provider_event_id ?? item.id;
              return (
                <button key={`${ref}-${index}`} onClick={() => void loadTimeline(item)} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{String(title).replace(/_/g, ' ')}</div>
                      <div className="mt-1 text-xs text-slate-500 break-all">{ref}</div>
                    </div>
                    <Badge value={item.recovery_status ?? item.fulfillment_status ?? item.processing_status ?? item.status} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <span>Org: {item.organization_id ?? '—'}</span>
                    <span>Age: {item.age_minutes ?? '—'} min</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Safe Actions</h3>
            <p className="mt-1 text-xs text-slate-500">Actions are audit-logged. Replay/reconcile require confirmation.</p>
            <div className="mt-4 grid gap-2">
              <ActionButton disabled={!selected || replayPaused || Boolean(readOnlyReason)} onClick={() => postAction({ action: 'retry_provider_event', provider_event_row_id: selected?.id, dryRun: true }, 'Run replay dry-run for this provider event?')} label="Replay Dry Run" />
              <ActionButton disabled={!selected || Boolean(readOnlyReason)} onClick={() => postAction({ action: 'reconcile', organization_id: selected?.organization_id ?? selected?.organizationId, minAgeSeconds: 0 }, 'Trigger reservation reconciliation for this org?')} label="Reconcile Reservation" />
              <ActionButton disabled={!selected || Boolean(readOnlyReason)} onClick={() => postAction({ action: 'beta_support_case', status: 'resolved', case_id: selected?.support_case_id ?? selected?.case_id, organization_id: selected?.organization_id, purchase_id: selected?.purchase_id, reservation_id: selected?.reservation_id, provider_event_id: selected?.provider_event_id, note: 'Reviewed in monetization ops UI.' })} label="Mark Reviewed" />
              <ActionButton disabled={!selected || Boolean(readOnlyReason)} onClick={() => postAction({ action: 'beta_support_case', status: 'customer-contact-required', organization_id: selected?.organization_id, purchase_id: selected?.purchase_id, reservation_id: selected?.reservation_id, provider_event_id: selected?.provider_event_id, note: 'Customer contact required.' })} label="Escalate" />
              <ActionButton disabled={!selected || Boolean(readOnlyReason)} onClick={() => postAction({ action: 'beta_support_action', support_action: 'quarantine_review', organization_id: selected?.organization_id, purchase_id: selected?.purchase_id, reservation_id: selected?.reservation_id, provider_event_id: selected?.provider_event_id, note: 'Quarantine reviewed from ops UI.' })} label="Quarantine Review" />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Beta Drill Record</h3>
            <div className="mt-3 space-y-2">
              <select value={drill.drill_type} onChange={(e) => setDrill(d => ({ ...d, drill_type: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                {DRILL_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
              </select>
              <select value={drill.status} onChange={(e) => setDrill(d => ({ ...d, status: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                {['planned', 'running', 'passed', 'failed', 'blocked'].map(status => <option key={status} value={status}>{status}</option>)}
              </select>
              <textarea placeholder="Expected outcome" value={drill.expected_outcome} onChange={(e) => setDrill(d => ({ ...d, expected_outcome: e.target.value }))} className="h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <textarea placeholder="Observed outcome" value={drill.observed_outcome} onChange={(e) => setDrill(d => ({ ...d, observed_outcome: e.target.value }))} className="h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <textarea placeholder="Anomalies, one per line" value={drill.anomalies_found} onChange={(e) => setDrill(d => ({ ...d, anomalies_found: e.target.value }))} className="h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <textarea placeholder="Follow-up actions, one per line" value={drill.follow_up_actions} onChange={(e) => setDrill(d => ({ ...d, follow_up_actions: e.target.value }))} className="h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={() => void recordDrill()} disabled={!drill.expected_outcome.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                <FileCheck2 className="h-4 w-4" />
                Record Drill
              </button>
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-slate-900">Operational Timeline</h3>
          <p className="text-xs text-slate-500">Immutable support view separated from customer-safe billing projection.</p>
        </div>
        {timeline.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">Select an incident to load its timeline.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {timeline.map((item) => (
              <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[180px_1fr_220px]">
                <div className="text-xs text-slate-500">{new Date(item.occurred_at).toLocaleString()}</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{item.title}</span>
                    <Badge value={item.status} />
                    {item.customer_safe && <Badge value="customer safe" />}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Source: {item.source}</div>
                </div>
                <div className="text-xs text-slate-500">
                  <div>Request: {item.request_id ?? '—'}</div>
                  <div>Correlation: {item.correlation_id ?? '—'}</div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-slate-700">Details</summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(item.details, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-slate-500">{icon}</div>
        <Badge value={typeof value === 'string' ? value : undefined} />
      </div>
      <div className="mt-3 text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value ?? '—'}</div>
    </div>
  );
}

function ActionButton({ disabled, onClick, label }: { disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
      <span>{label}</span>
      <Eye className="h-4 w-4 text-slate-400" />
    </button>
  );
}
