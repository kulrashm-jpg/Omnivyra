/**
 * Company Billing Portal — Phase C/D/E/F
 *
 * Company-facing financial transparency. Strictly org-scoped: every fetch
 * passes the CompanyContext-selected companyId, and the server enforces
 * org-isolation via assertOrgAccess (a company user physically cannot read
 * another org's data — the API rejects it).
 *
 * Read-only. No mutations. Exports go through the manifest-wrapped
 * company export endpoint.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Coins, Download, FileText, Lock,
  RefreshCw, ShoppingCart, Sparkles, TrendingDown,
} from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import CreditAdvisorDashboard from '../../../components/credit-advisor/CreditAdvisorDashboard';
import OptimizationPanel from '../../../components/credit-advisor/OptimizationPanel';
import TopUpPanel from '../../../components/billing/TopUpPanel';
import ActivityCostRange from '../../../components/billing/ActivityCostRange';

type BillingView = 'advisor' | 'billing' | 'buy';

const VIEW_OPTIONS: { key: BillingView; label: string; icon: React.ReactNode; blurb: string }[] = [
  { key: 'advisor', label: 'Credit Advisor', icon: <Sparkles className="h-4 w-4" />, blurb: 'Consumption intelligence, runway forecast, and savings — read-only.' },
  { key: 'billing', label: 'Billing & Subscription', icon: <FileText className="h-4 w-4" />, blurb: 'Wallet, forecast, plan, ledger, and recent events.' },
  { key: 'buy', label: 'Buy Credits', icon: <ShoppingCart className="h-4 w-4" />, blurb: 'Add top-up credits for heavier periods.' },
];

// Representative activities surfaced in the cost-reference card. Token-priced
// ones (campaign/content/blog) render a min–max band with a "may rise"
// provisional flag; fixed-fee ones render a flat number.
const COST_REFERENCE_ACTIONS = [
  'campaign_generation',
  'campaign_creation',
  'content_generation',
  'content_basic',
  'blog_generation',
  'full_strategy',
  'deep_analysis',
  'trend_analysis',
];
const COST_REFERENCE_LABELS: Record<string, string> = {
  campaign_generation: 'BOLT campaign (autonomous)',
  campaign_creation: 'Campaign creation',
  content_generation: 'Master content (token-priced)',
  content_basic: 'Basic content / post',
  blog_generation: 'Blog article',
  full_strategy: 'Full campaign strategy',
  deep_analysis: 'Deep analysis',
  trend_analysis: 'Trend analysis',
};

interface SummaryPayload {
  organizationId: string;
  wallet: {
    freeBalance: number; paidBalance: number; incentiveBalance: number;
    reservedFree: number; reservedPaid: number; reservedIncentive: number;
    lifetimePurchased: number; lifetimeConsumed: number;
    creditRateUsd: number; totalAvailable: number; estimatedUsdValue: number;
    lastTransactionAt: string | null;
  } | null;
  reservations: { openHolds: number; totalReserved: number; oldHolds24h: number };
  forecast: { dailyBurnRate: number; daysRemaining: number; isAccelerating: boolean; projectedCredits: number } | null;
  invoiceProjection: { projectedTotalUsd: number; currency: string } | null;
  contract: { contractNumber: string; paymentTerms: string; allotment: number; endDate: string; currency: string } | null;
  subscriptions: Array<{ status: string; currentPeriodEnd: string; daysUntilRenewal: number; willAutoRenew: boolean }>;
  flags: Record<string, { enabled: boolean; reason: string }>;
  topModules: Array<{ module: string; credits: number }>;
  recentEvents: Array<{ id: string; execution_phase: string; credits_delta: number; reference_type: string | null; note: string | null; created_at: string }>;
}

interface LedgerRow {
  id: string; execution_phase: string; credits_delta: number;
  balance_after: number | null; usd_equivalent: number | null;
  reference_type: string | null; reference_id: string | null;
  note: string | null; created_at: string; immutable: boolean;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}
function usd(n: number | null | undefined, c = 'USD'): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
}
function dt(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleString() : '—';
}
function phasePill(p: string): string {
  if (['confirm', 'grant'].includes(p)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (p === 'hold') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (['release', 'expire', 'expire_incentive'].includes(p)) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function Card({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">{icon}{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
function CollapseToggle({ expanded, onToggle, total }: { expanded: boolean; onToggle: () => void; total: number }) {
  return (
    <button type="button" onClick={onToggle}
      className="text-sm text-slate-600 flex items-center gap-1 hover:text-slate-900">
      {expanded
        ? <><ChevronUp className="h-4 w-4" />Minimize</>
        : <><ChevronDown className="h-4 w-4" />Show all ({total})</>}
    </button>
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

export default function CompanyBillingPortal() {
  const { selectedCompanyId, selectedCompanyName, userRole } = useCompanyContext();
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Tab switcher (dropdown): Credit Advisor / Billing & Subscription / Buy Credits.
  const [view, setView] = useState<BillingView>('billing');
  const [menuOpen, setMenuOpen] = useState(false);
  // Collapsible list sections — default collapsed to 2 rows; expand to see all.
  const [expandModules, setExpandModules] = useState(false);
  const [expandLedger, setExpandLedger] = useState(false);
  const [expandEvents, setExpandEvents] = useState(false);
  const currentView = VIEW_OPTIONS.find(o => o.key === view) ?? VIEW_OPTIONS[1];

  // Standard users have no billing access. The server also enforces this,
  // but we avoid even rendering the data fetch for them.
  const allowed = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'FINANCE_AUDITOR'].includes(String(userRole));

  const load = useCallback(async () => {
    if (!selectedCompanyId || !allowed) return;
    setLoading(true);
    setError(null);
    try {
      const [sumRes, ledRes] = await Promise.all([
        fetchWithAuth(`/api/company/billing/summary?companyId=${encodeURIComponent(selectedCompanyId)}`),
        fetchWithAuth(`/api/company/billing/ledger?companyId=${encodeURIComponent(selectedCompanyId)}&limit=50`),
      ]);
      if (sumRes.status === 403) { setError('You do not have billing access for this organization.'); return; }
      if (!sumRes.ok) throw new Error(`Summary HTTP ${sumRes.status}`);
      setSummary(await sumRes.json());
      if (ledRes.ok) {
        const j = await ledRes.json();
        setLedger(Array.isArray(j?.rows) ? j.rows : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, allowed, tick]);

  useEffect(() => { void load(); }, [load]);

  async function exportUsage(): Promise<void> {
    const res = await fetchWithAuth('/api/company/billing/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `cbexport-${selectedCompanyId}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      },
      body: JSON.stringify({ companyId: selectedCompanyId, exportType: 'company_usage', format: 'csv' }),
    });
    const j = await res.json();
    if (res.ok && j.ok) {
      const blob = new Blob([j.body], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-${selectedCompanyId}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      window.alert(`Export failed: ${j.error ?? res.status}`);
    }
  }

  if (!allowed) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
          <Lock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-medium text-slate-900">Billing access required</h2>
          <p className="text-sm text-slate-500 mt-1">Contact your organization administrator.</p>
        </div>
      </div>
    );
  }

  const w = summary?.wallet;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{currentView.label}</h1>
          <p className="text-sm text-slate-500">{selectedCompanyName || selectedCompanyId}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab dropdown */}
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              <span className="text-slate-500">{currentView.icon}</span>
              {currentView.label}
              <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <>
                <button type="button" aria-hidden onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default" tabIndex={-1} />
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {VIEW_OPTIONS.map(o => (
                    <button key={o.key} type="button"
                      onClick={() => { setView(o.key); setMenuOpen(false); }}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 ${view === o.key ? 'bg-slate-50' : ''}`}>
                      <span className="mt-0.5 text-slate-500">{o.icon}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                          {o.label}
                          {view === o.key && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                        </span>
                        <span className="block text-xs text-slate-500">{o.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {view === 'billing' && (
            <button type="button" onClick={() => setTick(t => t + 1)}
              className="text-sm text-slate-600 flex items-center gap-1 hover:text-slate-900">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
            </button>
          )}
        </div>
      </div>

      {view === 'advisor' && (
        <div className="space-y-6">
          <CreditAdvisorDashboard orgId={selectedCompanyId} />
          <div>
            <h2 className="text-xl font-bold text-slate-900">Consumption Optimization</h2>
            <p className="mt-1 text-sm text-slate-500">
              Where credits go, why, and how to extend your runway — deterministic, read-only.
            </p>
            <div className="mt-4">
              <OptimizationPanel orgId={selectedCompanyId} />
            </div>
          </div>
        </div>
      )}

      {view === 'buy' && (
        <div className="max-w-3xl">
          <p className="mb-4 text-sm text-slate-500">
            Add credits for heavier periods. Top-up credits are consumed after monthly plan credits and never expire.
          </p>
          <TopUpPanel orgId={selectedCompanyId} />
        </div>
      )}

      {view === 'billing' && (<>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 mb-6 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />{error}
        </div>
      )}

      <Card title="Wallet" icon={<Coins className="h-5 w-5 text-emerald-600" />}>
        {loading && !w && <div className="text-slate-500 text-sm">Loading…</div>}
        {w && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Available" value={fmt(w.totalAvailable)} hint={usd(w.estimatedUsdValue)} />
            <Metric label="Free" value={fmt(w.freeBalance)} hint={`reserved ${w.reservedFree}`} />
            <Metric label="Paid (purchased)" value={fmt(w.paidBalance)} hint={`reserved ${w.reservedPaid}`} />
            <Metric label="Promotional" value={fmt(w.incentiveBalance)} hint={`reserved ${w.reservedIncentive}`} />
            <Metric label="Lifetime purchased" value={fmt(w.lifetimePurchased)} />
            <Metric label="Lifetime consumed" value={fmt(w.lifetimeConsumed)} />
            <Metric
              label="Reserved (in-flight)"
              value={fmt(summary?.reservations.totalReserved ?? 0)}
              hint={
                <span className="text-amber-700">
                  {summary?.reservations.openHolds ?? 0} provisional hold(s) · settles on completion
                </span>
              }
            />
            <Metric label="Last activity" value={dt(w.lastTransactionAt)} />
          </div>
        )}
        {w && (summary?.reservations.totalReserved ?? 0) > 0 && (
          <p className="mt-3 text-xs text-amber-700">
            Reserved credits are <span className="font-medium">provisional</span> — held when an
            activity starts and not yet a firm charge. The final amount settles against actual usage
            and may rise (e.g. when an asset/image is added) before it is confirmed.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Forecast" icon={<TrendingDown className="h-5 w-5 text-amber-600" />}>
          {summary?.forecast ? (
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Daily burn" value={`${fmt(Math.round(summary.forecast.dailyBurnRate))} cr`} hint={summary.forecast.isAccelerating ? 'accelerating' : 'stable'} />
              <Metric label="Days remaining (period)" value={String(summary.forecast.daysRemaining)} />
              <Metric label="Projected month-end credits" value={fmt(summary.forecast.projectedCredits)} />
              <Metric label="Projected invoice" value={usd(summary.invoiceProjection?.projectedTotalUsd, summary.invoiceProjection?.currency)} />
            </div>
          ) : <div className="text-sm text-slate-500">No usage data yet.</div>}
        </Card>

        <Card title="Plan &amp; Contract" icon={<FileText className="h-5 w-5 text-indigo-600" />}>
          <div className="grid grid-cols-2 gap-4">
            <Metric label="Contract" value={summary?.contract?.contractNumber ?? '—'} hint={summary?.contract?.paymentTerms ?? ''} />
            <Metric label="Allotment" value={fmt(summary?.contract?.allotment ?? null)} />
            <Metric label="Contract ends" value={summary?.contract?.endDate ?? '—'} />
            <Metric
              label="Subscription"
              value={summary?.subscriptions?.[0]?.status ?? 'none'}
              hint={summary?.subscriptions?.[0] ? `renews in ${summary.subscriptions[0].daysUntilRenewal}d` : ''}
            />
          </div>
        </Card>
      </div>

      <Card
        title="Top Consuming Modules"
        icon={<Coins className="h-5 w-5 text-slate-500" />}
        right={(summary?.topModules?.length ?? 0) > 2
          ? <CollapseToggle expanded={expandModules} onToggle={() => setExpandModules(e => !e)} total={summary?.topModules?.length ?? 0} />
          : undefined}
      >
        {summary?.topModules?.length ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr><th className="py-2 pr-3">Module</th><th className="py-2 pr-3">Credits (period)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(expandModules ? summary.topModules : summary.topModules.slice(0, 2)).map(m => (
                <tr key={m.module}>
                  <td className="py-2 pr-3"><code className="text-xs text-slate-700">{m.module}</code></td>
                  <td className="py-2 pr-3 font-mono text-slate-900">{fmt(m.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-sm text-slate-500">No consumption this period.</div>}
      </Card>

      <Card title="What activities cost" icon={<Coins className="h-5 w-5 text-slate-500" />}>
        <p className="text-xs text-slate-500 mb-3">
          Estimated credits per activity. A band (e.g. <span className="font-medium">80–120</span>)
          means the charge is token-priced: the lower number is reserved up front and the final
          amount settles with actual usage — it <span className="font-medium">may rise</span>. A
          single number is a fixed fee.
        </p>
        {selectedCompanyId && (
          <ActivityCostRange
            companyId={selectedCompanyId}
            actions={COST_REFERENCE_ACTIONS}
            labels={COST_REFERENCE_LABELS}
            variant="list"
          />
        )}
      </Card>

      <Card
        title="Ledger"
        icon={<FileText className="h-5 w-5 text-slate-600" />}
        right={
          <div className="flex items-center gap-3">
            {ledger.length > 2 && (
              <CollapseToggle expanded={expandLedger} onToggle={() => setExpandLedger(e => !e)} total={ledger.length} />
            )}
            <button type="button" onClick={exportUsage}
              className="text-sm px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 flex items-center gap-1">
              <Download className="h-4 w-4" />Export usage CSV
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Phase</th>
                <th className="py-2 pr-3">Δ Credits</th>
                <th className="py-2 pr-3">Balance after</th>
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3">Note</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(expandLedger ? ledger : ledger.slice(0, 2)).map(r => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{dt(r.created_at)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${phasePill(r.execution_phase)}`}>
                      {r.execution_phase}
                    </span>
                    {r.execution_phase === 'hold' && (
                      <span className="ml-1 text-[10px] text-amber-700" title="Provisional reservation — not a firm charge until confirmed.">
                        provisional
                      </span>
                    )}
                  </td>
                  <td className={`py-2 pr-3 font-mono ${r.credits_delta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{r.credits_delta}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{r.balance_after ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-500"><code className="text-xs">{r.reference_type ?? '—'}</code></td>
                  <td className="py-2 pr-3 text-slate-600 max-w-md truncate">{r.note ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">
                      <Lock className="h-3 w-3 mr-1" />immutable
                    </span>
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && !loading && (
                <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-500">No ledger activity.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Recent Billing Events"
        icon={<CheckCircle2 className="h-5 w-5 text-slate-500" />}
        right={(summary?.recentEvents?.length ?? 0) > 2
          ? <CollapseToggle expanded={expandEvents} onToggle={() => setExpandEvents(e => !e)} total={Math.min(summary?.recentEvents?.length ?? 0, 12)} />
          : undefined}
      >
        <ol className="space-y-2">
          {(summary?.recentEvents ?? []).slice(0, expandEvents ? 12 : 2).map(e => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="w-40 shrink-0 text-slate-500 text-xs">{dt(e.created_at)}</span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${phasePill(e.execution_phase)}`}>{e.execution_phase}</span>
              <span className="text-slate-700">{e.credits_delta} cr · {e.reference_type ?? 'n/a'}</span>
            </li>
          ))}
          {(summary?.recentEvents ?? []).length === 0 && <li className="text-sm text-slate-500">No recent events.</li>}
        </ol>
      </Card>
      </>)}
    </div>
  );
}
