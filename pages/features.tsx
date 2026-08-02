import Link from 'next/link';
import type { ReactNode } from 'react';
import MarketingPageMeta from '../components/seo/MarketingPageMeta';

const BLUE_FIELD = 'linear-gradient(150deg, #071D3A 0%, #0A3770 54%, #0A66C2 100%)';

const SYSTEMS = [
  {
    eyebrow: 'System 01',
    title: 'Intelligence & Reporting',
    summary:
      'Diagnostic infrastructure for authority, discoverability, evidence strength, operational gaps, and investment direction.',
    behavior: 'Visibility diagnostics',
    outcome: 'Turns scattered public signals into an executive view of where authority is forming, where it is constrained, and what deserves attention first.',
    signals: [
      'Public intelligence report',
      'Paid intelligence dossier',
      'SEO / AEO / GEO analysis',
      'Competitive visibility',
      'Authority inflow',
      'Content performance',
      'Lead qualification',
      'Operational scoring',
      'Forecast direction',
      'Budget alignment',
    ],
  },
  {
    eyebrow: 'System 02',
    title: 'Content Operations',
    summary:
      'Publishing infrastructure for text, creator assets, campaign materials, and authority-building formats that need to move through market surfaces cleanly.',
    behavior: 'Publishing pathways',
    outcome: 'Shapes content as an operational asset, not a blank output: format, depth, discoverability, campaign fit, and publishing movement stay visible.',
    signals: [
      'Posts',
      'Threads',
      'Blogs',
      'Articles',
      'Newsletters',
      'Guides',
      'Stories',
      'Long-form',
      'Case studies',
      'Image posts',
      'Visual threads',
      'Banners',
      'Carousels',
      'PDFs',
      'Creator assets',
      'Posts with assets',
      'Threads with assets',
    ],
  },
  {
    eyebrow: 'System 03',
    title: 'Campaign Operations',
    summary:
      'Execution infrastructure for campaign sequencing, creator coordination, hybrid workflows, and collaborative operating rhythm.',
    behavior: 'Execution orchestration',
    outcome: 'Keeps campaign movement coordinated across formats, teams, timing, and operational handoffs so execution does not become a disconnected queue.',
    signals: [
      'Automated text workflows',
      'Campaign sequencing',
      'Execution automation',
      'Creator-asset campaigns',
      'Synchronized publishing',
      'Hybrid text + creator systems',
      'Multi-format orchestration',
      'Collaborative planning',
      'Workflow management',
      'Guided campaign execution',
    ],
  },
  {
    eyebrow: 'System 04',
    title: 'Engagement & Market Intelligence',
    summary:
      'External awareness infrastructure for engagement visibility, market movement, competitor activity, social listening, and opportunity discovery.',
    behavior: 'Market signal awareness',
    outcome: 'Surfaces the outside movement that changes operational priorities: customer response, competitor motion, ecosystem shifts, and emerging opportunities.',
    signals: [
      'Unified engagement window',
      'Social response systems',
      'Operational engagement visibility',
      'Interaction prioritization',
      'Market Pulse',
      'Industry movement intelligence',
      'Competitor activity',
      'Management changes',
      'Market shifts',
      'Active Leads',
      'Social listening',
      'Opportunity discovery',
    ],
  },
];

const ACTIVE_INTELLIGENCE = [
  'Visibility changes priority order',
  'Execution improves recommendation quality',
  'Discoverability reshapes campaign direction',
  'Engagement changes operational context',
  'Market signals adjust strategic movement',
  'Guidance sharpens as evidence deepens',
];

