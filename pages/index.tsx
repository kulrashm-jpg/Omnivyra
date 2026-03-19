import Link from 'next/link';
import HeroSection from '../components/landing/HeroSection';
import Footer from '../components/landing/Footer';
import FreeAuditInput from '../components/FreeAuditInput';

const hl = { fontFamily: "'Poppins', 'Inter', sans-serif" };

// ── Section 3: For Anyone ─────────────────────────────────────────────────────
const FOR_ANYONE = [
  { icon: '🎯', title: 'Stop Guessing', body: 'See what\'s actually working across your website, content, and campaigns — with clear evidence, not hunches.' },
  { icon: '⚡', title: 'Save Time', body: 'Get instant audits and clear next steps — no manual effort, no spreadsheets, no waiting.' },
  { icon: '🛠', title: 'A Unified System for Modern Marketing', body: 'Plan, generate, and execute all your marketing in one place. No more tab overload.' },
  { icon: '📈', title: 'Grow with Confidence', body: 'Know where to invest, when to scale, and what will actually drive results.' },
];

// ── Section 5: How It Works ───────────────────────────────────────────────────
const HOW_IT_WORKS = [
  { n: '01', title: 'Understand', body: 'Audit website, campaigns, and market — in seconds.' },
  { n: '02', title: 'Decide', body: 'Clear insights and prioritised recommendations.' },
  { n: '03', title: 'Execute', body: 'Content and campaigns built and launched in one place.' },
  { n: '04', title: 'Grow', body: 'Scale what works. Cut what doesn\'t. Repeat.' },
];

// ── Section 6: Decision Intelligence ─────────────────────────────────────────
const DI_QA = [
  { q: 'Should I run ads right now?', a: 'Recommended: Delay ads — fix your landing page first.' },
  { q: 'What content will perform?', a: 'Top Opportunity: Tutorial content in your niche (+3× reach).' },
  { q: 'Where should I invest next?', a: 'Budget Shift Suggested: LinkedIn organic is your best channel now.' },
  { q: 'Why is this campaign failing?', a: 'Audience mismatch — your creative targets buyers, not decision-makers.' },
];

// ── Section 7: Tool Fatigue ───────────────────────────────────────────────────
const SCATTERED = ['Analytics tools', 'SEO tools', 'Content tools', 'Ads dashboards'];

