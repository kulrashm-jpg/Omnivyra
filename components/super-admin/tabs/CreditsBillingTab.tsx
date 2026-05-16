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

interface Company { id: string; name?: string | null }

interface WalletPayload {
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

interface LedgerRow {
  id: string; execution_phase: string; credits_delta: number;
  balance_after: number | null; usd_equivalent: number | null;
  reference_type: string | null; reference_id: string | null;
  note: string | null; performed_by: string | null; idempotency_key: string;
  parent_transaction_id: string | null; category: string; created_at: string;
  metadata: Record<string, unknown> | null;
}

interface ApprovalRow {
  id: string; action_type: string; organization_id: string; proposed_by: string;
  status: string; required_approvals: number; approvals_received: number;
  proposed_at: string; payload: Record<string, unknown>;
}

interface TimelineRow {
  organization_id: string; event_at: string; event_kind: string;
  payload: Record<string, unknown>;
}

function fmtCredits(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}
function fmtUsd(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso: string | null | undefined): string {
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
function makeIdemKey(prefix: string): string {
  const haveUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  return haveUuid
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function Pill({ children, state }: { children: React.ReactNode; state: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClass(state)}`}>{children}</span>;
}
function ImmutableBadge() {
  return <Pill state="confirm"><Lock className="h-3 w-3 mr-1" />immutable</Pill>;
}

function Card({ title, icon, children, action }: {
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

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500';

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

function ApprovalQueuePanel({ organizationId, onActionComplete }: { organizationId: string; onActionComplete: () => void }) {
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

function LedgerExplorerPanel({ organizationId }: { organizationId: string }) {
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

function FinancialTimelinePanel({ organizationId }: { organizationId: string }) {
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

function RiskAnomalyPanel({ wallet }: { wallet: WalletPayload | null }) {
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

function IdempotencyOperationsPanel({ organizationId, onActionComplete }: {
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

function BillingFlagsPanel({ organizationId, flags, onActionComplete }: {
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
