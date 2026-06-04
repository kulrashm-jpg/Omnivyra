/**
 * Company Credit Experience — Phase 9B (presentation only).
 *
 * Exposes the completed credit economy to company admins. Strictly read-only:
 * composes existing company billing services (summary, ledger) + the Phase 9B
 * read endpoints (activity-economics, warnings). No billing/settlement/admission/
 * accounting mutation; admission warnings are advisory and NEVER block.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Coins, Clock, History, Gauge, Lock, RefreshCw } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import {
  summarizeCompanyCredits,
  groupCreditHistoryByActivity,
  type WalletLike,
  type LedgerRowLike,
  type CompanyCreditSummary,
  type ActivityHistoryGroup,
} from '../../../components/company-credits/creditPresentation';

const ACTIVITIES = [
  'campaign_generation', 'campaign_creation', 'content_generation', 'content_basic',
  'blog_generation', 'full_strategy', 'deep_analysis', 'trend_analysis',
];
const LABELS: Record<string, string> = {
  campaign_generation: 'BOLT campaign (autonomous)',
  campaign_creation: 'Campaign creation',
  content_generation: 'Master content',
  content_basic: 'Basic content / post',
  blog_generation: 'Blog article',
  full_strategy: 'Full campaign strategy',
  deep_analysis: 'Deep analysis',
  trend_analysis: 'Trend analysis',
};

interface SummaryPayload {
  wallet: (WalletLike & { totalAvailable: number }) | null;
  reservations: { openHolds: number; totalReserved: number };
}
interface ActivityEconomicsRow {
  activity: string; activityClass: string; minimumCredits: number; maximumCredits: number;
  estimatedStartingCost: number; potentialFinalCost: number; reservationCredits: number;
}
interface WarningRow { activity: string; wouldBlock: boolean; shortfall: number; requiredCredits: number; effectiveCredits: number; }
interface WarningsPayload { effectiveCredits: number; lowCredit: boolean; anyWouldBlock: boolean; warnings: WarningRow[]; }

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
}
function dt(s: string | null | undefined): string { return s ? new Date(s).toLocaleString() : '—'; }

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-4">{icon}{title}</h3>
      {children}
    </div>
  );
}
function Metric({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'amber' | 'default' }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
      {hint != null && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default function CompanyCreditExperience() {
  const { selectedCompanyId, selectedCompanyName, userRole } = useCompanyContext();
  const allowed = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'FINANCE_AUDITOR'].includes(String(userRole));

  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [credit, setCredit] = useState<CompanyCreditSummary | null>(null);
  const [history, setHistory] = useState<ActivityHistoryGroup[]>([]);
  const [economics, setEconomics] = useState<ActivityEconomicsRow[]>([]);
  const [warnings, setWarnings] = useState<WarningsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!selectedCompanyId || !allowed) return;
    setLoading(true); setError(null);
    try {
      const cid = encodeURIComponent(selectedCompanyId);
      const acts = encodeURIComponent(ACTIVITIES.join(','));
      const [sumRes, ledRes, ecoRes, warnRes] = await Promise.all([
        fetchWithAuth(`/api/company/billing/summary?companyId=${cid}`),
        fetchWithAuth(`/api/company/billing/ledger?companyId=${cid}&limit=200`),
        fetchWithAuth(`/api/company/economics/activity-economics?companyId=${cid}&actions=${acts}`),
        fetchWithAuth(`/api/company/economics/warnings?companyId=${cid}&actions=${acts}`),
      ]);
      if (sumRes.status === 403) { setError('You do not have credit access for this organization.'); return; }
      if (sumRes.ok) {
        const j = (await sumRes.json()) as SummaryPayload;
        setSummary(j);
        if (j.wallet) setCredit(summarizeCompanyCredits(j.wallet));
      }
      if (ledRes.ok) {
        const j = await ledRes.json();
        setHistory(groupCreditHistoryByActivity((Array.isArray(j?.rows) ? j.rows : []) as LedgerRowLike[]));
      }
      if (ecoRes.ok) { const j = await ecoRes.json(); setEconomics(Array.isArray(j?.economics) ? j.economics : []); }
      if (warnRes.ok) setWarnings(await warnRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, allowed, tick]);

  useEffect(() => { void load(); }, [load]);

  if (!allowed) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
          <Lock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-medium text-slate-900">Credit access required</h2>
          <p className="text-sm text-slate-500 mt-1">Contact your organization administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Credits</h1>
          <p className="text-sm text-slate-500">{selectedCompanyName || selectedCompanyId}</p>
        </div>
        <button type="button" onClick={() => setTick((t) => t + 1)} className="text-sm text-slate-600 flex items-center gap-1 hover:text-slate-900">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 mb-6 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />{error}
        </div>
      )}

      {/* TASK 5 — Credit warnings (advisory; never blocks) */}
      {warnings && (warnings.lowCredit || warnings.anyWouldBlock) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md p-4 mb-6">
          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Heads up</div>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            {warnings.lowCredit && <li>Low credits — {fmt(warnings.effectiveCredits)} usable.</li>}
            {warnings.warnings.filter((w) => w.wouldBlock).map((w) => (
              <li key={w.activity}>
                {LABELS[w.activity] ?? w.activity}: needs up to {fmt(w.requiredCredits)} — short by {fmt(w.shortfall)}.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">These are estimates to help you plan. Nothing is blocked.</p>
        </div>
      )}

      {/* TASK 1 — Credit summary */}
      <Card title="Credit Summary" icon={<Coins className="h-5 w-5 text-emerald-600" />}>
        {credit ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Metric label="Available Credits" value={fmt(credit.availableCredits)} />
            <Metric label="Reserved Credits" value={fmt(credit.reservedCredits)} hint="provisional · in-flight" tone="amber" />
            <Metric label="Effective Credits" value={fmt(credit.effectiveCredits)} hint="available to start new work" />
            <Metric label="Consumed Credits" value={fmt(credit.consumedCredits)} hint="settled to date" />
            <Metric label="Total Purchased" value={fmt(credit.totalPurchasedCredits)} />
            <Metric label="Total Bonus" value={fmt(credit.totalBonusCredits)} hint="promotional" />
          </div>
        ) : <div className="text-sm text-slate-500">{loading ? 'Loading…' : 'No credit data yet.'}</div>}
      </Card>

      {/* TASK 2 — Provisional vs settled */}
      <Card title="In-flight Activities" icon={<Clock className="h-5 w-5 text-amber-600" />}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Metric label="Provisional (Reserved)" value={fmt(summary?.reservations.totalReserved ?? 0)} hint={`${summary?.reservations.openHolds ?? 0} in progress`} tone="amber" />
          <Metric label="Settled (Consumed)" value={fmt(credit?.consumedCredits ?? 0)} />
        </div>
        <p className="mt-3 text-xs text-amber-700">
          Reserved credits are <span className="font-medium">provisional</span> — held while an activity is in
          progress. The final amount is <span className="font-medium">settled</span> when it completes and may be
          lower than reserved (unused credits return) or higher with added work such as images.
        </p>
      </Card>

      {/* TASK 3 — Activity cost ranges */}
      <Card title="What activities cost" icon={<Gauge className="h-5 w-5 text-indigo-600" />}>
        <p className="text-xs text-slate-500 mb-3">
          Each activity shows a starting estimate and a potential final cost. You begin at the starting cost; the
          final amount settles with actual usage, up to the maximum.
        </p>
        {economics.length ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Activity</th>
                <th className="py-2 pr-3">Minimum</th>
                <th className="py-2 pr-3">Maximum</th>
                <th className="py-2 pr-3">Estimated Starting</th>
                <th className="py-2 pr-3">Potential Final</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {economics.map((e) => (
                <tr key={e.activity}>
                  <td className="py-2 pr-3 text-slate-700">{LABELS[e.activity] ?? e.activity}</td>
                  <td className="py-2 pr-3 font-mono">{fmt(e.minimumCredits)}</td>
                  <td className="py-2 pr-3 font-mono">{fmt(e.maximumCredits)}</td>
                  <td className="py-2 pr-3 font-mono text-emerald-700">~{fmt(e.estimatedStartingCost)}</td>
                  <td className="py-2 pr-3 font-mono text-amber-700">up to {fmt(e.potentialFinalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-sm text-slate-500">{loading ? 'Loading…' : 'No activity pricing available.'}</div>}
      </Card>

      {/* TASK 4 — Credit history grouped by activity */}
      <Card title="Credit History by Activity" icon={<History className="h-5 w-5 text-slate-500" />}>
        {history.length ? (
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Activity</th>
                <th className="py-2 pr-3">Consumed</th>
                <th className="py-2 pr-3">Reserved</th>
                <th className="py-2 pr-3">Released</th>
                <th className="py-2 pr-3">Settlements</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((g) => (
                <tr key={g.activity}>
                  <td className="py-2 pr-3 text-slate-700"><code className="text-xs">{g.activity}</code></td>
                  <td className="py-2 pr-3 font-mono text-slate-900">{fmt(g.consumed)}</td>
                  <td className="py-2 pr-3 font-mono text-amber-700">{fmt(g.reserved)}</td>
                  <td className="py-2 pr-3 font-mono text-slate-600">{fmt(g.released)}</td>
                  <td className="py-2 pr-3 font-mono text-slate-600">{fmt(g.settlements)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-sm text-slate-500">{loading ? 'Loading…' : 'No credit history yet.'}</div>}
        <p className="mt-3 text-xs text-slate-400">As of {dt(new Date().toISOString())}</p>
      </Card>
    </div>
  );
}
