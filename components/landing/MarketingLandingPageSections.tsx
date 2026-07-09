/** Part 1/2 of MarketingLandingPage.tsx — verbatim split (barrel preserved; importers unchanged). */
'use client';

import Link from 'next/link';
import { BarChart3, Home, LayoutGrid, Target } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';


export const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';
const CENTERPIECE_FIELD = 'linear-gradient(160deg, #06182F 0%, #082B55 58%, #0A4F94 100%)';

export const LANDING_FAQS = [
  {
    question: 'What does the free Digital Authority Snapshot analyze?',
    answer:
      'The free report analyzes public digital authority signals such as SEO readiness, AEO readiness, GEO readiness, AI visibility readiness, authority signals, content depth, social presence, platform presence, competitive visibility positioning, score drivers, action priorities, and confidence coverage.',
  },
  {
    question: 'What does the free report not include?',
    answer:
      'The free snapshot does not include Google Analytics, funnel drop-offs, attribution analytics, behavioral telemetry, private engagement metrics, or conversion analytics. Those unlock later through connected systems and advanced reports.',
  },
  {
    question: 'How does Omnivyra become more powerful over time?',
    answer:
      'The Digital Authority Snapshot is the first intelligence layer. As users complete their company profile and connect marketing systems, Omnivyra evolves into Active Intelligence across campaigns, content, engagement, market context, recommendations, and execution.',
  },
];

export const SNAPSHOT_DIMENSIONS = [
  {
    title: 'Search visibility',
    body: 'SEO readiness, site structure, search coverage, keyword capture, and discoverability signals.',
  },
  {
    title: 'Answer engine readiness',
    body: 'AEO readiness, direct-answer structure, FAQ coverage, and extraction-friendly page hierarchy.',
  },
  {
    title: 'Generative visibility',
    body: 'GEO readiness, entity clarity, AI interpretation signals, topical depth, and brand retrievability.',
  },
  {
    title: 'Digital authority',
    body: 'Authority gaps, proof signals, competitor pressure, platform presence, and trust-building priorities.',
  },
];

export const EXCLUSIONS = [
  'Google Analytics',
  'Funnel drop-offs',
  'Attribution analytics',
  'Behavioral telemetry',
  'Private engagement metrics',
  'Conversion analytics',
];

export const SNAPSHOT_OUTPUTS = [
  {
    title: 'Executive score context',
    body: 'Overall snapshot, digital authority score, score drivers, confidence level, and strategic position.',
  },
  {
    title: 'Competitive landscape',
    body: 'Competitor pressure, authority gaps, market standing, keyword gaps, and visibility positioning.',
  },
  {
    title: 'Action priorities',
    body: 'What is broken, what to fix first, what to delay, and the moves most likely to improve trajectory.',
  },
  {
    title: 'Growth roadmap',
    body: 'Social platform recommendations, growth trajectory, confidence coverage, and deeper report unlocks.',
  },
];

export const HERO_RAIL = [
  ['01', 'Public authority baseline', 'SEO, AEO, GEO, authority, competition, and content depth.'],
  ['02', 'Connected operational context', 'Campaigns, content, publishing, analytics, and engagement systems.'],
  ['03', 'Active Intelligence', 'Recommendations, next-best actions, execution, and optimization loops.'],
];

export const ACTIVE_INTELLIGENCE = [
  {
    mode: 'Passive intelligence',
    body: 'Useful, but disconnected from the operating reality of the marketing team.',
    items: ['Static reports', 'Isolated analytics', 'Disconnected metrics', 'Manual interpretation'],
  },
  {
    mode: 'Active Intelligence',
    body: 'Generated from connected marketing operations, so recommendations understand context and execution.',
    items: ['Workflow-aware systems', 'Execution-aware insights', 'Evolving recommendations', 'Next-best actions'],
  },
];

export const EVOLUTION = [
  {
    stage: '01',
    title: 'Free Digital Authority Snapshot',
    label: 'Public intelligence layer',
    body: 'A first view of public visibility, authority, content depth, competitor pressure, score drivers, and action priorities.',
  },
  {
    stage: '02',
    title: 'Connected Intelligence',
    label: 'Integrated context',
    body: 'Analytics, campaigns, content, engagement, publishing, and market systems add richer operational context.',
  },
  {
    stage: '03',
    title: 'Operational Active Intelligence',
    label: 'Guided action',
    body: 'Recommendations become workflow-aware, campaign-aware, content-aware, and tied to what teams can execute next.',
  },
  {
    stage: '04',
    title: 'Marketing Operating Layer',
    label: 'Execution system',
    body: 'Omnivyra helps teams plan, create, publish, measure, and improve through one connected operating layer.',
  },
];

