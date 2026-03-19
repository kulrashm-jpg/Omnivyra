import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

// ── Inline SVG micro-visuals ──────────────────────────────────────────────────

function BarChart({ bars }: { bars: number[] }) {
  return (
    <svg viewBox="0 0 80 40" fill="none" className="w-full h-full">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 14 + 4}
          y={40 - h}
          width={10}
          height={h}
          rx={2}
          fill="currentColor"
          opacity={0.15 + i * 0.12}
        />
      ))}
      <polyline
        points={bars.map((h, i) => `${i * 14 + 9},${40 - h}`).join(' ')}
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        opacity={0.6}
      />
    </svg>
  );
}

function SparkLine({ vals }: { vals: number[] }) {
  const w = 80, h = 32;
  const max = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} fill="none" className="w-full h-full">
      <polyline points={pts} stroke="currentColor" strokeWidth="1.8" fill="none" opacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(vals.length - 1) / (vals.length - 1) * w} cy={h - (vals[vals.length - 1] / max) * h} r="2.5" fill="currentColor" />
    </svg>
  );
}

function NodeGraph() {
  return (
    <svg viewBox="0 0 120 80" fill="none" className="w-full h-full">
      {/* edges */}
      <line x1="60" y1="40" x2="20" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="60" y1="40" x2="100" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="60" y1="40" x2="20" y2="64" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="60" y1="40" x2="100" y2="64" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* outer nodes */}
      <circle cx="20" cy="16" r="7" fill="currentColor" opacity="0.2" />
      <circle cx="100" cy="16" r="7" fill="currentColor" opacity="0.2" />
      <circle cx="20" cy="64" r="7" fill="currentColor" opacity="0.2" />
      <circle cx="100" cy="64" r="7" fill="currentColor" opacity="0.2" />
      {/* center */}
      <circle cx="60" cy="40" r="12" fill="currentColor" opacity="0.25" />
      <circle cx="60" cy="40" r="6" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function ChecklistMock({ items }: { items: Array<{ done: boolean; label: string }> }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`h-4 w-4 shrink-0 rounded-full flex items-center justify-center ${it.done ? 'bg-[#0A66C2]' : 'bg-white/10 border border-white/20'}`}>
            {it.done && (
              <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className={`text-xs ${it.done ? 'text-white/80' : 'text-white/40 line-through'}`}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  {
    step: '01',
    label: 'Understand',
    description: 'Get full visibility into your website, content, campaigns, and market signals — all in one place.',
    color: 'from-[#0A1F44] to-[#0A3872]',
    visual: (
      <div className="relative h-28 overflow-hidden rounded-xl bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Site Health</span>
          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">Live</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[['SEO Score', '74'], ['Content', '82%'], ['Speed', '91ms'], ['Signals', '14']].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-white/5 p-1.5">
              <p className="text-[8px] text-white/40">{l}</p>
              <p className="text-sm font-bold text-white">{v}</p>
            </div>
          ))}
        </div>
      </div>
    ),
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-9v9m3-12v12M3 20.25v-16.5A.75.75 0 0 1 3.75 3h16.5a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
  },
  {
    step: '02',
    label: 'Decide',
    description: 'Know exactly what to fix, improve, or launch — based on real insights, not guesswork.',
    color: 'from-[#0A3872] to-[#0A66C2]',
    visual: (
      <div className="relative h-28 overflow-hidden rounded-xl bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Recommendations</span>
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">3 actions</span>
        </div>
        <div className="space-y-1.5">
          {[
            { label: 'Fix meta descriptions', priority: 'High', c: 'bg-red-500/20 text-red-300' },
            { label: 'Update social posting time', priority: 'Med', c: 'bg-amber-500/20 text-amber-300' },
            { label: 'Launch retargeting ad', priority: 'Quick', c: 'bg-emerald-500/20 text-emerald-300' },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1">
              <span className="text-[9px] text-white/70">{r.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${r.c}`}>{r.priority}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    step: '03',
    label: 'Execute',
    description: 'Create content, plan campaigns, and run everything — structured, scheduled, and aligned.',
    color: 'from-[#0A66C2] to-[#1478D0]',
    visual: (
      <div className="relative h-28 overflow-hidden rounded-xl bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Campaign Status</span>
          <span className="rounded-full bg-blue-400/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-300">Running</span>
        </div>
        <div className="space-y-1.5">
          {[
            { ch: 'LinkedIn', pct: 78 },
            { ch: 'Email', pct: 55 },
            { ch: 'Instagram', pct: 40 },
          ].map((r) => (
            <div key={r.ch} className="flex items-center gap-2">
              <span className="w-14 text-[9px] text-white/50">{r.ch}</span>
              <div className="flex-1 rounded-full bg-white/10 h-1.5">
                <div className="h-1.5 rounded-full bg-[#3FA9F5]" style={{ width: `${r.pct}%` }} />
              </div>
              <span className="text-[9px] font-bold text-white/70">{r.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    ),
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    step: '04',
    label: 'Grow',
    description: 'Scale what works, eliminate what doesn\'t, and improve continuously with clear direction.',
    color: 'from-[#1478D0] to-[#2387D8]',
    visual: (
      <div className="relative h-28 overflow-hidden rounded-xl bg-white/5 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Growth Signals</span>
          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">↑ +23%</span>
        </div>
        <div className="h-[72px] text-[#3FA9F5]">
          <SparkLine vals={[12, 18, 14, 22, 19, 28, 25, 34, 30, 40]} />
        </div>
      </div>
    ),
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
      </svg>
    ),
  },
];

const CAPABILITIES = [
  {
    id: 'understand',
    color: 'from-[#0A1F44] to-[#0A3872]',
    badge: '01',
    badgeBg: 'bg-[#3FA9F5]/10 text-[#3FA9F5]',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-9v9m3-12v12M3 20.25v-16.5A.75.75 0 0 1 3.75 3h16.5a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
    bgIcon: (
      <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" strokeWidth={0.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-9v9m3-12v12M3 20.25v-16.5A.75.75 0 0 1 3.75 3h16.5a.75.75 0 0 1 .75.75v16.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
    title: 'Understand Your Marketing',
    subtitle: 'Complete visibility before any decision',
    items: [
      'Website & SEO performance analysis',
      'Content readiness across web and social',
      'Campaign diagnostics and health checks',
      'Market signals and trend intelligence',
      'Competitive gap identification',
    ],
    miniVisual: (
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'SEO Health', val: '74', bar: 74, c: '#3FA9F5' },
          { label: 'Content Score', val: '82', bar: 82, c: '#60B5FF' },
          { label: 'Campaign Fit', val: '61', bar: 61, c: '#93C5FD' },
          { label: 'Market Signal', val: '88', bar: 88, c: '#BAE6FD' },
        ].map((m) => (
          <div key={m.label} className="rounded-xl bg-white/5 p-3">
            <p className="text-[9px] text-white/40">{m.label}</p>
            <p className="mt-0.5 text-lg font-bold text-white">{m.val}</p>
            <div className="mt-1.5 h-1 rounded-full bg-white/10">
              <div className="h-1 rounded-full bg-[#3FA9F5]" style={{ width: `${m.bar}%` }} />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'plan',
    color: 'from-[#0A3872] to-[#0A66C2]',
    badge: '02',
    badgeBg: 'bg-[#60B5FF]/10 text-[#60B5FF]',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
    bgIcon: (
      <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" strokeWidth={0.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
    title: 'Plan & Execute Campaigns',
    subtitle: 'From strategy to launch without the chaos',
    items: [
      'Campaign creation and structuring',
      'Multi-channel planning and prioritisation',
      'Trend-based campaign ideas and timing',
      'Auto-posting and scheduling across platforms',
      'Budget allocation guidance',
    ],
    miniVisual: (
      <div className="space-y-2">
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-semibold text-white/40 uppercase tracking-wider">Campaign Planner</span>
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">Active</span>
          </div>
          {['LinkedIn Awareness', 'Email Nurture', 'Retargeting'].map((c, i) => (
            <div key={c} className="flex items-center gap-2 mt-1.5">
              <div className="h-2 w-2 rounded-full bg-[#60B5FF]" style={{ opacity: 1 - i * 0.2 }} />
              <span className="text-[9px] text-white/60">{c}</span>
              <div className="flex-1 rounded-full bg-white/10 h-1">
                <div className="h-1 rounded-full bg-[#60B5FF]" style={{ width: `${85 - i * 20}%`, opacity: 0.7 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[['Channels', '5'], ['Days', '14'], ['Posts', '42']].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white/5 p-2 text-center">
              <p className="text-sm font-bold text-white">{v}</p>
              <p className="text-[8px] text-white/40">{l}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'content',
    color: 'from-[#0A66C2] to-[#1478D0]',
    badge: '03',
    badgeBg: 'bg-[#93C5FD]/10 text-[#93C5FD]',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    ),
    bgIcon: (
      <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" strokeWidth={0.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    ),
    title: 'Create & Optimise Content',
    subtitle: 'Content with intent, not just volume',
    items: [
      'Website and landing page content generation',
      'Social media content across all platforms',
      'Performance-based content improvements',
      'SEO-aligned copy and keyword targeting',
      'Repurposing and format adaptation',
    ],
    miniVisual: (
      <div className="space-y-2">
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2 w-2 rounded-full bg-[#93C5FD] animate-pulse" />
            <span className="text-[9px] font-semibold text-white/50 uppercase tracking-wider">Generating…</span>
          </div>
          <div className="space-y-1.5">
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div className="h-1.5 w-4/5 rounded-full bg-[#93C5FD]/60" />
            </div>
            <div className="h-1.5 w-3/4 rounded-full bg-white/10">
              <div className="h-1.5 w-2/3 rounded-full bg-[#93C5FD]/40" />
            </div>
            <div className="h-1.5 w-1/2 rounded-full bg-white/10">
              <div className="h-1.5 w-2/5 rounded-full bg-[#93C5FD]/30" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['LinkedIn', 'Email', 'Blog', 'Instagram', 'Twitter'].map((p) => (
            <span key={p} className="rounded-full bg-white/10 px-2 py-0.5 text-[8px] font-semibold text-white/60">{p}</span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'engage',
    color: 'from-[#1478D0] to-[#1A7FD4]',
    badge: '04',
    badgeBg: 'bg-[#BAE6FD]/10 text-[#BAE6FD]',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
    bgIcon: (
      <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" strokeWidth={0.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
    title: 'Manage Engagement',
    subtitle: 'One view for every conversation',
    items: [
      'Unified engagement control centre',
      'Cross-platform interaction view',
      'Assisted reply suggestions',
      'Rule-based response automation',
      'Comment and DM prioritisation',
    ],
    miniVisual: (
      <div className="space-y-1.5">
        {[
          { src: 'LinkedIn', msg: 'Great post — how does this…', t: '2m', dot: 'bg-blue-400' },
          { src: 'Instagram', msg: 'Love this! Can you share…', t: '5m', dot: 'bg-pink-400' },
          { src: 'Twitter', msg: 'Agreed, especially the part…', t: '9m', dot: 'bg-sky-400' },
          { src: 'Email', msg: 'Following up on your recent…', t: '14m', dot: 'bg-amber-400' },
        ].map((m) => (
          <div key={m.src} className="flex items-start gap-2 rounded-xl bg-white/5 px-2.5 py-2">
            <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] font-bold text-white/70">{m.src}</span>
                <span className="text-[8px] text-white/30">{m.t}</span>
              </div>
              <p className="truncate text-[9px] text-white/40">{m.msg}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'decisions',
    color: 'from-[#1A7FD4] to-[#2387D8]',
    badge: '05',
    badgeBg: 'bg-[#E0F2FE]/10 text-[#E0F2FE]',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
      </svg>
    ),
    bgIcon: (
      <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" strokeWidth={0.6} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
      </svg>
    ),
    title: 'Make Better Decisions',
    subtitle: 'Clarity over noise',
    items: [
      'Budget and investment recommendations',
      'Growth opportunity identification',
      'Lead signal detection',
      'Campaign performance insights',
      'Prioritisation across channels',
    ],
    miniVisual: (
      <div className="space-y-2">
        <div className="rounded-xl bg-white/5 p-2.5">
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-white/40">Decision Summary</div>
          <div className="h-16 text-[#E0F2FE]">
            <BarChart bars={[20, 32, 24, 38, 28, 42, 36, 44]} />
          </div>
        </div>
        <div className="flex gap-1.5">
          {[
            { label: 'Invest more', c: 'bg-emerald-500/20 text-emerald-300' },
            { label: 'Pause', c: 'bg-red-500/20 text-red-300' },
            { label: 'Scale', c: 'bg-blue-400/20 text-blue-300' },
          ].map((b) => (
            <span key={b.label} className={`flex-1 rounded-full px-2 py-1 text-center text-[8px] font-bold ${b.c}`}>{b.label}</span>
          ))}
        </div>
      </div>
    ),
  },
];

// ── Platform diagram ──────────────────────────────────────────────────────────

function PlatformDiagram() {
  const channels = [
    { label: 'Website', sub: 'SEO & content', x: 50, y: 8 },
    { label: 'Campaigns', sub: 'Plan & launch', x: 85, y: 38 },
    { label: 'Content', sub: 'Create & post', x: 68, y: 78 },
    { label: 'Engagement', sub: 'Respond & track', x: 15, y: 78 },
    { label: 'Analytics', sub: 'Measure & improve', x: 0, y: 38 },
  ];

  return (
    <div className="relative mx-auto h-72 max-w-sm sm:h-80 sm:max-w-md">
      <svg viewBox="0 0 300 240" className="absolute inset-0 h-full w-full" fill="none">
        {/* connecting lines from center to each node */}
        {channels.map((c) => (
          <line
            key={c.label}
            x1="150" y1="120"
            x2={c.x / 100 * 300}
            y2={c.y / 100 * 240}
            stroke="#3FA9F5"
            strokeWidth="1"
            strokeDasharray="3 4"
            opacity="0.3"
          />
        ))}
        {/* outer ring */}
        <circle cx="150" cy="120" r="90" stroke="#0A66C2" strokeWidth="0.5" opacity="0.15" />
        <circle cx="150" cy="120" r="55" stroke="#0A66C2" strokeWidth="0.5" opacity="0.1" />
      </svg>

      {/* Center hub */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A1F44] to-[#0A66C2] shadow-[0_0_32px_rgba(10,102,194,0.6)]">
          <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </div>
        <p className="mt-1 text-center text-[9px] font-bold uppercase tracking-widest text-[#0A66C2]">Omnivyra</p>
      </div>

      {/* Satellite nodes */}
      {channels.map((c) => (
        <div
          key={c.label}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${c.x}%`, top: `${c.y}%` }}
        >
          <div className="rounded-xl border border-[#0A66C2]/20 bg-white px-3 py-2 shadow-[0_2px_12px_rgba(10,31,68,0.10)] text-center min-w-[80px]">
            <p className="text-[10px] font-bold text-[#0B1F33]">{c.label}</p>
            <p className="text-[8px] text-[#6B7C93]">{c.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FeaturesPage() {
  return (
    <>
      <Head>
        <title>Capabilities — Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra is a connected marketing system — campaign management software, SEO analysis tools, content strategy platform, and marketing insights in one place."
        />
        <meta name="keywords" content="marketing automation platform, campaign management software, SEO analysis tools, marketing insights, content strategy platform" />
        <meta property="og:title" content="Capabilities — Omnivyra" />
        <meta property="og:description" content="Everything you need to understand and run your marketing. From insight to execution — one connected system." />
        <meta property="og:type" content="website" />
        <link rel="canonical" href="https://omnivyra.com/features" />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] font-sans antialiased">

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 — HERO
        ════════════════════════════════════════════════════════════════════ */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0A1F44] via-[#0A3872] to-[#0A66C2]">
          <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[#0A66C2]/30 blur-[140px]" />
          <div className="pointer-events-none absolute top-0 right-0 h-80 w-80 rounded-full bg-[#3FA9F5]/20 blur-[100px]" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-56 w-[700px] rounded-full bg-[#0A66C2]/20 blur-[80px]" />

          <div className="relative mx-auto max-w-[1280px] px-6 py-24 sm:py-32 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: text */}
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#3FA9F5]" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/70">Capabilities</span>
                </div>
                <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Everything you need to understand and run your digital marketing
                </h1>
                <p className="mt-6 text-lg leading-relaxed text-white/70">
                  From insight to execution — Omnivyra connects everything into one system so you know what to do and how to do it.
                </p>
                <p className="mt-2 text-sm font-medium text-[#3FA9F5]">
                  No scattered tools. No disconnected decisions.
                </p>
                <div className="mt-10 flex flex-wrap items-center gap-4">
                  <Link
                    href="/get-free-credits"
                    className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#0A1F44] shadow-[0_4px_20px_rgba(255,255,255,0.15)] transition hover:opacity-95"
                  >
                    Get Free Credits
                  </Link>
                  <a
                    href="#how-it-works"
                    className="flex items-center gap-2 rounded-full border border-white/20 px-7 py-3 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
                  >
                    See How It Works
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </a>
                </div>
                {/* Stat pills */}
                <div className="mt-10 flex flex-wrap gap-3">
                  {[
                    { val: '5', label: 'Capability Groups' },
                    { val: '1', label: 'Connected Platform' },
                    { val: '∞', label: 'Clarity' },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-sm">
                      <span className="text-2xl font-bold text-white">{s.val}</span>
                      <span className="text-xs text-white/60">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: platform diagram */}
              <div className="hidden lg:block">
                <PlatformDiagram />
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2 — HOW IT WORKS
        ════════════════════════════════════════════════════════════════════ */}
        <section id="how-it-works" className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mb-14 text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">The System</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                How Omnivyra works
              </h2>
              <p className="mt-3 text-base text-[#6B7C93]">
                Four connected stages — moving from visibility to growth.
              </p>
            </div>

            <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Desktop connector */}
              <div className="pointer-events-none absolute top-[52px] left-[calc(12.5%+12px)] right-[calc(12.5%+12px)] hidden h-px bg-gradient-to-r from-transparent via-[#3FA9F5]/40 to-transparent lg:block" />

              {HOW_IT_WORKS.map((s, i) => (
                <div
                  key={s.label}
                  className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${s.color} p-5`}
                >
                  {/* Dot pattern */}
                  <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
                    style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

                  {/* Header */}
                  <div className="relative mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                      {s.icon}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Step {s.step}</span>
                      <h3 className="text-base font-bold text-white leading-tight">{s.label}</h3>
                    </div>
                  </div>

                  {/* Mini visual */}
                  <div className="relative mb-4">
                    {s.visual}
                  </div>

                  {/* Description */}
                  <p className="relative text-xs leading-relaxed text-white/60">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3 — CORE CAPABILITIES
        ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mb-14 text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">What You Get</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                Core capabilities
              </h2>
              <p className="mt-3 text-base text-[#6B7C93]">
                Grouped by how they serve your marketing — not by feature lists.
              </p>
            </div>

            <div className="space-y-5">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.id}
                  className={`relative overflow-hidden rounded-3xl bg-gradient-to-r ${cap.color}`}
                >
                  {/* Dot pattern */}
                  <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
                    style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
                  {/* Large ghost background icon */}
                  <div className="pointer-events-none absolute right-4 top-4 h-40 w-40 text-white opacity-[0.04]">
                    {cap.bgIcon}
                  </div>

                  <div className="relative grid gap-8 p-8 sm:p-10 lg:grid-cols-3 lg:gap-10">
                    {/* Col 1: title */}
                    <div className="flex flex-col justify-between">
                      <div>
                        <div className="mb-4 flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cap.badgeBg}`}>
                            {cap.icon}
                          </div>
                          <span className={`text-xs font-bold uppercase tracking-widest ${cap.badgeBg} rounded-full px-3 py-1`}>
                            {cap.badge}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-white sm:text-2xl">{cap.title}</h3>
                        <p className="mt-2 text-sm text-white/60">{cap.subtitle}</p>
                      </div>
                      <div className="mt-6 hidden lg:block">
                        <Link
                          href="/get-free-credits"
                          className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white/70 transition hover:border-white/40 hover:text-white"
                        >
                          Try this
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                        </Link>
                      </div>
                    </div>

                    {/* Col 2: bullet points */}
                    <ul className="space-y-3">
                      {cap.items.map((item) => (
                        <li key={item} className="flex items-start gap-3">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#3FA9F5]" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span className="text-sm leading-relaxed text-white/80">{item}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Col 3: mini visual mockup */}
                    <div className="rounded-2xl bg-white/5 p-4">
                      {cap.miniVisual}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 4 — WHAT MAKES THIS DIFFERENT
        ════════════════════════════════════════════════════════════════════ */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mb-14 text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">The Difference</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                Not just tools. A connected system.
              </h2>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Most platforms */}
              <div className="rounded-3xl border border-red-100 bg-red-50/60 p-8">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                    <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#0B1F33]">Most platforms</h3>
                    <p className="text-xs text-[#6B7C93]">What you usually get</p>
                  </div>
                </div>

                {/* Chaos visual: scattered tool icons */}
                <div className="mb-5 relative h-24 overflow-hidden rounded-2xl bg-red-100/40 p-3">
                  <div className="absolute inset-0 flex flex-wrap gap-2 p-3 opacity-60">
                    {['SEO', 'Email', 'Ads', 'CRM', 'Analytics', 'Social', 'CMS', 'Leads'].map((t, i) => (
                      <span
                        key={t}
                        className="rounded-lg bg-red-200/60 px-2 py-1 text-[9px] font-semibold text-red-700"
                        style={{ transform: `rotate(${(i % 2 === 0 ? 1 : -1) * (i + 1) * 2}deg)` }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-full bg-red-200/80 px-3 py-1 text-[10px] font-bold text-red-600">No clear picture</span>
                  </div>
                </div>

                <ul className="space-y-3">
                  {['Separate tools for every task', 'Fragmented data with no context', 'Manual interpretation required', 'Constant tab-switching', 'No clear next step'].map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm text-[#6B7C93]">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Center quote */}
              <div className="relative flex flex-col items-center justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-[#0A1F44] to-[#0A66C2] p-8 text-center">
                <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
                  style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

                {/* Top icon */}
                <div className="relative mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>

                <blockquote className="relative text-xl font-bold leading-snug text-white sm:text-2xl">
                  "You don't need more tools.
                  <br />
                  You need clarity across them."
                </blockquote>

                <div className="relative mt-6 w-full">
                  <div className="mb-5 h-px w-full bg-white/10" />
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[['Clarity', '✓'], ['Control', '✓'], ['Direction', '✓']].map(([l, v]) => (
                      <div key={l} className="rounded-xl bg-white/8 py-2">
                        <p className="text-sm font-bold text-[#3FA9F5]">{v}</p>
                        <p className="text-[10px] text-white/50">{l}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="relative mt-5 text-sm text-white/60">
                  One system. Every signal. Clear direction.
                </p>
              </div>

              {/* Omnivyra */}
              <div className="rounded-3xl border border-[#0A66C2]/15 bg-[#F0F7FF] p-8">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0A66C2]/10">
                    <svg className="h-5 w-5 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#0B1F33]">Omnivyra</h3>
                    <p className="text-xs text-[#6B7C93]">What you actually need</p>
                  </div>
                </div>

                {/* Connected visual */}
                <div className="mb-5 relative h-24 overflow-hidden rounded-2xl bg-[#0A66C2]/5 p-3">
                  <div className="absolute inset-0 text-[#0A66C2] p-2 opacity-30">
                    <NodeGraph />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-full bg-[#0A66C2]/10 px-3 py-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#0A66C2] animate-pulse" />
                      <span className="text-[10px] font-bold text-[#0A66C2]">All connected</span>
                    </div>
                  </div>
                </div>

                <ul className="space-y-3">
                  {['Everything connected in one system', 'Data that talks to each other', 'Insight automatically surfaced', 'One workflow, start to finish', 'Always a clear next action'].map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-sm text-[#0B1F33]">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5 — USE CASES
        ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mb-14 text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">In Practice</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                What this looks like in practice
              </h2>
              <p className="mt-3 text-base text-[#6B7C93]">
                Three moments where Omnivyra gives you the clarity you need.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
              {/* Before campaign */}
              <div className="overflow-hidden rounded-3xl border border-[#0A66C2]/15 bg-[#F0F7FF]">
                <div className="bg-[#0A1F44] px-6 py-4">
                  <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
                    Before running a campaign
                  </span>
                </div>
                <div className="p-6">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A66C2]/10">
                    <svg className="h-7 w-7 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-[#0B1F33]">Know if you're ready</h3>
                  <p className="mb-5 text-sm leading-relaxed text-[#6B7C93]">
                    Check if your content, funnel, and targeting are aligned — before committing spend.
                  </p>
                  {/* Readiness checklist mock */}
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Launch Readiness</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Landing page optimised', done: true },
                        { label: 'Audience segments defined', done: true },
                        { label: 'Budget allocated', done: true },
                        { label: 'Creative assets ready', done: false },
                        { label: 'Tracking pixels live', done: false },
                      ].map((it) => (
                        <div key={it.label} className="flex items-center gap-2">
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${it.done ? 'bg-[#0A66C2]' : 'border border-gray-200'}`}>
                            {it.done && (
                              <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            )}
                          </div>
                          <span className={`text-xs ${it.done ? 'text-[#0B1F33]' : 'text-[#6B7C93]'}`}>{it.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                        <div className="h-1.5 w-3/5 rounded-full bg-[#0A66C2]" />
                      </div>
                      <span className="text-[10px] font-bold text-[#0A66C2]">60%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* While executing */}
              <div className="overflow-hidden rounded-3xl border border-[#0A66C2]/20 bg-gradient-to-br from-[#0A3872] to-[#0A66C2]">
                <div className="bg-white/10 px-6 py-4">
                  <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
                    While executing
                  </span>
                </div>
                <div className="p-6">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                    <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-white">Track and adjust in real time</h3>
                  <p className="mb-5 text-sm leading-relaxed text-white/70">
                    Monitor performance across channels and course-correct before issues compound.
                  </p>
                  {/* Live metrics mock */}
                  <div className="rounded-2xl bg-white/5 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">Live Performance</p>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[9px] text-emerald-300">Live</span>
                      </div>
                    </div>
                    <div className="h-16 text-[#3FA9F5] mb-3">
                      <SparkLine vals={[10, 14, 12, 18, 15, 22, 20, 26, 24, 30]} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[['CTR', '3.4%', '+0.6%'], ['Conv', '218', '+12'], ['CPC', '£0.82', '-£0.14']].map(([l, v, d]) => (
                        <div key={l} className="text-center">
                          <p className="text-[8px] text-white/40">{l}</p>
                          <p className="text-sm font-bold text-white">{v}</p>
                          <p className="text-[8px] text-emerald-300">{d}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* After launch */}
              <div className="overflow-hidden rounded-3xl border border-[#0A66C2]/15 bg-[#F0F7FF]">
                <div className="bg-[#0A66C2] px-6 py-4">
                  <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                    After launch
                  </span>
                </div>
                <div className="p-6">
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0A66C2]/10">
                    <svg className="h-7 w-7 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
                    </svg>
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-[#0B1F33]">Learn what actually worked</h3>
                  <p className="mb-5 text-sm leading-relaxed text-[#6B7C93]">
                    Identify what drove results, what didn't, and what to improve next time.
                  </p>
                  {/* Post-campaign analysis mock */}
                  <div className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Post-Campaign Insights</p>
                    {[
                      { label: 'LinkedIn Ads', result: 'Scale ↑', c: 'text-emerald-600 bg-emerald-50' },
                      { label: 'Email sequence', result: 'Optimise', c: 'text-amber-600 bg-amber-50' },
                      { label: 'Display retargeting', result: 'Pause', c: 'text-red-600 bg-red-50' },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-xs text-[#0B1F33]">{r.label}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${r.c}`}>{r.result}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 6 — FINAL CTA
        ════════════════════════════════════════════════════════════════════ */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0A1F44] via-[#0A3872] to-[#0A66C2] px-8 py-16 text-center sm:px-16 sm:py-20">
              <div className="pointer-events-none absolute -top-20 -left-20 h-64 w-64 rounded-full bg-[#3FA9F5]/20 blur-[80px]" />
              <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-[#0A66C2]/30 blur-[80px]" />
              <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
                style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

              <div className="relative">
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">Ready to start</p>
                <h2 className="mx-auto max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
                  Clarity changes how you approach everything
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-base text-white/70">
                  Stop guessing. Start acting with direction.
                </p>

                <div className="mt-10 flex flex-wrap justify-center gap-4">
                  <Link
                    href="/get-free-credits"
                    className="rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-[#0A1F44] shadow-[0_4px_24px_rgba(255,255,255,0.15)] transition hover:opacity-95"
                  >
                    Get Free Credits
                  </Link>
                  <Link
                    href="/pricing"
                    className="rounded-full border border-white/20 px-8 py-3.5 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
                  >
                    See Pricing
                  </Link>
                </div>

                <div className="mt-10 flex flex-wrap justify-center gap-6 text-xs text-white/50">
                  {['No credit card required', 'Free credits included', 'Ready in minutes'].map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
