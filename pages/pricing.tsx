'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

// ── Data ─────────────────────────────────────────────────────────────────────

const TIERS = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'For individuals & creators',
    credits: '1,000',
    price: '',
    cta: 'Buy Now',
    ctaHref: '/login?plan=starter',
    accent: 'emerald',
    popular: false,
    enterprise: false,
  },
  {
    key: 'growth',
    name: 'Growth',
    tagline: 'For start-ups',
    credits: '5,000',
    price: '',
    cta: 'Buy Now',
    ctaHref: '/login?plan=growth',
    accent: 'blue',
    popular: true,
    enterprise: false,
  },
  {
    key: 'scale',
    name: 'Scale',
    tagline: 'For SMBs',
    credits: '20,000',
    price: '',
    cta: 'Buy Now',
    ctaHref: '/login?plan=scale',
    accent: 'violet',
    popular: false,
    enterprise: false,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    tagline: 'For marketing teams',
    credits: 'Custom',
    price: 'Custom',
    cta: 'Talk to Sales',
    ctaHref: 'mailto:sales@omnivyra.com',
    accent: 'slate',
    popular: false,
    enterprise: true,
  },
];

const CREDIT_TIERS = [
  {
    tier: 'Low',
    label: 'Frequent actions',
    color: 'emerald',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-400',
    rows: [
      { action: 'AI reply suggestion',     credits: '1',    note: '' },
      { action: 'Social auto-post',        credits: '2',    note: 'per post' },
      { action: 'Content rewrite',         credits: '3',    note: '' },
      { action: 'Basic content generation', credits: '5',   note: 'per output' },
    ],
  },
  {
    tier: 'Medium',
    label: 'Value actions',
    color: 'blue',
    badge: 'bg-[#EBF3FD] text-[#0A66C2] border-[#0A66C2]/20',
    dot: 'bg-[#3FA9F5]',
    rows: [
      { action: 'Trend analysis',          credits: '25',   note: '' },
      { action: 'Market insight (manual)', credits: '30',   note: '' },
      { action: 'Campaign creation',       credits: '40',   note: '' },
      { action: 'Website SEO audit',       credits: '50',   note: '' },
    ],
  },
  {
    tier: 'High',
    label: 'Smart background',
    color: 'amber',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-400',
    note: '★ Charged only when actionable output is found',
    rows: [
      { action: 'Lead signal detection',       credits: '15',  note: '★ value-gated' },
      { action: 'Daily insight scan',          credits: '20',  note: '★ value-gated' },
      { action: 'Campaign optimisation scan',  credits: '30',  note: '★ value-gated' },
    ],
  },
  {
    tier: 'Heavy',
    label: 'LLM · Voice · Multi-step',
    color: 'violet',
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
    dot: 'bg-violet-400',
    rows: [
      { action: 'Voice interaction',           credits: '10',  note: 'per minute' },
      { action: 'Deep multi-step analysis',    credits: '60',  note: '' },
      { action: 'Full campaign strategy',      credits: '80',  note: '' },
    ],
  },
];

const ADDON_PACKS = [
  { credits: 500,    price: '',  saving: null,   popular: false },
  { credits: 2_000,  price: '',  saving: null,   popular: true },
  { credits: 10_000, price: '',  saving: null,   popular: false },
];

const CAPABILITIES = [
  {
    group: 'Understand your marketing',
    items: ['SEO & website health analysis', 'Market insight scans', 'Trend-based recommendations', 'Competitor signal monitoring'],
  },
  {
    group: 'Plan & execute campaigns',
    items: ['AI campaign planning & structuring', 'Weekly execution skeletons', 'Strategic theme mapping', 'Multi-channel scheduling'],
  },
  {
    group: 'Create & optimise content',
    items: ['AI content generation (text + social)', 'Brand voice consistency', 'Format-specific recommendations', 'Content performance signals'],
  },
  {
    group: 'Manage engagement',
    items: ['AI-assisted reply generation', 'Engagement control center', 'Audience response patterns', 'Sentiment tracking'],
  },
  {
    group: 'Make better decisions',
    items: ['Lead signal detection', 'Growth opportunity alerts', 'Decision intelligence layer', 'Performance narrative reports'],
  },
];

