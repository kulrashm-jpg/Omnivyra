'use client';

import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';
import {
  PLANS, TOPUPS, FEATURE_MATRIX, FAQS, FOUNDING_MEMBER, CURRENCIES,
  formatPrice, type PlanId, type Currency,
} from '@/lib/billing/commercialPlans';
import { DEFAULT_FX, type FxConfig } from '@/lib/billing/currency';
import { apiFetch } from '@/lib/apiFetch';
import { FoundingMemberBadge } from '@/components/billing/FoundingMemberBadge';

const BLUE_GRADIENT = 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 45%, #0A66C2 100%)';
const PLAN_IDS: PlanId[] = ['free', 'starter', 'growth', 'business'];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <span className="text-emerald-600" aria-label="Included">✓</span>;
  if (value === false) return <span className="text-slate-300" aria-label="Not included">—</span>;
  return <span className="font-medium text-slate-700">{value}</span>;
}

function CurrencyToggle({ currency, onChange }: { currency: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="inline-flex rounded-full border border-white/30 bg-white/10 p-1" role="tablist" aria-label="Currency">
      {CURRENCIES.map((c) => (
        <button
          key={c}
          role="tab"
          aria-selected={currency === c}
          onClick={() => onChange(c)}
          className={`rounded-full px-4 py-1.5 text-xs font-black transition ${
            currency === c ? 'bg-white text-[#0A66C2]' : 'text-white/80 hover:text-white'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export default function PricingPage() {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [fx, setFx] = useState<FxConfig>(DEFAULT_FX);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/billing/fx');
        if (res.ok) setFx(await res.json());
      } catch { /* fall back to DEFAULT_FX */ }
    })();
  }, []);

  return (
    <>
      <Head>
        <title>Pricing | Omnivyra</title>
        <meta name="description" content="Omnivyra pricing: credit-based plans with full platform access, in USD or INR. Founding Member pricing available before March 2028." />
      </Head>

      <main className="min-h-screen bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        {/* ── Hero + currency toggle ─────────────────────────────── */}
        <section className="relative overflow-hidden" style={{ background: BLUE_GRADIENT }}>
          <div className="pointer-events-none absolute inset-0 omnivyra-dark-grid opacity-45" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#F5F9FF] to-transparent" />
          <div className="relative mx-auto max-w-[1280px] px-6 py-14 text-center lg:px-8 lg:py-16">
            <h1 className="mx-auto max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
              Full platform access. Pay by usage, not feature gates.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/80">
              Every plan unlocks the entire platform. Plans differ only by monthly credits and seats. Start free, add top-up credits any time.
            </p>
            <div className="mt-6 flex justify-center">
              <CurrencyToggle currency={currency} onChange={setCurrency} />
            </div>
          </div>
        </section>

        {/* ── Founding Member banner (the ONLY founding messaging) ── */}
        <section className="relative z-10 -mt-8 px-6 lg:px-8">
          <div className="mx-auto max-w-[1280px]">
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:gap-4">
              <FoundingMemberBadge className="shrink-0" />
              <div>
                <p className="text-sm font-black text-amber-800">{FOUNDING_MEMBER.heading}</p>
                <p className="mt-0.5 text-sm leading-6 text-amber-900/80">{FOUNDING_MEMBER.explanation}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing cards (price + credits + seats only) ─────────── */}
        <section className="px-6 pt-8 lg:px-8" aria-label="Plans">
          <div className="mx-auto grid max-w-[1280px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-[0_18px_42px_rgba(10,31,68,0.08)] ${
                  plan.popular ? 'border-[#0A66C2] ring-4 ring-[#0A66C2]/10' : 'border-[#D8E3F0]'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-6 rounded-full border border-[#B9D9FA] bg-[#EEF6FF] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#0A66C2] shadow-sm">
                    Most selected
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-[#071D3A]">{plan.name}</h2>
                  {plan.foundingMember && <FoundingMemberBadge />}
                </div>
                <p className="mt-1 text-sm font-semibold text-[#5D6F83]">{plan.audience}</p>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#0A66C2]">{formatPrice(plan.priceFounderUsd, currency, fx, plan.id)}</span>
                  {plan.priceRegularUsd != null && (
                    <span className="text-sm font-semibold text-slate-400 line-through" aria-label="Regular price">
                      {formatPrice(plan.priceRegularUsd, currency, fx)}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-[#5D6F83]">/ {plan.cadenceLabel.replace('per ', '')}</span>
                </div>
                <p className="mt-3 text-sm font-bold text-[#071D3A]">{plan.creditsLabel}</p>
                <p className="text-sm text-[#5D6F83]">{plan.usersLabel}</p>
                <Link
                  href={plan.href}
                  className={`mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl px-5 py-3 text-sm font-black transition ${
                    plan.popular
                      ? 'bg-[#0A66C2] text-white shadow-omnivyra hover:bg-[#0857A8]'
                      : 'border border-[#C9DDF3] bg-white text-[#0A66C2] hover:border-[#0A66C2]/50 hover:bg-[#EEF6FF]'
                  }`}
                >
                  {plan.cta}
                </Link>
              </article>
            ))}
          </div>
          <p className="mx-auto mt-4 max-w-[1280px] text-center text-xs text-slate-400">
            Founder prices apply to members who subscribe before {FOUNDING_MEMBER.expiryLabel}. Payments are processed in INR via Razorpay.
          </p>
          {/* Phase 9 — human-sales CTA routes to the canonical Lead Capture experience.
              Self-serve plan CTAs above are unchanged. */}
          <div className="mx-auto mt-8 flex max-w-[1280px] flex-col items-center justify-between gap-4 rounded-2xl border border-[#C9DDF3] bg-[#EEF6FF] px-6 py-5 text-center sm:flex-row sm:text-left">
            <div>
              <p className="text-sm font-black text-[#071D3A]">Need a custom or enterprise plan?</p>
              <p className="text-sm text-[#5D6F83]">Talk to our team about volume credits, seats, and onboarding.</p>
            </div>
            <Link
              href="/contact-sales"
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#0A66C2] px-6 py-3 text-sm font-black text-white shadow-omnivyra transition hover:bg-[#0857A8]"
            >
              Talk to sales
            </Link>
          </div>
        </section>

        {/* ── Unified feature comparison matrix (the ONLY capability list) ── */}
        <section className="px-6 py-12 lg:px-8" aria-label="Feature comparison">
          <div className="mx-auto max-w-[1280px] rounded-3xl border border-[#C9DDF3] bg-white p-6 shadow-sm lg:p-8">
            <h2 className="text-2xl font-black tracking-tight text-[#071D3A]">Compare plans</h2>
            <p className="mt-1 text-sm text-[#5D6F83]">All plans include the full platform. Plans differ by credits and seats.</p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className="py-3 pr-4 text-left font-bold text-slate-500">Capability</th>
                    {PLANS.map((p) => (
                      <th key={p.id} scope="col" className="px-3 py-3 text-center font-black text-[#071D3A]">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_MATRIX.map((row) => (
                    <tr key={row.label} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="py-3 pr-4 text-left font-medium text-slate-600">{row.label}</th>
                      {PLAN_IDS.map((id) => (
                        <td key={id} className="px-3 py-3 text-center"><Cell value={row.values[id]} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Top-up section (the ONLY top-up pricing) ─────────────── */}
        <section className="px-6 pb-12 lg:px-8" aria-label="Top-up credits">
          <div className="mx-auto max-w-[1280px] rounded-3xl border border-[#C9DDF3] bg-white p-6 shadow-sm lg:p-8">
            <h2 className="text-2xl font-black tracking-tight text-[#071D3A]">Top-up credits</h2>
            <p className="mt-1 max-w-2xl text-sm text-[#5D6F83]">
              Add capacity for heavier periods. Consumed after your monthly plan credits and <strong>never expire</strong>.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {TOPUPS.map((t) => (
                <div key={t.id} className="flex flex-col rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF] px-6 py-6 text-center">
                  <p className="text-3xl font-black text-[#0A66C2]">{t.credits.toLocaleString()}</p>
                  <p className="mt-1 text-sm font-semibold text-[#5D6F83]">{t.label}</p>
                  <p className="mt-2 text-lg font-black text-[#071D3A]">{formatPrice(t.priceUsd, currency, fx, t.sku)}</p>
                  <Link
                    href={`/command-center/topup?pack=${t.id}`}
                    className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0A66C2] px-5 py-2.5 text-sm font-black text-white shadow-omnivyra transition hover:bg-[#0857A8]"
                  >
                    Buy credits
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────── */}
        <section className="px-6 pb-20 lg:px-8" aria-label="Frequently asked questions">
          <div className="mx-auto max-w-[900px]">
            <h2 className="text-2xl font-black tracking-tight text-[#071D3A]">Frequently asked questions</h2>
            <dl className="mt-5 space-y-3">
              {FAQS.map((f) => (
                <div key={f.q} className="rounded-2xl border border-[#D8E3F0] bg-white px-5 py-4">
                  <dt className="text-sm font-black text-[#071D3A]">{f.q}</dt>
                  <dd className="mt-1 text-sm leading-6 text-[#5D6F83]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
