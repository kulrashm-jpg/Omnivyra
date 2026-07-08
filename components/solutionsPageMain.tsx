/** Part 2/2 of solutions.tsx — verbatim split (barrel preserved; importers unchanged). */
'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import { BLUE_FIELD, type RoleId, type SignalState, type StepContent, type Role, STEPS, ROLES, TRANSFORMATIONS, TESTIMONIALS, stateStyles, roleAtmospheres, OperationalAtmosphere, SignalMemory, PrimaryCtas, CinematicFooter, RoleSelector, ProgressNavigator } from './solutionsPageSections';

function StatusPill({ value, state }: { value: string; state: SignalState }) {
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${stateStyles[state]}`}>{value}</span>;
}

function FounderView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Executive intelligence</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Confidence 74" state="build" />
      </div>
      <div className="mt-4 rounded-2xl bg-white p-4">
        <div className="flex items-end gap-2">
          {[58, 52, 49, 46, 41, 44, 39].map((height, index) => (
            <div key={index} className="flex-1 rounded-t-lg bg-[#0A66C2]" style={{ height }} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs font-bold text-[#496179]">
          <span>Visibility trend</span>
          <span className="text-[#0A66C2]">Needs attention</span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Competitor authority rising', 'Watch', 'watch'],
          ['3 priority risks surfaced', 'Review', 'build'],
          ['Content execution delayed', 'Blocked', 'watch'],
          ['Strategic visibility score', '74/100', 'good'],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function MarketingView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Workflow operational</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Queue active" state="build" />
      </div>
      <div className="mt-4 grid gap-3">
        {['Plan', 'Create', 'Publish', 'Review'].map((item, index) => (
          <div key={item} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 rounded-2xl bg-white p-3">
            <span className="text-sm font-black text-[#071D3A]">{item}</span>
            <div className="h-2 rounded-full bg-[#D7E8F8]">
              <div className="h-2 rounded-full bg-[#0A66C2]" style={{ width: `${[85, 58, 72, 44][index]}%` }} />
            </div>
            <span className="text-xs font-black text-[#0A66C2]">{[85, 58, 72, 44][index]}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Paid visibility dropping', 'Alert', 'watch' as SignalState],
          ['2 campaign bottlenecks', 'Fix', 'build' as SignalState],
          ['SEO/AEO opportunity detected', 'Open', 'good' as SignalState],
          ['Publishing alignment improved', 'Stable', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function GrowthView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Opportunity radar</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="GEO gap" state="build" />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-white p-3">
        {Array.from({ length: 16 }).map((_, index) => (
          <div
            key={index}
            className={`h-10 rounded-xl ${index % 5 === 0 ? 'bg-[#0A66C2]' : index % 3 === 0 ? 'bg-[#9BD6FF]' : 'bg-[#E8F7FF]'}`}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Visibility momentum rising', 'Up', 'good' as SignalState],
          ['Competitor overlap increasing', 'Watch', 'watch' as SignalState],
          ['GEO opportunity detected', 'Act', 'build' as SignalState],
          ['Authority growth accelerating', 'Good', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function ContentView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Content strategist view</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="3 opportunities" state="build" />
      </div>
      <div className="mt-4 rounded-2xl bg-white p-4">
        <div className="grid grid-cols-3 gap-3">
          {['Topic authority', 'AI visibility', 'Publishing'].map((label, index) => (
            <div key={label} className="rounded-2xl border border-[#D7E8F8] p-3 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-[8px] border-[#0A66C2] text-sm font-black text-[#0A66C2]">
                {[42, 68, 81][index]}
              </div>
              <p className="mt-2 text-xs font-black text-[#071D3A]">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Topic authority weak', 'Build', 'watch' as SignalState],
          ['AI visibility improving', 'Up', 'good' as SignalState],
          ['3 content opportunities detected', 'Open', 'build' as SignalState],
          ['Publishing consistency stable', 'Stable', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function AgencyView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Multi-client intelligence</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="Review ready" state="good" />
      </div>
      <div className="mt-4 grid gap-2">
        {[
          ['Client A', 'Visibility loss', 42],
          ['Client B', 'Authority improving', 74],
          ['Client C', 'Competitor overlap', 58],
        ].map(([client, label, score]) => (
          <div key={client} className="grid grid-cols-[80px_1fr_48px] items-center gap-3 rounded-2xl bg-white p-3">
            <span className="text-sm font-black text-[#071D3A]">{client}</span>
            <div>
              <p className="text-xs font-bold text-[#496179]">{label}</p>
              <div className="mt-1 h-2 rounded-full bg-[#D7E8F8]"><div className="h-2 rounded-full bg-[#0A66C2]" style={{ width: `${score}%` }} /></div>
            </div>
            <span className="text-sm font-black text-[#0A66C2]">{score}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['2 clients losing visibility', 'Watch', 'watch' as SignalState],
          ['Strategic recommendation ready', 'Ready', 'build' as SignalState],
          ['Authority benchmark improved', 'Good', 'good' as SignalState],
          ['Client opportunity tracking', 'Live', 'good' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function SoloView({ role, step }: { role: Role; step: StepContent }) {
  return (
    <div className="rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Simplified action queue</p>
          <h3 className="mt-2 text-xl font-black text-[#071D3A]">{role.dashboardTitle}</h3>
        </div>
        <StatusPill value="3 actions" state="build" />
      </div>
      <div className="mt-4 grid gap-2">
        {['Create one authority post', 'Schedule campaign touchpoint', 'Review visibility gap'].map((item, index) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl bg-white p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A66C2] text-sm font-black text-white">{index + 1}</span>
            <span className="text-sm font-black text-[#071D3A]">{item}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([
          ['Visibility improving', 'Up', 'good' as SignalState],
          ['Publishing consistency stable', 'Stable', 'good' as SignalState],
          ['Authority gaps detected', 'Fix', 'watch' as SignalState],
          ['Operational overload reduced', 'Focus', 'build' as SignalState],
        ] as ReadonlyArray<readonly [string, string, SignalState]>).map(([label, value, state]) => (
          <div key={label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
            <p className="text-sm font-black text-[#071D3A]">{label}</p>
            <div className="mt-2"><StatusPill value={value} state={state as SignalState} /></div>
          </div>
        ))}
      </div>
      <MetricRow metrics={step.metrics} />
    </div>
  );
}

function MetricRow({ metrics }: { metrics: StepContent['metrics'] }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-2xl border border-[#D7E8F8] bg-white p-3">
          <p className="text-xl font-black text-[#0A66C2]">{metric.value}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#607A94]">{metric.label}</p>
        </div>
      ))}
    </div>
  );
}

function RoleOperationalView({ role, step }: { role: Role; step: StepContent }) {
  if (role.id === 'founder') return <FounderView role={role} step={step} />;
  if (role.id === 'marketing') return <MarketingView role={role} step={step} />;
  if (role.id === 'growth') return <GrowthView role={role} step={step} />;
  if (role.id === 'creator') return <ContentView role={role} step={step} />;
  if (role.id === 'agency') return <AgencyView role={role} step={step} />;
  return <SoloView role={role} step={step} />;
}

function GuidedPanel({ role, step }: { role: Role; step: StepContent }) {
  return (
    <article key={`${role.id}-${step.title}`} className="solution-reveal relative overflow-hidden rounded-[32px] border border-[#CBE2F7] bg-white/[0.90] p-5 shadow-[0_24px_72px_rgba(8,68,138,0.10)] backdrop-blur lg:p-7">
      <SignalMemory />
      <div className="pointer-events-none absolute -right-28 top-8 h-72 w-72 rounded-full bg-[#3FA9F5]/[0.10] blur-3xl" />
      <div className="relative grid gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">{role.label}</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-[#071D3A] lg:text-4xl">{step.title}</h2>
          <p className="mt-4 text-base leading-7 text-[#496179]">{step.summary}</p>

          <div className="mt-5 rounded-2xl border border-[#D7E8F8] bg-[#F7FBFF]/85 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Daily frustration</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#334B63]">{step.pain}</p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Omnivyra unifies</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {step.connects.map((item) => (
                  <span key={item} className="rounded-full border border-[#CBE2F7] bg-[#F7FBFF]/90 px-3 py-2 text-xs font-black text-[#0A3A7A]">{item}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">What changes</p>
              <div className="mt-3 space-y-2">
                {step.changes.map((item) => (
                  <div key={item} className="rounded-2xl bg-[#0A66C2] px-3 py-2 text-xs font-bold leading-5 text-white">{item}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <RoleOperationalView role={role} step={step} />
        </div>
      </div>

      <div className="relative mt-6 rounded-[26px] border border-[#CBE2F7] bg-[#F7FBFF]/86 p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#0A66C2]">Recommended actions</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {step.recommendations.map((item, index) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-white px-3 py-3 shadow-[0_8px_20px_rgba(8,68,138,0.05)]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0A66C2] text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-bold leading-5 text-[#071D3A]">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <Link
            href={role.id === 'marketing' || role.id === 'creator' || role.id === 'solo' ? '/get-free-credits' : '/create-account'}
            className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-[#0A66C2] px-7 py-3 text-sm font-black text-white shadow-[0_16px_34px_rgba(10,102,194,0.22)] transition hover:-translate-y-0.5 hover:bg-[#075FAE]"
          >
            {role.cta}
          </Link>
        </div>
      </div>
    </article>
  );
}

function FragmentedFlow() {
  const nodes = ['Content', 'Campaigns', 'Publishing', 'Visibility', 'Analytics', 'Reporting'];
  const positions = [
    'left-[4%] top-[10%]',
    'left-[34%] top-[4%]',
    'right-[4%] top-[14%]',
    'left-[6%] bottom-[16%]',
    'left-[38%] bottom-[8%]',
    'right-[6%] bottom-[18%]',
  ];
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-[#CBE2F7]/70 bg-[#F7FBFF]/72 p-5 shadow-[0_18px_56px_rgba(8,68,138,0.06)] backdrop-blur">
      <div className="pointer-events-none absolute inset-0 opacity-45" aria-hidden="true">
        <SignalMemory />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(10,102,194,0.10),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.62),rgba(247,251,255,0.36))]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-70" viewBox="0 0 900 520" preserveAspectRatio="none" aria-hidden="true">
        <path d="M92 126 C 245 72, 332 180, 452 154 S 670 104, 806 202" fill="none" stroke="rgba(10,102,194,0.12)" strokeWidth="1" strokeDasharray="3 18" className="solution-signal-drift" />
        <path d="M96 370 C 250 290, 384 420, 512 330 S 700 276, 820 372" fill="none" stroke="rgba(63,169,245,0.11)" strokeWidth="1" className="solution-signal-breathe" />
        <path d="M120 130 C 278 230, 330 246, 450 252 S 620 255, 785 150" fill="none" stroke="rgba(10,102,194,0.13)" strokeWidth="1" strokeDasharray="2 15" className="solution-signal-drift" />
        <path d="M120 390 C 290 292, 340 266, 450 252 S 610 238, 782 382" fill="none" stroke="rgba(63,169,245,0.12)" strokeWidth="1" strokeDasharray="2 15" className="solution-signal-drift-slow" />
      </svg>
      <div className="relative min-h-[430px]">
        <div className="hidden sm:block">
          {nodes.map((node, index) => (
            <div
              key={node}
              className={`solution-node-drift absolute w-[29%] rounded-2xl border px-4 py-3 ${positions[index]} ${
                index % 2 === 0
                  ? 'border-[#D7E8F8]/70 bg-white/70'
                  : 'border-[#CBE2F7]/65 bg-[#EAF6FF]/62'
              }`}
            >
              <p className="text-sm font-black text-[#071D3A]">{node}</p>
              <p className="mt-1 text-xs font-semibold text-[#607A94]">Operational signal</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:hidden">
          {nodes.map((node) => (
            <div key={node} className="rounded-2xl border border-[#D7E8F8]/70 bg-white/70 p-4">
              <p className="text-sm font-black text-[#071D3A]">{node}</p>
              <p className="mt-1 text-xs font-semibold text-[#607A94]">Operational signal</p>
            </div>
          ))}
        </div>

        <div className="absolute left-1/2 top-[46%] hidden -translate-x-1/2 -translate-y-1/2 sm:block">
          <div className="relative grid h-44 w-44 place-items-center rounded-full border border-[#0A66C2]/20 bg-[#0A66C2]/[0.08] shadow-[inset_0_0_42px_rgba(10,102,194,0.08)]">
            <div className="absolute h-32 w-32 rounded-full border border-[#3FA9F5]/25 bg-white/50" />
            <div className="relative max-w-[120px] text-center text-sm font-black leading-5 text-[#0A3A7A]">
              Omnivyra operational layer
            </div>
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-[24px] bg-[#0A66C2] p-5 text-white shadow-[0_18px_38px_rgba(10,102,194,0.20)] sm:absolute sm:inset-x-0 sm:bottom-0 sm:mt-0">
          <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#BFE5FF]">Connected visibility intelligence</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {['Guided priorities', 'Operational clarity', 'Discoverability context'].map((item) => (
              <div key={item} className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm font-black">{item}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransformationRows() {
  return (
    <div className="relative mx-auto mt-10 max-w-5xl overflow-hidden rounded-[30px] border border-[#CBE2F7] bg-white/[0.90] p-5 shadow-[0_18px_56px_rgba(8,68,138,0.08)] backdrop-blur">
      <SignalMemory />
      <div className="pointer-events-none absolute bottom-16 left-7 top-16 hidden w-px bg-gradient-to-b from-[#0A66C2]/10 via-[#0A66C2]/34 to-[#0A66C2]/10 sm:block" />
      {TRANSFORMATIONS.map(([before, after], index) => (
        <div key={before} className="relative grid gap-3 py-3 pl-0 sm:grid-cols-[52px_1fr] sm:items-stretch">
          <div className="solution-node-drift relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#0A66C2] text-sm font-black text-white shadow-[0_10px_24px_rgba(10,102,194,0.22)] sm:mt-4">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-[#D7E8F8] bg-[#F7FBFF]/72 p-4">
            <div className="grid gap-3 sm:grid-cols-[0.82fr_1.18fr] sm:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#607A94]">Starts as</p>
                <p className="mt-1 text-lg font-black text-[#071D3A]">{before}</p>
              </div>
              <div className="rounded-2xl border border-[#0A66C2]/30 bg-[#0A66C2] px-4 py-4 text-white shadow-[0_14px_30px_rgba(10,102,194,0.16)]">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#BFE5FF]">Synchronizes into</p>
                <p className="mt-1 text-lg font-black">{after}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SolutionsPage() {
  const [activeRoleId, setActiveRoleId] = useState<RoleId>('founder');
  const [activeStep, setActiveStep] = useState(0);
  const activeRole = ROLES.find((role) => role.id === activeRoleId) ?? ROLES[0];
  const activeStepContent = activeRole.steps[STEPS[activeStep].id];
  const activeAtmosphere = roleAtmospheres[activeRole.id];

  function selectRole(role: Role) {
    setActiveRoleId(role.id);
    setActiveStep(0);
  }

  return (
    <>
      <Head>
        <title>Solutions for Scaling Marketing Operations | Omnivyra</title>
        <meta
          name="description"
          content="Explore how Omnivyra helps founders, marketing leads, growth teams, creators, agencies, and solo operators scale marketing operations with operational intelligence."
        />
      </Head>

      <main className="relative isolate overflow-x-hidden bg-[#F7FBFF] text-[#071D3A]">
        <OperationalAtmosphere />
        <section className="relative z-10 overflow-hidden" style={{ background: BLUE_FIELD }}>
          <SignalMemory dark />
          <div className="absolute left-1/2 top-0 h-[360px] w-[70%] -translate-x-1/2 bg-[#3FA9F5]/[0.08] blur-3xl" />
          <div className="relative mx-auto max-w-[1280px] px-6 py-12 text-center lg:px-8 lg:py-14">
            <p className="inline-flex rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-[#D6F0FF] backdrop-blur">
              Solutions
            </p>
            <h1 className="mx-auto mt-5 max-w-5xl text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-5xl lg:text-[3.35rem]">
              Marketing operations rarely fail from lack of effort.
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-[#EAF6FF] sm:text-lg">
              They fail because systems, visibility, execution, and intelligence do not move together. Omnivyra helps each role experience connected operational intelligence inside the way marketing actually runs.
            </p>
            <div className="mt-7">
              <PrimaryCtas />
            </div>
          </div>
        </section>

        <section className="relative z-10 border-b border-[#D7E8F8]" style={{ background: activeAtmosphere }}>
          <SignalMemory />
          <div className="relative mx-auto max-w-[1280px] px-6 py-8 lg:px-8 lg:py-11">
            <RoleSelector activeRole={activeRole} onSelect={selectRole} />

            <div className="mt-10 grid gap-6 lg:grid-cols-[286px_1fr] lg:items-start">
              <ProgressNavigator activeStep={activeStep} setActiveStep={setActiveStep} activeRole={activeRole} />
              <GuidedPanel role={activeRole} step={activeStepContent} />
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-white/[0.92]">
          <SignalMemory />
          <div className="mx-auto max-w-[1280px] px-6 py-12 lg:px-8 lg:py-14">
            <div className="max-w-5xl">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">Why this matters</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-5xl">
                Most marketing operations were never designed to work together.
              </h2>
              <p className="mt-7 text-xs font-black uppercase tracking-[0.22em] text-[#0A66C2]">The operating reality</p>
              <p className="mt-3 max-w-3xl text-lg leading-8 text-[#496179]">
                Teams use separate systems for content, campaigns, publishing, discoverability, analytics, and reporting,
                but operational understanding rarely moves together.
              </p>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[0.55fr_1.45fr] lg:items-stretch">
              <div className="flex flex-col">
                <div className="grid flex-1 gap-1">
                  {[
                    ['Fragmented execution', 'Work moves, but the operating pattern is hard to see.'],
                    ['Delayed decisions', 'Reports arrive after the moment to act has passed.'],
                    ['Discoverability blind spots', 'Visibility gaps stay hidden until growth slows.'],
                  ].map(([title, body]) => (
                    <div key={title} className="relative border-l border-[#0A66C2]/20 px-5 py-5">
                      <span className="absolute -left-[5px] top-7 h-2.5 w-2.5 rounded-full bg-[#0A66C2]/45" />
                      <p className="text-sm font-black text-[#0A66C2]">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#496179]">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
              <FragmentedFlow />
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-[#F7FBFF]/[0.92]">
          <SignalMemory />
          <div className="relative mx-auto max-w-[1280px] px-6 py-16 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#0A66C2]">Outcome-driven operations</p>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-[#071D3A] sm:text-4xl">
                Built for operational outcomes, not isolated dashboards.
              </h2>
            </div>
            <TransformationRows />
            <div className="mx-auto mt-8 max-w-3xl rounded-[26px] border border-[#CBE2F7] bg-white/[0.82] p-5 text-center shadow-[0_14px_36px_rgba(8,68,138,0.06)] backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#0A66C2]">Future evolution</p>
              <p className="mt-3 text-sm font-semibold leading-7 text-[#496179]">
                Operational intelligence is still evolving through deeper forecasting, contextual analysis, and connected
                decision support. Our goal is to empower teams to operate with clearer visibility, stronger operational
                understanding, and increasingly intelligent marketing execution.
              </p>
            </div>
          </div>
        </section>

        <section className="relative z-10 bg-white/[0.92]">
          <SignalMemory />
          <div className="mx-auto max-w-[1280px] px-6 py-16 lg:px-8 lg:py-20">
            <div className="grid gap-5 lg:grid-cols-3">
              {TESTIMONIALS.map((item) => (
                <figure key={item.name} className="relative overflow-hidden rounded-[26px] border border-[#CBE2F7] bg-white/[0.90] p-6 shadow-[0_18px_46px_rgba(8,68,138,0.09)] backdrop-blur">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0A66C2]/35 to-transparent" />
                  <blockquote className="text-lg font-black leading-8 text-[#071D3A]">"{item.quote}"</blockquote>
                  <figcaption className="mt-5 border-t border-[#D7E8F8] pt-4">
                    <p className="font-black text-[#0A66C2]">{item.name}</p>
                    <p className="text-sm text-[#496179]">{item.role}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-10 overflow-hidden" style={{ background: BLUE_FIELD }}>
          <SignalMemory dark />
          <div className="absolute left-1/2 top-0 h-[300px] w-[70%] -translate-x-1/2 bg-[#3FA9F5]/[0.08] blur-3xl" />
          <div className="relative mx-auto max-w-[900px] px-6 py-16 text-center lg:px-8 lg:py-20">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-[#D6F0FF]">Start simple</p>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-5xl">
              Start with your Visibility Snapshot.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#EAF6FF]">
              Create an account, complete your company profile, request the snapshot, and use free credits to explore the workflow layer.
            </p>
            <div className="mt-9">
              <PrimaryCtas />
            </div>
          </div>
        </section>
      </main>

      <CinematicFooter />
      <style jsx global>{`
        @keyframes solutionSignalDrift {
          0%,
          100% {
            stroke-dashoffset: 0;
            opacity: 0.5;
          }
          50% {
            stroke-dashoffset: -38;
            opacity: 0.88;
          }
        }

        @keyframes solutionSignalBreathe {
          0%,
          100% {
            opacity: 0.28;
          }
          50% {
            opacity: 0.66;
          }
        }

        @keyframes solutionNodeDrift {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -4px, 0);
          }
        }

        @keyframes solutionReveal {
          from {
            opacity: 0.88;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .solution-signal-drift {
          animation: solutionSignalDrift 15s ease-in-out infinite;
        }

        .solution-signal-drift-slow {
          animation: solutionSignalDrift 19s ease-in-out infinite reverse;
        }

        .solution-signal-breathe {
          animation: solutionSignalBreathe 9s ease-in-out infinite;
        }

        .solution-node-drift {
          animation: solutionNodeDrift 10s ease-in-out infinite;
        }

        .solution-reveal {
          animation: solutionReveal 420ms ease-out both;
        }

        @media (prefers-reduced-motion: reduce) {
          .solution-signal-drift,
          .solution-signal-drift-slow,
          .solution-signal-breathe,
          .solution-node-drift,
          .solution-reveal {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}