// ── Colour helpers ────────────────────────────────────────────────────────────

function tierBorder(accent: string) {
  if (accent === 'emerald') return 'border-emerald-300';
  if (accent === 'blue')    return 'border-[#0A66C2]';
  if (accent === 'violet')  return 'border-violet-400';
  return 'border-slate-300';
}
function tierBadge(accent: string) {
  if (accent === 'emerald') return 'bg-emerald-50 text-emerald-700';
  if (accent === 'blue')    return 'bg-[#EBF3FD] text-[#0A66C2]';
  if (accent === 'violet')  return 'bg-violet-50 text-violet-700';
  return 'bg-slate-100 text-slate-700';
}
function tierButton(accent: string, popular: boolean, enterprise: boolean) {
  if (popular)    return 'bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] hover:opacity-95';
  if (enterprise) return 'border-2 border-slate-300 text-slate-700 hover:bg-slate-50';
  if (accent === 'emerald') return 'border-2 border-emerald-400 text-emerald-700 hover:bg-emerald-50';
  return 'border-2 border-violet-400 text-violet-700 hover:bg-violet-50';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

  return (
    <>
      <Head>
        <title>Pricing | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra pricing — all features included, pay only for what you use. Start free with 1,000 credits. No feature gating, no forced upgrades."
        />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="relative overflow-hidden"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 50%, #0A66C2 100%)' }}
        >
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -top-32 left-1/3 h-[420px] w-[420px] rounded-full opacity-[0.10]"
              style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }} />
          </div>
          <div className="relative mx-auto max-w-[1280px] px-6 py-20 text-center lg:px-8 lg:py-28">
            <p className="mb-4 inline-block rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Simple, usage-based pricing
            </p>
            <h1
              className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl xl:text-[3.25rem]"
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
            >
              Use everything.<br />Pay for what you use.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/75">
              No locked features. No forced upgrades.<br className="hidden sm:block" />
              Just one platform that scales with your needs.
            </p>
            <p className="mt-3 text-sm font-medium text-[#3FA9F5]">
              Start small. Scale when you need. Stay in control.
            </p>
          </div>
        </section>

        {/* ── Pricing cards ────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1280px] -mt-8 px-6 pb-20 lg:px-8">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <div
                key={tier.key}
                className={`relative flex flex-col rounded-2xl border-2 bg-white p-7 shadow-sm transition hover:shadow-md ${
                  tier.popular ? tierBorder(tier.accent) + ' shadow-md' : 'border-gray-100'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-[#0A66C2] px-4 py-1 text-xs font-semibold text-white shadow">
                      Most Popular
                    </span>
                  </div>
                )}

                {/* Tier name + tagline */}
                <div>
                  <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold ${tierBadge(tier.accent)}`}>
                    {tier.name}
                  </span>
                  <p className="mt-2 text-sm text-[#6B7C93]">{tier.tagline}</p>
                </div>

                {/* Credits */}
                <div className="mt-6">
                  {tier.enterprise ? (
                    <p className="mt-1 text-sm text-[#6B7C93]">Credits &amp; pricing on request</p>
                  ) : (
                    <p className="text-sm text-[#6B7C93]">
                      <span className="text-2xl font-bold text-[#0B1F33]">{tier.credits}</span> credits / month
                    </p>
                  )}
                </div>

                {/* Divider */}
                <div className="my-5 border-t border-gray-100" />

                {/* Feature note */}
                <p className="mb-5 text-sm font-medium text-[#0B1F33]">
                  All features included. No restrictions.
                </p>

                {/* CTA */}
                <div className="mt-auto">
                  <Link
                    href={tier.ctaHref}
                    className={`block w-full rounded-full px-6 py-3 text-center text-sm font-semibold transition ${tierButton(tier.accent, tier.popular, tier.enterprise)}`}
                  >
                    {tier.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Top-up note */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[#6B7C93]">
              Need more? Buy additional credits any time — no plan change needed.
            </p>
            <p className="mt-1 text-xs text-[#6B7C93]/70">
              Try free first &rarr;{' '}
              <Link href="/get-free-credits" className="text-[#0A66C2] hover:underline">Get 300 free credits</Link>
            </p>
          </div>
        </section>

        {/* ── Credit explanation ───────────────────────────────────────────── */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Transparent usage</p>
              <h2
                className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                Simple, transparent usage
              </h2>
              <p className="mt-4 text-base text-[#6B7C93]">
                Credits reflect real compute cost and the value you get — not hidden token math.
                Background jobs only charge when they find something worth acting on.
              </p>
            </div>

            {/* 4-tier credit table */}
            <div className="mx-auto max-w-3xl space-y-4">
              {CREDIT_TIERS.map((tier) => (
                <div key={tier.tier} className="overflow-hidden rounded-2xl border border-gray-100 bg-[#F5F9FF] shadow-sm">
                  {/* Tier header */}
                  <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-3">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${tier.dot}`} />
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tier.badge}`}>
                      {tier.tier}
                    </span>
                    <span className="text-xs text-[#6B7C93]">{tier.label}</span>
                    {tier.note && (
                      <span className="ml-auto text-[10px] font-medium text-amber-600">{tier.note}</span>
                    )}
                  </div>
                  {/* Rows */}
                  <table className="w-full text-sm">
                    <tbody>
                      {tier.rows.map((row, i) => (
                        <tr
                          key={row.action}
                          onMouseEnter={() => setHoveredAction(row.action)}
                          onMouseLeave={() => setHoveredAction(null)}
                          className={`border-b border-gray-100 last:border-0 transition-colors ${
                            hoveredAction === row.action ? 'bg-[#EBF3FD]' : i % 2 === 0 ? 'bg-white' : 'bg-[#F5F9FF]'
                          }`}
                        >
                          <td className="px-5 py-3 font-medium text-[#0B1F33]">{row.action}</td>
                          <td className="px-5 py-3 text-xs text-[#6B7C93]">{row.note}</td>
                          <td className="px-5 py-3 text-right font-bold text-[#0A66C2]">{row.credits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* Smart Mode callout */}
            <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-[#0A66C2]/20 bg-[#EBF3FD] px-6 py-4 flex items-start gap-4">
              <span className="text-2xl flex-shrink-0">⚡</span>
              <div>
                <p className="text-sm font-semibold text-[#0B1F33]">Smart Mode — on by default</p>
                <p className="mt-1 text-sm leading-relaxed text-[#6B7C93]">
                  Omnivyra automatically batches operations, skips redundant scans, and only charges background credits when real value is found.
                  You get the same outcomes — at lower credit cost.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Add-on credits ───────────────────────────────────────────────── */}
        <section id="addons" className="py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-10 max-w-xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Add-on credits</p>
              <h2
                className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                Top up any time
              </h2>
              <p className="mt-4 text-base text-[#6B7C93]">
                Need more? Buy additional credits without changing your plan. No disruption, no lock-in.
              </p>
            </div>
            <div className="mx-auto grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-3">
              {ADDON_PACKS.map((pack) => (
                <div
                  key={pack.credits}
                  className={`relative flex flex-col items-center rounded-2xl border-2 bg-white px-6 py-7 text-center shadow-sm transition hover:shadow-md ${
                    pack.popular ? 'border-[#0A66C2] shadow-md' : 'border-gray-100'
                  }`}
                >
                  {pack.popular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-[#0A66C2] px-4 py-1 text-xs font-semibold text-white">
                        Best value
                      </span>
                    </div>
                  )}
                  <p className="text-3xl font-bold text-[#0B1F33]">{pack.credits.toLocaleString()}</p>
                  <p className="text-sm text-[#6B7C93]">credits</p>
                  <Link
                    href="/login"
                    className={`mt-5 w-full rounded-full py-2.5 text-sm font-semibold transition ${
                      pack.popular
                        ? 'bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] text-white hover:opacity-95'
                        : 'border-2 border-gray-200 text-[#0B1F33] hover:border-[#0A66C2] hover:text-[#0A66C2]'
                    }`}
                  >
                    Buy Credits
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Usage intelligence ───────────────────────────────────────────── */}
        <section className="py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Usage intelligence</p>
                <h2
                  className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                  style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
                >
                  Know where your credits go
                </h2>
                <p className="mt-4 text-base leading-relaxed text-[#6B7C93]">
                  Your credit usage is never a black box. You always know what ran, what it cost, and where you can optimise.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { icon: '📊', title: 'Real-time tracking', body: 'See your credit balance and spend update live as you work.' },
                  { icon: '🗂️', title: 'Category breakdown', body: 'Understand which activities — content, insights, publishing — consume the most.' },
                  { icon: '💡', title: 'Optimisation hints', body: 'Suggestions to get the same outcomes with fewer credits.' },
                  { icon: '🔔', title: 'Limit alerts', body: 'Get notified at 80% and 95% usage so you are never caught off-guard.' },
                ].map((item) => (
                  <div key={item.title} className="card-lift rounded-2xl border border-gray-100 bg-white p-5">
                    <div className="mb-3 text-2xl">{item.icon}</div>
                    <h3 className="text-sm font-semibold text-[#0B1F33]">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#6B7C93]">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Flexibility ──────────────────────────────────────────────────── */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-10 max-w-xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Flexibility</p>
              <h2
                className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                Scale when you need
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[
                { icon: '➕', title: 'Top-up any time', body: 'Buy additional credits mid-month with no plan change required and no workflow disruption.' },
                { icon: '🔄', title: 'Credits roll over', body: 'Unused credits carry forward so you never lose what you paid for.' },
                { icon: '↕️', title: 'Change tiers freely', body: 'Move up or down between plans whenever your needs shift. No penalties, no lock-in.' },
              ].map((item) => (
                <div key={item.title} className="card-lift rounded-2xl border border-gray-100 bg-[#F5F9FF] p-6 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
                    {item.icon}
                  </div>
                  <h3 className="text-base font-semibold text-[#0B1F33]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-10 max-w-xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Everything included</p>
              <h2
                className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                All capabilities. All plans.
              </h2>
              <p className="mt-4 text-base text-[#6B7C93]">
                Your plan determines how much you can do — not what you can access.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap) => (
                <div key={cap.group} className="rounded-2xl border border-gray-100 bg-white p-6">
                  <h3 className="mb-4 text-sm font-semibold text-[#0B1F33]">{cap.group}</h3>
                  <ul className="space-y-2.5">
                    {cap.items.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-[#6B7C93]">
                        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0A66C2]" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l4 4 6-6" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section
          className="py-20"
          style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}
        >
          <div className="mx-auto max-w-[1280px] px-6 text-center lg:px-8">
            <h2
              className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
            >
              You already have everything.<br />Now use it your way.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
              Start free. Scale when you need. Stay in control.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/get-free-credits"
                className="rounded-full bg-white px-8 py-3.5 text-[15px] font-semibold text-[#0A66C2] shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition hover:shadow-[0_6px_28px_rgba(255,255,255,0.35)] hover:opacity-95"
              >
                Get Free Credits
              </Link>
            </div>
            <p className="mt-5 text-xs text-white/35">No credit card required &middot; Cancel any time</p>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
