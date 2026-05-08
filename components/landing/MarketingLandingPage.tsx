'use client';

import Link from 'next/link';
import { BarChart3, Home, LayoutGrid, Target } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';
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

const SNAPSHOT_DIMENSIONS = [
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

const EXCLUSIONS = [
  'Google Analytics',
  'Funnel drop-offs',
  'Attribution analytics',
  'Behavioral telemetry',
  'Private engagement metrics',
  'Conversion analytics',
];

const SNAPSHOT_OUTPUTS = [
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

const HERO_RAIL = [
  ['01', 'Public authority baseline', 'SEO, AEO, GEO, authority, competition, and content depth.'],
  ['02', 'Connected operational context', 'Campaigns, content, publishing, analytics, and engagement systems.'],
  ['03', 'Active Intelligence', 'Recommendations, next-best actions, execution, and optimization loops.'],
];

const ACTIVE_INTELLIGENCE = [
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

const EVOLUTION = [
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

const OPERATING_LAYERS = [
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

const OMNIVYRA_SYNTHESIS = {
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

function OperationalContinuityField() {
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

function HeroSignalField() {
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

function OperationalConsequence() {
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

function CinematicFooter() {
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

function PrimaryCta({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
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

function ArchitectureMap() {
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

function SectionShell({
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
            <h3 className="mt-3 text-2xl font-bold text-white" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
    <div className="relative isolate min-h-screen overflow-x-hidden bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
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
              style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
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
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
            Omnivyra reads the layers that shape AI-era discoverability.
          </h2>
        </div>
        <DiscoverabilityEcosystem />
      </SectionShell>

      <SectionShell dark>
        <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A9DAFF]">Active Intelligence</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-5xl" style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}>
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
