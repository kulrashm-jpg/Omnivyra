/**
 * Credits Management Panel — super admin only
 * Displays credit balance, transaction history, and controls to grant/adjust/set-rate.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Coins, Plus, Settings, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { getAuthToken } from '../../utils/getAuthToken';

interface CreditTransaction {
  id: string;
  transaction_type: string;
  credits_delta: number;
  balance_after: number;
  usd_equivalent: number | null;
  reference_type: string | null;
  note: string | null;
  created_at: string;
}

interface CreditSummary {
  organization_id: string;
  balance_credits: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  credit_rate_usd?: number;
  balance_usd_equivalent?: number;
  recent_transactions: CreditTransaction[];
}

interface Props {
  companyId: string;
  isSuperAdmin: boolean;
}

type ActionType = 'grant' | 'adjust' | 'set_rate';

export default function CreditsManagementPanel({ companyId, isSuperAdmin }: Props) {
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [formCredits, setFormCredits] = useState('');
  const [formUsd, setFormUsd] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formRate, setFormRate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
      const resp = await fetch(`/api/admin/credits?companyId=${encodeURIComponent(companyId)}`, {
        credentials: 'include',
        headers: authHeader,
      });
      if (!resp.ok) throw new Error((await resp.json()).error ?? 'Failed');
      const json = await resp.json();
      setSummary(json.credits);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const submitAction = async () => {
    if (!activeAction) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const body: Record<string, unknown> = { action: activeAction, companyId };
    if (activeAction === 'grant') {
      body.credits = parseFloat(formCredits);
      if (formUsd) body.usdEquivalent = parseFloat(formUsd);
      if (formNote) body.note = formNote;
    } else if (activeAction === 'adjust') {
      body.credits = parseFloat(formCredits);
      body.note = formNote;
    } else if (activeAction === 'set_rate') {
      body.creditRateUsd = parseFloat(formRate);
    }

    try {
      const token = await getAuthToken();
      const resp = await fetch('/api/admin/credits', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? 'Failed');
      setSuccess(`Action "${activeAction}" completed successfully.`);
      setActiveAction(null);
      setFormCredits('');
      setFormUsd('');
      setFormNote('');
      setFormRate('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading credits…
    </div>
  );

  const fmtCredits = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtUsd = (n: number | null | undefined) => n == null ? '—' : `$${n.toFixed(4)}`;
  const txTypeColor = (t: string) =>
    t === 'purchase' ? 'text-emerald-400' :
    t === 'adjustment' && 0 < 0 ? 'text-red-400' :
    t === 'deduction' ? 'text-red-400' : 'text-blue-400';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-yellow-400" />
          <h2 className="text-lg font-semibold text-white">Credits</h2>
        </div>
        <button onClick={load} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-emerald-400 bg-emerald-900/20 border border-emerald-800 rounded-lg px-4 py-3 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}

      {/* Balance cards */}
      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <BalanceCard label="Current Balance" value={fmtCredits(summary.balance_credits)} unit="credits" accent="yellow" />
          {summary.balance_usd_equivalent != null && (
            <BalanceCard label="Balance (USD equiv.)" value={fmtUsd(summary.balance_usd_equivalent)} accent="emerald" />
          )}
          <BalanceCard label="Lifetime Purchased" value={fmtCredits(summary.lifetime_purchased)} unit="credits" />
          <BalanceCard label="Lifetime Consumed" value={fmtCredits(summary.lifetime_consumed)} unit="credits" />
          {isSuperAdmin && summary.credit_rate_usd != null && (
            <BalanceCard label="Credit Rate" value={`${fmtUsd(summary.credit_rate_usd)} / credit`} accent="violet" />
          )}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400 text-sm">
          No credit account yet for this organization.
        </div>
      )}

      {/* Super admin actions */}
      {isSuperAdmin && (
        <div className="bg-gray-800/60 rounded-lg p-4 space-y-4">
          <p className="text-sm font-medium text-gray-300">Credit Management</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={<Plus className="w-4 h-4" />} label="Grant Credits" active={activeAction === 'grant'} onClick={() => setActiveAction(activeAction === 'grant' ? null : 'grant')} color="emerald" />
            <ActionButton icon={<Settings className="w-4 h-4" />} label="Adjust Credits" active={activeAction === 'adjust'} onClick={() => setActiveAction(activeAction === 'adjust' ? null : 'adjust')} color="blue" />
            <ActionButton icon={<Settings className="w-4 h-4" />} label="Set Credit Rate" active={activeAction === 'set_rate'} onClick={() => setActiveAction(activeAction === 'set_rate' ? null : 'set_rate')} color="violet" />
          </div>

          {activeAction === 'grant' && (
            <ActionForm onSubmit={submitAction} onCancel={() => setActiveAction(null)} submitting={submitting} submitLabel="Grant Credits">
              <FormField label="Credits to Grant" type="number" min="0.01" step="0.01" value={formCredits} onChange={setFormCredits} placeholder="e.g. 1000" />
              <FormField label="USD Equivalent (optional)" type="number" min="0" step="0.01" value={formUsd} onChange={setFormUsd} placeholder="e.g. 10.00" />
              <FormField label="Note (optional)" value={formNote} onChange={setFormNote} placeholder="e.g. Onboarding grant" />
            </ActionForm>
          )}

          {activeAction === 'adjust' && (
            <ActionForm onSubmit={submitAction} onCancel={() => setActiveAction(null)} submitting={submitting} submitLabel="Apply Adjustment">
              <FormField label="Credits (+ to add, - to deduct)" type="number" step="0.01" value={formCredits} onChange={setFormCredits} placeholder="e.g. -50 or 200" />
              <FormField label="Reason (required)" value={formNote} onChange={setFormNote} placeholder="e.g. Correction for failed job" />
            </ActionForm>
          )}

          {activeAction === 'set_rate' && (
            <ActionForm onSubmit={submitAction} onCancel={() => setActiveAction(null)} submitting={submitting} submitLabel="Set Rate">
              <FormField label="USD per 1 Credit" type="number" min="0" step="0.000001" value={formRate} onChange={setFormRate} placeholder="e.g. 0.01" />
            </ActionForm>
          )}
        </div>
      )}

      {/* Transaction history */}
      {summary && summary.recent_transactions.length > 0 && (
        <div className="bg-gray-800/60 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-200">Recent Transactions</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right">Delta</th>
                  <th className="px-4 py-2 font-medium text-right">Balance After</th>
                  <th className="px-4 py-2 font-medium text-right">USD</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent_transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">{new Date(tx.created_at).toLocaleString()}</td>
                    <td className={`px-4 py-2 font-medium text-xs ${txTypeColor(tx.transaction_type)}`}>{tx.transaction_type}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${tx.credits_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.credits_delta >= 0 ? '+' : ''}{fmtCredits(tx.credits_delta)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-300 font-mono text-xs">{fmtCredits(tx.balance_after)}</td>
                    <td className="px-4 py-2 text-right text-gray-400 text-xs">{fmtUsd(tx.usd_equivalent)}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs max-w-xs truncate">{tx.note ?? tx.reference_type ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceCard({ label, value, unit, accent = 'gray' }: { label: string; value: string; unit?: string; accent?: string }) {
  const accentClass = accent === 'yellow' ? 'text-yellow-400' : accent === 'emerald' ? 'text-emerald-400' : accent === 'violet' ? 'text-violet-400' : 'text-white';
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${accentClass}`}>{value} {unit && <span className="text-xs font-normal text-gray-500">{unit}</span>}</p>
    </div>
  );
}

function ActionButton({ icon, label, active, onClick, color }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; color: string }) {
  const base = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border';
  const colorMap: Record<string, string> = {
    emerald: active ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-emerald-500 hover:text-emerald-400',
    blue: active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-blue-500 hover:text-blue-400',
    violet: active ? 'bg-violet-600 border-violet-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-violet-500 hover:text-violet-400',
  };
  return (
    <button onClick={onClick} className={`${base} ${colorMap[color] ?? colorMap.blue}`}>
      {icon} {label}
    </button>
  );
}

function ActionForm({ children, onSubmit, onCancel, submitting, submitLabel }: {
  children: React.ReactNode; onSubmit: () => void; onCancel: () => void; submitting: boolean; submitLabel: string;
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4 space-y-3">
      {children}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder, min, step }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; min?: string; step?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        step={step}
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
      />
    </div>
  );
}
