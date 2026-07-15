/** Part 2/2 of MarketingLandingPage.tsx — verbatim split (barrel preserved; importers unchanged). */
'use client';

import Link from 'next/link';
import { BarChart3, Home, LayoutGrid, Target } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { BLUE_FIELD, SNAPSHOT_DIMENSIONS, EXCLUSIONS, SNAPSHOT_OUTPUTS, HERO_RAIL, ACTIVE_INTELLIGENCE, EVOLUTION, OPERATING_LAYERS, OMNIVYRA_SYNTHESIS, OperationalContinuityField, HeroSignalField, OperationalConsequence, CinematicFooter, PrimaryCta, ArchitectureMap, SectionShell } from './MarketingLandingPageSections';

function DiscoverabilityEcosystem() {
  const left = SNAPSHOT_DIMENSIONS.slice(0, 2);
  const right = SNAPSHOT_DIMENSIONS.slice(2);

  return (
    <div className="relative mt-12 overflow-hidden rounded-[30px] border border-[#C9DDF3] bg-white/[0.82] p-5 shadow-[0_24px_58px_rgba(10,31,68,0.10)] backdrop-blur lg:p-8">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 omnivyra-light-grid opacity-55" />
        <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1040 520" preserveAspectRatio="none">
          <path
            d="M120 140 C 280 80, 390 190, 520 170 S 760 90, 930 210"
            fill="none"
            stroke="rgba(10,102,194,0.12)"
            strokeWidth="1.2"
            strokeDasharray="4 18"
            className="landing-signal-drift"
          />
          <path
            d="M120 370 C 285 300, 390 420, 520 345 S 755 275, 920 360"
            fill="none"
            stroke="rgba(63,169,245,0.12)"
            strokeWidth="1.2"
            strokeDasharray="3 16"
            className="landing-signal-drift-slow"
          />
          <path
            d="M280 255 C 380 205, 465 255, 520 255 S 665 305, 770 250"
            fill="none"
            stroke="rgba(10,102,194,0.16)"
            strokeWidth="1.3"
            className="landing-signal-breathe"
          />
          <path
            d="M160 176 C 312 185, 390 252, 520 260 S 727 330, 884 342"
            fill="none"
            stroke="rgba(10,102,194,0.10)"
            strokeWidth="1"
            strokeDasharray="2 14"
            className="landing-signal-drift"
          />
          <path
            d="M170 344 C 330 318, 396 260, 520 260 S 706 192, 878 178"
            fill="none"
            stroke="rgba(63,169,245,0.11)"
            strokeWidth="1"
            strokeDasharray="2 14"
            className="landing-signal-drift-slow"
          />
        </svg>
      </div>

      <div className="relative grid gap-5 lg:grid-cols-[1fr_0.82fr_1fr] lg:items-center">
        <div className="grid gap-4">
          {left.map((item, index) => (
            <DiscoverabilityNode key={item.title} item={item} index={index} align="left" />
          ))}
        </div>

        <div className="relative mx-auto flex min-h-[260px] w-full max-w-[320px] items-center justify-center">
          <div className="absolute h-60 w-60 rounded-full border border-[#0A66C2]/15 bg-[#EBF3FD]/70 shadow-[inset_0_0_42px_rgba(10,102,194,0.08)] landing-node-drift" />
          <div
            className="landing-node-drift absolute h-44 w-44 rounded-full border border-[#3FA9F5]/25"
            style={{ '--node-duration': '13s', '--node-delay': '-1.5s' } as CSSProperties}
          />
          <div className="relative grid h-36 w-36 place-items-center rounded-full border border-[#AFCBEA] bg-white text-center shadow-[0_22px_48px_rgba(10,31,68,0.14)]">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#0A66C2]">Synthesis</p>
              <p className="mt-2 text-sm font-black leading-5 text-[#071D3A]">Discoverability intelligence</p>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 h-10 w-px -translate-x-1/2 bg-gradient-to-b from-[#0A66C2]/20 to-transparent" />
        </div>

        <div className="grid gap-4">
          {right.map((item, index) => (
            <DiscoverabilityNode key={item.title} item={item} index={index + 2} align="right" />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiscoverabilityNode({
  item,
  index,
  align,
}: {
  item: (typeof SNAPSHOT_DIMENSIONS)[number];
  index: number;
  align: 'left' | 'right';
}) {
  const active = index === 1 || index === 2;
  return (
    <div
      className={`landing-node-drift relative overflow-hidden rounded-2xl border p-5 shadow-[0_16px_34px_rgba(10,31,68,0.08)] transition duration-300 hover:-translate-y-1 ${
        active
          ? 'border-[#0A66C2]/70 bg-gradient-to-br from-[#0A66C2] to-[#0A3A7A] text-white'
          : 'border-[#C9DDF3] bg-white text-[#0B1F33]'
      } ${align === 'right' ? 'lg:translate-y-7' : ''}`}
      style={{ '--node-duration': `${10 + index * 1.4}s`, '--node-delay': `${index * -0.8}s` } as CSSProperties}
    >
      <div className={`absolute inset-y-0 ${align === 'left' ? 'right-0' : 'left-0'} w-px bg-gradient-to-b from-transparent ${active ? 'via-white/35' : 'via-[#0A66C2]/20'} to-transparent`} />
      <div className="flex items-center gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black ${
            active ? 'bg-white text-[#0A66C2]' : 'bg-[#EBF3FD] text-[#0A66C2]'
          }`}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className={`text-lg font-semibold ${active ? 'text-white' : 'text-[#0A3A7A]'}`}>{item.title}</h3>
      </div>
      <p className={`mt-3 text-sm leading-7 ${active ? 'text-[#DDF1FF]' : 'text-[#5D6F83]'}`}>{item.body}</p>
    </div>
  );
}

function OperationalSynthesisFlow() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/[0.20] bg-white/[0.10] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.18)] backdrop-blur lg:p-6">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 omnivyra-dark-grid opacity-25" />
        <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 760 620" preserveAspectRatio="none">
          <path
            d="M84 132 C 210 84, 315 186, 380 162 S 556 92, 676 174"
            fill="none"
            stroke="rgba(169,218,255,0.16)"
            strokeWidth="1"
            strokeDasharray="4 18"
            className="landing-signal-drift"
          />
          <path
            d="M98 492 C 232 402, 334 524, 440 438 S 586 384, 676 474"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="1"
            className="landing-signal-breathe"
          />
          <path
            d="M208 300 C 302 242, 440 238, 548 300"
            fill="none"
            stroke="rgba(63,169,245,0.18)"
            strokeWidth="1.2"
            strokeDasharray="3 14"
            className="landing-signal-drift-slow"
          />
          <path
            d="M148 118 C 246 196, 248 266, 345 308 S 515 352, 635 240"
            fill="none"
            stroke="rgba(169,218,255,0.16)"
            strokeWidth="1"
            strokeDasharray="2 16"
            className="landing-signal-drift"
          />
          <path
            d="M626 414 C 488 498, 342 460, 236 384 S 136 256, 226 188"
            fill="none"
            stroke="rgba(255,255,255,0.075)"
            strokeWidth="1"
            className="landing-signal-breathe"
          />
        </svg>
      </div>

      <div className="relative grid gap-5 xl:grid-cols-[0.9fr_0.72fr] xl:items-stretch">
        <div className="relative space-y-3">
          <div className="pointer-events-none absolute bottom-8 left-5 top-8 w-px bg-gradient-to-b from-transparent via-[#A9DAFF]/35 to-transparent" />
          {OPERATING_LAYERS.map((item, index) => (
            <div
              key={item.tool}
              className={`landing-node-drift relative overflow-hidden rounded-[22px] border border-white/[0.10] bg-white/[0.065] py-4 pl-12 pr-4 shadow-[0_14px_34px_rgba(0,0,0,0.08)] ${
                index % 2 === 0 ? 'sm:mr-[8%]' : 'sm:ml-[8%]'
              }`}
              style={{ '--node-duration': `${11 + index}s`, '--node-delay': `${index * -0.7}s` } as CSSProperties}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#A9DAFF]/45 to-transparent" />
              <span className="absolute left-[15px] top-5 h-3 w-3 rounded-full border border-[#A9DAFF]/50 bg-[#A9DAFF]/45 shadow-[0_0_20px_rgba(169,218,255,0.24)]" />
              <div>
                <p className="text-sm font-semibold text-[#EFF8FF]">{item.tool}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#A9DAFF]/75">{item.layer}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#DDF1FF]">{item.focus}</p>
            </div>
          ))}
        </div>

        <div className="relative flex min-h-[340px] flex-col justify-between overflow-hidden rounded-2xl border border-[#A9DAFF]/[0.40] bg-[#A9DAFF]/[0.12] p-5 shadow-[0_22px_54px_rgba(10,102,194,0.18)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
          <div className="absolute -right-24 top-10 h-56 w-56 rounded-full bg-[#3FA9F5]/[0.12] blur-3xl" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF]">Live synthesis</p>
            <h3 className="mt-3 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
              {OMNIVYRA_SYNTHESIS.title}
            </h3>
            <p className="mt-4 text-sm leading-7 text-[#F4FBFF]">{OMNIVYRA_SYNTHESIS.body}</p>
          </div>
          <div className="mt-6 space-y-3">
            {OMNIVYRA_SYNTHESIS.points.map((point, index) => (
              <div key={point} className="flex items-center gap-3 rounded-xl border border-[#A9DAFF]/[0.28] bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white">
                <span className="h-2 w-2 rounded-full bg-[#A9DAFF]" style={{ opacity: 0.55 + index * 0.14 }} />
                {point}
              </div>
            ))}
          </div>
          <div className="mt-7 rounded-2xl border border-white/[0.14] bg-[#06182F]/25 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A9DAFF]">Continuous loop</p>
            <p className="mt-2 text-sm leading-7 text-[#DDF1FF]">
              Reporting informs intelligence. Intelligence guides execution. Execution changes discoverability. New
              signals refine the next recommendation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketingLandingPage() {
  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-[#F5F9FF]" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
      <OperationalContinuityField />
      <section
        className="relative z-10 overflow-hidden"
        style={{ background: BLUE_FIELD }}
      >
        <HeroSignalField />

        <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-6 px-6 pb-8 pt-10 lg:min-h-[520px] lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:pb-8 lg:pt-8 xl:gap-8 2xl:min-h-[580px]">
          <div className="text-center lg:text-left">
            <p className="landing-reveal mb-4 inline-flex rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#A9DAFF]">
              Active Intelligence for AI-era marketing
            </p>
            <h1
              className="landing-reveal landing-delay-1 text-4xl font-bold leading-[1.04] tracking-tight text-white sm:text-5xl lg:text-[2.75rem] xl:text-[2.95rem] 2xl:text-[3.18rem]"
              style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}
            >
              Fragmented marketing systems limit AI capabilities.
            </h1>
            <p className="landing-reveal landing-delay-2 mx-auto mt-5 max-w-2xl text-base leading-7 text-white/80 lg:mx-0 2xl:text-lg">
              Replace them with one connected intelligent operational system that measures digital authority, connects
              campaigns, content, market signals, recommendations, and execution, then evolves into Active Intelligence.
            </p>
            <div className="landing-reveal landing-delay-3 mx-auto mt-7 max-w-2xl lg:mx-0">
              <PrimaryCta />
              <p className="mt-3 text-sm leading-6 text-white/65">
                Create an account, complete your company profile, then request the free Digital Authority Snapshot
                inside Omnivyra.
              </p>
            </div>
          </div>

          <div className="hidden lg:block">
            <ArchitectureMap />
          </div>
        </div>

      </section>

      <section className="relative z-20 hidden bg-[#F5F9FF] px-6 lg:block lg:px-8">
        <div className="mx-auto -mt-8 max-w-[1280px]">
          <div className="grid gap-3 rounded-2xl border border-[#C9DDF3] bg-white/[0.86] p-3 shadow-[0_24px_60px_rgba(10,31,68,0.18)] backdrop-blur md:grid-cols-3">
            {HERO_RAIL.map(([step, title, body]) => (
              <div key={step} className="rounded-xl border border-[#D8E3F0] bg-[#F7FBFF] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0A66C2] text-xs font-bold text-white">
                    {step}
                  </span>
                  <p className="text-sm font-semibold text-[#0A3A7A]">{title}</p>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#5D6F83]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#F5F9FF] px-6 py-8 lg:hidden">
        <div className="mx-auto max-w-3xl">
          <ArchitectureMap />
        </div>
      </section>

      <OperationalConsequence />

      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">The visibility shift</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
              Visibility is no longer just SEO.
            </h2>
          </div>
          <div className="space-y-5 text-base leading-8 text-[#4E6175]">
            <p>
              Modern discoverability is shaped by search engines, answer engines, generative engines, AI assistants,
              authority signals, entity clarity, content depth, platform presence, and competitive positioning.
            </p>
            <p>
              Omnivyra starts by measuring how your brand is discovered, interpreted, trusted, and compared. As your
              systems connect, that intelligence becomes operationally grounded and execution-aware.
            </p>
          </div>
        </div>
      </SectionShell>

      <SectionShell dark>
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full border border-white/[0.20] bg-white/[0.10] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF] shadow-sm">
            Free Digital Authority Snapshot
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
            Start with a public Digital Authority Snapshot.
          </h2>
          <p className="mt-5 text-base leading-8 text-[#DDF1FF]">
            The free report analyzes public signals only: SEO readiness, AEO readiness, GEO readiness, AI visibility,
            authority, content depth, score drivers, competitive positioning, social platform fit, action priorities,
            and confidence coverage.
          </p>
        </div>

        <div className="relative mt-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          <div className="grid gap-4 sm:grid-cols-2">
            {SNAPSHOT_OUTPUTS.map((item, index) => (
              <div
                key={item.title}
                className={`relative flex flex-col overflow-hidden rounded-2xl border p-5 shadow-[0_20px_44px_rgba(10,31,68,0.16)] backdrop-blur ${
                  index === 0
                    ? 'min-h-[236px] border-[#A9DAFF]/45 bg-white/[0.18] sm:col-span-2'
                    : 'min-h-[168px] border-white/[0.16] bg-white/[0.10]'
                }`}
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#A9DAFF]/70 to-transparent" />
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-[#0A66C2] shadow-[0_10px_22px_rgba(0,0,0,0.12)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={`${index === 0 ? 'mt-6 text-2xl' : 'mt-4 text-base'} font-semibold text-white`}>
                  {item.title}
                </h3>
                <p className={`${index === 0 ? 'mt-3 max-w-xl text-base' : 'mt-2 text-sm'} leading-7 text-[#DDF1FF]`}>
                  {item.body}
                </p>
                {index === 0 && (
                  <div className="mt-auto pt-6">
                    <div className="h-px w-full bg-gradient-to-r from-[#A9DAFF]/45 via-white/20 to-transparent" />
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF]">
                      Public evidence becomes the first operating baseline.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="relative flex h-full flex-col overflow-hidden rounded-[24px] border border-white/[0.35] bg-white p-6 shadow-[0_22px_54px_rgba(10,31,68,0.18)] lg:p-8">
            <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-[#AFCBEA] via-[#DDF1FF] to-[#0A66C2]" />
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="inline-flex w-fit rounded-full bg-[#EBF3FD] px-3 py-1 text-sm font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">
                Not in the free public snapshot
              </p>
              <span className="w-fit rounded-full border border-[#C9DDF3] bg-white px-3 py-1 text-xs font-semibold text-[#4E6175]">
                Unlocks later
              </span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {EXCLUSIONS.map((item) => (
                <div key={item} className="rounded-xl border border-[#C9DDF3] bg-[#F7FBFF] px-4 py-3 text-sm font-semibold text-[#4E6175] shadow-[0_10px_20px_rgba(10,31,68,0.06)]">
                {item}
              </div>
              ))}
            </div>
            <p className="mt-6 rounded-2xl px-5 py-4 text-sm font-semibold leading-7 text-white shadow-[0_16px_34px_rgba(10,102,194,0.22)]" style={{ background: 'linear-gradient(150deg, #0A3A7A 0%, #0A66C2 100%)' }}>
              These become available later through connected systems, advanced reports, and operational Active
              Intelligence inside Omnivyra.
            </p>
            <div className="mt-auto pt-6">
              <div className="rounded-2xl border border-[#C9DDF3] bg-[#F7FBFF] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0A66C2]">Why the boundary matters</p>
                <p className="mt-2 text-sm leading-7 text-[#4E6175]">
                  The snapshot stays truthful by using public evidence first. Connected systems make the next reports
                  deeper, more precise, and more operational.
                </p>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full border border-[#0A66C2]/20 bg-[#EBF3FD] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">
            Intelligence dimensions
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
            Omnivyra reads the layers that shape AI-era discoverability.
          </h2>
        </div>
        <DiscoverabilityEcosystem />
      </SectionShell>

      <SectionShell dark>
        <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF]">Active Intelligence</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
              Reports observe. Active Intelligence guides action.
            </h2>
            <p className="mt-5 text-base leading-8 text-[#DDF1FF]">
              Omnivyra generates intelligence from connected marketing operations, not only from isolated dashboards.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.18] bg-white/[0.10] p-5 shadow-[0_22px_54px_rgba(10,31,68,0.18)] backdrop-blur">
            <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-55" viewBox="0 0 760 430" preserveAspectRatio="none">
              <path d="M70 90 C 180 70, 260 150, 360 130 S 520 78, 690 160" fill="none" stroke="rgba(169,218,255,0.20)" strokeWidth="1" strokeDasharray="4 18" className="landing-signal-drift" />
              <path d="M70 330 C 220 250, 340 350, 470 280 S 590 235, 700 305" fill="none" stroke="rgba(255,255,255,0.11)" strokeWidth="1" className="landing-signal-breathe" />
              <path d="M286 98 C 355 160, 402 210, 492 218 S 628 198, 700 260" fill="none" stroke="rgba(169,218,255,0.14)" strokeWidth="1" strokeDasharray="2 15" className="landing-signal-drift-slow" />
            </svg>
            <div className="relative grid gap-5 md:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-2xl border border-white/[0.10] bg-[#06182F]/38 p-5 opacity-90">
                <p className="text-sm font-semibold text-white">{ACTIVE_INTELLIGENCE[0].mode}</p>
                <p className="mt-2 text-sm leading-7 text-[#DDF1FF]">{ACTIVE_INTELLIGENCE[0].body}</p>
                <div className="mt-5 space-y-2">
                  {ACTIVE_INTELLIGENCE[0].items.map((item) => (
                    <div key={item} className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm font-semibold text-[#BFD8EE]/80">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-[#A9DAFF]/[0.35] bg-white/[0.15] p-5">
                <div className="absolute bottom-5 left-5 top-5 w-px bg-gradient-to-b from-transparent via-[#A9DAFF]/45 to-transparent" />
                <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-[#3FA9F5]/[0.12] blur-3xl" />
                <p className="text-sm font-semibold text-white">{ACTIVE_INTELLIGENCE[1].mode}</p>
                <p className="mt-2 text-sm leading-7 text-[#F4FBFF]">{ACTIVE_INTELLIGENCE[1].body}</p>
                <div className="mt-5 space-y-3">
                  {ACTIVE_INTELLIGENCE[1].items.map((item, index) => (
                    <div
                      key={item}
                      className="landing-node-drift ml-5 flex items-center gap-3 rounded-xl border border-[#A9DAFF]/[0.28] bg-[#A9DAFF]/[0.10] px-4 py-3 text-sm font-semibold text-white"
                      style={{ '--node-duration': `${10 + index}s`, '--node-delay': `${index * -0.9}s` } as CSSProperties}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#A9DAFF]" style={{ opacity: 0.55 + index * 0.1 }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
          <div className="flex flex-col justify-between rounded-[28px] border border-[#C9DDF3] bg-white p-7 shadow-[0_18px_42px_rgba(10,31,68,0.08)]">
            <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">Progression</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
              The snapshot creates the baseline. Context makes it operational.
            </h2>
            <p className="mt-5 text-base leading-8 text-[#5D6F83]">
              Users begin with public authority intelligence, then unlock richer context as workflows, publishing,
              campaigns, engagement, and analytics connect.
            </p>
            </div>
            <div className="mt-8 rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF] p-5">
              <p className="text-sm font-semibold text-[#0A3A7A]">The strategic pattern</p>
              <p className="mt-2 text-sm leading-7 text-[#5D6F83]">
                Public evidence establishes the baseline. Operational context explains what is moving, what is stalled,
                and what deserves attention next.
              </p>
            </div>
          </div>
          <div className="relative grid gap-4">
            <div className="pointer-events-none absolute bottom-8 left-5 top-8 hidden w-px bg-gradient-to-b from-[#0A66C2]/10 via-[#0A66C2]/28 to-[#0A66C2]/10 sm:block" />
            {EVOLUTION.map((item) => (
              <div key={item.stage} className="landing-node-drift relative rounded-2xl border border-[#D8E3F0] bg-white p-5 shadow-[0_14px_30px_rgba(10,31,68,0.06)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2] text-sm font-bold text-white">
                    {item.stage}
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">{item.label}</p>
                    <h3 className="mt-1 text-lg font-semibold text-[#0B1F33]">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-[#5D6F83]">{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionShell>

      <SectionShell dark>
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch">
          <div className="flex flex-col justify-between">
            <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF]">Operational system</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
              Marketing work starts moving as one system.
            </h2>
            <p className="mt-5 text-base leading-8 text-[#DDF1FF]">
              Visibility reporting, campaign building, content creation, intelligence, and recommendations stop behaving
              like separate workstreams and begin forming shared operating context.
            </p>
            </div>
            <div className="mt-8 rounded-2xl border border-white/[0.14] bg-white/[0.08] p-5">
              <p className="text-sm font-semibold text-white">Why it matters</p>
              <p className="mt-2 text-sm leading-7 text-[#DDF1FF]">
                Most tools stop at one workflow. Omnivyra connects the operating context so intelligence can guide what
                teams do next.
              </p>
            </div>
          </div>
          <OperationalSynthesisFlow />
        </div>
      </SectionShell>

      <section className="relative z-10 bg-[#F5F9FF] px-6 py-20 lg:px-8">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 omnivyra-light-grid opacity-60" />
          <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 1200 420" preserveAspectRatio="none">
            <path
              d="M80 160 C 250 90, 430 170, 590 150 S 880 95, 1120 190"
              fill="none"
              stroke="rgba(10,102,194,0.08)"
              strokeWidth="1.4"
            />
            <path
              d="M110 250 C 320 200, 470 270, 650 230 S 920 185, 1080 260"
              fill="none"
              stroke="rgba(63,169,245,0.07)"
              strokeWidth="1.4"
            />
          </svg>
        </div>
        <div className="relative mx-auto max-w-[980px] text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A66C2]">Start with authority</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "var(--font-poppins), var(--font-inter), sans-serif" }}>
            Start where intelligence can become operational.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#5D6F83]">
            Create an account, complete your company profile, and request your free Digital Authority Snapshot inside
            Omnivyra. From there, the first public signal layer can begin evolving into connected marketing context.
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryCta variant="dark" />
          </div>
        </div>
      </section>

      <CinematicFooter />
      <style jsx global>{`
        @keyframes landingSignalDrift {
          0%,
          100% {
            stroke-dashoffset: 0;
            opacity: 0.58;
          }
          50% {
            stroke-dashoffset: -42;
            opacity: 0.92;
          }
        }

        @keyframes landingSignalBreathe {
          0%,
          100% {
            opacity: 0.32;
          }
          50% {
            opacity: 0.68;
          }
        }

        @keyframes landingBarRise {
          0%,
          100% {
            transform: scaleY(0.86);
          }
          50% {
            transform: scaleY(1);
          }
        }

        @keyframes landingNodeDrift {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -5px, 0);
          }
        }

        .landing-signal-drift {
          animation: landingSignalDrift 12s ease-in-out infinite;
        }

        .landing-signal-drift-slow {
          animation: landingSignalDrift 16s ease-in-out infinite reverse;
        }

        .landing-signal-breathe {
          animation: landingSignalBreathe 9s ease-in-out infinite;
        }

        .landing-bar-rise {
          transform-origin: bottom;
          animation: landingBarRise 8s ease-in-out var(--bar-delay, 0s) infinite;
        }

        .landing-node-drift {
          animation: landingNodeDrift var(--node-duration, 11s) ease-in-out var(--node-delay, 0s) infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-signal-drift,
          .landing-signal-drift-slow,
          .landing-signal-breathe,
          .landing-bar-rise,
          .landing-node-drift {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

