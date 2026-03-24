/**
 * Plans & Pricing Panel — super admin only
 * Manage tier definitions (name, credits/month, price) and view credit cost reference table.
 * Uses /api/super-admin/plans/list and /api/super-admin/plans/create.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Pencil, X, Save } from 'lucide-react';
import { getAuthToken } from '../../utils/getAuthToken';

interface Plan {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  monthly_price: number | null;
  currency: string;
  is_active: boolean;
}

interface PlanWithLimits extends Plan {
  monthly_credits: number | null;
}

// Default tier seeds — shown if no plans exist in DB yet
const TIER_SEEDS = [
  { plan_key: 'starter', name: 'Starter', description: 'For individuals & creators', monthly_price: 29, monthly_credits: 1000 },
  { plan_key: 'growth',  name: 'Growth',  description: 'For founders & small teams', monthly_price: 79, monthly_credits: 5000 },
  { plan_key: 'scale',   name: 'Scale',   description: 'For marketing teams',        monthly_price: 199, monthly_credits: 20000 },
];

// Credit cost reference table (informational — reflects platform pricing page)
const CREDIT_COSTS = [
  { action: 'Website SEO Audit',             credits: '50',   category: 'Insights' },
  { action: 'Campaign Creation',              credits: '40',   category: 'Planning' },
  { action: 'AI Content Generation',          credits: '5–10', category: 'Content' },
  { action: 'Social Auto-post (per post)',     credits: '2',    category: 'Publishing' },
  { action: 'Engagement AI Reply',            credits: '1',    category: 'Engagement' },
  { action: 'Market Insight Scan (daily)',    credits: '20',   category: 'Insights' },
  { action: 'Trend Analysis',                 credits: '25',   category: 'Insights' },
  { action: 'Voice Interaction (per minute)', credits: '10',   category: 'AI' },
  { action: 'Lead Signal Detection',          credits: '15',   category: 'Growth' },
];

export default function PlansPricingPanel() {
  const [plans, setPlans] = useState<PlanWithLimits[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; monthly_price: string; monthly_credits: string;
  }>({ name: '', description: '', monthly_price: '', monthly_credits: '' });

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/super-admin/plans/list', { credentials: 'include', headers: authHeader });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load plans');
      const json = await res.json();
      const fetched: PlanWithLimits[] = (json.plans ?? []).map((p: Plan) => ({
        ...p,
        monthly_credits: json.limitsByPlan?.[p.id]?.monthly_credits ?? null,
      }));
      // Merge seeds for any missing plan_keys
      const presentKeys = new Set(fetched.map((p) => p.plan_key));
      const merged = [...fetched];
      for (const seed of TIER_SEEDS) {
        if (!presentKeys.has(seed.plan_key)) {
          merged.push({ id: '', ...seed, currency: 'USD', is_active: false });
        }
      }
      merged.sort((a, b) => TIER_SEEDS.findIndex(s => s.plan_key === a.plan_key) - TIER_SEEDS.findIndex(s => s.plan_key === b.plan_key));
      setPlans(merged);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  function startEdit(plan: PlanWithLimits) {
    setEditingKey(plan.plan_key);
    setEditForm({
      name: plan.name,
      description: plan.description ?? '',
      monthly_price: plan.monthly_price?.toString() ?? '',
      monthly_credits: plan.monthly_credits?.toString() ?? '',
    });
    setError(null);
    setSuccess(null);
  }

  async function savePlan(plan: PlanWithLimits) {
    setSaving(plan.plan_key);
    setError(null);
    setSuccess(null);
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/super-admin/plans/create', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          plan_key: plan.plan_key,
          name: editForm.name.trim() || plan.name,
          description: editForm.description.trim() || null,
          monthly_price: editForm.monthly_price ? parseFloat(editForm.monthly_price) : null,
          limits: {
            monthly_credits: editForm.monthly_credits ? parseFloat(editForm.monthly_credits) : null,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setSuccess(`"${editForm.name}" saved successfully.`);
      setEditingKey(null);
      await loadPlans();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-gray-400 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading plans…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Plans &amp; Pricing</h2>
          <p className="text-xs text-gray-400 mt-0.5">Define credit tiers and monthly prices shown on the public pricing page.</p>
        </div>
        <button onClick={loadPlans} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
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

      {/* Tier cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isEditing = editingKey === plan.plan_key;
          const isSaving = saving === plan.plan_key;
          return (
            <div key={plan.plan_key} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{plan.plan_key}</span>
                  {!isEditing && <p className="text-base font-bold text-white mt-0.5">{plan.name}</p>}
                </div>
                {!isEditing ? (
                  <button
                    onClick={() => startEdit(plan)}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                    title="Edit plan"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setEditingKey(null)}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                    title="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <Field label="Name" value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
                  <Field label="Description" value={editForm.description} onChange={(v) => setEditForm((f) => ({ ...f, description: v }))} />
                  <Field label="Monthly Price (USD)" type="number" value={editForm.monthly_price} onChange={(v) => setEditForm((f) => ({ ...f, monthly_price: v }))} placeholder="e.g. 79" />
                  <Field label="Credits / Month" type="number" value={editForm.monthly_credits} onChange={(v) => setEditForm((f) => ({ ...f, monthly_credits: v }))} placeholder="e.g. 5000" />
                  <button
                    onClick={() => savePlan(plan)}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 mt-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSaving ? 'Saving…' : 'Save Plan'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {plan.description && (
                    <p className="text-xs text-gray-400">{plan.description}</p>
                  )}
                  <div className="flex items-end gap-3 mt-3">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Credits / mo</p>
                      <p className="text-2xl font-bold text-white">
                        {plan.monthly_credits != null ? plan.monthly_credits.toLocaleString() : <span className="text-gray-500 text-base">—</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Price</p>
                      <p className="text-xl font-semibold text-emerald-400">
                        {plan.monthly_price != null ? `$${plan.monthly_price}` : <span className="text-gray-500">—</span>}
                        <span className="text-xs text-gray-500 font-normal">/mo</span>
                      </p>
                    </div>
                  </div>
                  <div className={`mt-2 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${plan.is_active ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${plan.is_active ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                    {plan.is_active ? 'Active in DB' : 'Not yet saved'}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Credit cost reference table */}
      <div>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">Credit Cost Reference</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            These costs are displayed on the public pricing page. They reflect platform-level LLM and API costs translated into credits at the current credit rate.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Category</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Credits</th>
              </tr>
            </thead>
            <tbody>
              {CREDIT_COSTS.map((row, i) => (
                <tr key={row.action} className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-850'}`}>
                  <td className="px-4 py-2.5 text-gray-200">{row.action}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs bg-violet-900/40 text-violet-300 px-2 py-0.5 rounded-full">{row.category}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-violet-400">{row.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          To update credit costs, adjust the <code className="text-violet-400">credit_rate_usd</code> per organisation in the Credits tab, or contact the engineering team to recalibrate action weights.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
      />
    </div>
  );
}
