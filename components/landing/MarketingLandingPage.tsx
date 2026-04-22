'use client';

import Link from 'next/link';
import Footer from './Footer';
import FreeAuditInput from '../FreeAuditInput';

export const LANDING_FAQS = [
  {
    question: 'What is marketing performance analytics?',
    answer:
      'Marketing performance analytics helps teams understand what is driving results across campaigns, channels, and content by analyzing metrics like conversions, engagement, and drop-offs.',
  },
  {
    question: 'How do you identify what to do next in marketing?',
    answer:
      'By analyzing performance trends, identifying bottlenecks such as drop-offs, and prioritizing actions that have the highest impact on conversions and growth.',
  },
  {
    question: 'How does OmniVyra help?',
    answer:
      'OmniVyra connects analytics with recommendations and execution, helping teams move from insights to prioritized actions without switching tools.',
  },
];

const OUTCOMES = [
  {
    title: 'Faster decision-making',
    body: 'Reduce time spent interpreting dashboards and debating priorities with a system that surfaces what needs attention first.',
  },
  {
    title: 'Better execution focus',
    body: 'Keep campaigns, content, and team effort aligned around the actions most likely to improve performance.',
  },
  {
    title: 'Clearer growth momentum',
    body: 'Track what changed, what was acted on, and which decisions are driving measurable progress.',
  },
];

const SYSTEM_POINTS = [
  'Marketing performance analytics across campaigns, channels, and content',
  'Funnel and conversion analysis to spot trends and drop-offs',
  'Prioritized recommendations tied to evidence',
  'Execution workflows that turn next steps into action',
];

const HOW_IT_WORKS = [
  {
    title: 'Capture marketing performance data',
    body: 'Bring together campaign, content, and channel performance so teams can work from a clear operating view.',
  },
  {
    title: 'Identify trends and drop-offs',
    body: 'Spot what is improving, stalling, or leaking across the funnel before small issues become missed revenue.',
  },
  {
    title: 'Prioritize next best actions',
    body: 'Focus on the highest-impact recommendations instead of reacting to disconnected metrics.',
  },
  {
    title: 'Execute and track outcomes',
    body: 'Move from insight to action, then measure what changed so teams can improve the next cycle.',
  },
];