const EVOLUTION = [
  'Public Snapshot',
  'Visibility baseline',
  'Context depth',
  'Execution readiness',
  'Guidance quality',
  'Operational maturity',
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

function SignalField({ dark = false }: { dark?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className={dark ? 'absolute inset-0 omnivyra-dark-grid opacity-35' : 'absolute inset-0 omnivyra-light-grid opacity-60'} />
      <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 1200 620" preserveAspectRatio="none">
        <path
          d="M70 160 C 240 95, 360 205, 520 172 S 790 95, 1110 235"
          fill="none"
          stroke={dark ? 'rgba(169,218,255,0.11)' : 'rgba(10,102,194,0.07)'}
          strokeWidth="1"
          strokeDasharray="3 22"
          className="features-signal-drift"
        />
        <path
          d="M120 505 C 285 405, 455 545, 630 456 S 880 372, 1120 494"
          fill="none"
          stroke={dark ? 'rgba(255,255,255,0.06)' : 'rgba(63,169,245,0.055)'}
          strokeWidth="1"
          className="features-signal-breathe"
        />
      </svg>
    </div>
  );
}

function PrimaryCtas({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex flex-col justify-center gap-3 sm:flex-row">
      <Link
        href="/create-account"
        className={`inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 py-3 text-sm font-black shadow-[0_14px_34px_rgba(10,102,194,0.22)] transition hover:-translate-y-0.5 ${
          dark ? 'bg-white text-[#0A66C2]' : 'bg-[#0A66C2] text-white'
        }`}
      >
        Get My Digital Authority Snapshot
      </Link>
      <Link
        href="/get-free-credits"
        className={`inline-flex min-h-[52px] items-center justify-center rounded-xl border px-6 py-3 text-sm font-black transition ${
          dark ? 'border-white/30 bg-white/10 text-white hover:bg-white/20' : 'border-[#C9DDF3] bg-white text-[#071D3A]'
        }`}
      >
        Get Free Credits
      </Link>
    </div>
  );
}

function Section({
  children,
  dark = false,
  className = '',
}: {
  children: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <section className={`relative z-10 overflow-hidden px-6 py-16 lg:px-8 ${dark ? 'text-white' : 'bg-[#F7FBFF] text-[#071D3A]'} ${className}`} style={dark ? { background: BLUE_FIELD } : undefined}>
      <SignalField dark={dark} />
      <div className="relative mx-auto max-w-[1280px]">{children}</div>
    </section>
  );
}

function HeroArchitecture() {
  const layers = [
    { label: 'Signal intake', x: '8%', y: '17%', w: '36%' },
    { label: 'Publishing systems', x: '56%', y: '14%', w: '36%' },
    { label: 'Campaign motion', x: '8%', y: '45%', w: '29%' },
    { label: 'Market awareness', x: '58%', y: '50%', w: '35%' },
    { label: 'Guidance layer', x: '28%', y: '75%', w: '44%' },
  ];

  return (
    <div className="relative mx-auto max-w-[590px]">
      <div className="relative overflow-hidden rounded-[32px] border border-white/18 bg-white/[0.10] p-4 shadow-[0_28px_76px_rgba(2,22,58,0.24)] backdrop-blur">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(169,218,255,0.20),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(63,169,245,0.16),transparent_34%)]" />
        <div className="relative min-h-[300px] overflow-hidden rounded-[24px] border border-[#A9DAFF]/16 bg-[#071D3A]/72">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(169,218,255,0.07)_1px,transparent_1px),linear-gradient(180deg,rgba(169,218,255,0.06)_1px,transparent_1px)] bg-[size:38px_38px]" />
          <svg className="absolute inset-0 h-full w-full opacity-80" viewBox="0 0 620 330" fill="none" preserveAspectRatio="none">
            <path d="M58 76 C 160 40, 240 110, 314 96 S 455 54, 560 94" stroke="rgba(169,218,255,0.28)" strokeDasharray="4 16" className="features-signal-drift" />
            <path d="M78 164 C 176 120, 245 196, 322 168 S 462 142, 558 184" stroke="rgba(255,255,255,0.16)" className="features-signal-breathe" />
            <path d="M74 250 C 170 210, 245 266, 318 244 S 464 214, 548 248" stroke="rgba(63,169,245,0.22)" strokeDasharray="2 14" className="features-signal-drift" />
            <circle cx="312" cy="166" r="54" stroke="rgba(169,218,255,0.18)" />
            <circle cx="312" cy="166" r="6" fill="rgba(169,218,255,0.76)" />
          </svg>
          <div className="absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#A9DAFF]/26 bg-[#123A68]/76 text-center text-[11px] font-black leading-4 text-white shadow-[inset_0_0_34px_rgba(169,218,255,0.12)] backdrop-blur">
            Operating core
          </div>
          {layers.map((layer, index) => (
            <div
              key={layer.label}
              className="features-node-drift absolute rounded-2xl border border-white/14 bg-white/[0.10] px-3 py-2 text-[11px] font-black text-white backdrop-blur"
              style={{ left: layer.x, top: layer.y, width: layer.w }}
            >
              <span className="mr-2 text-[#A9DAFF]">{String(index + 1).padStart(2, '0')}</span>
              {layer.label}
            </div>
          ))}
        </div>
        <div className="relative mt-3 flex items-center justify-between rounded-2xl border border-white/12 bg-white/[0.08] px-4 py-3 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#A9DAFF]">Infrastructure view</p>
          <p className="text-xs font-semibold text-white/78">Visibility - content - campaigns - guidance</p>
        </div>
      </div>
    </div>
  );
}

