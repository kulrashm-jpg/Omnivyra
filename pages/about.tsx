import Head from 'next/head';
import Link from 'next/link';
import type { CSSProperties } from 'react';

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';
const CENTERPIECE_FIELD = 'linear-gradient(160deg, #06182F 0%, #082B55 58%, #0A4F94 100%)';

const AI_PROMISES = ['speed', 'automation', 'intelligence', 'content scale', 'optimization', 'execution acceleration'];

const FRACTURE_ACCELERATORS = ['Content creation', 'Campaign execution', 'Publishing', 'Optimization', 'Automation', 'Analysis'];

const ECOSYSTEM_PARTS = [
  'analytics platforms',
  'social systems',
  'AI tools',
  'publishing systems',
  'visibility layers',
  'reporting environments',
  'automation tools',
];

const INTERPRETATION_LAYERS = [
  'authority',
  'operational movement',
  'discoverability',
  'contextual relevance',
  'coordination across systems',
  'evolving visibility behavior',
];

const TEAM_OUTCOMES = ['understand direction', 'reduce fragmentation', 'operate with greater confidence'];

const PRINCIPLES = [
  {
    title: 'Clarity before complexity',
    body: 'We believe operational understanding should come before operational scale.',
  },
  {
    title: 'Intelligence inside the workflow',
    body: 'We believe intelligence becomes more meaningful when generated from connected operational context.',
  },
  {
    title: 'Systems should adapt',
    body: 'We believe marketing platforms should evolve with operational behavior instead of forcing rigid disconnected workflows.',
  },
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

function AtmosphericTexture({ mode = 'dark' }: { mode?: 'dark' | 'light' }) {
  const isDark = mode === 'dark';

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className={`absolute inset-0 ${
          isDark ? 'omnivyra-dark-grid opacity-20' : 'omnivyra-light-grid opacity-65'
        }`}
      />
      <div
        className={`absolute left-0 right-0 top-[28%] h-px bg-gradient-to-r from-transparent ${
          isDark ? 'via-[#A9DAFF]/20' : 'via-[#0A66C2]/12'
        } to-transparent`}
      />
      <div
        className={`absolute left-0 right-0 top-[72%] h-px bg-gradient-to-r from-transparent ${
          isDark ? 'via-white/10' : 'via-[#0A66C2]/10'
        } to-transparent`}
      />
      <div
        className={`absolute -right-28 top-16 h-64 w-64 rounded-full blur-3xl ${
          isDark ? 'bg-[#3FA9F5]/10' : 'bg-[#3FA9F5]/8'
        }`}
      />
      <div
        className={`absolute -left-24 bottom-10 h-56 w-56 rounded-full blur-3xl ${
          isDark ? 'bg-[#0A66C2]/14' : 'bg-[#0A66C2]/7'
        }`}
      />
    </div>
  );
}

function JourneyField() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-50" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(10,102,194,0.055),transparent_28%),radial-gradient(circle_at_82%_82%,rgba(63,169,245,0.05),transparent_30%)]" />
      <svg className="h-full w-full" viewBox="0 0 1400 1000" preserveAspectRatio="none">
        <path
          d="M80 210 C 290 120, 410 250, 610 220 S 900 130, 1260 260"
          fill="none"
          stroke="rgba(10,102,194,0.055)"
          strokeWidth="1.4"
          strokeDasharray="3 20"
          className="omnivyra-signal-drift-slow"
        />
        <path
          d="M110 780 C 330 620, 520 760, 710 650 S 1010 560, 1290 710"
          fill="none"
          stroke="rgba(63,169,245,0.05)"
          strokeWidth="1.4"
          className="omnivyra-signal-breathe"
        />
        <path
          d="M180 510 C 380 470, 510 520, 690 500 S 980 450, 1220 520"
          fill="none"
          stroke="rgba(10,102,194,0.035)"
          strokeWidth="1"
          strokeDasharray="1 24"
          className="omnivyra-signal-drift"
        />
      </svg>
    </div>
  );
}

