/** Part 1/2 of CreditsBillingTab.tsx — verbatim split (barrel preserved; importers unchanged). */
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

import { ApprovalQueuePanel, LedgerExplorerPanel, FinancialTimelinePanel, RiskAnomalyPanel, IdempotencyOperationsPanel, BillingFlagsPanel } from './CreditsBillingTabPanels';

interface Company { id: string; name?: string | null }

export interface WalletPayload {
  organizationId: string;
  wallet: {
    freeBalance: number; paidBalance: number; incentiveBalance: number;
    reservedFree: number; reservedPaid: number; reservedIncentive: number;
    lifetimePurchased: number; lifetimeConsumed: number;
    creditRateUsd: number; totalAvailable: number; estimatedUsdValue: number;
    lastTransactionAt: string | null;
  } | null;
  reservations: { openHolds: number; totalReserved: number; oldestHoldAgeSec: number | null };
  forecast: {
    observedCredits: number; projectedCredits: number; dailyBurnRate: number;
    daysRemaining: number; isAccelerating: boolean;
  } | null;
  burnRateAnomaly: { reason?: string } | null;
  invoiceProjection: {
    projectedTotalUsd: number; currency: string;
    contract: { id: string; number: string; status: string; allotment: number } | null;
  };
  contract: { contractNumber?: string; paymentTerms?: string; totalCreditAllotment?: number; endDate?: string } | null;
  flags: Record<string, { enabled: boolean; reason: string }>;
  financialControls: { allowed: boolean; emergencyFreeze: boolean; billingLock: boolean; reason?: string };
}

