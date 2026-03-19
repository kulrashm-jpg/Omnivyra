'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

// ── Data ─────────────────────────────────────────────────────────────────────

const Q1_OPTIONS = [
  { id: 'performance',  emoji: '📊', label: 'Understand my marketing performance' },
  { id: 'campaigns',   emoji: '🚀', label: 'Run or improve campaigns' },
  { id: 'content',     emoji: '✍️',  label: 'Create content consistently' },
  { id: 'audience',    emoji: '📈', label: 'Grow my audience' },
  { id: 'engagement',  emoji: '💬', label: 'Manage engagement' },
];

const Q2_OPTIONS = [
  { id: 'solo',    emoji: '🙋', label: 'I manage everything myself' },
  { id: 'small',   emoji: '👥', label: 'I have a small team' },
  { id: 'team',    emoji: '🏢', label: 'I work in a marketing team' },
  { id: 'explore', emoji: '🔭', label: "I'm just exploring" },
];

const Q3_OPTIONS = [
  { id: 'unknown',  emoji: '🤷', label: "Don't know what's working" },
  { id: 'time',     emoji: '⏰', label: "Don't have time" },
  { id: 'tools',    emoji: '🧰', label: 'Too many tools' },
  { id: 'results',  emoji: '📉', label: 'Not getting results' },
  { id: 'content',  emoji: '✏️',  label: 'Need better content' },
];

const EARN_MORE = [
  { emoji: '👥', label: 'Invite a friend',           credits: '+200', desc: 'Share your referral link' },
  { emoji: '💬', label: 'Share feedback',            credits: '+100', desc: 'Tell us what you think' },
  { emoji: '⚙️',  label: 'Complete your setup',      credits: '+100', desc: 'Fill in your profile & goals' },
  { emoji: '🔗', label: 'Connect website or social', credits: '+150', desc: 'Link your channels for insights' },
  { emoji: '🎯', label: 'Create your first campaign', credits: '+200', desc: 'Launch and learn fast' },
];

const FREE_CREDITS = 300;
const EXPIRY_DAYS = 14;