export const OPERATING_LAYERS = [
  {
    tool: 'Visibility reporting',
    focus: 'SEO, AEO, GEO, AI visibility, content depth, authority, and competitive discoverability.',
    layer: 'Digital authority',
  },
  {
    tool: 'Campaign building',
    focus: 'Plan campaigns, shape campaign structure, create content, schedule publishing, and move toward posting.',
    layer: 'Campaign operations',
  },
  {
    tool: 'Content creation',
    focus: 'Create text-led content and creator-led assets such as images, banners, visual concepts, and campaign variants.',
    layer: 'Creative workflow',
  },
  {
    tool: 'Intelligence',
    focus: 'Market Pulse, competitor activity, analytics, reports, engagement signals, confidence coverage, and guided next actions.',
    layer: 'Decision intelligence',
  },
];

export const OMNIVYRA_SYNTHESIS = {
  title: 'Omnivyra',
  body: 'A connected Active Intelligence platform that turns reporting, campaigns, content, market context, analytics, and recommendations into guided execution.',
  points: ['Operating intelligence', 'Workflow-aware guidance', 'Execution-ready next actions'],
};

const HERO_NAV_ITEMS = [
  { label: 'Overview', icon: Home },
  { label: 'Signals', icon: LayoutGrid },
  { label: 'Movement', icon: BarChart3 },
  { label: 'Priorities', icon: Target },
];

const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '/features' },
      { label: 'Solutions', href: '/solutions' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Blog', href: '/blog' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Data Deletion Instructions', href: '/data-deletion' },
    ],
  },
];

export function OperationalContinuityField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-45" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(10,102,194,0.05),transparent_26%),radial-gradient(circle_at_86%_80%,rgba(63,169,245,0.05),transparent_30%)]" />
      <svg className="h-full w-full" viewBox="0 0 1400 1000" preserveAspectRatio="none">
        <path
          d="M80 220 C 280 120, 430 260, 620 220 S 920 140, 1260 270"
          fill="none"
          stroke="rgba(10,102,194,0.055)"
          strokeWidth="1.4"
          strokeDasharray="3 20"
          className="landing-signal-drift-slow"
        />
        <path
          d="M120 790 C 330 640, 520 760, 720 660 S 1010 560, 1300 720"
          fill="none"
          stroke="rgba(63,169,245,0.05)"
          strokeWidth="1.4"
          className="landing-signal-breathe"
        />
      </svg>
    </div>
  );
}

export function HeroSignalField() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 omnivyra-dark-grid opacity-35" />
      <div
        className="absolute -top-32 left-1/3 h-[420px] w-[420px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1400 780" preserveAspectRatio="none">
        <path
          d="M90 180 C 260 110, 390 250, 560 210 S 830 120, 1080 250 S 1260 360, 1340 260"
          fill="none"
          stroke="rgba(169,218,255,0.16)"
          strokeWidth="1"
          strokeDasharray="4 18"
          className="landing-signal-drift"
        />
        <path
          d="M140 580 C 340 450, 520 620, 700 500 S 980 430, 1290 540"
          fill="none"
          stroke="rgba(63,169,245,0.16)"
          strokeWidth="1"
          strokeDasharray="2 18"
          className="landing-signal-drift-slow"
        />
        <path
          d="M340 150 C 420 300, 520 360, 730 340 S 1030 270, 1210 430"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
          className="landing-signal-breathe"
        />
      </svg>
    </div>
  );
}