// ── Section 8: Personas ───────────────────────────────────────────────────────
const PERSONAS = [
  { role: 'Founder', initials: 'F', color: 'from-[#0A66C2] to-[#3FA9F5]', quote: '"I finally know what to do next."', detail: 'No more guessing which channel to prioritise or why growth stalled.' },
  { role: 'Marketer', initials: 'M', color: 'from-violet-500 to-purple-400', quote: '"This replaced multiple tools."', detail: 'One system for audits, planning, content, and reporting.' },
  { role: 'Creator', initials: 'C', color: 'from-emerald-500 to-teal-400', quote: '"I can grow without a team."', detail: 'Clear direction, instant content, and no agency dependency.' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <HeroSection />

      {/* ── S3: FOR ANYONE WHO ──────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Built for real people</p>
          <h2 className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl" style={hl}>
            For anyone who wants to take control
          </h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FOR_ANYONE.map((card) => (
              <div
                key={card.title}
                className="card-lift rounded-2xl border border-gray-200/70 bg-white p-6 shadow-[0_2px_12px_rgba(10,31,68,0.05)]"
              >
                <span className="text-3xl">{card.icon}</span>
                <h3 className="mt-4 text-[15px] font-semibold text-[#0B1F33]">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── S4: THE PROBLEM ─────────────────────────────────────────────── */}
      <section className="bg-[#0B1F33] px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <h2 className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl" style={hl}>
            Digital Marketing today is broken
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              { title: 'Too many tools', body: 'You switch between 6–10 platforms just to run a single campaign. Nothing talks to each other.' },
              { title: 'Too much data', body: 'Dashboards everywhere — but no clear answer on what to actually do next.' },
              { title: 'No clear direction', body: 'Every week starts with the same question: where do I even begin?' },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.05] p-6">
                <h3 className="text-base font-semibold text-[#3FA9F5]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 text-center">
            <p className="text-2xl font-bold text-white sm:text-3xl" style={hl}>
              You don&rsquo;t lack tools.
            </p>
            <p className="mt-1 text-2xl font-bold text-[#3FA9F5] sm:text-3xl" style={hl}>
              You lack clarity.
            </p>
          </div>
        </div>
      </section>

      {/* ── S5: HOW IT WORKS ────────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">One system</p>
          <h2 className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl" style={hl}>
            Total control.
          </h2>
          <div className="relative mt-14 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Connector line — desktop only */}
            <div
              className="absolute left-[12.5%] right-[12.5%] top-6 hidden h-px lg:block"
              style={{ background: 'linear-gradient(to right, #0A66C2, #3FA9F5, #0A66C2)' }}
              aria-hidden="true"
            />
            {HOW_IT_WORKS.map((item) => (
              <div key={item.n} className="relative flex flex-col items-center text-center">
                <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-sm font-bold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)]">
                  {item.n}
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#0B1F33]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── S6: DECISION INTELLIGENCE ───────────────────────────────────── */}
      <section className="border-y border-gray-200/60 bg-white px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Not data. Answers.</p>
          <h2 className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl" style={hl}>
            Make better decisions. Faster.
          </h2>

          <div className="mt-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
            {/* Left: Questions */}
            <div className="flex flex-col gap-3">
              {DI_QA.map((item) => (
                <div
                  key={item.q}
                  className="group rounded-2xl border border-gray-200/70 bg-[#F5F9FF] px-5 py-4 transition-colors hover:border-[#0A66C2]/30 hover:bg-[#EFF6FF]"
                >
                  <p className="text-sm font-semibold text-[#0B1F33]">&ldquo;{item.q}&rdquo;</p>
                </div>
              ))}
            </div>

            {/* Right: Answer cards */}
            <div className="flex flex-col gap-3">
              {DI_QA.map((item) => (
                <div
                  key={item.a}
                  className="rounded-2xl border border-[#0A66C2]/15 bg-gradient-to-r from-[#F0F7FF] to-white px-5 py-4 shadow-[0_2px_8px_rgba(10,102,194,0.06)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-[10px] font-bold text-white">
                      →
                    </div>
                    <p className="text-sm leading-relaxed text-[#0B1F33]">{item.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="mx-auto mt-12 max-w-xl text-center text-base text-[#6B7C93]">
            Omnivyra doesn&rsquo;t give you data.{' '}
            <span className="font-semibold text-[#0B1F33]">It gives you answers.</span>
          </p>
        </div>
      </section>

      {/* ── S7: TOOL FATIGUE ────────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Simplify everything</p>
          <h2 className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl" style={hl}>
            Replace your scattered tools
          </h2>

          <div className="mt-14 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Left: problem */}
            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#6B7C93]">Before Omnivyra</p>
              <div className="flex flex-col gap-2">
                {SCATTERED.map((tool) => (
                  <div
                    key={tool}
                    className="flex items-center gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-3 text-sm text-[#6B7C93]"
                  >
                    <span className="text-rose-400 text-base">✕</span>
                    {tool}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: solution */}
            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">After Omnivyra</p>
              <div
                className="rounded-2xl p-7 text-white"
                style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}
              >
                <p className="text-lg font-bold">One unified system</p>
                <ul className="mt-5 space-y-3 text-sm text-white/85">
                  {[
                    'Website & campaign audits',
                    'Content planning & generation',
                    'Campaign execution',
                    'Performance intelligence',
                    'Growth recommendations',
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <span className="text-[#3FA9F5] font-semibold">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <p className="mt-10 text-center text-sm font-semibold text-[#0B1F33]">
            Everything connected. Everything actionable.
          </p>
        </div>
      </section>

      {/* ── S8: PERSONA BLOCK ───────────────────────────────────────────── */}
      <section className="bg-[#0B1F33] px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <h2 className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl" style={hl}>
            Built for how real people work
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {PERSONAS.map((p) => (
              <div
                key={p.role}
                className="card-lift rounded-2xl border border-white/10 bg-white/[0.05] p-6"
              >
                {/* Avatar */}
                <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${p.color} text-base font-bold text-white shadow-lg`}>
                  {p.initials}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">{p.role}</p>
                <p className="mt-2 text-base font-semibold text-white">{p.quote}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{p.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FREE AUDIT STRIP ────────────────────────────────────────────── */}
      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <div className="rounded-2xl border border-gray-200/70 bg-white p-10 text-center shadow-[0_4px_24px_rgba(10,31,68,0.07)]">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Start free</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-3xl" style={hl}>
              Discover what&rsquo;s holding your website back
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-base text-[#6B7C93]">
              Run a free AI-powered website audit — get your score and a clear action plan in under 60 seconds.
            </p>
            <div className="mx-auto mt-8 max-w-xl">
              <FreeAuditInput placeholder="https://yourwebsite.com" buttonText="Run Free Audit" />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[#6B7C93]">
              <span className="flex items-center gap-1"><span className="text-emerald-500">✔</span> No credit card</span>
              <span className="flex items-center gap-1"><span className="text-emerald-500">✔</span> Under 60 seconds</span>
              <span className="flex items-center gap-1"><span className="text-emerald-500">✔</span> Instant results</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── S9: FINAL CTA ───────────────────────────────────────────────── */}
      <section
        className="px-6 py-20 lg:px-8"
        style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A66C2 100%)' }}
      >
        <div className="mx-auto max-w-[1280px] text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl" style={hl}>
            If you had clarity,<br className="hidden sm:block" /> what would you do differently?
          </h2>
          <p className="mt-5 text-lg text-white/65">Now you don&rsquo;t have to guess.</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/audit/website-growth-check"
              className="rounded-full bg-white px-8 py-4 text-base font-semibold text-[#0A66C2] shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition hover:shadow-[0_6px_28px_rgba(255,255,255,0.35)]"
            >
              Run a Free Audit
            </Link>
            <Link
              href="/features"
              className="rounded-full border-2 border-white/40 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