function FragmentedHeroField() {
  return (
    <div className="absolute inset-0 opacity-85" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(169,218,255,0.16),transparent_28%),radial-gradient(circle_at_82%_45%,rgba(63,169,245,0.14),transparent_30%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 720" preserveAspectRatio="none">
        <path
          d="M120 160 C 260 120, 330 260, 450 230 S 660 120, 760 210 S 930 340, 1080 280"
          fill="none"
          stroke="rgba(169,218,255,0.18)"
          strokeWidth="1"
          strokeDasharray="5 18"
          className="omnivyra-signal-drift"
        />
        <path
          d="M170 520 C 310 410, 430 560, 560 450 S 760 410, 910 500 S 1040 520, 1130 410"
          fill="none"
          stroke="rgba(63,169,245,0.22)"
          strokeWidth="1"
          strokeDasharray="3 16"
          className="omnivyra-signal-drift-slow"
        />
        <path
          d="M320 140 C 370 260, 430 370, 610 360 S 890 260, 1010 430"
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
          className="omnivyra-signal-breathe"
        />
      </svg>
      <span className="absolute left-[11%] top-[21%] hidden h-2 w-2 rounded-full bg-[#A9DAFF]/55 md:block" />
      <span className="absolute left-[63%] top-[16%] hidden h-1.5 w-1.5 rounded-full bg-white/45 md:block" />
      <span className="absolute left-[77%] top-[44%] hidden h-2 w-2 rounded-full bg-[#A9DAFF]/45 md:block" />
      <span className="absolute left-[24%] top-[63%] hidden h-1.5 w-1.5 rounded-full bg-white/40 md:block" />
      <span className="absolute left-[54%] top-[73%] hidden h-2 w-2 rounded-full bg-[#3FA9F5]/55 md:block" />
    </div>
  );
}

function FractureVisual() {
  return (
    <div className="relative min-h-[430px] overflow-hidden rounded-[30px] border border-[#C9DDF3] bg-white/82 p-5 shadow-[0_26px_76px_rgba(10,31,68,0.10)] backdrop-blur">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,102,194,0.08)_1px,transparent_1px),linear-gradient(180deg,rgba(10,102,194,0.06)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 650 480" preserveAspectRatio="none">
        <path
          d="M90 90 C 210 60, 250 170, 350 130 S 470 55, 555 120"
          fill="none"
          stroke="rgba(10,102,194,0.24)"
          strokeWidth="1.5"
          strokeDasharray="4 14"
          className="omnivyra-signal-drift"
        />
        <path
          d="M96 375 C 190 275, 285 415, 360 300 S 470 255, 560 345"
          fill="none"
          stroke="rgba(10,102,194,0.18)"
          strokeWidth="1.5"
          strokeDasharray="2 13"
          className="omnivyra-signal-drift-slow"
        />
        <path
          d="M165 190 C 250 235, 330 210, 410 250 S 485 315, 540 265"
          fill="none"
          stroke="rgba(7,29,58,0.12)"
          strokeWidth="1.5"
          className="omnivyra-signal-breathe"
        />
      </svg>
      <div className="relative grid min-h-[390px] grid-cols-2 gap-4 sm:grid-cols-3">
        {ECOSYSTEM_PARTS.map((item, index) => (
          <div
            key={item}
            className="omnivyra-node-drift relative self-start rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF]/92 px-4 py-4 shadow-[0_12px_34px_rgba(10,31,68,0.045)]"
            style={
              {
                '--node-duration': `${9 + index}s`,
                '--node-delay': `${index * 0.25}s`,
                '--node-offset': index % 3 === 1 ? '2rem' : index % 3 === 2 ? '0.75rem' : '0rem',
              } as CSSProperties
            }
          >
            <span className="absolute right-4 top-4 h-2 w-2 rounded-full bg-[#0A66C2]" />
            <p className="max-w-[130px] text-sm font-black leading-5 text-[#071D3A]">{item}</p>
          </div>
        ))}
      </div>
      <div className="relative mt-5 rounded-2xl bg-[#071D3A] px-5 py-4 text-white">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#A9DAFF]">The fracture</p>
        <p className="mt-2 text-sm font-semibold leading-6">Scattered systems. No shared operating truth.</p>
      </div>
    </div>
  );
}