export function OperationalConsequence() {
  return (
    <section className="relative z-10 overflow-hidden px-6 py-28 text-white sm:py-36 lg:px-8" style={{ background: CENTERPIECE_FIELD }}>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 omnivyra-dark-grid opacity-15" />
        <svg className="absolute inset-0 h-full w-full opacity-24" viewBox="0 0 1200 520" preserveAspectRatio="none">
          <path
            d="M80 150 C 250 90, 390 220, 520 180 S 760 80, 920 210 S 1080 320, 1160 220"
            fill="none"
            stroke="rgba(169,218,255,0.10)"
            strokeWidth="1"
            strokeDasharray="3 22"
            className="landing-signal-breathe"
          />
          <path
            d="M70 370 C 260 270, 410 410, 600 300 S 850 240, 1120 350"
            fill="none"
            stroke="rgba(255,255,255,0.055)"
            strokeWidth="1"
          />
        </svg>
      </div>
      <div className="relative mx-auto max-w-[980px]">
        <div className="space-y-7">
          <p className="max-w-[900px] text-[1.78rem] font-black leading-[1.08] tracking-tight sm:text-[2.9rem] lg:text-[3.2rem]" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
            AI visibility expanded across search, answer engines, AI assistants, and generative systems.
          </p>
          <p className="max-w-[900px] pl-0 text-[1.78rem] font-black leading-[1.08] tracking-tight text-[#A9DAFF]/90 sm:pl-12 sm:text-[2.9rem] lg:text-[3.2rem]" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
            Marketing operations became harder to understand coherently.
          </p>
        </div>
      </div>
    </section>
  );
}

export function CinematicFooter() {
  return (
    <footer className="relative z-10 overflow-hidden bg-[#F5F9FF] px-6 pb-10 pt-16 lg:px-8">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 omnivyra-light-grid opacity-60" />
        <div className="absolute left-1/2 top-0 h-40 w-[80%] -translate-x-1/2 bg-gradient-to-b from-[#0A66C2]/[0.055] to-transparent blur-2xl" />
        <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 1200 420" preserveAspectRatio="none">
          <path
            d="M80 160 C 250 90, 430 170, 590 150 S 880 95, 1120 190"
            fill="none"
            stroke="rgba(10,102,194,0.08)"
            strokeWidth="1.4"
            className="landing-signal-breathe"
          />
          <path
            d="M110 250 C 320 200, 470 270, 650 230 S 920 185, 1080 260"
            fill="none"
            stroke="rgba(63,169,245,0.07)"
            strokeWidth="1.4"
            className="landing-signal-drift-slow"
          />
        </svg>
      </div>
      <div className="relative mx-auto max-w-[1180px] pt-10">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9DDF3]/65 to-transparent" />
        <div className="mt-12 grid gap-12 lg:grid-cols-[1.22fr_1fr] lg:items-start">
          <div>
            <Link href="/" aria-label="Omnivyra home" className="inline-flex">
              <img src="/logo.png" alt="Omnivyra" className="h-12 w-auto object-contain" />
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[#5D6F83]">
              Connected intelligence for AI-era visibility and marketing operations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#071D3A]">{column.heading}</p>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-[#5D6F83] transition hover:text-[#0A66C2]">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 h-px w-full bg-gradient-to-r from-transparent via-[#D8E3F0]/70 to-transparent" />
        <div className="mt-7 flex flex-col gap-3 text-xs text-[#6B7C93] sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Omnivyra. All rights reserved.</p>
          <p>Marketing Decision Intelligence Platform</p>
        </div>
      </div>
    </footer>
  );
}

export function PrimaryCta({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const isLight = variant === 'light';
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href="/create-account"
        data-ga-primary-cta
        data-ga-label="Get My Digital Authority Snapshot"
        data-ga-location="active_intelligence_homepage"
        className={`inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 py-3 text-center text-base font-semibold shadow-[0_14px_34px_rgba(10,102,194,0.28)] transition hover:-translate-y-0.5 ${
          isLight ? 'bg-white text-[#0A66C2] hover:bg-[#EEF6FF]' : 'bg-[#0A66C2] text-white hover:bg-[#0857A8]'
        }`}
      >
        Get My Digital Authority Snapshot
      </Link>
      <Link
        href="/get-free-credits"
        className={`inline-flex min-h-[52px] items-center justify-center rounded-xl border px-6 py-3 text-center text-base font-semibold transition ${
          isLight
            ? 'border-white/[0.35] bg-white/[0.10] text-white hover:bg-white/[0.16]'
            : 'border-[#C9DDF3] bg-white text-[#0B1F33] hover:border-[#0A66C2]/40'
        }`}
      >
        Get Free Credits
      </Link>
    </div>
  );
}