const STEPS = ['Goals', 'Setup', 'Challenge', 'Credits', 'Done'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function creditContext(goals: string[]) {
  if (goals.includes('performance')) return 'Enough to audit your website and scan your top channels.';
  if (goals.includes('campaigns'))  return 'Enough to plan your first campaign and generate content.';
  if (goals.includes('content'))    return 'Enough to generate 30+ pieces of content this month.';
  if (goals.includes('audience'))   return 'Enough to audit your top channels and spot growth opportunities.';
  return 'Enough to run your first audit and generate your first campaign.';
}

function suggestedActions(goals: string[]) {
  const all = [
    { label: 'Website SEO audit',           credits: 50, href: '/audit/website-growth-check', show: ['performance', 'audience'] },
    { label: 'Full campaign strategy',       credits: 80, href: '/campaign-planner',           show: ['campaigns'] },
    { label: 'Content generation (per piece)', credits: 5, href: '/campaign-planner',          show: ['content'] },
    { label: 'Daily insight scan',           credits: 20, href: '/dashboard',                  show: ['performance', 'audience'] },
    { label: 'Lead signal detection',        credits: 15, href: '/dashboard',                  show: ['campaigns', 'audience'] },
    { label: 'Trend analysis',               credits: 25, href: '/dashboard',                  show: ['content', 'audience'] },
    { label: 'AI reply suggestion',          credits: 1,  href: '/dashboard',                  show: ['engagement'] },
  ];
  const matched = all.filter(a => a.show.some(s => goals.includes(s)));
  return (matched.length ? matched : all).slice(0, 3);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GetFreeCreditsPage() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0=entry, 1-3=questions, 4=credits, 5=thanks
  const [q1, setQ1] = useState<string[]>([]);
  const [q2, setQ2] = useState<string>('');
  const [q3, setQ3] = useState<string[]>([]);

  function toggleMulti(val: string, state: string[], setter: (v: string[]) => void) {
    setter(state.includes(val) ? state.filter(x => x !== val) : [...state, val]);
  }

  function next() { setStep(s => s + 1); }
  function canNext(s: number) {
    if (s === 1) return q1.length > 0;
    if (s === 2) return q2 !== '';
    if (s === 3) return q3.length > 0;
    return true;
  }

  const progress = step === 0 ? 0 : ((step - 1) / STEPS.length) * 100;

  return (
    <>
      <Head>
        <title>Get Free Credits | Omnivyra</title>
        <meta name="description" content="Start with free credits and explore the full Omnivyra platform your way." />
      </Head>

      <div className="min-h-screen bg-[#F5F9FF] flex flex-col">

        {/* ── Minimal header ─────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-6">
            <Link href="/">
              <img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" />
            </Link>
            {step > 0 && step < 5 && (
              <span className="text-xs text-[#6B7C93]">
                Step {step} of {STEPS.length}
              </span>
            )}
            <Link href="/login" className="text-sm text-[#6B7C93] hover:text-[#0A66C2] transition-colors">
              Log in
            </Link>
          </div>
          {/* Progress bar */}
          {step > 0 && step < 5 && (
            <div className="h-0.5 w-full bg-gray-100">
              <div
                className="h-0.5 bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </header>

        {/* ── Step content ───────────────────────────────────────────────── */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">

          {/* STEP 0 — Entry ─────────────────────────────────────────── */}
          {step === 0 && (
            <div key="entry" className="w-full max-w-lg text-center animate-fadeIn">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-3xl shadow-lg">
                🎁
              </div>
              <h1
                className="text-3xl font-bold tracking-tight text-[#0B1F33] sm:text-4xl"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                Start with free credits.<br />Use them your way.
              </h1>
              <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-[#6B7C93]">
                Tell us what you&rsquo;re trying to achieve — we&rsquo;ll help you get started with {FREE_CREDITS} free credits, no card required.
              </p>
              <button
                onClick={next}
                className="mt-8 rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3.5 text-base font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.4)] transition hover:shadow-[0_6px_28px_rgba(10,102,194,0.55)] hover:opacity-95"
              >
                Get Free Credits
              </button>
              <p className="mt-4 text-xs text-[#6B7C93]">No credit card &middot; Free to start &middot; Takes 60 seconds</p>
            </div>
          )}

          {/* STEP 1 — Q1: Goals ─────────────────────────────────────── */}
          {step === 1 && (
            <div key="q1" className="w-full max-w-lg animate-fadeIn">
              <QuestionHeader
                step={1}
                total={STEPS.length}
                question="What are you looking to do?"
                hint="Pick everything that applies."
              />
              <div className="mt-6 grid grid-cols-1 gap-3">
                {Q1_OPTIONS.map(opt => (
                  <OptionCard
                    key={opt.id}
                    emoji={opt.emoji}
                    label={opt.label}
                    selected={q1.includes(opt.id)}
                    onClick={() => toggleMulti(opt.id, q1, setQ1)}
                    multi
                  />
                ))}
              </div>
              <NextButton disabled={!canNext(1)} onClick={next} />
            </div>
          )}

          {/* STEP 2 — Q2: Team ──────────────────────────────────────── */}
          {step === 2 && (
            <div key="q2" className="w-full max-w-lg animate-fadeIn">
              <QuestionHeader
                step={2}
                total={STEPS.length}
                question="How do you currently handle marketing?"
                hint="Choose the one that fits best."
              />
              <div className="mt-6 grid grid-cols-1 gap-3">
                {Q2_OPTIONS.map(opt => (
                  <OptionCard
                    key={opt.id}
                    emoji={opt.emoji}
                    label={opt.label}
                    selected={q2 === opt.id}
                    onClick={() => { setQ2(opt.id); setTimeout(next, 180); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* STEP 3 — Q3: Challenge ─────────────────────────────────── */}
          {step === 3 && (
            <div key="q3" className="w-full max-w-lg animate-fadeIn">
              <QuestionHeader
                step={3}
                total={STEPS.length}
                question="What's your biggest challenge right now?"
                hint="Pick everything that resonates."
              />
              <div className="mt-6 grid grid-cols-1 gap-3">
                {Q3_OPTIONS.map(opt => (
                  <OptionCard
                    key={opt.id}
                    emoji={opt.emoji}
                    label={opt.label}
                    selected={q3.includes(opt.id)}
                    onClick={() => toggleMulti(opt.id, q3, setQ3)}
                    multi
                  />
                ))}
              </div>
              <NextButton disabled={!canNext(3)} onClick={next} label="Show my credits →" />
            </div>
          )}

          {/* STEP 4 — Credits ───────────────────────────────────────── */}
          {step === 4 && (
            <div key="credits" className="w-full max-w-lg animate-fadeIn">
              {/* Credit card */}
              <div
                className="rounded-2xl p-8 text-center text-white"
                style={{ background: 'linear-gradient(135deg, #0A1F44 0%, #0A66C2 100%)' }}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Your starting credits</p>
                <p className="mt-2 text-6xl font-bold">{FREE_CREDITS}</p>
                <p className="mt-1 text-sm font-medium text-[#3FA9F5]">free credits</p>
                <p className="mt-3 text-sm leading-relaxed text-white/75">{creditContext(q1)}</p>
                <p className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-xs text-white/60 inline-block">
                  ⏳ Expires in {EXPIRY_DAYS} days — use them now
                </p>
              </div>

              {/* Suggested first actions */}
              <div className="mt-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#6B7C93]">Start here</p>
                <div className="space-y-2">
                  {suggestedActions(q1).map(a => (
                    <div key={a.label} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
                      <span className="text-sm text-[#0B1F33]">{a.label}</span>
                      <span className="rounded-full bg-[#EBF3FD] px-2.5 py-0.5 text-xs font-semibold text-[#0A66C2]">
                        {a.credits} credits
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Earn more */}
              <div className="mt-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#6B7C93]">Earn more credits</p>
                <div className="space-y-2">
                  {EARN_MORE.map(item => (
                    <div key={item.label} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3">
                      <span className="text-xl">{item.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#0B1F33]">{item.label}</p>
                        <p className="text-xs text-[#6B7C93]">{item.desc}</p>
                      </div>
                      <span className="flex-shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        {item.credits}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="mt-8">
                <Link
                  href={`/create-account?goals=${q1.join(',')}&team=${q2}&challenge=${q3.join(',')}`}
                  className="block w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-4 text-center text-base font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.4)] transition hover:opacity-95"
                >
                  Create Account &amp; Claim Credits
                </Link>
                <p className="mt-3 text-center text-xs text-[#6B7C93]">
                  No credit card required &middot; Takes under 60 seconds
                </p>
              </div>
            </div>
          )}

          {/* STEP 5 — Thank you ─────────────────────────────────────── */}
          {step === 5 && (
            <div key="done" className="w-full max-w-lg text-center animate-fadeIn">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-3xl shadow-lg">
                ✅
              </div>
              <h2
                className="text-3xl font-bold tracking-tight text-[#0B1F33]"
                style={{ fontFamily: "'Poppins', 'Inter', sans-serif" }}
              >
                You&rsquo;re all set.
              </h2>
              <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-[#6B7C93]">
                We&rsquo;ll guide you based on what you want to achieve. Your {FREE_CREDITS} credits are waiting.
              </p>
              {/* Summary */}
              {q1.length > 0 && (
                <div className="mx-auto mt-6 max-w-xs rounded-2xl border border-gray-100 bg-white p-5 text-left">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7C93] mb-3">Your profile</p>
                  <div className="space-y-2">
                    <SummaryRow label="Focus" value={Q1_OPTIONS.filter(o => q1.includes(o.id)).map(o => o.label).join(', ')} />
                    {q2 && <SummaryRow label="Setup" value={Q2_OPTIONS.find(o => o.id === q2)?.label ?? ''} />}
                    {q3.length > 0 && <SummaryRow label="Challenge" value={Q3_OPTIONS.filter(o => q3.includes(o.id)).map(o => o.label).join(', ')} />}
                  </div>
                </div>
              )}
              <Link
                href="/login"
                className="mt-8 inline-block rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-10 py-3.5 text-base font-semibold text-white shadow-[0_4px_20px_rgba(10,102,194,0.4)] transition hover:opacity-95"
              >
                Go to Dashboard
              </Link>
            </div>
          )}
        </main>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.28s ease both; }
      `}</style>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QuestionHeader({ step, total, question, hint }: {
  step: number; total: number; question: string; hint: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#0A66C2]">
        {step} / {total}
      </p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#0B1F33]">{question}</h2>
      <p className="mt-1 text-sm text-[#6B7C93]">{hint}</p>
    </div>
  );
}

function OptionCard({ emoji, label, selected, onClick, multi }: {
  emoji: string; label: string; selected: boolean; onClick: () => void; multi?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-xl border-2 px-4 py-3.5 text-left transition-all ${
        selected
          ? 'border-[#0A66C2] bg-[#EBF3FD] shadow-sm'
          : 'border-gray-100 bg-white hover:border-[#0A66C2]/40 hover:bg-[#F5F9FF]'
      }`}
    >
      <span className="text-xl">{emoji}</span>
      <span className={`text-sm font-medium ${selected ? 'text-[#0A66C2]' : 'text-[#0B1F33]'}`}>{label}</span>
      {multi && (
        <span className={`ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-[#0A66C2] bg-[#0A66C2] text-white' : 'border-gray-200'
        }`}>
          {selected && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
            </svg>
          )}
        </span>
      )}
    </button>
  );
}

function NextButton({ onClick, disabled, label = 'Next →' }: {
  onClick: () => void; disabled: boolean; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-6 w-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(10,102,194,0.35)] transition hover:opacity-95 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7C93]">{label}</span>
      <span className="text-xs text-[#0B1F33] leading-snug">{value}</span>
    </div>
  );
}