function CenterpiecePause() {
  return (
    <section
      className="relative z-10 overflow-hidden px-6 py-28 text-white sm:py-36 lg:px-8"
      style={{ background: CENTERPIECE_FIELD }}
    >
      <AtmosphericTexture mode="dark" />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <svg className="absolute inset-0 h-full w-full opacity-28" viewBox="0 0 1200 520" preserveAspectRatio="none">
          <path
            d="M80 150 C 250 90, 390 220, 520 180 S 760 80, 920 210 S 1080 320, 1160 220"
            fill="none"
            stroke="rgba(169,218,255,0.10)"
            strokeWidth="1"
            strokeDasharray="3 22"
            className="omnivyra-signal-breathe"
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
          <p className="text-[2.45rem] font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Capability expanded.
          </p>
          <p className="max-w-[860px] pl-0 text-[2.45rem] font-black leading-[1.05] tracking-tight text-[#A9DAFF]/90 sm:pl-12 sm:text-5xl lg:text-6xl">
            Connected understanding did not.
          </p>
        </div>
      </div>
    </section>
  );
}

function OrchestrationVisual() {
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-white/15 bg-white/10 p-6 backdrop-blur">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(169,218,255,0.10)_1px,transparent_1px),linear-gradient(180deg,rgba(169,218,255,0.09)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="absolute bottom-8 left-8 top-8 w-px bg-gradient-to-b from-transparent via-[#A9DAFF]/28 to-transparent" />
      <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 620 420" preserveAspectRatio="none">
        <path
          d="M82 72 C 210 85, 230 178, 365 160 S 500 178, 552 92"
          fill="none"
          stroke="rgba(169,218,255,0.20)"
          strokeWidth="1.2"
          strokeDasharray="5 18"
          className="omnivyra-signal-drift"
        />
        <path
          d="M82 325 C 205 280, 285 352, 402 280 S 520 226, 558 320"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.2"
          className="omnivyra-signal-breathe"
        />
      </svg>
      <div className="relative space-y-5">
        {INTERPRETATION_LAYERS.map((item, index) => (
          <div key={item} className="flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-[#A9DAFF]/60" />
            <span className="h-px flex-1 bg-gradient-to-r from-[#A9DAFF]/35 via-[#A9DAFF]/50 to-[#A9DAFF]/10" />
            <span
              className={`rounded-full border px-4 py-2 text-sm font-black ${
                index % 2 === 0
                  ? 'border-white/20 bg-white/12 text-white'
                  : 'border-[#A9DAFF]/25 bg-[#A9DAFF]/10 text-[#EAF8FF]'
              }`}
            >
              {item}
            </span>
          </div>
        ))}
      </div>
      <div className="relative mt-8 rounded-2xl border border-[#A9DAFF]/20 bg-[#071D3A]/45 px-5 py-4">
        <p className="text-sm font-semibold leading-6 text-[#DDF1FF]">
          Separate signals become useful only when the system can interpret how they move together.
        </p>
      </div>
    </div>
  );
}

function HarmonyVisual() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1200 500" preserveAspectRatio="none">
        <path
          d="M80 310 C 260 180, 430 220, 590 250 S 880 330, 1120 170"
          fill="none"
          stroke="rgba(10,102,194,0.16)"
          strokeWidth="2"
        />
        <path
          d="M120 360 C 310 260, 430 320, 600 300 S 900 220, 1080 300"
          fill="none"
          stroke="rgba(63,169,245,0.16)"
          strokeWidth="2"
        />
      </svg>
      <div className="absolute left-[18%] top-[34%] h-2 w-2 rounded-full bg-[#0A66C2]" />
      <div className="absolute left-[50%] top-[49%] h-2 w-2 rounded-full bg-[#3FA9F5]" />
      <div className="absolute right-[20%] top-[38%] h-2 w-2 rounded-full bg-[#0A66C2]" />
    </div>
  );
}