export interface LedgerRow {
  id: string; execution_phase: string; credits_delta: number;
  balance_after: number | null; usd_equivalent: number | null;
  reference_type: string | null; reference_id: string | null;
  note: string | null; performed_by: string | null; idempotency_key: string;
  parent_transaction_id: string | null; category: string; created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface ApprovalRow {
  id: string; action_type: string; organization_id: string; proposed_by: string;
  status: string; required_approvals: number; approvals_received: number;
  proposed_at: string; payload: Record<string, unknown>;
}

export interface TimelineRow {
  organization_id: string; event_at: string; event_kind: string;
  payload: Record<string, unknown>;
}

export function fmtCredits(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}
export function fmtUsd(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/**
 * Collision-resistant Idempotency-Key generator. Uses crypto.randomUUID()
 * where available (modern browsers + Node 19+); falls back to a high-entropy
 * suffix when not (extremely rare in admin contexts).
 *
 * Rationale: a previous version used `Date.now()` which permits two clicks
 * within the same millisecond to share a key — causing the withIdempotency
 * middleware to return HTTP 409 IDEMPOTENCY_IN_PROGRESS or
 * IDEMPOTENCY_CONFLICT on the second submission.
 */
// Canonical implementation now lives in lib/idempotency.ts so tenant-facing
// callers reuse it instead of duplicating it. Imported and re-exported here
// unchanged so this module's existing importers (CreditsBillingTabPanels) and
// its own local use below are both unaffected.
import { makeIdemKey } from '../../../lib/idempotency';
export { makeIdemKey };

function pillClass(state: string): string {
  switch (state) {
    case 'confirm': case 'grant': case 'approved': case 'executed': case 'pass':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'hold': case 'pending': case 'initiated': case 'held':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'release': case 'expire': case 'expire_incentive':
    case 'released': case 'rejected': case 'cancelled': case 'expired':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'fail': case 'critical':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function Pill({ children, state }: { children: React.ReactNode; state: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClass(state)}`}>{children}</span>;
}
export function ImmutableBadge() {
  return <Pill state="confirm"><Lock className="h-3 w-3 mr-1" />immutable</Pill>;
}

export function Card({ title, icon, children, action }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-900">{value}</div>
      {hint != null && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default function CreditsBillingTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<Company | null>(null);
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth('/api/super-admin/companies');
        const json = await res.json();
        const list: Company[] = Array.isArray(json?.companies) ? json.companies : Array.isArray(json) ? json : [];
        setCompanies(list);
      } catch { /* non-fatal */ }
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrg) { setWallet(null); return; }
    setWalletLoading(true);
    setWalletError(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/credits/company-wallet?orgId=${encodeURIComponent(selectedOrg.id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as WalletPayload;
        setWallet(json);
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : String(err));
      } finally {
        setWalletLoading(false);
      }
    })();
  }, [selectedOrg, refreshTick]);

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies.slice(0, 50);
    return companies.filter(c =>
      (c.name ?? '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    ).slice(0, 100);
  }, [query, companies]);

  const refresh = useCallback(() => setRefreshTick(t => t + 1), []);

  return (
    <div className="space-y-6">
      <GlobalFinancialOverviewPanel onSelectOrg={(id) => setSelectedOrg({ id })} />

      <CompanySearchPanel
        companies={filteredCompanies}
        query={query}
        onQuery={setQuery}
        selected={selectedOrg}
        onSelect={setSelectedOrg}
      />

      {!selectedOrg && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-10 text-center">
          <Coins className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-900">Select a company to begin</h3>
          <p className="text-sm text-slate-500 mt-1">Search above to load wallet, ledger, and approval state.</p>
        </div>
      )}

      {selectedOrg && (
        <>
          <WalletOverviewPanel
            wallet={wallet}
            loading={walletLoading}
            error={walletError}
            onRefresh={refresh}
            organizationName={selectedOrg.name ?? selectedOrg.id}
          />
          <CreditActionsPanel
            organizationId={selectedOrg.id}
            isFrozen={Boolean(wallet?.financialControls?.emergencyFreeze)}
            isLocked={Boolean(wallet?.financialControls?.billingLock)}
            onActionComplete={refresh}
          />
          <ApprovalQueuePanel organizationId={selectedOrg.id} onActionComplete={refresh} />
          <LedgerExplorerPanel organizationId={selectedOrg.id} />
          <FinancialTimelinePanel organizationId={selectedOrg.id} />
          <RiskAnomalyPanel wallet={wallet} />
          <IdempotencyOperationsPanel organizationId={selectedOrg.id} onActionComplete={refresh} />
          <BillingFlagsPanel organizationId={selectedOrg.id} flags={wallet?.flags ?? {}} onActionComplete={refresh} />
        </>
      )}
    </div>
  );
}

interface OverviewAggregate {
  totalOrgs: number;
  totalActiveCompanies?: number;
  totalAvailableCredits: number;
  totalAvailableUsd: number;
  totalReservedCredits: number;
  frozenCount: number;
  lockedCount: number;
  anomalyCount: number;
  topByConsumption: Array<{ organizationId: string; companyName?: string; lifetimeConsumed: number }>;
}
interface OverviewCompanyRow {
  organizationId: string;
  companyName?: string;
  totalAvailable: number;
  reservedTotal: number;
  lifetimePurchased: number;
  lifetimeConsumed: number;
  estimatedUsdValue: number;
  emergencyFreeze: boolean;
  billingLock: boolean;
  contractNumber: string | null;
  burnAnomaly: boolean;
  burnReason: string | null;
  lastTransactionAt: string | null;
}

function GlobalFinancialOverviewPanel({ onSelectOrg }: { onSelectOrg: (orgId: string) => void }) {
  const [agg, setAgg] = useState<OverviewAggregate | null>(null);
  const [rows, setRows] = useState<OverviewCompanyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'' | 'frozen' | 'locked' | 'lowBalance' | 'anomaly' | 'highBurn'>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filter === 'frozen')  params.set('status', 'frozen');
      if (filter === 'locked')  params.set('status', 'locked');
      if (filter === 'lowBalance') params.set('lowBalance', 'true');
      if (filter === 'anomaly') params.set('anomaly', 'true');
      if (filter === 'highBurn') params.set('highBurn', 'true');
      const res = await fetchWithAuth(`/api/super-admin/financial-overview?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAgg(json.aggregate);
      setRows(Array.isArray(json?.companies?.rows) ? json.companies.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card title="Global Financial Overview" icon={<Coins className="h-5 w-5 text-emerald-600" />}
      action={<button type="button" onClick={load} className="text-sm text-slate-600 flex items-center gap-1"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>}>
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
      {agg && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Metric
            label="Companies"
            value={fmtCredits(agg.totalOrgs)}
            hint={agg.totalActiveCompanies != null ? `${fmtCredits(agg.totalActiveCompanies)} active total` : undefined}
          />
          <Metric label="Total available" value={fmtCredits(agg.totalAvailableCredits)} hint={fmtUsd(agg.totalAvailableUsd)} />
          <Metric label="Total reserved" value={fmtCredits(agg.totalReservedCredits)} />
          <Metric label="Frozen / Locked" value={`${agg.frozenCount} / ${agg.lockedCount}`} hint={`${agg.anomalyCount} anomalies`} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        {([
          ['', 'All'], ['frozen', 'Frozen'], ['locked', 'Locked'],
          ['lowBalance', 'Low balance'], ['anomaly', 'Anomaly'], ['highBurn', 'High burn'],
        ] as const).map(([val, label]) => (
          <button key={val} type="button" onClick={() => setFilter(val)}
            className={`px-3 py-1 text-xs rounded-md border ${filter === val ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-3">Org</th>
              <th className="py-2 pr-3">Available</th>
              <th className="py-2 pr-3">Reserved</th>
              <th className="py-2 pr-3">Purchased</th>
              <th className="py-2 pr-3">Consumed</th>
              <th className="py-2 pr-3">USD</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Contract</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.organizationId}>
                <td className="py-2 pr-3">
                  <div className="text-slate-900">{r.companyName ?? 'Unnamed company'}</div>
                  <code className="text-[10px] text-slate-400">{r.organizationId.slice(0, 8)}…</code>
                </td>
                <td className="py-2 pr-3 font-mono text-slate-900">{fmtCredits(r.totalAvailable)}</td>
                <td className="py-2 pr-3 font-mono text-slate-600">{fmtCredits(r.reservedTotal)}</td>
                <td className="py-2 pr-3 font-mono text-slate-600">{fmtCredits(r.lifetimePurchased)}</td>
                <td className="py-2 pr-3 font-mono text-slate-600">{fmtCredits(r.lifetimeConsumed)}</td>
                <td className="py-2 pr-3 font-mono text-slate-700">{fmtUsd(r.estimatedUsdValue)}</td>
                <td className="py-2 pr-3 flex flex-wrap gap-1">
                  {r.emergencyFreeze && <Pill state="critical">frozen</Pill>}
                  {r.billingLock && <Pill state="critical">locked</Pill>}
                  {r.burnAnomaly && <Pill state="pending">{r.burnReason ?? 'anomaly'}</Pill>}
                  {!r.emergencyFreeze && !r.billingLock && !r.burnAnomaly && <Pill state="approved">ok</Pill>}
                </td>
                <td className="py-2 pr-3 text-slate-500 text-xs">{r.contractNumber ?? '—'}</td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => onSelectOrg(r.organizationId)}
                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Open</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} className="py-6 text-center text-sm text-slate-500">No companies match the filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CompanySearchPanel({ companies, query, onQuery, selected, onSelect }: {
  companies: Company[]; query: string; onQuery: (q: string) => void;
  selected: Company | null; onSelect: (c: Company | null) => void;
}) {
  return (
    <Card title="Company Search" icon={<Search className="h-5 w-5 text-slate-500" />}>
      <div className="flex gap-2 mb-4">
        <input type="text" value={query} onChange={(e) => onQuery(e.target.value)}
          placeholder="Search by name or org_id..."
          className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500" />
        {selected && (
          <button type="button" onClick={() => onSelect(null)}
            className="px-3 py-2 border border-slate-300 rounded-md text-sm hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {selected ? (
        <div className="text-sm text-slate-700">
          <span className="font-medium">Selected:</span> {selected.name ?? '(unnamed)'}{' '}
          <code className="ml-2 text-xs text-slate-500">{selected.id}</code>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
          {companies.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No matches.</div>}
          {companies.map(c => (
            <button key={c.id} type="button" onClick={() => onSelect(c)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
              <span className="text-slate-900">{c.name ?? '(unnamed)'}</span>
              <code className="text-xs text-slate-500">{c.id.slice(0, 8)}…</code>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function WalletOverviewPanel({ wallet, loading, error, onRefresh, organizationName }: {
  wallet: WalletPayload | null; loading: boolean; error: string | null;
  onRefresh: () => void; organizationName: string;
}) {
  return (
    <Card
      title={`Wallet — ${organizationName}`}
      icon={<Coins className="h-5 w-5 text-emerald-600" />}
      action={
        <button type="button" onClick={onRefresh} className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      }
    >
      {loading && <div className="text-slate-500 text-sm">Loading…</div>}
      {error && <div className="text-red-600 text-sm">Error: {error}</div>}
      {!loading && wallet && wallet.wallet && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Metric label="Available" value={fmtCredits(wallet.wallet.totalAvailable)} hint={fmtUsd(wallet.wallet.estimatedUsdValue)} />
            <Metric label="Free" value={fmtCredits(wallet.wallet.freeBalance)} hint={`reserved ${wallet.wallet.reservedFree}`} />
            <Metric label="Paid" value={fmtCredits(wallet.wallet.paidBalance)} hint={`reserved ${wallet.wallet.reservedPaid}`} />
            <Metric label="Incentive" value={fmtCredits(wallet.wallet.incentiveBalance)} hint={`reserved ${wallet.wallet.reservedIncentive}`} />
            <Metric label="Lifetime purchased" value={fmtCredits(wallet.wallet.lifetimePurchased)} />
            <Metric label="Lifetime consumed" value={fmtCredits(wallet.wallet.lifetimeConsumed)} />
            <Metric label="Open HOLDs" value={fmtCredits(wallet.reservations.openHolds)} hint={`${wallet.reservations.totalReserved} reserved`} />
            <Metric label="Last txn" value={fmtDate(wallet.wallet.lastTransactionAt)} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Metric label="Monthly burn (forecast)" value={wallet.forecast ? `${fmtCredits(Math.round(wallet.forecast.dailyBurnRate * 30))} cr` : '—'}
                    hint={wallet.forecast?.isAccelerating ? 'accelerating' : 'stable'} />
            <Metric label="Days remaining (period)" value={wallet.forecast ? String(wallet.forecast.daysRemaining) : '—'} />
            <Metric label="Projected invoice" value={fmtUsd(wallet.invoiceProjection.projectedTotalUsd, wallet.invoiceProjection.currency)} />
            <Metric label="Contract" value={wallet.contract?.contractNumber ?? '—'} hint={wallet.contract?.paymentTerms ?? ''} />
            <Metric label="Contract allotment" value={fmtCredits(wallet.contract?.totalCreditAllotment ?? null)} />
            <Metric label="Contract ends" value={wallet.contract?.endDate ?? '—'} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {wallet.financialControls.emergencyFreeze && (
              <Pill state="critical"><Snowflake className="h-3 w-3 mr-1" />FROZEN — {wallet.financialControls.reason ?? 'no reason'}</Pill>
            )}
            {wallet.financialControls.billingLock && (
              <Pill state="critical"><Lock className="h-3 w-3 mr-1" />BILLING LOCK</Pill>
            )}
            {!wallet.financialControls.emergencyFreeze && !wallet.financialControls.billingLock && (
              <Pill state="approved"><Sun className="h-3 w-3 mr-1" />Active</Pill>
            )}
            {wallet.burnRateAnomaly && (
              <Pill state="critical"><TrendingDown className="h-3 w-3 mr-1" />Burn-rate anomaly: {wallet.burnRateAnomaly.reason}</Pill>
            )}
          </div>
        </>
      )}
      {!loading && wallet && !wallet.wallet && (
        <div className="text-sm text-slate-500">No wallet on file for this organization.</div>
      )}
    </Card>
  );
}

function ActionButton({ kind, active, onClick, variant = 'default' }: {
  kind: 'grant' | 'revoke' | 'freeze' | 'unfreeze';
  active: string | null;
  onClick: (k: 'grant' | 'revoke' | 'freeze' | 'unfreeze') => void;
  variant?: 'default' | 'warning' | 'success';
}) {
  const variantCls =
    variant === 'warning' ? 'bg-amber-600 hover:bg-amber-700' :
    variant === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' :
    'bg-blue-600 hover:bg-blue-700';
  return (
    <button type="button" onClick={() => onClick(kind)}
      className={`px-3 py-2 text-sm rounded-md text-white capitalize ${variantCls} ${active === kind ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}>
      {kind}
    </button>
  );
}

type TerminalState = {
  kind: 'success' | 'info' | 'failure';
  title: string;
  detail?: string;
  correlationId?: string;
  retryable?: boolean;
  errorCode?: string;
};

function CreditActionsPanel({ organizationId, isFrozen, isLocked, onActionComplete }: {
  organizationId: string; isFrozen: boolean; isLocked: boolean; onActionComplete: () => void;
}) {
  const [action, setAction] = useState<'grant' | 'revoke' | 'freeze' | 'unfreeze' | null>(null);
  const [credits, setCredits] = useState('');
  const [category, setCategory] = useState<'free' | 'paid' | 'incentive'>('free');
  const [reason, setReason] = useState('');
  const [reasonType, setReasonType] = useState('customer_support');
  const [submitting, setSubmitting] = useState(false);
  const [terminal, setTerminal] = useState<TerminalState | null>(null);

  // Phase D: every async financial action MUST reach a terminal state —
  // a hung request can never leave an infinite "Submitting…".
  const ACTION_TIMEOUT_MS = 30_000;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setTerminal(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS);
    try {
      let endpoint = '';
      let body: Record<string, unknown> = {};
      if (action === 'grant') {
        endpoint = '/api/admin/credits/grant';
        body = { organizationId, credits: Number(credits), reason, reasonType };
      } else if (action === 'revoke') {
        endpoint = '/api/admin/credits/revoke';
        body = { organizationId, credits: Number(credits), category, reason };
      } else if (action === 'freeze') {
        endpoint = '/api/admin/credits/freeze';
        body = { organizationId, reason };
      } else if (action === 'unfreeze') {
        endpoint = '/api/admin/credits/unfreeze';
        body = { organizationId, reason };
      }

      const res = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': makeIdemKey(action ?? 'action') },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      const correlationId = typeof json.correlationId === 'string' ? json.correlationId : undefined;

      if (res.status === 202 && json.status === 'pending_approval') {
        setTerminal({
          kind: 'info',
          title: 'Awaiting approval signatures',
          detail: `${json.message ?? 'A second super-admin must sign this request.'} (approvalId=${json.approvalId}, ${json.requiredApprovals} signatures required)`,
          correlationId,
        });
        onActionComplete(); // refresh the approval queue so the row is visible
      } else if (res.ok && (json.success === true || json.ok === true)) {
        setTerminal({
          kind: 'success',
          title:
            action === 'grant'  ? 'Credits granted successfully'  :
            action === 'revoke' ? 'Credits revoked successfully'   :
            action === 'freeze' ? 'Billing frozen successfully'    :
                                  'Billing unfrozen successfully',
          detail: typeof json.message === 'string' ? json.message : undefined,
          correlationId,
        });
        setAction(null); setCredits(''); setReason('');
        onActionComplete();
      } else {
        setTerminal({
          kind: 'failure',
          title:
            action === 'grant' && (json.errorCode === 'APPROVAL_CONSTRAINT')
              ? 'Grant failed — approval constraint error'
              : `${action ?? 'Action'} failed`,
          detail:
            (typeof json.actionableMessage === 'string' && json.actionableMessage) ||
            (typeof json.error === 'string' && json.error) ||
            `HTTP ${res.status}`,
          correlationId,
          retryable: json.retryable === true,
          errorCode: typeof json.errorCode === 'string' ? json.errorCode : undefined,
        });
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setTerminal({
        kind: 'failure',
        title: aborted ? 'Request timed out' : `${action ?? 'Action'} failed`,
        detail: aborted
          ? `No response after ${ACTION_TIMEOUT_MS / 1000}s. The request may still have applied — check the Ledger Explorer / Approval Queue before retrying.`
          : (err instanceof Error ? err.message : String(err)),
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      setSubmitting(false); // ALWAYS — success, failure, timeout, or abort
    }
  }

  return (
    <Card title="Credit Actions" icon={<FileCheck2 className="h-5 w-5 text-blue-600" />}>
      <div className="flex flex-wrap gap-2 mb-4">
        <ActionButton kind="grant"    active={action} onClick={setAction} />
        <ActionButton kind="revoke"   active={action} onClick={setAction} />
        {!isFrozen && <ActionButton kind="freeze" active={action} onClick={setAction} variant="warning" />}
        {isFrozen && <ActionButton kind="unfreeze" active={action} onClick={setAction} variant="success" />}
      </div>

      {action && (
        <div className="border border-slate-200 rounded-md p-4 bg-slate-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {(action === 'grant' || action === 'revoke') && (
              <Field label="Credits">
                <input type="number" value={credits} onChange={e => setCredits(e.target.value)} className={inputCls} />
              </Field>
            )}
            {action === 'revoke' && (
              <Field label="Category">
                <select value={category} onChange={e => setCategory(e.target.value as 'free' | 'paid' | 'incentive')} className={inputCls}>
                  <option value="free">free</option>
                  <option value="incentive">incentive</option>
                </select>
              </Field>
            )}
            {action === 'grant' && (
              <Field label="Reason type">
                <select value={reasonType} onChange={e => setReasonType(e.target.value)} className={inputCls}>
                  <option value="customer_support">customer_support</option>
                  <option value="goodwill">goodwill</option>
                  <option value="promotional">promotional</option>
                  <option value="beta_feedback">beta_feedback</option>
                  <option value="compensation">compensation</option>
                  <option value="correction">correction</option>
                  <option value="other">other</option>
                </select>
              </Field>
            )}
            <Field label="Reason (required)">
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Free-text justification" className={inputCls} />
            </Field>
          </div>
          {isLocked && action !== 'unfreeze' && (
            <div className="mb-3 text-amber-700 text-sm flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />Org is locked. Actions may be blocked at execution.
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={submit}
              disabled={submitting || !reason.trim() || ((action === 'grant' || action === 'revoke') && !credits)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Submitting…' : `Confirm ${action}`}
            </button>
            <button type="button" onClick={() => { setAction(null); setTerminal(null); }}
              className="px-4 py-2 border border-slate-300 rounded-md text-sm hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {terminal && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-md border p-3 text-sm ${
            terminal.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
            terminal.kind === 'info'    ? 'border-blue-200 bg-blue-50 text-blue-800' :
                                          'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {terminal.kind === 'success' ? <CheckCircle2 className="h-4 w-4" /> :
             terminal.kind === 'info'    ? <Clock className="h-4 w-4" /> :
                                           <AlertTriangle className="h-4 w-4" />}
            {terminal.title}
          </div>
          {terminal.detail && <div className="mt-1 text-[13px] leading-snug">{terminal.detail}</div>}
          {terminal.kind === 'failure' && (
            <div className="mt-1 text-[12px] flex items-center gap-1 text-red-700">
              <Info className="h-3.5 w-3.5" />
              {terminal.retryable
                ? 'Retryable — resubmit with the same Idempotency-Key (exactly-once protected).'
                : 'Not retryable without remediation — resolve the cause above, then retry.'}
            </div>
          )}
          {terminal.correlationId && (
            <div className="mt-1.5 text-[11px] text-slate-500">
              correlationId: <span className="font-mono">{terminal.correlationId}</span>
              {terminal.errorCode && <> · code: <span className="font-mono">{terminal.errorCode}</span></>}
            </div>
          )}
          <button
            type="button"
            onClick={() => setTerminal(null)}
            className="mt-2 text-[12px] underline text-slate-500 hover:text-slate-700"
          >
            Dismiss
          </button>
        </div>
      )}
    </Card>
  );
}

