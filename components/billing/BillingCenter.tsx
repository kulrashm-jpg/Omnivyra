'use client';

/**
 * Billing & Subscription Center (customer-facing, read-only + buy hand-off).
 * Sections: Current Plan · Credit Summary · Monthly Credits · Top-Up Credits ·
 * Buy More Credits · Upgrade Plan · Payment Methods · Billing History · Invoices.
 * No subscriptions / gateway / checkout implemented here — buy/upgrade hand off
 * to the existing top-up flow and the pricing page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { getPlan, TOPUPS, formatPrice } from '@/lib/billing/commercialPlans';

interface Bucket { key: 'plan' | 'bonus' | 'topup'; label: string; available: number; neverExpires: boolean; note: string }
interface Allocation {
  planKey: string | null;
  monthlyCredits: number | null;
  lastAllocationDate: string | null;
  nextAllocationDate: string | null;
  creditsGrantedThisCycle: number;
}
interface Center {
  currentPlan: { key: string | null };
  credits: { buckets: Bucket[]; totalAvailable: number; summary: string } | null;
  allocation: Allocation | null;
  billingHistory: Array<{ id: string; credits: number; amount_paid: number | null; currency: string | null; status: string | null; provider: string | null; created_at: string }>;
  invoices: Array<{ id: string; invoice_number: string; period_start: string; period_end: string; total_amount: number | null; currency: string | null; status: string | null; issued_at: string | null; paid_at: string | null }>;
  paymentMethods: Array<{ id: string; brand: string | null; last4: string | null; is_default: boolean }>;
}

const CARD = 'rounded-2xl border border-[#C9DDF3] bg-white p-6 shadow-omnivyra';
const money = (a: number | null, c: string | null) => (a == null ? '—' : `${c === 'INR' ? '₹' : c === 'USD' ? '$' : (c ?? '') + ' '}${Number(a).toLocaleString()}`);

export default function BillingCenter({ orgId }: { orgId: string | null | undefined }) {
  const [data, setData] = useState<Center | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/billing/center?org_id=${orgId}`);
      if (res.ok) setData(await res.json());
    } catch { /* */ } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const plan = getPlan((data?.currentPlan.key ?? 'free') as any);
  const planName = plan?.name ?? (data?.currentPlan.key ? data.currentPlan.key : 'Free');
  const buckets = data?.credits?.buckets ?? [];
  const planBucket = buckets.find((b) => b.key === 'plan');
  const topupBucket = buckets.find((b) => b.key === 'topup');
  const total = data?.credits?.totalAvailable ?? 0;

  if (loading) return <p className="text-sm text-[#5D6F83]">Loading billing…</p>;

  return (
    <div className="space-y-6">
      {/* 1 + 6 — Current Plan & Upgrade */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-label="Current plan">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#5D6F83]">Current plan</h2>
          <p className="mt-2 text-2xl font-black text-[#071D3A]">{planName}</p>
          {plan && (
            <p className="mt-1 text-sm text-[#5D6F83]">{plan.creditsLabel} · {plan.usersLabel}</p>
          )}
          {data?.allocation?.monthlyCredits != null && (
            <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-[#D8E3F0] bg-[#F7FBFF] p-3 text-center">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[#5D6F83]">This cycle</dt>
                <dd className="text-sm font-black text-[#071D3A]">{data.allocation.creditsGrantedThisCycle.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[#5D6F83]">Last</dt>
                <dd className="text-sm font-black text-[#071D3A]">{data.allocation.lastAllocationDate ? new Date(data.allocation.lastAllocationDate).toLocaleDateString() : '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[#5D6F83]">Next</dt>
                <dd className="text-sm font-black text-[#071D3A]">{data.allocation.nextAllocationDate ? new Date(data.allocation.nextAllocationDate).toLocaleDateString() : '—'}</dd>
              </div>
            </dl>
          )}
          <Link href="/pricing" className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0A66C2] px-5 py-2.5 text-sm font-black text-white shadow-omnivyra transition hover:bg-[#0857A8]">
            Upgrade plan
          </Link>
        </section>

        {/* 2 — Credit Summary */}
        <section className={CARD} aria-label="Credit summary">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#5D6F83]">Available credits</h2>
          <p className="mt-2 text-4xl font-black text-[#0A66C2]">{total.toLocaleString()}</p>
          <p className="mt-1 text-xs text-[#5D6F83]">{data?.credits?.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {buckets.map((b) => (
              <span key={b.key} className="rounded-full border border-[#D8E3F0] bg-[#F7FBFF] px-3 py-1 text-xs font-semibold text-[#071D3A]">
                {b.label}: {b.available.toLocaleString()}
              </span>
            ))}
          </div>
        </section>
      </div>

      {/* 3 + 4 — Monthly vs Top-Up pools (separate balances) */}
      <div className="grid gap-6 sm:grid-cols-2">
        <section className={CARD} aria-label="Monthly credits">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#5D6F83]">Monthly credits</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Spent 1st · resets</span>
          </div>
          <p className="mt-2 text-3xl font-black text-[#0B5ED7]">{(planBucket?.available ?? 0).toLocaleString()}</p>
          <p className="mt-1 text-xs text-[#5D6F83]">{planBucket?.note ?? 'Included with your plan. Spent first; refresh each billing cycle.'}</p>
        </section>
        <section className={CARD} aria-label="Top-up credits">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#5D6F83]">Top-up credits</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Never expires</span>
          </div>
          <p className="mt-2 text-3xl font-black text-[#0B5ED7]">{(topupBucket?.available ?? 0).toLocaleString()}</p>
          <p className="mt-1 text-xs text-[#5D6F83]">{topupBucket?.note ?? 'Purchased credits. Spent only after monthly credits; never expire.'}</p>
        </section>
      </div>

      {/* 5 — Buy More Credits (hand-off to the top-up checkout) */}
      <section className={CARD} aria-label="Buy more credits">
        <h2 className="text-lg font-black text-[#071D3A]">Buy more credits</h2>
        <p className="mt-1 text-sm text-[#5D6F83]">Top-up credits are added to your balance and never expire.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {TOPUPS.map((t) => (
            <div key={t.id} className="flex flex-col rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF] px-5 py-5 text-center">
              <p className="text-2xl font-black text-[#0A66C2]">{t.credits.toLocaleString()}</p>
              <p className="text-xs font-semibold text-[#5D6F83]">{t.label}</p>
              <p className="mt-1 text-base font-black text-[#071D3A]">{formatPrice(t.priceUsd, 'USD')}</p>
              <Link href={`/command-center/topup?pack=${t.id}`} className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-lg bg-[#0A66C2] px-4 py-2 text-sm font-black text-white transition hover:bg-[#0857A8]">
                Buy
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* 7 — Payment Methods */}
      <section className={CARD} aria-label="Payment methods">
        <h2 className="text-lg font-black text-[#071D3A]">Payment methods</h2>
        {data && data.paymentMethods.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {data.paymentMethods.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-sm text-[#071D3A]">
                <span className="font-semibold">{m.brand ?? 'Card'}</span> •••• {m.last4 ?? '----'}
                {m.is_default && <span className="rounded-full bg-[#EEF6FF] px-2 py-0.5 text-[10px] font-bold text-[#0A66C2]">Default</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[#5D6F83]">No saved payment methods. Your method is entered securely at checkout.</p>
        )}
      </section>

      {/* 8 — Billing History */}
      <section className={CARD} aria-label="Billing history">
        <h2 className="text-lg font-black text-[#071D3A]">Billing history</h2>
        {data && data.billingHistory.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-[#5D6F83]">
                  <th className="py-2">Date</th><th className="py-2 text-right">Credits</th><th className="py-2 text-right">Amount</th><th className="py-2">Provider</th><th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.billingHistory.map((h) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(h.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-right tabular-nums">{h.credits.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{money(h.amount_paid, h.currency)}</td>
                    <td className="py-2 capitalize">{h.provider ?? '—'}</td>
                    <td className="py-2 capitalize">{h.status === 'completed' ? 'paid' : (h.status ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#5D6F83]">No purchases yet.</p>
        )}
      </section>

      {/* 9 — Invoice History */}
      <section className={CARD} aria-label="Invoice history">
        <h2 className="text-lg font-black text-[#071D3A]">Invoices</h2>
        {data && data.invoices.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-[#5D6F83]">
                  <th className="py-2">Invoice</th><th className="py-2">Period</th><th className="py-2 text-right">Total</th><th className="py-2">Status</th><th className="py-2">Issued</th><th className="py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{inv.invoice_number}</td>
                    <td className="py-2 text-xs text-[#5D6F83]">{inv.period_start} → {inv.period_end}</td>
                    <td className="py-2 text-right tabular-nums">{money(inv.total_amount, inv.currency)}</td>
                    <td className="py-2 capitalize">{inv.status ?? '—'}</td>
                    <td className="py-2 text-xs text-[#5D6F83]">{inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : '—'}</td>
                    <td className="py-2">
                      <a href={`/api/billing/invoices/${inv.id}/pdf?org_id=${orgId}`} target="_blank" rel="noreferrer" className="font-semibold text-[#0A66C2] hover:underline">Download</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#5D6F83]">No invoices yet.</p>
        )}
      </section>
    </div>
  );
}