function CinematicFooter() {
  return (
    <footer className="relative overflow-hidden bg-[#F5F9FF] px-6 pb-10 pt-14 lg:px-8">
      <AtmosphericTexture mode="light" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#F5F9FF] via-[#F5F9FF]/85 to-transparent" />
      <div className="relative mx-auto max-w-[1180px] pt-10">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9DDF3]/65 to-transparent" />
        <div className="mt-12 grid gap-12 lg:grid-cols-[1.22fr_1fr] lg:items-start">
          <div>
            <Link href="/" aria-label="Omnivyra home" className="inline-flex">
              <img src="/logo.png" alt="Omnivyra" className="h-12 w-auto object-contain" />
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[#5D6F83]">
              Built for clarity, control, and direction in modern marketing.
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

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra exists because AI changed marketing faster than marketing systems could evolve."
        />
      </Head>

      <main className="relative isolate min-h-screen overflow-hidden bg-[#F5F9FF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <JourneyField />
        <section
          className="relative z-10 flex min-h-[calc(100svh-65px)] overflow-hidden text-white"
          style={{ background: BLUE_FIELD }}
        >
          <AtmosphericTexture mode="dark" />
          <FragmentedHeroField />
          <div className="absolute inset-x-0 bottom-0 h-px bg-[#A9DAFF]/18" />
          <div className="relative mx-auto flex w-full max-w-[1180px] items-center px-6 py-4 sm:py-6 lg:px-8">
            <div className="max-w-[820px]">
              <p className="inline-flex rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#A9DAFF]">
                About Omnivyra
              </p>
              <h1 className="mt-3 max-w-[820px] text-[2.05rem] font-black leading-[1.02] tracking-tight sm:text-5xl lg:text-[3.05rem] xl:text-[3.15rem]">
                AI changed marketing faster than marketing systems could evolve.
              </h1>
              <div className="mt-3 grid max-w-4xl gap-3 lg:grid-cols-[0.7fr_1fr] lg:gap-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#A9DAFF]">AI promised</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {AI_PROMISES.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-white/14 bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-[#EAF8FF] backdrop-blur"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 text-sm leading-6 text-white/82 sm:text-[0.95rem] sm:leading-6">
                  <div>
                    <p>But what emerged was an ecosystem of</p>
                    <p className="mt-1 inline rounded-lg bg-white/10 px-1.5 py-0.5 font-black text-white">
                      disconnected tools solving disconnected problems.
                    </p>
                  </div>
                  <p>Teams gained more capability, yet operational understanding became increasingly fragmented.</p>
                  <p className="font-semibold text-[#DDF1FF]">Omnivyra was created because of that disconnect.</p>
                </div>
              </div>
              <div className="mt-4 sm:mt-5">
                <Link
                  href="/solutions"
                  data-ga-primary-cta
                  data-ga-label="Explore Omnivyra"
                  data-ga-location="about_hero"
                  className="inline-flex min-h-[46px] items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-[#0A66C2] shadow-[0_16px_34px_rgba(10,102,194,0.24)] transition hover:-translate-y-0.5 hover:bg-[#EEF6FF]"
                >
                  Explore Omnivyra
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="relative z-10 overflow-hidden px-6 pb-14 pt-20 lg:px-8 lg:pb-16 lg:pt-24">
          <AtmosphericTexture mode="light" />
          <div className="relative mx-auto grid max-w-[1180px] gap-12 lg:grid-cols-[0.94fr_1.06fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0A66C2]">The fracture</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
                Modern marketing became increasingly powerful, and increasingly disconnected.
              </h2>
              <div className="mt-8 space-y-5 text-base leading-8 text-[#4E6175]">
                <p>AI accelerated everything.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FRACTURE_ACCELERATORS.map((item) => (
                    <p key={item} className="border-l border-[#0A66C2]/30 pl-4 text-sm font-black text-[#0A3A7A]">
                      {item}
                    </p>
                  ))}
                </div>
                <p>
                  But instead of creating operational clarity, the ecosystem expanded into scattered platforms, isolated
                  intelligence, fragmented workflows, and disconnected decision systems.
                </p>
                <p>Teams today operate across systems that rarely understand each other operationally.</p>
                <p>Teams gained more marketing power than ever before.</p>
                <p>Yet many started understanding less about how everything was actually moving together.</p>
                <p className="text-xl font-black leading-snug text-[#071D3A]">It is lack of connected understanding.</p>
              </div>
            </div>
            <FractureVisual />
          </div>
        </section>

        <CenterpiecePause />

        <section className="relative z-10 overflow-hidden px-6 pb-24 pt-20 lg:px-8 lg:pt-24">
          <AtmosphericTexture mode="light" />
          <div className="relative mx-auto max-w-[930px] text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0A66C2]">Why Omnivyra exists</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
              Omnivyra was created to reconnect marketing operationally.
            </h2>
            <div className="mx-auto mt-10 max-w-3xl space-y-7 text-lg leading-9 text-[#4E6175]">
              <p>We did not start Omnivyra to add another marketing tool.</p>
              <p>
                We started it because modern marketing increasingly felt like disconnected systems trying to simulate
                connected understanding.
              </p>
              <div className="mx-auto max-w-3xl border-y border-[#C9DDF3] py-8 text-left sm:px-8">
                <p className="text-2xl font-black leading-snug tracking-tight text-[#071D3A] sm:text-3xl">
                  At some point, marketing systems stopped helping teams understand marketing.
                </p>
                <p className="mt-5 text-xl leading-9 text-[#4E6175]">
                  They started helping teams manage fragments of it.
                </p>
                <p className="mt-5 text-xl font-black leading-9 text-[#0A66C2]">That realization stayed with us.</p>
                <p className="mt-5 text-xl leading-9 text-[#4E6175]">Over time, it became difficult to ignore.</p>
                <p className="mt-5 text-xl leading-9 text-[#4E6175]">And eventually, it became Omnivyra.</p>
              </div>
              <p className="mx-auto max-w-2xl text-2xl font-black leading-snug text-[#071D3A]">
                The future required something different.
              </p>
              <p>
                Systems that could understand operational context, connect fragmented visibility, and guide teams with
                greater clarity.
              </p>
              <p className="font-black text-[#071D3A]">
                That belief continues to shape everything Omnivyra is becoming.
              </p>
            </div>
          </div>
        </section>

        <section className="relative z-10 overflow-hidden px-6 py-24 text-white lg:px-8" style={{ background: BLUE_FIELD }}>
          <AtmosphericTexture mode="dark" />
          <div className="relative mx-auto grid max-w-[1180px] gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A9DAFF]">What shapes Omnivyra</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">
                We think discoverability is no longer just about publishing.
              </h2>
              <div className="mt-8 space-y-5 text-base leading-8 text-[#DDF1FF] sm:text-lg">
                <p>
                  It is increasingly shaped by interpretation, authority, coordination, consistency, and operational
                  movement across systems that were never designed to think together.
                </p>
                <p>We think future marketing systems will need to understand more than isolated performance metrics.</p>
                <p>They will increasingly need to interpret:</p>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {INTERPRETATION_LAYERS.map((item) => (
                  <p key={item} className="border-l border-[#A9DAFF]/40 pl-4 text-sm font-black text-white">
                    {item}
                  </p>
                ))}
              </div>
              <div className="mt-8 space-y-5 text-base leading-8 text-[#DDF1FF] sm:text-lg">
                <p>We believe intelligent marketing systems should help teams:</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                {TEAM_OUTCOMES.map((item) => (
                  <span key={item} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <OrchestrationVisual />
          </div>
        </section>

        <section className="relative z-10 overflow-hidden px-6 py-24 lg:px-8">
          <AtmosphericTexture mode="light" />
          <div className="relative mx-auto max-w-[1180px]">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0A66C2]">How Omnivyra builds</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
                Built with patience for complexity, and discipline around clarity.
              </h2>
            </div>
            <div className="mt-14 grid gap-10 lg:grid-cols-3 lg:items-start">
              {PRINCIPLES.map((item, index) => (
                <div
                  key={item.title}
                  className={`border-t border-[#C9DDF3] pt-6 ${index === 1 ? 'lg:mt-14' : index === 2 ? 'lg:mt-28' : ''}`}
                >
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#0A66C2]">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-4 text-2xl font-black tracking-tight text-[#071D3A]">{item.title}</h3>
                  <p className="mt-4 text-base leading-8 text-[#5D6F83]">{item.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-20 max-w-3xl border-l border-[#0A66C2]/30 bg-white/28 py-2 pl-6 backdrop-blur-[2px]">
              <p className="text-2xl font-black leading-snug tracking-tight text-[#071D3A] sm:text-3xl">
                We are not interested in adding more operational noise to marketing.
              </p>
              <p className="mt-5 text-lg leading-8 text-[#4E6175]">
                We are interested in helping teams reconnect understanding across systems that increasingly stopped
                speaking the same language.
              </p>
            </div>
          </div>
        </section>

        <section className="relative z-10 overflow-hidden px-6 pb-16 pt-24 lg:px-8">
          <AtmosphericTexture mode="light" />
          <HarmonyVisual />
          <div className="relative mx-auto max-w-[900px] text-center">
            <h2 className="text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
              Marketing became more powerful. Understanding became more fragmented.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-xl font-black leading-8 text-[#0A66C2]">
              Omnivyra exists to reconnect them.
            </p>
            <div className="mt-10">
              <Link
                href="/solutions"
                className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-[#0A66C2]/25 bg-white/60 px-5 py-3 text-sm font-bold text-[#0A66C2] shadow-[0_10px_24px_rgba(10,102,194,0.10)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
              >
                Explore Omnivyra
              </Link>
            </div>
          </div>
        </section>

        <CinematicFooter />
      </main>

      <style jsx global>{`
        @keyframes omnivyraSignalDrift {
          0%,
          100% {
            stroke-dashoffset: 0;
            opacity: 0.62;
          }
          50% {
            stroke-dashoffset: -42;
            opacity: 1;
          }
        }

        @keyframes omnivyraSignalBreathe {
          0%,
          100% {
            opacity: 0.36;
          }
          50% {
            opacity: 0.72;
          }
        }

        .omnivyra-signal-drift {
          animation: omnivyraSignalDrift 12s ease-in-out infinite;
        }

        .omnivyra-signal-drift-slow {
          animation: omnivyraSignalDrift 16s ease-in-out infinite reverse;
        }

        .omnivyra-signal-breathe {
          animation: omnivyraSignalBreathe 9s ease-in-out infinite;
        }

        @keyframes omnivyraNodeDrift {
          0%,
          100% {
            transform: translate3d(0, var(--node-offset, 0rem), 0);
          }
          50% {
            transform: translate3d(0, calc(var(--node-offset, 0rem) - 5px), 0);
          }
        }

        .omnivyra-node-drift {
          animation: omnivyraNodeDrift var(--node-duration, 10s) ease-in-out var(--node-delay, 0s) infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .omnivyra-signal-drift,
          .omnivyra-signal-drift-slow,
          .omnivyra-signal-breathe,
          .omnivyra-node-drift {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
