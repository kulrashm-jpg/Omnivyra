'use client';

import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

const BLUE_GRADIENT = 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 50%, #0A66C2 100%)';

const TIERS = [
  {
    name: 'Starter',
    audience: 'For creators and solo operators',
    credits: '1,000',
    note: 'Early operating rhythm for first reports, content, and campaign workflows.',
    href: '/login?plan=starter',
  },
  {
    name: 'Growth',
    audience: 'For startups and growth teams',
    credits: '5,000',
    note: 'Consistent operating volume for active marketing execution.',
    href: '/login?plan=growth',
    popular: true,
  },
  {
    name: 'Scale',
    audience: 'For SMB marketing operations',
    credits: '20,000',
    note: 'High-volume capacity for coordinated campaigns and recurring intelligence.',
    href: '/login?plan=scale',
  },
  {
    name: 'Enterprise',
    audience: 'For larger marketing teams',
    credits: 'Custom',
    note: 'Organizational operating capacity with custom volume and support.',
    href: 'mailto:sales@omnivyra.com',
    enterprise: true,
  },
];

const RESERVE_POINTS = [
  {
    title: 'Monthly plans cover normal rhythm',
    body: 'Your subscription gives predictable monthly capacity for regular operating work.',
  },
  {
    title: 'Flexible Operational Reserve supports heavier periods',
    body: 'If monthly credits are used, reserve capacity can continue the work without forcing an immediate upgrade.',
  },
];

const RESERVE_PACKS = [
  ['500', 'Reserve credits'],
  ['2,000', 'Reserve credits'],
  ['10,000', 'Reserve credits'],
];

export default function PricingPage() {
  return (
    <>
      <Head>
        <title>Pricing | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra pricing uses credits so teams can access the full platform and pay based on usage volume, not locked feature gates."
        />
      </Head>

      <main className="min-h-screen bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <section className="relative overflow-hidden" style={{ background: BLUE_GRADIENT }}>
          <div className="pointer-events-none absolute inset-0 omnivyra-dark-grid opacity-45" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#F5F9FF] to-transparent" />
          <div className="relative mx-auto max-w-[1280px] px-6 py-14 lg:min-h-[390px] lg:px-8 lg:py-16">
            <div className="max-w-3xl">
              <p className="inline-flex rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#A9DAFF]">
                Pricing
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl xl:text-[2.9rem]">
                Simple pricing for full platform access.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80">
                Choose a monthly credit plan for normal usage. Add Operational Reserve when heavier periods need more capacity.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Link href="/get-free-credits" className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-[#0A66C2] shadow-[0_16px_34px_rgba(10,102,194,0.25)]">
                  Get Free Credits
                </Link>
                <Link href="/create-account" className="inline-flex min-h-[50px] items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold text-white">
                  Get My Digital Authority Snapshot
                </Link>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/65">Reserve credits stay valid for lifetime use.</p>
            </div>
          </div>
        </section>

        <section className="relative z-10 -mt-8 px-6 lg:px-8">
          <div className="mx-auto grid max-w-[1280px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <article
                key={tier.name}
                className={`relative flex min-h-[285px] flex-col rounded-2xl border bg-white p-6 shadow-[0_18px_42px_rgba(10,31,68,0.08)] transition ${
                  tier.popular ? 'border-[#0A66C2] ring-4 ring-[#0A66C2]/10' : 'border-[#D8E3F0]'
                }`}
              >
                {tier.popular && (
                  <span className="absolute -top-3 left-6 rounded-full border border-[#B9D9FA] bg-[#EEF6FF] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#0A66C2] shadow-sm">
                    Most selected
                  </span>
                )}
                <p className="text-lg font-black text-[#071D3A]">{tier.name}</p>
                <p className="mt-1 text-sm font-semibold text-[#5D6F83]">{tier.audience}</p>
                <div className="mt-5">
                  <p className="text-4xl font-black text-[#0A66C2]">{tier.credits}</p>
                  <p className="mt-1 text-sm font-semibold text-[#5D6F83]">{tier.enterprise ? 'credits and pricing on request' : 'credits per month'}</p>
                </div>
                <p className="mt-4 text-sm leading-7 text-[#4E6175]">{tier.note}</p>
                <Link
                  href={tier.href}
                  className={`mt-auto inline-flex min-h-[48px] items-center justify-center rounded-xl px-5 py-3 text-sm font-black transition ${
                    tier.popular
                      ? 'bg-[#0A66C2] text-white shadow-[0_14px_28px_rgba(10,102,194,0.24)]'
                      : 'border border-[#C9DDF3] bg-white text-[#0A66C2] hover:border-[#0A66C2]/50'
                  }`}
                >
                  {tier.enterprise ? 'Talk to Sales' : 'Buy Now'}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="px-6 py-14 lg:px-8">
          <div className="mx-auto grid max-w-[1180px] gap-6 rounded-3xl border border-[#C9DDF3] bg-white px-6 py-8 shadow-[0_18px_42px_rgba(10,31,68,0.06)] lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#0A66C2]">Operational flexibility</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-[#071D3A]">
                Flexible Operational Reserve keeps work moving.
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#5D6F83]">
                Monthly plans cover normal rhythm. Reserve capacity protects heavier periods, activates after monthly
                credits are used, and remains available for lifetime use.
              </p>
            </div>
            <div className="grid gap-3">
              {RESERVE_POINTS.map((point) => (
                <div key={point.title} className="rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF] px-5 py-4">
                  <h3 className="text-sm font-black text-[#071D3A]">{point.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#5D6F83]">{point.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-5 grid max-w-[1180px] gap-5 lg:grid-cols-[0.78fr_1.22fr]">
            <div className="rounded-3xl border border-[#C9DDF3] bg-white px-6 py-6 shadow-[0_14px_34px_rgba(10,31,68,0.05)]">
              <h3 className="text-xl font-black text-[#071D3A]">Unused reserve never disappears.</h3>
              <p className="mt-3 text-sm leading-7 text-[#5D6F83]">
                Reserve capacity carries lifetime validity, so quiet months do not erase capacity kept for future demand.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {RESERVE_PACKS.map(([amount, label]) => (
                <div key={amount} className="rounded-3xl border border-[#C9DDF3] bg-white px-6 py-6 text-center shadow-[0_14px_34px_rgba(10,31,68,0.05)]">
                  <p className="text-3xl font-black text-[#0A66C2]">{amount}</p>
                  <p className="mt-1 text-sm font-semibold text-[#5D6F83]">{label}</p>
                  <Link
                    href="/get-free-credits"
                    className="mt-5 inline-flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#C9DDF3] bg-white px-4 py-2 text-sm font-black text-[#0A66C2] transition hover:border-[#0A66C2]/50"
                  >
                    Add Reserve
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pb-20 lg:px-8">
          <div className="mx-auto max-w-[980px] rounded-3xl border border-[#C9DDF3] bg-white px-6 py-8 text-center shadow-[0_18px_42px_rgba(10,31,68,0.06)]">
            <h2 className="text-2xl font-black tracking-tight text-[#071D3A]">All plans include core platform access.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-[#5D6F83]">
              Plans differ by monthly credit volume, not restricted workflows. Access remains open as operating intensity grows.
            </p>
          </div>
        </section>

        <Footer />
      </main>
    </>
  );
}