export default function MarketingLandingPage() {
  return (
    <div className="min-h-screen bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <section
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 45%, #0A66C2 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full opacity-[0.15]"
            style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }}
          />
          <div
            className="absolute -bottom-20 right-0 h-80 w-80 rounded-full opacity-[0.08]"
            style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }}
          />
        </div>

        <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-28">
          <div className="text-center lg:text-left">
            <p className="mb-4 inline-block rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Analytics to action system
            </p>
            <h1
              className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl xl:text-[2.85rem]"
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
            >
              Marketing Performance Analytics and Action System
            </h1>
            <h2
              className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl xl:text-[3.25rem]"
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
            >
              See what is working, know what to do next, and move faster.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80 lg:mx-0">
              OmniVyra turns performance signals, campaign data, and market context into clear priorities your team can act on.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href="/features"
                data-ga-primary-cta
                data-ga-label="See OmniVyra in Action"
                data-ga-location="hero"
                className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.45)] transition hover:shadow-[0_6px_28px_rgba(10,102,194,0.6)] hover:opacity-95"
              >
                See OmniVyra in Action
              </Link>
              <Link
                href="/free-audit/start"
                className="rounded-full border-2 border-white/40 bg-white/10 px-7 py-3.5 text-[15px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                Analyze My Performance
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 px-4 lg:px-0">
            {[
              {
                label: 'Performance Alert',
                signal: 'Homepage drop-off is rising',
                detail: 'Visitors leave before reaching your primary CTA, reducing conversion potential.',
                textColor: 'text-amber-600',
                dot: 'bg-amber-400',
              },
              {
                label: 'Funnel Insight',
                signal: 'Paid traffic is stalling mid-funnel',
                detail: 'Conversion trends show strong clicks, but low handoff into qualified actions.',
                textColor: 'text-rose-500',
                dot: 'bg-rose-400',
              },
              {
                label: 'Next Best Action',
                signal: 'Shift focus to high-intent channel',
                detail: 'Organic and retargeting signals are outperforming broad top-of-funnel spend.',
                textColor: 'text-emerald-500',
                dot: 'bg-emerald-400',
              },
            ].map((card, index) => (
              <div
                key={card.label}
                className={`rounded-2xl border border-white/20 bg-white/95 p-4 backdrop-blur-md ${
                  index === 1 ? 'ml-8' : index === 2 ? 'ml-4' : ''
                }`}
                style={{ boxShadow: '0 4px 24px rgba(10,31,68,0.14), 0 1px 0 rgba(255,255,255,0.8) inset' }}
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
              Marketing performance, funnel behavior, conversion trends, and next best actions in one view.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#0B1F33] px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <h2
            className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            Most teams do not need more dashboards. They need direction.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: 'Too much signal, not enough priority',
                body: 'Teams can see metrics, but they still cannot tell which issue matters most right now.',
              },
              {
                title: 'Too many disconnected tools',
                body: 'Analytics, reporting, content planning, and execution live in separate places, which slows action down.',
              },
              {
                title: 'Too little confidence in what to do next',
                body: 'Without clear prioritization, teams spend more time interpreting data than improving outcomes.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.05] p-6">
                <h3 className="text-base font-semibold text-[#3FA9F5]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
            Analytics, recommendations, and action
          </p>
          <h2
            className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            OmniVyra connects marketing performance with next best actions.
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-center text-base leading-relaxed text-[#6B7C93]">
            OmniVyra analyzes marketing performance, funnel behavior, conversion trends, and drop-offs to identify what is changing and what needs attention. Then it turns those signals into prioritized recommendations and execution-ready next steps.
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {[
              {
                title: 'Analytics that explain performance',
                body: 'See what is rising, stalling, or underperforming across campaigns, channels, and content.',
              },
              {
                title: 'Recommendations with context',
                body: 'Get priorities tied to evidence instead of generic advice or disconnected reporting.',
              },
              {
                title: 'Actions teams can execute',
                body: 'Move from insight to campaigns, content, and follow-through without losing momentum.',
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-gray-200/70 bg-white p-6 shadow-[0_2px_12px_rgba(10,31,68,0.05)]"
              >
                <h3 className="text-[15px] font-semibold text-[#0B1F33]">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-gray-200/60 bg-white px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[960px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
            Answer engine content
          </p>
          <h2
            className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            Understanding marketing performance and next steps
          </h2>
          <div className="mt-12 space-y-6">
            {LANDING_FAQS.map((item) => (
              <div key={item.question} className="rounded-2xl border border-gray-200/70 bg-[#F5F9FF] p-6">
                <h3 className="text-lg font-semibold text-[#0B1F33]">{item.question}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#6B7C93]">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
            Structured workflow
          </p>
          <h2
            className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            How OmniVyra works
          </h2>
          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((item, index) => (
              <div key={item.title} className="relative rounded-2xl border border-gray-200/70 bg-white p-6 text-center shadow-[0_2px_12px_rgba(10,31,68,0.05)]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-sm font-bold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)]">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#0B1F33]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-[#6B7C93]">
            Learn more about{' '}
            <Link href="/marketing-performance-analytics" className="font-semibold text-[#0A66C2]">
              marketing performance analytics
            </Link>{' '}
            and{' '}
            <Link href="/funnel-and-conversion-analysis" className="font-semibold text-[#0A66C2]">
              funnel and conversion analysis
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-[#0B1F33] px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <h2
            className="text-center text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            What OmniVyra helps you improve
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {OUTCOMES.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/10 bg-white/[0.05] p-6"
              >
                <h3 className="text-base font-semibold text-[#3FA9F5]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
            System explanation
          </p>
          <h2
            className="text-center text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            A system built for analytics-driven execution
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-center text-base leading-relaxed text-[#6B7C93]">
            OmniVyra is not just a reporting layer. It is an analytics and action system that helps teams understand performance, generate next steps, and follow through.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {SYSTEM_POINTS.map((point) => (
              <div
                key={point}
                className="flex items-start gap-3 rounded-2xl border border-gray-200/70 bg-white p-5 shadow-[0_2px_12px_rgba(10,31,68,0.05)]"
              >
                <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-[10px] font-bold text-white">
                  +
                </div>
                <p className="text-sm leading-relaxed text-[#0B1F33]">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 lg:px-8" style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A66C2 100%)' }}>
        <div className="mx-auto max-w-[960px] text-center">
          <h2
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
            style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
          >
            If your team had clearer priorities, what would move faster?
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/70">
            Use OmniVyra to turn analytics into action and action into measurable progress.
          </p>
          <div className="mx-auto mt-8 max-w-xl">
            <FreeAuditInput placeholder="https://yourwebsite.com" buttonText="Analyze My Performance" />
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/features"
              className="rounded-full bg-white px-8 py-4 text-base font-semibold text-[#0A66C2] shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition hover:shadow-[0_6px_28px_rgba(255,255,255,0.35)]"
            >
              Book a Demo
            </Link>
            <Link
              href="/free-audit/start"
              className="rounded-full border-2 border-white/40 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              Analyze My Performance
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
