'use client';

/**
 * Super-Admin — Pricing Management.
 * Manage FX rates, plan founder/regular pricing, and market overrides.
 * Charge currency is INR only; USD/EUR are display. Writes config, not charges.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { apiFetch } from '@/lib/apiFetch';

const CURRENCIES = ['USD', 'INR', 'EUR'] as const;
interface Fx { rates: Record<string, number>; overrides?: Record<string, Record<string, number>>; updatedAt?: string }
interface Plan { plan_key: string; founder_usd: number; regular_usd: number | null; active: boolean }

async function post(body: unknown) {
  const res = await apiFetch('/api/super-admin/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

export default function SuperAdminPricingPage() {
  const [fx, setFx] = useState<Fx | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [ov, setOv] = useState({ sku: '', currency: 'INR', amount: '' });

  const load = useCallback(async () => {
    const res = await apiFetch('/api/super-admin/pricing');
    if (res.ok) { const d = await res.json(); setFx(d.fx); setPlans(d.planPricing ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveFx = async (currency: string, rate: number) => {
    const r = await post({ action: 'fx', currency, rate }); setMsg(r.ok ? `Saved ${currency} rate` : r.error); if (r.ok) { setFx(r.fx); }
  };
  const savePlan = async (p: Plan) => {
    const r = await post({ action: 'plan', plan_key: p.plan_key, founder_usd: p.founder_usd, regular_usd: p.regular_usd, active: p.active });
    setMsg(r.ok ? `Saved ${p.plan_key}` : r.error); if (r.ok) setPlans(r.planPricing);
  };
  const saveOverride = async () => {
    const r = await post({ action: 'override', sku: ov.sku, currency: ov.currency, amount: ov.amount === '' ? null : Number(ov.amount) });
    setMsg(r.ok ? `Override saved for ${ov.sku}` : r.error); if (r.ok) { setFx(r.fx); setOv({ sku: '', currency: 'INR', amount: '' }); }
  };

  return (
    <>
      <Head><title>Pricing Management | Super Admin</title></Head>
      <main className="min-h-screen bg-[#F5F9FF] px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <header>
            <h1 className="text-2xl font-black text-[#071D3A]">Pricing Management</h1>
            <p className="mt-1 text-sm text-[#5D6F83]">Canonical USD catalog · display USD/INR/EUR · charge INR only.</p>
            {msg && <p className="mt-2 rounded bg-[#EEF6FF] px-3 py-1 text-xs font-semibold text-[#0A66C2]">{msg}</p>}
          </header>

          {/* FX rates */}
          <section className="rounded-2xl border border-[#C9DDF3] bg-white p-5">
            <h2 className="text-sm font-black text-[#071D3A]">FX rates (per 1 USD)</h2>
            {fx?.updatedAt && <p className="text-[11px] text-[#5D6F83]">Updated {new Date(fx.updatedAt).toLocaleString()}</p>}
            <div className="mt-3 space-y-2">
              {CURRENCIES.map((c) => (
                <div key={c} className="flex items-center gap-3">
                  <span className="w-12 text-sm font-bold">{c}</span>
                  <input
                    type="number" step="0.0001" defaultValue={fx?.rates?.[c] ?? ''}
                    onBlur={(e) => saveFx(c, Number(e.target.value))}
                    disabled={c === 'USD'}
                    className="w-40 rounded-lg border border-[#D8E3F0] px-3 py-1.5 text-sm disabled:bg-slate-100"
                  />
                  {c === 'USD' && <span className="text-xs text-[#5D6F83]">base</span>}
                </div>
              ))}
            </div>
          </section>

          {/* Plan pricing */}
          <section className="rounded-2xl border border-[#C9DDF3] bg-white p-5">
            <h2 className="text-sm font-black text-[#071D3A]">Plan pricing (canonical USD)</h2>
            <div className="mt-3 space-y-3">
              {plans.map((p, i) => (
                <div key={p.plan_key} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 text-sm font-bold capitalize">{p.plan_key}</span>
                  <label className="text-xs text-[#5D6F83]">Founder $</label>
                  <input type="number" defaultValue={p.founder_usd}
                    onChange={(e) => { const n = [...plans]; n[i] = { ...p, founder_usd: Number(e.target.value) }; setPlans(n); }}
                    className="w-24 rounded-lg border border-[#D8E3F0] px-2 py-1 text-sm" />
                  <label className="text-xs text-[#5D6F83]">Regular $</label>
                  <input type="number" defaultValue={p.regular_usd ?? ''}
                    onChange={(e) => { const n = [...plans]; n[i] = { ...p, regular_usd: e.target.value === '' ? null : Number(e.target.value) }; setPlans(n); }}
                    className="w-24 rounded-lg border border-[#D8E3F0] px-2 py-1 text-sm" />
                  <button onClick={() => savePlan(plans[i])} className="rounded-lg bg-[#0A66C2] px-3 py-1 text-xs font-bold text-white">Save</button>
                </div>
              ))}
              {plans.length === 0 && <p className="text-xs text-[#5D6F83]">No plan pricing rows (apply migration 20260723 to seed).</p>}
            </div>
          </section>

          {/* Market overrides */}
          <section className="rounded-2xl border border-[#C9DDF3] bg-white p-5">
            <h2 className="text-sm font-black text-[#071D3A]">Market override (explicit retail price)</h2>
            <p className="text-[11px] text-[#5D6F83]">Per (sku, currency). Wins over the FX-derived value. Leave amount blank to clear.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input placeholder="sku (e.g. topup_250)" value={ov.sku} onChange={(e) => setOv({ ...ov, sku: e.target.value })} className="w-44 rounded-lg border border-[#D8E3F0] px-2 py-1 text-sm" />
              <select value={ov.currency} onChange={(e) => setOv({ ...ov, currency: e.target.value })} className="rounded-lg border border-[#D8E3F0] px-2 py-1 text-sm">
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input placeholder="amount" type="number" value={ov.amount} onChange={(e) => setOv({ ...ov, amount: e.target.value })} className="w-28 rounded-lg border border-[#D8E3F0] px-2 py-1 text-sm" />
              <button onClick={saveOverride} className="rounded-lg bg-[#0A66C2] px-3 py-1 text-xs font-bold text-white">Save</button>
            </div>
            {fx?.overrides && Object.keys(fx.overrides).length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-[#071D3A]">
                {Object.entries(fx.overrides).flatMap(([sku, byCur]) =>
                  Object.entries(byCur).map(([cur, amt]) => <li key={`${sku}:${cur}`}>{sku} · {cur} → {amt}</li>),
                )}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
