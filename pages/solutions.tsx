'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/landing/Footer';

// ── Inline visual components ──────────────────────────────────────────────────

function SparkLine({ vals, color = '#0A66C2' }: { vals: number[]; color?: string }) {
  const w = 120, h = 40;
  const max = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} fill="none" className="w-full h-full">
      <polyline points={pts} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle
        cx={(vals.length - 1) / (vals.length - 1) * w}
        cy={h - (vals[vals.length - 1] / max) * (h - 4) - 2}
        r="3" fill={color}
      />
    </svg>
  );
}

function BarRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[10px] text-[#6B7C93]">{label}</span>
      <div className="flex-1 rounded-full bg-gray-100 h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold text-[#0B1F33]">{pct}%</span>
    </div>
  );
}

// ── Section visual panels ─────────────────────────────────────────────────────

const MARKETER_VISUALS: React.ReactNode[] = [
  // 0 — Challenge: scattered tools chaos
  <div className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Your typical Tuesday</p>
    <div className="flex flex-wrap gap-2 mb-4">
      {['Google Ads', 'HubSpot', 'LinkedIn Ads', 'Metabase', 'Looker', 'Salesforce', 'Mailchimp', 'Agency deck'].map((t, i) => (
        <span key={t} className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-[#6B7C93] shadow-sm"
          style={{ transform: `rotate(${(i % 2 === 0 ? 1 : -1) * (i % 3 + 1)}deg)` }}>
          {t}
        </span>
      ))}
    </div>
    <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
      <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <span className="text-[10px] font-semibold text-red-600">No single source of truth</span>
    </div>
  </div>,

  // 1 — What Omnivyra does: unified signal
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-[#F0F7FF] p-4">
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Omnivyra Signal Layer</p>
      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
      </span>
    </div>
    <div className="space-y-2">
      {[
        { ch: 'LinkedIn', status: 'Converting', c: 'bg-emerald-100 text-emerald-700', pct: 82 },
        { ch: 'Email', status: 'Optimise', c: 'bg-amber-100 text-amber-700', pct: 54 },
        { ch: 'Google Ads', status: 'Underperforming', c: 'bg-red-100 text-red-700', pct: 31 },
      ].map((r) => (
        <div key={r.ch} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-[#0B1F33]">{r.ch}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${r.c}`}>{r.status}</span>
            </div>
            <div className="h-1 rounded-full bg-gray-100">
              <div className="h-1 rounded-full bg-[#0A66C2]" style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>,

  // 2 — Signal not noise: 17→1 dashboards
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
    <div className="grid grid-cols-2 gap-3 mb-3">
      <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
        <p className="text-2xl font-bold text-red-400">17</p>
        <p className="text-[9px] text-red-400">dashboards before</p>
        <div className="mt-1.5 flex flex-wrap gap-1 justify-center">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-2 w-4 rounded-sm bg-red-200" style={{ opacity: 0.4 + i * 0.1 }} />
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-[#F0F7FF] border border-[#0A66C2]/15 p-3 text-center">
        <p className="text-2xl font-bold text-[#0A66C2]">1</p>
        <p className="text-[9px] text-[#0A66C2]">decision layer now</p>
        <div className="mt-2 flex items-center justify-center">
          <div className="h-8 w-8 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center">
            <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div className="rounded-xl bg-[#F5F9FF] p-2.5">
      <p className="text-[9px] text-[#6B7C93]">Every alert includes <span className="font-semibold text-[#0B1F33]">context</span> and a <span className="font-semibold text-[#0B1F33]">clear next step</span></p>
    </div>
  </div>,

  // 3 — Campaign planning: skeleton
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-[#F0F7FF] p-4">
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Campaign Skeleton</p>
      <span className="rounded-full bg-[#0A66C2] px-2 py-0.5 text-[9px] font-bold text-white">Built in &lt;10 min</span>
    </div>
    <div className="space-y-1.5">
      {[
        { week: 'Wk 1', task: 'Audience brief + creative', ch: 'LinkedIn', done: true },
        { week: 'Wk 2', task: 'Launch awareness push', ch: 'LinkedIn + Email', done: true },
        { week: 'Wk 3', task: 'Retargeting & nurture', ch: 'Email + Display', done: false },
        { week: 'Wk 4', task: 'Review + optimise', ch: 'All channels', done: false },
      ].map((r) => (
        <div key={r.week} className={`flex items-start gap-2 rounded-lg p-2 ${r.done ? 'bg-white shadow-sm' : 'bg-white/50 border border-dashed border-[#0A66C2]/20'}`}>
          <span className="mt-0.5 text-[9px] font-bold text-[#0A66C2] w-8 shrink-0">{r.week}</span>
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-[#0B1F33]">{r.task}</p>
            <p className="text-[9px] text-[#6B7C93]">{r.ch}</p>
          </div>
          {r.done && (
            <svg className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </div>
      ))}
    </div>
  </div>,

  // 4 — Reporting done: performance narrative
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0A66C2]/10">
        <svg className="h-4 w-4 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Performance Summary</p>
    </div>
    <div className="h-16 mb-3">
      <SparkLine vals={[18, 22, 19, 28, 24, 33, 30, 38, 36, 44]} color="#0A66C2" />
    </div>
    <div className="grid grid-cols-3 gap-2 mb-3">
      {[['Leads', '↑ 34%', 'text-emerald-600'], ['CAC', '↓ 18%', 'text-emerald-600'], ['ROAS', '3.2×', 'text-[#0A66C2]']].map(([l, v, c]) => (
        <div key={l} className="rounded-lg bg-[#F5F9FF] p-2 text-center">
          <p className={`text-sm font-bold ${c}`}>{v}</p>
          <p className="text-[9px] text-[#6B7C93]">{l}</p>
        </div>
      ))}
    </div>
    <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2">
      <p className="text-[10px] font-semibold text-emerald-700">Review prep: 2 min instead of a weekend</p>
    </div>
  </div>,
];

const FOUNDER_VISUALS: React.ReactNode[] = [
  // 0 — Challenge: time scattered
  <div className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Your week looks like this</p>
    <div className="space-y-2">
      {[
        { task: 'Operations & customer support', pct: 45, c: '#6B7C93' },
        { task: 'Sales calls & follow-ups', pct: 30, c: '#6B7C93' },
        { task: 'Product & team', pct: 18, c: '#6B7C93' },
        { task: 'Marketing', pct: 7, c: '#DC2626' },
      ].map((r) => (
        <div key={r.task}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-[#6B7C93]">{r.task}</span>
            <span className="text-[10px] font-bold" style={{ color: r.c }}>{r.pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200">
            <div className="h-1.5 rounded-full" style={{ width: `${r.pct}%`, backgroundColor: r.c }} />
          </div>
        </div>
      ))}
    </div>
    <p className="mt-3 text-[10px] text-red-500 font-semibold">Marketing always slides to the bottom</p>
  </div>,

  // 1 — What Omnivyra does: action list
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-[#F0F7FF] p-4">
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Your next 30 minutes</p>
      <span className="rounded-full bg-[#0A66C2] px-2 py-0.5 text-[9px] font-bold text-white">3 actions</span>
    </div>
    <div className="space-y-2">
      {[
        { priority: '1', action: 'Post LinkedIn update on new feature', time: '8 min', tag: 'Content' },
        { priority: '2', action: 'Respond to 4 warm leads in inbox', time: '12 min', tag: 'Engagement' },
        { priority: '3', action: 'Review ad spend — pause underperformer', time: '5 min', tag: 'Campaign' },
      ].map((a) => (
        <div key={a.action} className="flex items-start gap-2.5 rounded-xl bg-white p-2.5 shadow-sm">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-[9px] font-bold text-white">{a.priority}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-[#0B1F33] leading-tight">{a.action}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded bg-[#0A66C2]/10 px-1.5 py-0.5 text-[8px] font-semibold text-[#0A66C2]">{a.tag}</span>
              <span className="text-[8px] text-[#6B7C93]">{a.time}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>,

  // 2 — A plan you can follow: weekly skeleton
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Your weekly plan</p>
      <span className="text-[9px] text-[#6B7C93]">Adjusted to 4h/week</span>
    </div>
    <div className="grid grid-cols-5 gap-1 mb-2">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
        <div key={d} className="text-center">
          <p className="text-[8px] text-[#6B7C93] mb-1">{d}</p>
          <div className={`rounded-lg p-1.5 ${i === 1 || i === 3 ? 'bg-[#0A66C2]' : i === 0 ? 'bg-[#0A66C2]/20' : 'bg-gray-100'}`}>
            <p className="text-[8px] font-semibold leading-tight text-center" style={{ color: i === 1 || i === 3 ? 'white' : i === 0 ? '#0A66C2' : '#6B7C93' }}>
              {['Plan', 'Post', 'Rest', 'Engage', 'Review'][i]}
            </p>
          </div>
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {[
        { day: 'Tue', task: '1× LinkedIn post + 1× story', done: true },
        { day: 'Thu', task: 'Reply to comments + 3 DMs', done: true },
        { day: 'Fri', task: 'Check metrics — 10 min review', done: false },
      ].map((r) => (
        <div key={r.task} className="flex items-center gap-2 rounded-lg bg-[#F5F9FF] px-2.5 py-1.5">
          <div className={`h-3.5 w-3.5 shrink-0 rounded-full flex items-center justify-center ${r.done ? 'bg-[#0A66C2]' : 'border border-gray-300'}`}>
            {r.done && <svg className="h-2 w-2 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          </div>
          <span className="text-[9px] text-[#0B1F33]"><span className="font-bold text-[#0A66C2]">{r.day}:</span> {r.task}</span>
        </div>
      ))}
    </div>
  </div>,

  // 3 — Know what is working: channel breakdown
  <div className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">What's actually driving results</p>
    <div className="space-y-2.5">
      <BarRow label="LinkedIn" pct={62} color="#0A66C2" />
      <BarRow label="Email" pct={24} color="#3FA9F5" />
      <BarRow label="Instagram" pct={10} color="#60B5FF" />
      <BarRow label="Twitter/X" pct={4} color="#93C5FD" />
    </div>
    <div className="mt-3 rounded-xl bg-[#0A66C2]/8 border border-[#0A66C2]/15 px-3 py-2">
      <p className="text-[10px] font-semibold text-[#0A66C2]">→ Double down on LinkedIn. Pause Twitter.</p>
    </div>
  </div>,

  // 4 — Grow without hiring: value comparison
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">What you get vs. what you pay</p>
    <div className="grid grid-cols-2 gap-3 mb-3">
      <div className="rounded-xl bg-red-50 border border-red-100 p-3">
        <p className="text-[9px] text-red-400 font-semibold mb-1">Marketing hire</p>
        <p className="text-xl font-bold text-red-500">£4–6k</p>
        <p className="text-[8px] text-red-400">per month</p>
        <div className="mt-2 space-y-1">
          {['Strategy', 'Execution', 'Reporting'].map((i) => (
            <div key={i} className="flex items-center gap-1">
              <svg className="h-3 w-3 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-[8px] text-red-400">{i}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-[#F0F7FF] border border-[#0A66C2]/15 p-3">
        <p className="text-[9px] text-[#0A66C2] font-semibold mb-1">Omnivyra</p>
        <p className="text-xl font-bold text-[#0A66C2]">Fraction</p>
        <p className="text-[8px] text-[#0A66C2]/70">of that cost</p>
        <div className="mt-2 space-y-1">
          {['Strategy', 'Execution', 'Reporting', 'Intelligence'].map((i) => (
            <div key={i} className="flex items-center gap-1">
              <svg className="h-3 w-3 text-[#0A66C2]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-[8px] text-[#0A66C2]">{i}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
    <div className="rounded-xl bg-[#F5F9FF] px-3 py-2">
      <p className="text-[10px] font-semibold text-[#0B1F33]">The thinking of a team. The cost of a tool.</p>
    </div>
  </div>,
];

const CREATOR_VISUALS: React.ReactNode[] = [
  // 0 — Challenge: inconsistent growth
  <div className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-4">
    <div className="mb-2 flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Your growth — last 10 posts</p>
    </div>
    <div className="h-20 mb-3">
      <SparkLine vals={[40, 12, 380, 22, 14, 210, 18, 44, 8, 195]} color="#0A66C2" />
    </div>
    <div className="flex gap-2">
      <div className="flex-1 rounded-xl bg-emerald-50 border border-emerald-100 p-2 text-center">
        <p className="text-sm font-bold text-emerald-600">3</p>
        <p className="text-[9px] text-emerald-500">Posts hit</p>
      </div>
      <div className="flex-1 rounded-xl bg-red-50 border border-red-100 p-2 text-center">
        <p className="text-sm font-bold text-red-500">7</p>
        <p className="text-[9px] text-red-400">Landed flat</p>
      </div>
      <div className="flex-1 rounded-xl bg-amber-50 border border-amber-100 p-2 text-center">
        <p className="text-sm font-bold text-amber-600">?</p>
        <p className="text-[9px] text-amber-500">Reason unknown</p>
      </div>
    </div>
  </div>,

  // 1 — What Omnivyra does: content patterns
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-[#F0F7FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">What performs for your audience</p>
    <div className="space-y-2">
      {[
        { topic: 'Behind-the-scenes', format: 'Short video', score: 94 },
        { topic: 'Industry opinion', format: 'Long-form post', score: 87 },
        { topic: 'Tutorial / how-to', format: 'Carousel', score: 76 },
        { topic: 'Personal story', format: 'Text post', score: 61 },
      ].map((r) => (
        <div key={r.topic} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-[#0B1F33]">{r.topic}</span>
              <span className="text-[10px] font-bold text-[#0A66C2]">{r.score}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1 rounded-full bg-gray-100">
                <div className="h-1 rounded-full bg-[#0A66C2]" style={{ width: `${r.score}%` }} />
              </div>
              <span className="text-[8px] text-[#6B7C93]">{r.format}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>,

  // 2 — Strategy: content map
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Your content map</p>
    <div className="grid grid-cols-3 gap-2 mb-3">
      {[
        { theme: 'Education', posts: 3, c: 'bg-[#0A66C2]/10 text-[#0A66C2] border-[#0A66C2]/20' },
        { theme: 'Inspiration', posts: 2, c: 'bg-purple-50 text-purple-600 border-purple-100' },
        { theme: 'Promotion', posts: 1, c: 'bg-amber-50 text-amber-600 border-amber-100' },
      ].map((t) => (
        <div key={t.theme} className={`rounded-xl border p-2.5 text-center ${t.c}`}>
          <p className="text-lg font-bold">{t.posts}×</p>
          <p className="text-[9px] font-semibold">{t.theme}</p>
          <p className="text-[8px] opacity-70">per week</p>
        </div>
      ))}
    </div>
    <div className="space-y-1">
      {['LinkedIn post — Mon & Wed', 'Instagram reel — Tue', 'Newsletter — Thu', 'Story + poll — Fri'].map((s) => (
        <div key={s} className="flex items-center gap-2 rounded-lg bg-[#F5F9FF] px-2.5 py-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-[#0A66C2] shrink-0" />
          <span className="text-[10px] text-[#0B1F33]">{s}</span>
        </div>
      ))}
    </div>
  </div>,

  // 3 — Channel intelligence: platform breakdown
  <div className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#6B7C93]">Where your audience actually is</p>
    <div className="space-y-2.5">
      {[
        { platform: 'LinkedIn', strength: 'Reach + authority', score: 88, c: '#0A66C2' },
        { platform: 'Instagram', strength: 'Engagement + discovery', score: 72, c: '#E1306C' },
        { platform: 'YouTube', strength: 'Long-form watch time', score: 45, c: '#FF0000' },
        { platform: 'Twitter/X', strength: 'Conversation + trends', score: 33, c: '#14171A' },
      ].map((r) => (
        <div key={r.platform}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="text-[10px] font-semibold text-[#0B1F33]">{r.platform}</span>
              <span className="ml-2 text-[9px] text-[#6B7C93]">{r.strength}</span>
            </div>
            <span className="text-[10px] font-bold" style={{ color: r.c }}>{r.score}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200">
            <div className="h-1.5 rounded-full" style={{ width: `${r.score}%`, backgroundColor: r.c }} />
          </div>
        </div>
      ))}
    </div>
  </div>,

  // 4 — From creator to brand: profile card
  <div className="rounded-2xl border border-[#0A66C2]/10 bg-[#F0F7FF] p-4">
    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#0A66C2]">Your creator profile</p>
    <div className="grid grid-cols-2 gap-2 mb-3">
      {[
        { label: 'Avg. engagement', val: '4.8%', trend: '↑', c: 'text-emerald-600' },
        { label: 'Posting consistency', val: '91%', trend: '↑', c: 'text-emerald-600' },
        { label: 'Audience growth', val: '+340/mo', trend: '↑', c: 'text-emerald-600' },
        { label: 'Top content', val: 'Education', trend: '', c: 'text-[#0A66C2]' },
      ].map((m) => (
        <div key={m.label} className="rounded-xl bg-white p-2.5 shadow-sm">
          <p className="text-[8px] text-[#6B7C93]">{m.label}</p>
          <p className={`text-sm font-bold ${m.c}`}>{m.val} <span className="text-xs">{m.trend}</span></p>
        </div>
      ))}
    </div>
    <div className="rounded-xl bg-[#0A66C2] px-3 py-2 text-center">
      <p className="text-[10px] font-semibold text-white">Ready to pitch to brands & investors</p>
    </div>
  </div>,
];

const PERSONA_VISUALS = [MARKETER_VISUALS, FOUNDER_VISUALS, CREATOR_VISUALS];

// ── Persona data ──────────────────────────────────────────────────────────────

const PERSONAS = [
  {
    id: 'marketer',
    tab: 'I run marketing',
    initials: 'MK',
    role: 'Marketing Manager / Director',
    intro: 'You are responsible for results across channels, teams, and budgets. You need clarity — not more reports.',
    sections: [
      {
        title: 'The challenge you live with',
        body: 'You are juggling five platforms, two agencies, a spreadsheet from finance, and a VP who wants weekly updates. You know your campaigns are running — you just cannot tell which ones are actually working and why.',
        bullets: [
          'Five or more platforms with no shared context',
          'Reporting takes hours and still misses the story',
          'Teams misaligned — each channel works in isolation',
          'Budget decisions made on incomplete signals',
        ],
        metrics: [
          { val: '5+', label: 'Platforms juggled' },
          { val: '3h', label: 'Weekly reporting' },
          { val: '0', label: 'Clear source of truth' },
        ],
      },
      {
        title: 'What Omnivyra does for you',
        body: 'It surfaces the decisions that matter: which channel is underperforming, which segment is converting, which content is being ignored. No setup, no data engineering — just intelligence ready when you open it.',
        bullets: [
          'Underperforming channels flagged instantly with context',
          'Converting segments identified, not just reported',
          'Ignored content rises to the surface automatically',
          'Zero setup — intelligence ready from day one',
        ],
        metrics: [
          { val: '1', label: 'Unified platform' },
          { val: '<1 min', label: 'To clarity' },
          { val: '100%', label: 'Signal confidence' },
        ],
      },
      {
        title: 'The signal, not the noise',
        body: 'Instead of seventeen dashboards you never fully trust, you get a single decision layer. When something changes — good or bad — you know immediately, with context and a clear next step.',
        bullets: [
          'Single decision layer replaces 17+ dashboards',
          'Every alert includes context, not just a number',
          'Changes surface with a clear next action',
          'Nothing important falls through the cracks',
        ],
        metrics: [
          { val: '17→1', label: 'Dashboards reduced' },
          { val: 'Always', label: 'Context included' },
          { val: '∞', label: 'Signal coverage' },
        ],
      },
      {
        title: 'Campaign planning without the chaos',
        body: 'Build a full campaign skeleton in minutes. Define your strategy, let AI map it to a weekly execution plan, then refine it with your team. Every activity connects to the goal — not just a calendar slot.',
        bullets: [
          'Full campaign skeleton generated in under 10 minutes',
          'AI maps strategy to a weekly execution plan',
          'Team can collaborate and refine inside the platform',
          'Every activity is goal-linked, not just scheduled',
        ],
        metrics: [
          { val: '<10 min', label: 'Campaign plan' },
          { val: '100%', label: 'Goal aligned' },
          { val: '0', label: 'Missed connections' },
        ],
      },
      {
        title: 'Your reporting, done',
        body: 'Stop assembling slide decks. Omnivyra compiles the story of your marketing performance — what worked, what did not, and what you did about it — so your next review takes minutes, not a weekend.',
        bullets: [
          'Performance narrative auto-compiled across channels',
          'Covers what worked, what didn\'t, and the reasons why',
          'Stakeholder-ready without manual assembly',
          'Next review: 2 minutes, not a full weekend',
        ],
        metrics: [
          { val: '90%', label: 'Time saved' },
          { val: '2 min', label: 'Review prep' },
          { val: '0', label: 'Manual slide decks' },
        ],
      },
    ],
  },
  {
    id: 'founder',
    tab: 'I do everything myself',
    initials: 'FD',
    role: 'Founder / Solo Operator',
    intro: 'You wear every hat. Marketing is important but it is not the only thing on your plate — you need it to work without consuming your day.',
    sections: [
      {
        title: 'The challenge you live with',
        body: 'You post when you remember to. You boost ads without a clear strategy. You know you should be more consistent but between operations, sales, and everything else, marketing slides to the bottom of the list.',
        bullets: [
          'Marketing only happens when everything else is done',
          'No clear strategy — boosting posts without direction',
          'Inconsistent output means inconsistent growth',
          'No time to analyse what is or isn\'t working',
        ],
        metrics: [
          { val: '7%', label: 'Time on marketing' },
          { val: '0', label: 'Clear strategy' },
          { val: '∞', label: 'Other priorities' },
        ],
      },
      {
        title: 'What Omnivyra does for you',
        body: 'It tells you exactly what to do, when to do it, and why — so you spend less time wondering and more time executing. Even 30 minutes a week becomes productive when you know where to focus.',
        bullets: [
          'Exact next actions — no guessing required',
          'Tells you what to do and why it matters now',
          '30 minutes a week becomes genuinely productive',
          'Focus replaces scattered effort instantly',
        ],
        metrics: [
          { val: '30 min', label: 'Per week needed' },
          { val: '3', label: 'Clear next actions' },
          { val: '100%', label: 'Time well spent' },
        ],
      },
      {
        title: 'A plan you can actually follow',
        body: 'Answer a few questions about your goals and audience. Omnivyra builds a realistic weekly marketing plan — content types, channels, timing — tailored to how much time you actually have.',
        bullets: [
          'Realistic plan built around your actual available time',
          'Content types, channels, and timing all decided for you',
          'Adjusts automatically as your schedule changes',
          'You follow a plan — not a vague set of good intentions',
        ],
        metrics: [
          { val: '5 min', label: 'Setup time' },
          { val: '1 week', label: 'Plan horizon' },
          { val: '100%', label: 'Tailored to you' },
        ],
      },
      {
        title: 'Know what is working',
        body: 'Stop guessing whether your LinkedIn post helped or whether the email campaign converted. Get clear signal on what is driving results so you double down on what works and cut what does not.',
        bullets: [
          'Clear signal — no guessing which channel drove results',
          'Top-performing topics and formats identified for you',
          'Underperforming activities flagged before money is wasted',
          'Double down on what works, cut what does not',
        ],
        metrics: [
          { val: '62%', label: 'Top channel (LinkedIn)' },
          { val: 'Instant', label: 'Performance signal' },
          { val: '0', label: 'Guesswork remaining' },
        ],
      },
      {
        title: 'Grow without hiring',
        body: 'Omnivyra gives you the thinking of a marketing team without the headcount. Strategy, execution priorities, and performance signals — all in one place, built for one person moving fast.',
        bullets: [
          'Strategy, execution, and reporting — all in one place',
          'Built for solo operators who move fast and need results',
          'No agency fees, no freelancer management overhead',
          'Scales with you as your business grows',
        ],
        metrics: [
          { val: '1', label: 'Person needed' },
          { val: 'Team', label: 'Thinking power' },
          { val: '£0', label: 'Extra headcount' },
        ],
      },
    ],
  },
  {
    id: 'creator',
    tab: 'I create & grow content',
    initials: 'CR',
    role: 'Content Creator / Personal Brand',
    intro: 'Your content is your business. You need to know what resonates, where to grow, and how to turn an audience into something sustainable.',
    sections: [
      {
        title: 'The challenge you live with',
        body: 'You are creating consistently but growth feels inconsistent. Some posts blow up, others land flat. You do not always know why — and the platforms keep changing the rules.',
        bullets: [
          'Consistent effort, wildly inconsistent results',
          'No clear pattern — some posts soar, most land flat',
          'Platform algorithms change and you adapt blindly',
          'No framework for replicating what works',
        ],
        metrics: [
          { val: '30%', label: 'Posts that perform' },
          { val: '70%', label: 'Miss the mark' },
          { val: '?', label: 'Reason known' },
        ],
      },
      {
        title: 'What Omnivyra does for you',
        body: 'It analyses your content performance across platforms and shows you the patterns: which topics drive engagement, which formats get reach, which times your audience is actually active.',
        bullets: [
          'Content performance analysed across all your platforms',
          'Topics that drive engagement ranked and explained',
          'Formats that get reach vs. formats that get buried',
          'Optimal posting times for your specific audience',
        ],
        metrics: [
          { val: '94', label: 'Top content score' },
          { val: '4', label: 'Topics ranked' },
          { val: 'Clear', label: 'What works & why' },
        ],
      },
      {
        title: 'Strategy behind the content',
        body: 'Great content is not just creative — it is structured. Omnivyra helps you build a content strategy that maps your themes, formats, and cadence to your growth goals, not just your inspiration.',
        bullets: [
          'Content themes mapped to audience growth goals',
          'Format and cadence decided — not left to inspiration',
          'Education, inspiration, and promotion balanced correctly',
          'Consistent output replaces reactive posting',
        ],
        metrics: [
          { val: '3', label: 'Content themes' },
          { val: '6', label: 'Posts per week' },
          { val: '100%', label: 'Goal aligned' },
        ],
      },
      {
        title: 'Channel-by-channel intelligence',
        body: 'LinkedIn is different from Instagram. Instagram is different from YouTube. Omnivyra tells you where your specific audience is, how they behave, and what kind of content drives them to follow, share, or act.',
        bullets: [
          'Each platform treated differently, as it should be',
          'Where your specific audience actually spends time',
          'What content type drives follows, shares, and action',
          'Which platform to invest in now vs. later',
        ],
        metrics: [
          { val: '4', label: 'Platforms analysed' },
          { val: '88', label: 'LinkedIn score' },
          { val: '1', label: 'Platform to focus on' },
        ],
      },
      {
        title: 'From creator to brand',
        body: 'When you are ready to monetise, partner, or scale — Omnivyra gives you the data story that makes the case. Engagement rates, audience profile, content consistency: everything a brand or investor needs to see.',
        bullets: [
          'Data story ready for brand partnerships and investors',
          'Engagement rate, audience profile, and consistency tracked',
          'Clear proof that your audience is real and active',
          'The narrative a brand partner needs to say yes',
        ],
        metrics: [
          { val: '4.8%', label: 'Avg. engagement' },
          { val: '91%', label: 'Posting consistency' },
          { val: '+340', label: 'Followers / month' },
        ],
      },
    ],
  },
];

// ── Remaining data ────────────────────────────────────────────────────────────

const UNIFIED_VALUES = [
  {
    icon: '⚡',
    title: 'One place for all signals',
    body: 'Your social accounts, campaigns, website, and content — connected and interpreted together.',
  },
  {
    icon: '🎯',
    title: 'Decisions, not data',
    body: 'We do not show you metrics. We tell you what they mean and what to do next.',
  },
  {
    icon: '🗓️',
    title: 'Plans that match reality',
    body: 'Campaign skeletons and content calendars built around your capacity and goals.',
  },
  {
    icon: '📈',
    title: 'Performance that compounds',
    body: 'Every campaign you run teaches the system. Recommendations get sharper over time.',
  },
];

const CAPABILITIES = [
  'Marketing performance signals across all connected channels',
  'AI-generated campaign skeletons and weekly execution plans',
  'Content strategy mapping: themes, formats, cadence',
  'Audience and segment intelligence',
  'Website and SEO health monitoring',
  'Channel-specific recommendations and priority scoring',
  'Campaign planning and collaborative brief building',
  'Decision history and performance narrative',
];

const DECISION_QA = [
  {
    q: 'Which channel should I focus on this quarter?',
    a: 'The one with the best engagement-to-effort ratio for your specific audience — we will show you which that is.',
  },
  {
    q: 'Is my content strategy working?',
    a: 'We track what resonates by topic, format, and timing — and flag when patterns shift.',
  },
  {
    q: 'Why did this campaign underperform?',
    a: 'Audience mismatch, timing, creative fatigue, or channel saturation — we diagnose, not just report.',
  },
  {
    q: 'What should I post next week?',
    a: 'A plan built from your goals, past performance, and current channel momentum.',
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function SolutionsPage() {
  const [activePersona, setActivePersona] = useState(0);
  const [activeSection, setActiveSection] = useState(0);
  const persona = PERSONAS[activePersona];
  const section = persona.sections[activeSection];
  const visual = PERSONA_VISUALS[activePersona][activeSection];

  function handlePersonaChange(idx: number) {
    setActivePersona(idx);
    setActiveSection(0);
  }

  return (
    <>
      <Head>
        <title>Solutions | Omnivyra</title>
        <meta
          name="description"
          content="Marketing clarity for every role. Whether you run a team, do it all yourself, or build a personal brand — Omnivyra gives you the intelligence to act with confidence."
        />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF]">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="relative overflow-hidden"
          style={{ background: 'linear-gradient(150deg, #0A1F44 0%, #0A3A7A 50%, #0A66C2 100%)' }}
        >
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div
              className="absolute -top-32 left-1/3 h-[420px] w-[420px] rounded-full opacity-[0.12]"
              style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }}
            />
            <div
              className="absolute bottom-0 right-0 h-64 w-64 rounded-full opacity-[0.07]"
              style={{ background: 'radial-gradient(circle, #3FA9F5 0%, transparent 70%)' }}
            />
          </div>
          <div className="relative mx-auto max-w-[1280px] px-6 py-20 text-center lg:px-8 lg:py-28">
            <p className="mb-4 inline-block rounded-full border border-[#3FA9F5]/30 bg-[#3FA9F5]/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-[#3FA9F5]">
              Built for every kind of marketer
            </p>
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl xl:text-[3.25rem]">
              Marketing looks different<br className="hidden sm:block" /> for everyone.
              <br />
              <span className="text-[#3FA9F5]">Clarity shouldn&rsquo;t.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/75">
              Whether you lead a team, run your business solo, or build a personal brand — Omnivyra gives you the intelligence to act with confidence, not guesswork.
            </p>
          </div>
        </section>

        {/* ── Persona tabs ─────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1280px] px-6 py-20 lg:px-8">
          {/* Tab row */}
          <div role="tablist" aria-label="Choose your role" className="flex flex-wrap justify-center gap-3">
            {PERSONAS.map((p, idx) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={activePersona === idx}
                aria-controls={`panel-${p.id}`}
                id={`tab-${p.id}`}
                onClick={() => handlePersonaChange(idx)}
                className={`rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
                  activePersona === idx
                    ? 'bg-[#0A66C2] text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)]'
                    : 'border border-[#0A66C2]/30 bg-white text-[#0A66C2] hover:bg-[#0A66C2]/8'
                }`}
              >
                {p.tab}
              </button>
            ))}
          </div>

          {/* Persona panel */}
          <div
            key={activePersona}
            role="tabpanel"
            id={`panel-${persona.id}`}
            aria-labelledby={`tab-${persona.id}`}
            className="mt-12 animate-fadeIn"
          >
            {/* Persona header */}
            <div className="mb-10 flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-lg font-bold text-white shadow-lg">
                {persona.initials}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">{persona.role}</p>
                <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-[#6B7C93]">{persona.intro}</p>
              </div>
            </div>

            {/* Two-column: section nav + content */}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
              {/* Section nav */}
              <nav aria-label="Section navigation" className="flex flex-col gap-2">
                {persona.sections.map((sec, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveSection(idx)}
                    className={`rounded-xl px-4 py-3 text-left text-sm font-medium transition-all ${
                      activeSection === idx
                        ? 'bg-[#0A66C2] text-white shadow-md'
                        : 'bg-white text-[#0B1F33] hover:bg-[#EBF3FD] hover:text-[#0A66C2]'
                    }`}
                  >
                    <span className={`mr-2 text-xs ${activeSection === idx ? 'text-white/60' : 'text-[#6B7C93]'}`}>
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    {sec.title}
                  </button>
                ))}
              </nav>

              {/* Section content — enriched right panel */}
              <div
                key={`${activePersona}-${activeSection}`}
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm animate-fadeIn"
              >
                {/* Top bar */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-[#F5F9FF] px-6 py-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
                    {String(activeSection + 1).padStart(2, '0')} / {String(persona.sections.length).padStart(2, '0')}
                  </p>
                  <div className="flex gap-1.5">
                    {persona.sections.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveSection(i)}
                        className={`h-1.5 rounded-full transition-all ${i === activeSection ? 'w-6 bg-[#0A66C2]' : 'w-1.5 bg-gray-300 hover:bg-[#0A66C2]/40'}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid gap-8 p-6 lg:grid-cols-2 lg:p-8">
                  {/* Left: text content */}
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-[#0B1F33] sm:text-[1.6rem]">
                      {section.title}
                    </h2>
                    <p className="mt-3 text-[15px] leading-relaxed text-[#6B7C93]">
                      {section.body}
                    </p>

                    {/* Bullet points */}
                    <ul className="mt-5 space-y-2.5">
                      {section.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10">
                            <svg className="h-3 w-3 text-[#0A66C2]" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                            </svg>
                          </span>
                          <span className="text-sm leading-snug text-[#0B1F33]">{b}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Metrics pills */}
                    <div className="mt-6 flex flex-wrap gap-3">
                      {section.metrics.map((m) => (
                        <div key={m.label} className="rounded-xl border border-[#0A66C2]/15 bg-[#F0F7FF] px-4 py-2.5">
                          <p className="text-lg font-bold text-[#0A66C2]">{m.val}</p>
                          <p className="text-[10px] text-[#6B7C93]">{m.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Navigation */}
                    <div className="mt-8 flex items-center gap-3">
                      <button
                        onClick={() => setActiveSection((s) => Math.max(0, s - 1))}
                        disabled={activeSection === 0}
                        className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-[#0B1F33] transition hover:border-[#0A66C2] hover:text-[#0A66C2] disabled:opacity-30"
                      >
                        ← Previous
                      </button>
                      <button
                        onClick={() => setActiveSection((s) => Math.min(persona.sections.length - 1, s + 1))}
                        disabled={activeSection === persona.sections.length - 1}
                        className="rounded-full bg-[#0A66C2] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#0A3872] disabled:opacity-30"
                      >
                        Next →
                      </button>
                    </div>
                  </div>

                  {/* Right: visual mock panel */}
                  <div className="flex flex-col gap-3">
                    {visual}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Unified value ─────────────────────────────────────────────────── */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Everything works together</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                One platform. Every role. Real decisions.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[#6B7C93]">
                Omnivyra is not a collection of tools bolted together. It is a single intelligence layer built to give every kind of marketer the clarity they need.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {UNIFIED_VALUES.map((v) => (
                <div key={v.title} className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-6">
                  <div className="mb-4 text-3xl">{v.icon}</div>
                  <h3 className="text-base font-semibold text-[#0B1F33]">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#6B7C93]">{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Core capabilities ─────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Core capabilities</p>
                <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                  Everything you need.<br />Nothing you don&rsquo;t.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-[#6B7C93]">
                  Every feature in Omnivyra exists to reduce the distance between information and a good decision.
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CAPABILITIES.map((cap) => (
                  <li key={cap} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10">
                      <svg className="h-3 w-3 text-[#0A66C2]" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    </span>
                    <span className="text-sm leading-snug text-[#0B1F33]">{cap}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Decision Intelligence ─────────────────────────────────────────── */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-[1280px] px-6 lg:px-8">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">Decision intelligence</p>
              <h2 className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl">
                When you know what to do,<br />everything changes.
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {DECISION_QA.map(({ q, a }) => (
                <div key={q} className="rounded-2xl border border-gray-100 bg-[#F5F9FF] p-6">
                  <p className="mb-3 text-sm font-semibold text-[#0B1F33]">{q}</p>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex-shrink-0 text-[#0A66C2]">→</span>
                    <p className="text-sm leading-relaxed text-[#6B7C93]">{a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="py-20" style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}>
          <div className="mx-auto max-w-[1280px] px-6 text-center lg:px-8">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              See how it works for you.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
              Start with a free audit. No credit card, no setup, no guesswork — just clarity.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/audit/website-growth-check"
                className="rounded-full bg-white px-8 py-3.5 text-[15px] font-semibold text-[#0A66C2] shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition hover:shadow-[0_6px_28px_rgba(255,255,255,0.35)] hover:opacity-95"
              >
                Run Free Audit
              </Link>
              <Link
                href="/features"
                className="rounded-full border-2 border-white/40 bg-white/10 px-8 py-3.5 text-[15px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                See How It Works
              </Link>
            </div>
            <p className="mt-5 text-xs text-white/35">No credit card required &middot; Free to start</p>
          </div>
        </section>

        <Footer />
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.25s ease both;
        }
      `}</style>
    </>
  );
}
