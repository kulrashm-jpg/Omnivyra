'use client';

/**
 * Top-up purchase panel (staging). Reads the catalog, launches Razorpay
 * Checkout.js (TEST MODE), verifies the payment, and shows purchase history.
 * Reuses /api/billing/topup/{catalog,create-order,verify,history}. No live mode.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { resolvePrice, currencySymbol, CURRENCIES, type Currency } from '@/lib/billing/currency';
import { TOPUPS } from '@/lib/billing/commercialPlans';

const RAZORPAY_JS = 'https://checkout.razorpay.com/v1/checkout.js';
const CASHFREE_JS = 'https://sdk.cashfree.com/js/v3/cashfree.js';

interface Pack { id: string; credits: number; price: number; currency: string; label: string }
interface Purchase {
  id: string; credits: number; amount_paid: number | null; currency: string | null;
  status: string | null; fulfillment_status: string | null; provider_order_id: string | null; created_at: string;
}
type Status = { kind: 'idle' | 'creating' | 'paying' | 'verifying' | 'success' | 'failed' | 'cancelled'; msg?: string };

function loadScript(src: string, ready: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) return resolve(true);
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
const loadRazorpay = () => loadScript(RAZORPAY_JS, () => Boolean((window as any).Razorpay));
async function loadCashfree(): Promise<any | null> {
  const ok = await loadScript(CASHFREE_JS, () => Boolean((window as any).Cashfree));
  if (!ok || !(window as any).Cashfree) return null;
  try { return (window as any).Cashfree({ mode: 'sandbox' }); } catch { return null; }
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

interface Bucket {
  key: 'plan' | 'bonus' | 'topup';
  label: string;
  available: number;
  neverExpires: boolean;
  consumptionRank: number;
  note: string;
}

export default function TopUpPanel({ orgId }: { orgId: string | null | undefined }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [history, setHistory] = useState<Purchase[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [lastPackId, setLastPackId] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [preselectId, setPreselectId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('INR');

  // Display price for a pack in the selected currency (derived from the canonical
  // USD price; falls back to the catalog INR price if no USD anchor is known).
  const priceLabel = (pack: Pack): string => {
    const usd = TOPUPS.find((t) => t.id === pack.id)?.priceUsd;
    if (usd == null) return `₹${pack.price.toLocaleString()}`;
    return `${currencySymbol(currency)}${resolvePrice(usd, currency).toLocaleString()}`;
  };

  const refreshHistory = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await apiFetch(`/api/billing/topup/history?org_id=${orgId}`);
      if (res.ok) setHistory(((await res.json()).purchases ?? []) as Purchase[]);
    } catch { /* best-effort */ }
  }, [orgId]);

  const refreshBreakdown = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await apiFetch(`/api/billing/credit-breakdown?org_id=${orgId}`);
      if (res.ok) setBuckets(((await res.json()).buckets ?? []) as Bucket[]);
    } catch { /* best-effort */ }
  }, [orgId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/billing/topup/catalog');
        if (res.ok) setPacks(((await res.json()).packs ?? []) as Pack[]);
      } catch { /* */ }
    })();
    refreshHistory();
    refreshBreakdown();
    try {
      const params = new URLSearchParams(window.location.search);
      const pid = params.get('pack');
      if (pid) setPreselectId(pid);
      const cur = (params.get('currency') ?? '').toUpperCase();
      if ((CURRENCIES as readonly string[]).includes(cur)) setCurrency(cur as Currency);
    } catch { /* SSR / no window */ }
  }, [refreshHistory, refreshBreakdown]);

  const runVerify = useCallback(async (order: any, orderId: string, paymentId: string, signature: string) => {
    setStatus({ kind: 'verifying' });
    const v = await postJson('/api/billing/checkout/verify', {
      org_id: orgId, purchase_id: order.purchase_id, provider: order.provider,
      order_id: orderId, payment_id: paymentId, signature,
    });
    if (v?.ok) {
      const n = v?.credits_granted;
      setStatus({ kind: 'success', msg: n ? `${Number(n).toLocaleString()} credits added` : 'Credits added' });
      refreshHistory();
      refreshBreakdown(); // top-up (paid) pool grew
    } else {
      setStatus({ kind: 'failed', msg: v?.status ?? v?.error ?? 'Verification failed' });
    }
  }, [orgId, refreshHistory, refreshBreakdown]);

  const buy = useCallback(async (pack: Pack) => {
    if (!orgId) return;
    setLastPackId(pack.id);
    setStatus({ kind: 'creating' });
    try {
      // Order via the Payment Orchestrator (internal routing: Razorpay → Cashfree).
      const order = await postJson('/api/billing/checkout/create-order', { org_id: orgId, package_id: pack.id, currency });
      if (!order?.ok) { setStatus({ kind: 'failed', msg: order?.error ?? 'Could not create order' }); return; }

      setStatus({ kind: 'paying' });
      if (order.provider === 'razorpay') {
        if (!(await loadRazorpay())) { setStatus({ kind: 'failed', msg: 'Could not load Razorpay Checkout' }); return; }
        const rzp = new (window as any).Razorpay({
          key: order.key_id,
          order_id: order.provider_order_id,
          amount: order.amount_subunits,
          currency: order.currency,
          name: 'Omnivyra',
          description: `${pack.credits} credits`,
          handler: (resp: any) => runVerify(order, resp.razorpay_order_id, resp.razorpay_payment_id, resp.razorpay_signature),
          modal: { ondismiss: () => setStatus({ kind: 'cancelled', msg: 'Payment cancelled' }) },
        });
        rzp.on('payment.failed', (e: any) => setStatus({ kind: 'failed', msg: e?.error?.description ?? 'Payment failed' }));
        rzp.open();
      } else if (order.provider === 'cashfree') {
        const cf = await loadCashfree();
        if (!cf) { setStatus({ kind: 'failed', msg: 'Could not load Cashfree Checkout' }); return; }
        const result = await cf.checkout({ paymentSessionId: order.client_token, redirectTarget: '_modal' });
        if (result?.error) {
          const cancelled = String(result.error?.message ?? '').toLowerCase().includes('cancel');
          setStatus({ kind: cancelled ? 'cancelled' : 'failed', msg: result.error?.message ?? 'Payment failed' });
          return;
        }
        await runVerify(order, order.provider_order_id, result?.paymentDetails?.paymentId ?? '', '');
      } else {
        setStatus({ kind: 'failed', msg: `Unsupported provider: ${order.provider}` });
      }
    } catch (err: any) {
      setStatus({ kind: 'failed', msg: err?.message ?? 'Something went wrong' });
    }
  }, [orgId, runVerify, currency]);

  const busy = status.kind === 'creating' || status.kind === 'paying' || status.kind === 'verifying';

  return (
    <div className="space-y-6">
      {/* Separate accountability — plan vs bonus vs top-up, validity + spend order */}
      {buckets.length > 0 && (
        <div className="rounded-2xl border border-[#C9DDF3] bg-white p-5">
          <h3 className="text-sm font-bold text-[#071D3A]">Your credits</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {buckets.map((b) => (
              <div key={b.key} className="rounded-xl border border-[#D8E3F0] bg-[#F7FBFF] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#5D6F83]">{b.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    b.neverExpires ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {b.neverExpires ? 'Never expires' : 'May expire'}
                  </span>
                </div>
                <p className="mt-1 text-2xl font-black text-[#0B5ED7]">{b.available.toLocaleString()}</p>
                <p className="mt-1 text-[11px] leading-4 text-[#5D6F83]">{b.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#5D6F83]">
            Credits are spent in order — <strong>plan</strong> first, then <strong>bonus</strong>, then <strong>top-up</strong>. Top-up credits never expire and require an active subscription to use.
          </p>
        </div>
      )}

      {/* Currency selector — pay in USD / EUR / INR */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Pay in</span>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                currency === c ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {currencySymbol(c)} {c}
            </button>
          ))}
        </div>
      </div>

      {/* Packs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {packs.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl border bg-white p-5 text-center transition ${
              p.id === preselectId ? 'border-[#0A66C2] ring-2 ring-[#0A66C2]/30' : 'border-slate-200'
            }`}
          >
            <div className="text-3xl font-black text-indigo-600">{p.credits.toLocaleString()}</div>
            <div className="text-xs text-slate-500">{p.label}</div>
            <div className="mt-2 text-sm font-semibold text-slate-700">{priceLabel(p)}</div>
            <button
              onClick={() => buy(p)}
              disabled={busy || !orgId}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy && lastPackId === p.id ? 'Processing…' : 'Buy'}
            </button>
          </div>
        ))}
      </div>

      {/* Status */}
      {status.kind !== 'idle' && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          status.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : status.kind === 'failed' ? 'border-red-200 bg-red-50 text-red-800'
          : status.kind === 'cancelled' ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {status.msg ?? status.kind}
          {(status.kind === 'failed' || status.kind === 'cancelled') && lastPackId && (
            <button onClick={() => { const p = packs.find((x) => x.id === lastPackId); if (p) buy(p); }} className="ml-3 font-semibold underline">
              Retry
            </button>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-700">Top-up history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">No top-ups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-400">
                  <th className="py-2">Date</th><th className="py-2 text-right">Credits</th>
                  <th className="py-2 text-right">Amount</th><th className="py-2">Status</th><th className="py-2">Reference</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(h.created_at).toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{h.credits}</td>
                    <td className="py-2 text-right tabular-nums">{h.amount_paid != null ? `${h.currency ?? '₹'} ${h.amount_paid}` : '—'}</td>
                    <td className="py-2 capitalize">{h.fulfillment_status ?? h.status ?? '—'}</td>
                    <td className="py-2 text-xs text-slate-400">{h.provider_order_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-slate-400">Razorpay test mode · top-up credits never expire · require an active subscription to use.</p>
    </div>
  );
}
