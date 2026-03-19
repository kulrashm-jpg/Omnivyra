'use client';

import Link from 'next/link';

const SIGNAL_CARDS = [
  {
    label: 'Website Insight',
    signal: 'SEO Issues Detected',
    detail: 'Your homepage loses 67% of visitors in under 8 seconds.',
    textColor: 'text-amber-600',
    dot: 'bg-amber-400',
    anim: 'animate-float-slow',
    offset: '',
  },
  {
    label: 'Campaign Alert',
    signal: 'Low Conversion Segment',
    detail: 'Your targeting misses the top 3 decision-making segments.',
    textColor: 'text-rose-500',
    dot: 'bg-rose-400',
    anim: 'animate-float-mid',
    offset: 'ml-8',
  },
  {
    label: 'Growth Opportunity',
    signal: 'Untapped Channel',
    detail: 'LinkedIn organic reach is up 40% — you are not posting.',
    textColor: 'text-emerald-500',
    dot: 'bg-emerald-400',
    anim: 'animate-float-fast',
    offset: 'ml-4',
  },
];

const cardShadow = '0 4px 24px rgba(10,31,68,0.14), 0 1px 0 rgba(255,255,255,0.8) inset';

export default function HeroSection() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 45%, #0A66C2 100%)' }}
    >
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full opacity-[0.15]"
          style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 right-0 h-80 w-80 rounded-full opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }} />
      </div>

      <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-28">

        {/* ── LEFT: Text ─────────────────────────────────────────────────── */}
        <div className="text-center lg:text-left">
          <p className="mb-4 inline-block rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">
            AI-Driven Digital Marketing System
          </p>
          <h1
            className="text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl xl:text-[3.25rem]"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            Take Control of<br />Your Digital Growth.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/75 lg:mx-0">
            Stop guessing. Stop juggling tools.<br className="hidden sm:block" />
            Know exactly what&rsquo;s working, what&rsquo;s not, and what to do next&nbsp;&mdash; all in one place.
          </p>
          <p className="mt-3 text-[15px] font-medium text-[#3FA9F5]">
            From confusion &rarr; clarity &rarr; growth.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Link
              href="/audit/website-growth-check"
              className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.45)] transition hover:shadow-[0_6px_28px_rgba(10,102,194,0.6)] hover:opacity-95"
            >
              Run Free Audit
            </Link>
            <Link
              href="/features"
              className="rounded-full border-2 border-white/40 bg-white/10 px-7 py-3.5 text-[15px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              See How It Works
            </Link>
          </div>
          <p className="mt-5 text-xs text-white/35">No credit card required &middot; Free to start</p>
        </div>

        {/* ── RIGHT: Floating signal cards ───────────────────────────────── */}
        <div className="flex flex-col gap-4 px-4 lg:px-0">
          {SIGNAL_CARDS.map((card) => (
            <div
              key={card.label}
              className={`${card.offset} ${card.anim} rounded-2xl border border-white/20 bg-white/95 p-4 backdrop-blur-md`}
              style={{ boxShadow: cardShadow }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6B7C93]">
                    {card.label}
                  </p>
                  <p className={`mt-0.5 text-sm font-bold ${card.textColor}`}>{card.signal}</p>
                  <p className="mt-1 text-xs leading-snug text-[#0B1F33]/65">{card.detail}</p>
                </div>
                <div className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${card.dot} ring-4 ring-current/20`} />
              </div>
            </div>
          ))}
          <p className="mt-1 text-center text-[11px] text-white/35">
            Real decision signals. No dashboards.
          </p>
        </div>
      </div>
    </section>
  );
}