function SystemVisual({ system, index }: { system: (typeof SYSTEMS)[number]; index: number }) {
  if (index === 0) {
    const quadrants = system.signals.slice(0, 8);
    return (
      <div className="relative min-h-[340px] overflow-hidden rounded-[30px] border border-[#CBE2F7]/70 bg-white/[0.72] p-5 shadow-[0_20px_56px_rgba(8,68,138,0.07)] backdrop-blur">
        <SignalField />
        <div className="relative grid h-full gap-4 sm:grid-cols-[1fr_0.82fr]">
          <div className="grid grid-cols-2 gap-2.5">
            {quadrants.map((signal, signalIndex) => (
              <div key={signal} className={`features-node-drift rounded-2xl border border-[#D8E8F7] bg-[#F8FBFF]/80 p-4 ${signalIndex % 2 === 1 ? 'translate-y-3' : ''}`}>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#0A66C2]">Signal</p>
                <p className="mt-2 text-sm font-black leading-6 text-[#071D3A]">{signal}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-center rounded-[24px] border border-[#0A66C2]/16 bg-[#071D3A] p-5 text-white">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#A9DAFF]">{system.behavior}</p>
            <div>
              <p className="mt-10 text-4xl font-black sm:mt-8">01</p>
              <p className="mt-3 text-sm leading-6 text-[#DDF1FF]">{system.outcome}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (index === 1) {
    const lanes = [
      { label: 'Writer formats', items: system.signals.slice(0, 9) },
      { label: 'Creator assets', items: system.signals.slice(9, 17) },
    ];
    return (
      <div className="relative overflow-hidden rounded-[26px] bg-[#F9FCFF] p-4 shadow-[0_18px_48px_rgba(8,68,138,0.06)]">
        <SignalField />
        <div className="relative grid gap-3 lg:grid-cols-2">
          {lanes.map((lane, laneIndex) => (
            <div key={lane.label} className="flex min-h-[235px] flex-col rounded-[22px] border border-[#D8E8F7] bg-white/75 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#0A66C2]">{lane.label}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {lane.items.map((item) => (
                  <span
                    key={item}
                    className={`inline-flex min-h-[34px] items-center rounded-full border border-[#CBE2F7] bg-[#F7FBFF] px-3 py-1 text-[10px] font-black leading-4 text-[#071D3A] ${
                      item.length > 14 || item === 'Case studies' ? 'col-span-2 justify-center' : 'justify-center'
                    }`}
                  >
                    {item}
                  </span>
                ))}
              </div>
              <div className="mt-auto pt-3">
                <div className="h-px w-full bg-[#D8E8F7]" />
              </div>
            </div>
          ))}
          <div className="relative border-t border-[#CBE2F7] pt-3 lg:col-span-2">
            <p className="max-w-2xl text-sm font-semibold leading-7 text-[#496179]">{system.outcome}</p>
          </div>
        </div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="relative min-h-[360px] overflow-hidden rounded-[30px] border border-[#CBE2F7]/70 bg-white/[0.78] p-5 shadow-[0_20px_56px_rgba(8,68,138,0.07)]">
        <SignalField />
        <div className="absolute bottom-8 left-1/2 top-8 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#0A66C2]/24 to-transparent sm:block" />
        <div className="relative grid gap-3 sm:grid-cols-2">
          {system.signals.slice(0, 10).map((signal, signalIndex) => (
            <div key={signal} className={`features-node-drift grid gap-3 rounded-2xl border border-[#D8E8F7] bg-[#F8FBFF]/82 p-4 sm:grid-cols-[40px_1fr] ${signalIndex % 4 === 1 ? 'sm:translate-y-5' : signalIndex % 4 === 2 ? 'sm:-translate-y-2' : ''}`}>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#0A66C2] text-xs font-black text-white">{String(signalIndex + 1).padStart(2, '0')}</span>
              <p className="text-sm font-black leading-6 text-[#071D3A]">{signal}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const engagementSignals = system.signals.slice(0, 8);

  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-[30px] bg-[#071D3A] p-5 text-white shadow-[0_22px_58px_rgba(8,68,138,0.14)]">
      <SignalField dark />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-45" viewBox="0 0 620 390" fill="none" aria-hidden="true">
        <path d="M82 64 C 190 35, 243 132, 310 112 S 435 54, 548 92" stroke="rgba(169,218,255,0.22)" strokeWidth="1" strokeDasharray="5 18" className="features-signal-drift" />
        <path d="M72 304 C 174 238, 253 325, 310 275 S 435 230, 550 300" stroke="rgba(255,255,255,0.15)" strokeWidth="1" className="features-signal-breathe" />
        <circle cx="310" cy="195" r="92" stroke="rgba(169,218,255,0.12)" strokeWidth="1" />
      </svg>
      <div className="relative grid min-h-[330px] gap-5 sm:hidden">
        <div className="relative z-20 mx-auto grid h-28 w-28 place-items-center rounded-full border border-[#A9DAFF]/25 bg-[#123A68]/80 text-center text-xs font-black leading-5 text-white backdrop-blur">
          External signal field
        </div>
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {system.signals.slice(0, 8).map((signal) => (
            <span key={signal} className="rounded-2xl border border-white/14 bg-white/[0.08] px-3 py-2 text-xs font-black leading-5 text-[#EAF7FF] backdrop-blur">
              {signal}
            </span>
          ))}
        </div>
      </div>
      <div className="relative z-10 hidden min-h-[330px] content-center gap-4 sm:grid">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-[#A9DAFF]/25 bg-[#123A68]/82 text-center text-xs font-black leading-5 text-white backdrop-blur">
          External signal field
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {engagementSignals.map((signal, signalIndex) => (
            <span
              key={signal}
              className={`features-node-drift min-w-0 rounded-2xl border border-white/16 bg-white/[0.08] px-3 py-2 text-[11px] font-black leading-5 text-[#EAF7FF] backdrop-blur ${
                signalIndex % 4 === 1 || signalIndex % 4 === 2 ? 'translate-y-3' : ''
              }`}
            >
              {signal}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemSection({ system, index }: { system: (typeof SYSTEMS)[number]; index: number }) {
  const reverse = index % 2 === 1;
  return (
    <div className={`grid gap-8 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">{system.eyebrow}</p>
        <h3 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">{system.title}</h3>
        <p className="mt-5 text-base leading-8 text-[#496179]">{system.summary}</p>
        <div className="mt-7 max-w-xl border-l border-[#0A66C2]/30 pl-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0A66C2]">{system.behavior}</p>
          <p className="mt-2 text-sm leading-7 text-[#5D6F83]">{system.outcome}</p>
        </div>
      </div>
      <SystemVisual system={system} index={index} />
    </div>
  );
}

function ActiveLayer() {
  return (
    <Section dark className="py-14 lg:py-16">
      <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A9DAFF]">Contextual guidance</p>
          <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">
            Guidance becomes sharper as operational context deepens.
          </h2>
          <p className="mt-5 text-base leading-8 text-[#DDF1FF]">
            Recommendations are not static outputs. They change as visibility, execution, publishing, engagement, and market
            signals reveal stronger evidence about what should move next.
          </p>
        </div>
        <div className="relative overflow-hidden rounded-[30px] border border-white/16 bg-white/[0.08] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.16)] backdrop-blur">
          <SignalField dark />
          <div className="relative grid gap-3 sm:grid-cols-2">
            {ACTIVE_INTELLIGENCE.map((item, index) => (
              <div key={item} className={`features-node-drift flex items-center gap-4 rounded-2xl border border-white/12 bg-white/[0.07] p-4 ${index % 2 === 1 ? 'sm:translate-y-5' : ''}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-sm font-black text-[#0A66C2]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="text-sm font-black leading-6 text-white">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function EvolutionSection() {
  return (
    <Section className="pb-14 pt-14 lg:pb-12 lg:pt-14">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">Operational maturity</p>
        <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
          Operational understanding deepens in layers.
        </h2>
      </div>
      <div className="relative mx-auto mt-9 grid max-w-5xl gap-4 sm:grid-cols-3">
        <div className="absolute left-0 right-0 top-1/2 hidden h-px bg-gradient-to-r from-transparent via-[#0A66C2]/24 to-transparent sm:block" />
        {EVOLUTION.map((item, index) => (
          <div key={item} className="relative">
            <div className="features-node-drift w-full rounded-2xl border border-[#CBE2F7]/80 bg-white/[0.78] p-5 shadow-[0_12px_30px_rgba(8,68,138,0.05)] backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0A66C2]">{String(index + 1).padStart(2, '0')}</p>
              <p className="mt-2 text-lg font-black text-[#071D3A]">{item}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 overflow-hidden bg-[#F7FBFF] px-6 pb-10 pt-10 lg:px-8">
      <SignalField />
      <div className="relative mx-auto max-w-[1180px] pt-8">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C9DDF3]/60 to-transparent" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.22fr_1fr]">
          <div>
            <Link href="/" aria-label="Omnivyra home" className="inline-flex">
              <img width={465} height={144} src="/logo.webp" alt="Omnivyra" className="h-12 w-auto object-contain" />
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[#5D6F83]">
              Operational marketing infrastructure for visibility, execution, and market awareness.
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
        <div className="mt-10 h-px w-full bg-gradient-to-r from-transparent via-[#D8E3F0]/60 to-transparent" />
        <div className="mt-7 flex flex-col gap-3 text-xs text-[#6B7C93] sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Omnivyra. All rights reserved.</p>
          <p>Marketing Decision Intelligence Platform</p>
        </div>
      </div>
    </footer>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <MarketingPageMeta
        title="Features | Omnivyra"
        description="Explore Omnivyra operational marketing infrastructure for visibility intelligence, content operations, campaign orchestration, engagement, Market Pulse, Active Leads, and contextual guidance."
        path="/features"
      />

      <main className="relative isolate min-h-screen overflow-x-hidden bg-[#F7FBFF]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <section className="relative z-10 overflow-hidden text-white" style={{ background: BLUE_FIELD }}>
          <SignalField dark />
          <div className="relative mx-auto grid max-w-[1280px] gap-5 px-6 py-8 lg:min-h-[430px] lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8 lg:py-9">
            <div>
              <p className="inline-flex rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#A9DAFF]">
                Features
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[1.03] tracking-tight sm:text-[2.7rem] xl:text-[2.9rem]">
                Operational marketing infrastructure for visibility, execution, and market awareness.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#DDF1FF]">
                Omnivyra gives teams the systems behind authority diagnosis, publishing operations, campaign movement,
                engagement awareness, market pulse, and contextual guidance.
              </p>
              <div className="mt-5">
                <PrimaryCtas />
              </div>
            </div>
            <div className="hidden lg:block">
              <HeroArchitecture />
            </div>
          </div>
        </section>

        <Section className="pt-12 lg:pt-14">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">Four operational systems</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
              From signals to synchronized execution.
            </h2>
          </div>
          <div className="mt-6">
            {SYSTEMS.map((system, index) => (
              <SystemSection key={system.title} system={system} index={index} />
            ))}
          </div>
        </Section>

        <ActiveLayer />
        <EvolutionSection />

        <Section dark className="py-14 lg:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A9DAFF]">Future depth</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">
              Operational understanding keeps getting deeper.
            </h2>
            <p className="mt-6 text-base leading-8 text-[#DDF1FF]">
              As forecasting, contextual analysis, recommendation precision, visibility intelligence, and execution understanding
              expand, Omnivyra will continue strengthening how teams read the market and decide what should move next.
            </p>
          </div>
        </Section>

        <section className="relative z-10 bg-[#F7FBFF] px-6 pb-14 pt-16 lg:px-8">
          <SignalField />
          <div className="relative mx-auto max-w-[920px] text-center">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#0A66C2]">Start with visibility</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
              Start with your operational visibility layer.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#496179]">
              Create an account, complete your company profile, and request the first public intelligence layer inside
              Omnivyra.
            </p>
            <div className="mt-8 flex justify-center">
              <PrimaryCtas dark={false} />
            </div>
          </div>
        </section>

        <Footer />

        <style jsx global>{`
          @keyframes featuresSignalDrift {
            0%,
            100% {
              stroke-dashoffset: 0;
              opacity: 0.5;
            }
            50% {
              stroke-dashoffset: -40;
              opacity: 0.88;
            }
          }

          @keyframes featuresSignalBreathe {
            0%,
            100% {
              opacity: 0.28;
            }
            50% {
              opacity: 0.66;
            }
          }

          @keyframes featuresNodeDrift {
            0%,
            100% {
              transform: translate3d(0, 0, 0);
            }
            50% {
              transform: translate3d(0, -4px, 0);
            }
          }

          .features-signal-drift {
            animation: featuresSignalDrift 15s ease-in-out infinite;
          }

          .features-signal-breathe {
            animation: featuresSignalBreathe 9s ease-in-out infinite;
          }

          .features-node-drift {
            animation: featuresNodeDrift 11s ease-in-out infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .features-signal-drift,
            .features-signal-breathe,
            .features-node-drift {
              animation: none;
            }
          }
        `}</style>
      </main>
    </>
  );
}