export function ArchitectureMap() {
  return (
    <div className="landing-reveal landing-delay-2 relative min-h-[360px] overflow-visible lg:min-h-[390px]">
      <div className="pointer-events-none absolute -right-20 -top-10 h-64 w-64 rounded-full border-[22px] border-[#3FA9F5]/40 shadow-[0_0_44px_rgba(63,169,245,0.22)]" />
      <div className="pointer-events-none absolute -right-8 top-8 h-48 w-48 rounded-full border-[14px] border-[#0A66C2]/50" />
      <div className="pointer-events-none absolute right-16 top-24 h-28 w-28 rounded-full border-[7px] border-[#75CBFF]/30" />
      <div className="pointer-events-none absolute right-5 top-16 h-36 w-48 bg-[radial-gradient(circle,rgba(169,218,255,0.36)_1px,transparent_1px)] bg-[size:12px_12px] opacity-60" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-55" viewBox="0 0 720 520" preserveAspectRatio="none">
        <path
          d="M30 180 C 140 120, 230 230, 330 185 S 500 110, 690 240"
          fill="none"
          stroke="rgba(169,218,255,0.24)"
          strokeWidth="1"
          strokeDasharray="4 18"
          className="landing-signal-drift"
        />
        <path
          d="M70 410 C 190 315, 300 430, 420 350 S 560 310, 700 390"
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1"
          className="landing-signal-breathe"
        />
      </svg>

      <div className="absolute left-0 top-8 w-[80%] rotate-[-2deg] overflow-hidden rounded-[28px] border border-[#A9DAFF]/35 bg-white shadow-[0_34px_90px_rgba(2,22,58,0.35)] sm:w-[78%]">
        <div className="grid min-h-[360px] grid-cols-[54px_1fr]">
          <div className="flex flex-col items-center gap-3 bg-[#082E63] px-3 py-5">
            <div className="h-8 w-8 rounded-full border-2 border-[#3FA9F5] shadow-[inset_0_0_0_4px_rgba(63,169,245,0.18)]" />
            {HERO_NAV_ITEMS.map(({ label, icon: Icon }, index) => (
              <div
                key={label}
                title={label}
                className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-black ${
                  index === 0 ? 'bg-[#0A66C2] text-white' : 'bg-white/10 text-[#BFE5FF]'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={2.2} />
              </div>
            ))}
          </div>

          <div className="bg-[#F7FBFF] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0A66C2]">Digital Authority Snapshot</p>
                <h3 className="mt-1 text-[1.35rem] font-black leading-tight text-[#071D3A]">Visibility intelligence brief</h3>
              </div>
              <span className="rounded-full border border-[#CBE2F7] bg-white px-3 py-1 text-xs font-bold text-[#0A66C2]">
                Public signals
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex aspect-square min-h-[132px] flex-col items-center justify-center rounded-full border border-[#C7DDF4] bg-white p-3 text-center shadow-[0_14px_34px_rgba(10,31,68,0.10)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5D6F83]">Authority Score</p>
                <div className="mt-2 grid h-16 w-16 place-items-center rounded-full border-[7px] border-[#0A66C2] bg-[#EFF7FF] text-xl font-black text-[#071D3A]">
                  72
                </div>
              </div>
              {[
                ['AEO Readiness', '64%', 'Answer structure'],
                ['AI Visibility', '41', 'Entity clarity'],
              ].map(([label, value, note], index) => (
                <div key={label} className="rounded-2xl border border-[#D8E3F0] bg-white p-3 shadow-[0_10px_24px_rgba(10,31,68,0.06)]">
                  <p className="text-[10px] font-bold text-[#5D6F83]">{label}</p>
                  <p className="mt-2 text-2xl font-black text-[#071D3A]">{value}</p>
                  <div className="mt-3 h-1.5 rounded-full bg-[#E6EEF8]">
                    <div className="h-1.5 rounded-full bg-[#0A66C2]" style={{ width: `${[64, 41][index]}%` }} />
                  </div>
                  <p className="mt-2 text-[10px] font-semibold text-[#0A66C2]">{note}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-[#D8E3F0] bg-white p-4 shadow-[0_10px_24px_rgba(10,31,68,0.06)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-[#071D3A]">Visibility movement</p>
                  <p className="text-xs font-bold text-[#0A66C2]">Last 90 days</p>
                </div>
                <div className="mt-4 flex h-20 items-end gap-2">
                  {[28, 42, 36, 58, 46, 62, 54, 72, 68, 84].map((height, index) => (
                    <div
                      key={index}
                      className="landing-bar-rise flex-1 rounded-t-lg bg-gradient-to-t from-[#0A66C2] to-[#3FA9F5]"
                      style={{ height, '--bar-delay': `${index * 0.08}s` } as CSSProperties}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#D8E3F0] bg-white p-4 shadow-[0_10px_24px_rgba(10,31,68,0.06)]">
                <p className="text-sm font-black text-[#071D3A]">Signal layers</p>
                <div className="mt-4 space-y-3">
                  {[
                    ['SEO readiness', '76%'],
                    ['GEO readiness', '52%'],
                    ['Entity clarity', '48%'],
                    ['Platform presence', '69%'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs font-semibold text-[#496179]">
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[#E6EEF8]">
                        <div className="h-2 rounded-full bg-[#0A66C2]" style={{ width: value }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute right-0 top-28 hidden w-[82vw] max-w-[300px] rounded-[22px] border border-white/70 bg-white p-4 shadow-[0_24px_60px_rgba(2,22,58,0.26)] sm:block sm:w-[300px] lg:-right-2 xl:right-0">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFE8D3] text-xl font-black text-[#F47A14]">!</div>
          <div>
            <p className="text-sm font-black text-[#F47A14]">Trust Proof Gap</p>
            <p className="mt-1 text-sm leading-6 text-[#071D3A]">Comparison pages need stronger proof assets.</p>
          </div>
        </div>
      </div>

      <div className="absolute right-4 top-64 hidden w-[78vw] max-w-[292px] rounded-[22px] border border-white/70 bg-white p-4 shadow-[0_24px_60px_rgba(2,22,58,0.24)] sm:block sm:right-8 sm:w-[292px] lg:right-4 xl:right-8">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E4F8EE] text-lg font-black text-[#11A36A]">AEO</div>
          <div>
            <p className="text-sm font-black text-[#11A36A]">AEO Structure Gap</p>
            <p className="mt-1 text-sm leading-6 text-[#071D3A]">Add answer blocks and FAQ hierarchy.</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-10 hidden rounded-[20px] border border-[#A9DAFF]/25 bg-[#062F68]/80 px-5 py-4 text-white shadow-[0_20px_50px_rgba(2,22,58,0.24)] backdrop-blur sm:block">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#A9DAFF]">Snapshot output</p>
        <p className="mt-1 text-sm font-semibold">Score context, growth gaps, and action priorities.</p>
      </div>
    </div>
  );
}

export function SectionShell({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      className={`relative z-10 overflow-hidden px-6 py-20 lg:px-8 ${dark ? 'text-white' : 'bg-[#F5F9FF]'}`}
      style={
        dark
          ? { background: BLUE_FIELD }
          : undefined
      }
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className={`absolute inset-0 ${dark ? 'omnivyra-dark-grid opacity-45' : 'omnivyra-light-grid opacity-80'}`} />
        <div className={`absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent ${dark ? 'via-[#A9DAFF]/[0.25]' : 'via-[#0A66C2]/[0.14]'} to-transparent`} />
        <div className={`absolute -top-24 right-[8%] h-56 w-56 rounded-full blur-3xl ${dark ? 'bg-[#3FA9F5]/[0.18]' : 'bg-[#3FA9F5]/[0.10]'}`} />
        <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1200 620" preserveAspectRatio="none">
          <path
            d="M70 160 C 240 95, 360 205, 520 172 S 790 95, 1110 235"
            fill="none"
            stroke={dark ? 'rgba(169,218,255,0.09)' : 'rgba(10,102,194,0.065)'}
            strokeWidth="1"
            strokeDasharray="3 22"
            className="landing-signal-drift-slow"
          />
          <path
            d="M120 505 C 285 405, 455 545, 630 456 S 880 372, 1120 494"
            fill="none"
            stroke={dark ? 'rgba(255,255,255,0.055)' : 'rgba(63,169,245,0.055)'}
            strokeWidth="1"
            className="landing-signal-breathe"
          />
        </svg>
      </div>
      <div className="relative mx-auto max-w-[1240px]">{children}</div>
    </section>
  );
}

