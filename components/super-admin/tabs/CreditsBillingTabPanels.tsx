/** Part 2/2 of CreditsBillingTab.tsx — verbatim split (barrel preserved; importers unchanged). */
/**
 * Credits & Billing — Super Admin Console Tab
 *
 * One-tab implementation of the Phase L Credit Console. Provides:
 *   1. Company search + selector
 *   2. Wallet overview
 *   3. Credit actions (grant / revoke / freeze / unfreeze)
 *   4. Approval queue
 *   5. Ledger explorer (filterable)
 *   6. Financial timeline
 *   7. Risk & anomaly panel
 *   8. Billing flag rollout status
 *
 * All mutations go through:
 *   - /api/admin/credits/grant         (Phase 1)
 *   - /api/admin/credits/revoke        (Phase Console)
 *   - /api/admin/credits/freeze        (Phase Console)
 *   - /api/admin/credits/unfreeze      (Phase Console)
 *   - /api/admin/credits/approvals/sign   (Phase 1)
 *   - /api/admin/credits/approvals/cancel (Phase 2)
 *
 * All reads:
 *   - /api/admin/credits/company-wallet (Phase Console)
 *   - /api/admin/credits/ledger          (Phase Console)
 *   - /api/super-admin/billing-forensics/timeline (Phase 3)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Coins, Eye, FileCheck2, Flag, Info, Lock,
  RefreshCw, Search, ShieldAlert, ShieldCheck, Snowflake, Sun, TrendingDown, X,
} from 'lucide-react';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';

import { type WalletPayload, type LedgerRow, type ApprovalRow, type TimelineRow, fmtCredits, fmtUsd, fmtDate, makeIdemKey, Pill, ImmutableBadge, Card, inputCls } from './CreditsBillingTabMain';

export function ApprovalQueuePanel({ organizationId, onActionComplete }: { organizationId: string; onActionComplete: () => void }) {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/credits/approvals?orgId=${encodeURIComponent(organizationId)}`);
      if (res.ok) {
        const json = await res.json();
        setRows(Array.isArray(json?.approvals) ? json.approvals : []);
      } else if (res.status === 404) {
        setRows([]);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function decide(approvalId: string, decision: 'approve' | 'reject'): Promise<void> {
    await fetchWithAuth('/api/admin/credits/approvals/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(`sign-${approvalId}-${decision}`) },
      body: JSON.stringify({ approvalId, decision }),
    });
    await load();
    onActionComplete();
  }

  async function cancel(approvalId: string): Promise<void> {
    const reason = window.prompt('Reason for cancelling this approval?');
    if (!reason?.trim()) return;
    await fetchWithAuth('/api/admin/credits/approvals/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(`cancel-${approvalId}`) },
      body: JSON.stringify({ approvalId, reason }),
    });
    await load();
  }

  return (
    <Card title="Approval Queue" icon={<ShieldCheck className="h-5 w-5 text-purple-600" />}
      action={<button type="button" onClick={load} className="text-sm text-slate-600 flex items-center gap-1"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>}>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {!loading && rows.length === 0 && <div className="text-sm text-slate-500">No active approvals.</div>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Sigs</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Proposed</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="py-2 pr-3">{r.action_type}</td>
                  <td className="py-2 pr-3"><Pill state={r.status}>{r.status}</Pill></td>
                  <td className="py-2 pr-3 text-slate-700">{r.approvals_received}/{r.required_approvals}</td>
                  <td className="py-2 pr-3">{fmtCredits(Number(r.payload?.amountCredits ?? 0))}</td>
                  <td className="py-2 pr-3 text-slate-500">{fmtDate(r.proposed_at)}</td>
                  <td className="py-2 pr-3 flex gap-1">
                    {r.status === 'pending' && (
                      <>
                        <button type="button" onClick={() => decide(r.id, 'approve')} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">Approve</button>
                        <button type="button" onClick={() => decide(r.id, 'reject')}  className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">Reject</button>
                        <button type="button" onClick={() => cancel(r.id)}            className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function LedgerExplorerPanel({ organizationId }: { organizationId: string }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [referenceType, setReferenceType] = useState<string>('');
  const [since, setSince] = useState<string>('');
  const [until, setUntil] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ orgId: organizationId, limit: '100' });
      if (phase) params.set('executionPhase', phase);
      if (referenceType) params.set('referenceType', referenceType);
      if (since) params.set('since', new Date(since).toISOString());
      if (until) params.set('until', new Date(until).toISOString());
      const res = await fetchWithAuth(`/api/admin/credits/ledger?${params}`);
      const json = await res.json();
      setRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [organizationId, phase, referenceType, since, until]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card title="Ledger Explorer" icon={<Eye className="h-5 w-5 text-slate-600" />}
      action={<button type="button" onClick={load} className="text-sm text-slate-600 flex items-center gap-1"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Reload</button>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <select value={phase} onChange={e => setPhase(e.target.value)} className={inputCls}>
          <option value="">All phases</option>
          <option value="hold">hold</option>
          <option value="confirm">confirm</option>
          <option value="release">release</option>
          <option value="grant">grant</option>
          <option value="expire">expire</option>
          <option value="expire_incentive">expire_incentive</option>
        </select>
        <input type="text" placeholder="reference_type" value={referenceType} onChange={e => setReferenceType(e.target.value)} className={inputCls} />
        <input type="date" value={since} onChange={e => setSince(e.target.value)} className={inputCls} />
        <input type="date" value={until} onChange={e => setUntil(e.target.value)} className={inputCls} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Phase</th>
              <th className="py-2 pr-3">Δ Credits</th>
              <th className="py-2 pr-3">USD</th>
              <th className="py-2 pr-3">Reference</th>
              <th className="py-2 pr-3">Note</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="py-2 pr-3"><Pill state={r.execution_phase}>{r.execution_phase}</Pill></td>
                <td className={`py-2 pr-3 font-mono ${r.credits_delta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{r.credits_delta}</td>
                <td className="py-2 pr-3 font-mono text-slate-700">{r.usd_equivalent != null ? fmtUsd(r.usd_equivalent) : '—'}</td>
                <td className="py-2 pr-3 text-slate-500"><code className="text-xs">{r.reference_type ?? '—'}</code></td>
                <td className="py-2 pr-3 text-slate-600 max-w-md truncate">{r.note ?? '—'}</td>
                <td className="py-2 pr-3"><ImmutableBadge /></td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-500">No ledger rows match the filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function FinancialTimelinePanel({ organizationId }: { organizationId: string }) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/super-admin/billing-forensics/timeline?orgId=${encodeURIComponent(organizationId)}&limit=100`);
      const json = await res.json();
      setRows(Array.isArray(json?.events) ? json.events : []);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card title="Financial Timeline" icon={<Eye className="h-5 w-5 text-slate-600" />}
      action={<button type="button" onClick={load} className="text-sm text-slate-600 flex items-center gap-1"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Reload</button>}>
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <div className="w-32 shrink-0 text-slate-500 text-xs">{fmtDate(r.event_at)}</div>
            <Pill state={r.event_kind}>{r.event_kind}</Pill>
            <div className="text-slate-700 break-all">
              <code className="text-xs text-slate-500">{JSON.stringify(r.payload).slice(0, 240)}</code>
            </div>
          </li>
        ))}
        {rows.length === 0 && !loading && <li className="text-sm text-slate-500">No timeline events.</li>}
      </ol>
    </Card>
  );
}

export function RiskAnomalyPanel({ wallet }: { wallet: WalletPayload | null }) {
  const items: Array<{ kind: 'warn' | 'critical'; label: string }> = [];
  if (wallet?.financialControls?.emergencyFreeze)  items.push({ kind: 'critical', label: 'Emergency freeze active' });
  if (wallet?.financialControls?.billingLock)      items.push({ kind: 'critical', label: 'Billing lock active' });
  if (wallet?.burnRateAnomaly)                     items.push({ kind: 'warn', label: `Burn anomaly: ${wallet.burnRateAnomaly.reason ?? 'unknown'}` });
  if ((wallet?.reservations?.oldestHoldAgeSec ?? 0) > 24 * 3600) items.push({ kind: 'warn', label: 'Open HOLDs older than 24h' });
  if (wallet?.forecast?.isAccelerating)            items.push({ kind: 'warn', label: 'Accelerating consumption velocity' });

  return (
    <Card title="Risk & Anomalies" icon={<ShieldAlert className="h-5 w-5 text-amber-600" />}>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No risk indicators for this org.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <Pill state={it.kind === 'critical' ? 'critical' : 'pending'}>{it.kind}</Pill>
              <span className="text-slate-700">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface StuckOpRow {
  surface:        string;
  id:             string;
  organizationId: string | null;
  state:          string;
  rawStatus:      string;
  startedAt:      string;
  ageSec:         number;
  metadata:       Record<string, unknown>;
  heartbeat?:     { lastSeenAt: string | null; ageSec: number } | null;
}

interface MiddlewareRow {
  scope:               string;
  idempotencyKey:      string;
  status:              string;
  requestId:           string | null;
  lockedAt:            string | null;
  ageSec:              number;
  autoRecoverEligible: boolean;
}

function ageLabel(sec: number): string {
  if (sec < 0) return 'never';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function IdempotencyOperationsPanel({ organizationId, onActionComplete }: {
  organizationId: string;
  onActionComplete: () => void;
}) {
  const [rows, setRows] = useState<StuckOpRow[]>([]);
  const [midRows, setMidRows] = useState<MiddlewareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<unknown | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/credits/idempotency/list?orgId=${encodeURIComponent(organizationId)}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(Array.isArray(json?.operational?.rows) ? json.operational.rows : []);
      setMidRows(Array.isArray(json?.middlewareProcessing?.rows) ? json.middlewareProcessing.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function recover(row: StuckOpRow, action: 'expire' | 'cancel' | 'mark_failed'): Promise<void> {
    const reason = window.prompt(`Reason for ${action} of ${row.surface}:${row.id}?`);
    if (!reason?.trim()) return;
    const res = await fetchWithAuth('/api/admin/credits/idempotency/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(`recover-${row.id}-${action}`) },
      body: JSON.stringify({ surface: row.surface, id: row.id, action, reason }),
    });
    if (!res.ok) {
      const j = await res.json();
      window.alert(`Recovery failed: ${j.error ?? res.status}`);
    }
    await load();
    onActionComplete();
  }

  async function safeRetry(row: StuckOpRow): Promise<void> {
    if (row.surface !== 'billing_operations' && row.surface !== 'job_execution_registry') {
      window.alert('Safe retry only applies to billing_operations / job_execution_registry.');
      return;
    }
    const reason = window.prompt(`Reason for SAFE RETRY of ${row.surface}:${row.id}?\n\nThis verifies no completed settlement exists, supersedes the stuck row, and issues a fresh idempotency key. It NEVER re-runs a financial mutation.`);
    if (!reason?.trim()) return;
    const res = await fetchWithAuth('/api/admin/credits/idempotency/safe-retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(`safe-retry-${row.id}`) },
      body: JSON.stringify({ surface: row.surface, id: row.id, reason }),
    });
    const j = await res.json();
    if (res.ok && j.ok) {
      window.alert(`Safe retry issued.\nNew key: ${j.newIdempotencyKey}\nLineage: ${j.retryLineageId}\n\n${j.message}`);
    } else {
      window.alert(`Safe retry refused (${j.code ?? res.status}): ${j.message ?? j.error}`);
    }
    await load();
    onActionComplete();
  }

  async function traceOp(row: StuckOpRow): Promise<void> {
    const res = await fetchWithAuth('/api/admin/credits/idempotency/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: row.surface === 'billing_operations' ? row.id : undefined }),
    });
    setTrace(await res.json());
  }

  async function forceReconcile(): Promise<void> {
    if (!window.confirm('Force a portfolio-wide reconciliation scan?')) return;
    const res = await fetchWithAuth('/api/admin/credits/idempotency/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey('recon') },
      body: JSON.stringify({ dryRun: false }),
    });
    const json = await res.json();
    const s = json?.summary;
    window.alert(`Reconciled: recovered ${s?.recovered ?? 0} / scanned ${s?.scanned ?? 0} / drift-refused ${s?.refusedDueToDrift ?? 0}`);
    await load();
    onActionComplete();
  }

  return (
    <Card title="Idempotency Recovery Console" icon={<ShieldAlert className="h-5 w-5 text-amber-600" />}
      action={
        <div className="flex gap-2">
          <button type="button" onClick={load} className="text-sm text-slate-600 flex items-center gap-1">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
          <button type="button" onClick={forceReconcile}
            className="text-sm px-3 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50">
            Force reconciliation
          </button>
        </div>
      }>
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

      {/* Operational surfaces */}
      <h4 className="text-sm font-semibold text-slate-700 mb-2">Operational surfaces</h4>
      {!loading && rows.length === 0 && (
        <div className="text-sm text-slate-500 flex items-center gap-2 mb-4">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />No stuck operations — self-healing nominal.
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Surface</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Age</th>
                <th className="py-2 pr-3">Heartbeat</th>
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={`${r.surface}-${r.id}`}>
                  <td className="py-2 pr-3"><code className="text-xs text-slate-700">{r.surface}</code></td>
                  <td className="py-2 pr-3"><Pill state={r.state.toLowerCase()}>{r.rawStatus}</Pill></td>
                  <td className="py-2 pr-3 text-slate-700">{ageLabel(r.ageSec)}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {r.heartbeat
                      ? (r.heartbeat.ageSec < 0 ? <span className="text-amber-700">none</span> : `${ageLabel(r.heartbeat.ageSec)} ago`)
                      : <span className="text-slate-400">n/a</span>}
                  </td>
                  <td className="py-2 pr-3"><code className="text-xs text-slate-500">{r.id.slice(0, 8)}…</code></td>
                  <td className="py-2 pr-3 flex flex-wrap gap-1">
                    <button type="button" onClick={() => traceOp(r)}
                      className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50">Trace</button>
                    {(r.surface === 'billing_operations' || r.surface === 'job_execution_registry') && (
                      <button type="button" onClick={() => safeRetry(r)}
                        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Retry safely</button>
                    )}
                    <button type="button" onClick={() => recover(r, 'expire')}
                      className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700">Expire</button>
                    <button type="button" onClick={() => recover(r, 'cancel')}
                      className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50">Cancel</button>
                    <button type="button" onClick={() => recover(r, 'mark_failed')}
                      className="px-2 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50">Mark failed</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Middleware processing rows (the 409 IDEMPOTENCY_IN_PROGRESS source) */}
      <h4 className="text-sm font-semibold text-slate-700 mb-2">
        Middleware locks <span className="font-normal text-slate-400">(api_idempotency_keys · status=processing)</span>
      </h4>
      {midRows.length === 0 ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />No stuck middleware locks. The 5-min cron auto-clears these.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Scope</th>
                <th className="py-2 pr-3">Key</th>
                <th className="py-2 pr-3">Age</th>
                <th className="py-2 pr-3">Auto-recover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {midRows.map(m => (
                <tr key={`${m.scope}-${m.idempotencyKey}`}>
                  <td className="py-2 pr-3"><code className="text-xs text-slate-700">{m.scope}</code></td>
                  <td className="py-2 pr-3"><code className="text-xs text-slate-500">{m.idempotencyKey.slice(0, 24)}…</code></td>
                  <td className="py-2 pr-3 text-slate-700">{ageLabel(m.ageSec)}</td>
                  <td className="py-2 pr-3">
                    {m.autoRecoverEligible
                      ? <Pill state="pending">eligible — next cron</Pill>
                      : <Pill state="hold">waiting (&lt; 10m)</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">
            These are cleared automatically by the 5-minute idempotency-expiry cron — no manual SQL required.
            Use the CLI <code>scripts/audit/flush-stale-idempotency.ts</code> to force an immediate sweep.
          </p>
        </div>
      )}

      {trace != null && (
        <div className="mt-4 border border-slate-200 rounded-md p-3 bg-slate-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">Correlation trace</span>
            <button type="button" onClick={() => setTrace(null)} className="text-xs text-slate-500 hover:text-slate-800">
              <X className="h-3 w-3" />
            </button>
          </div>
          <pre className="text-xs text-slate-600 overflow-x-auto max-h-80">{JSON.stringify(trace, null, 2)}</pre>
        </div>
      )}
    </Card>
  );
}

export function BillingFlagsPanel({ organizationId, flags, onActionComplete }: {
  organizationId: string;
  flags: Record<string, { enabled: boolean; reason: string }>;
  onActionComplete: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function emergencyRollback(): Promise<void> {
    if (!window.confirm(`Emergency rollback all billing flags for ${organizationId}?`)) return;
    setBusy(true);
    try {
      const reason = window.prompt('Reason for emergency rollback?') ?? 'operator-initiated';
      await fetchWithAuth('/api/super-admin/billing-rollout/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(`rollback-${organizationId}`) },
        body: JSON.stringify({ organizationId, reason }),
      });
      onActionComplete();
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(flags);

  return (
    <Card title="Billing Flags & Rollout" icon={<Flag className="h-5 w-5 text-indigo-600" />}
      action={
        <button type="button" onClick={emergencyRollback} disabled={busy}
          className="text-sm px-3 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50">
          {busy ? 'Working…' : 'Emergency rollback'}
        </button>
      }
    >
      {entries.length === 0 ? (
        <div className="text-sm text-slate-500">No flag state available.</div>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-3">Flag</th>
              <th className="py-2 pr-3">State</th>
              <th className="py-2 pr-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map(([flagKey, ev]) => (
              <tr key={flagKey}>
                <td className="py-2 pr-3 font-mono text-xs text-slate-700">{flagKey}</td>
                <td className="py-2 pr-3"><Pill state={ev.enabled ? 'approved' : 'expired'}>{ev.enabled ? 'enabled' : 'disabled'}</Pill></td>
                <td className="py-2 pr-3 text-slate-500 text-xs">{ev.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

