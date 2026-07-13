'use client';

/**
 * /onboarding/journey — the guided onboarding journey (ONBOARD-001 §5/§12).
 *
 * One resumable, skippable, dismissible view over the canonical journey
 * authority (/api/onboarding/journey). It renders the server-derived truth —
 * it does NOT compute progress itself — so browser refresh, new login, and
 * partial completion all resume identically. Each stage shows why it matters,
 * its dependencies, and its live status.
 */

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { apiFetch } from '../../lib/apiFetch';

type StageStatus =
  | 'not_started' | 'pending' | 'in_progress' | 'completed'
  | 'skipped' | 'dismissed' | 'blocked';

interface StageView {
  id: string;
  title: string;
  why: string;
  mandatory: boolean;
  skippable: boolean;
  dismissible: boolean;
  dependsOn: string[];
  href: string;
  status: StageStatus;
  detail: string | null;
  providers?: Array<{ platform: string; state: string }>;
}

interface Journey {
  stages: StageView[];
  currentStep: string;
  platformReady: boolean;
  companyId: string | null;
}

const STATUS_META: Record<StageStatus, { label: string; cls: string }> = {
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:     { label: 'Pending',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  not_started: { label: 'Not started', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  skipped:     { label: 'Skipped',     cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  dismissed:   { label: 'Dismissed',   cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  blocked:     { label: 'Blocked',     cls: 'bg-gray-100 text-gray-400 border-gray-200' },
};

export default function OnboardingJourneyPage() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/onboarding/journey');
      if (!res.ok) { setError('Could not load your onboarding progress.'); setLoading(false); return; }
      setJourney(await res.json());
    } catch {
      setError('Network error loading onboarding.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (stage: string, action: 'skip' | 'dismiss' | 'reopen') => {
    setBusy(`${stage}:${action}`);
    setError(null);
    try {
      const res = await apiFetch('/api/onboarding/journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, action }),
      });
      if (res.ok) setJourney(await res.json());
      else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'Could not update that step.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <>
      <Head><title>Set up your workspace | Omnivyra</title></Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <header className="border-b border-gray-100 bg-white/95">
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-6">
            <Link href="/"><img src="/logo.png" alt="Omnivyra" className="h-9 w-auto object-contain" /></Link>
            <Link href="/command-center" className="text-sm text-[#6B7C93] hover:text-[#0A66C2]">Skip to dashboard</Link>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-2xl font-bold tracking-tight text-[#0B1F33]">Set up your workspace</h1>
          <p className="mt-2 text-sm text-[#6B7C93]">
            Complete the essentials, then connect the tools that make Omnivyra smarter. You can skip optional steps and come back anytime.
          </p>

          {journey?.platformReady && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-sm font-semibold text-emerald-800">🎉 Your platform is ready.</p>
              <p className="mt-1 text-sm text-emerald-700">Every required step is done. <Link href="/command-center" className="font-semibold underline">Go to your dashboard →</Link></p>
            </div>
          )}

          {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="mt-8 text-sm text-[#6B7C93]">Loading your progress…</p>}

          <ol className="mt-6 space-y-3">
            {journey?.stages.map((stage) => {
              const meta = STATUS_META[stage.status];
              const isCurrent = journey.currentStep === stage.id;
              const actionable = stage.status !== 'completed' && stage.status !== 'blocked';
              return (
                <li key={stage.id}
                  className={`rounded-2xl border bg-white p-5 transition ${isCurrent ? 'border-[#0A66C2] shadow-[0_4px_16px_rgba(10,102,194,0.12)]' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[#0B1F33]">{stage.title}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                        {stage.mandatory && <span className="text-[11px] font-medium text-[#6B7C93]">Required</span>}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#6B7C93]">{stage.why}</p>
                      {stage.detail && <p className="mt-1.5 text-xs text-[#0B1F33]/70">{stage.detail}</p>}
                      {stage.status === 'blocked' && (
                        <p className="mt-1.5 text-xs text-gray-400">Complete the earlier steps first.</p>
                      )}
                      {stage.providers && stage.providers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {stage.providers.map((p) => (
                            <span key={p.platform} className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] text-[#6B7C93]">
                              {p.platform}: {p.state.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {stage.status === 'completed' && (
                      <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </div>

                  {actionable && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link href={stage.href}
                        className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95">
                        {stage.status === 'in_progress' ? 'Continue' : 'Set up'}
                      </Link>
                      {stage.skippable && (
                        <button disabled={!!busy} onClick={() => act(stage.id, 'skip')}
                          className="text-xs text-[#6B7C93] hover:text-[#0A66C2] disabled:opacity-50">
                          {busy === `${stage.id}:skip` ? 'Skipping…' : 'Skip for now'}
                        </button>
                      )}
                      {stage.dismissible && (
                        <button disabled={!!busy} onClick={() => act(stage.id, 'dismiss')}
                          className="text-xs text-[#6B7C93]/70 hover:text-[#0A66C2] disabled:opacity-50">
                          {busy === `${stage.id}:dismiss` ? 'Dismissing…' : "Don't need this"}
                        </button>
                      )}
                    </div>
                  )}
                  {(stage.status === 'skipped' || stage.status === 'dismissed') && (
                    <button disabled={!!busy} onClick={() => act(stage.id, 'reopen')}
                      className="mt-3 text-xs text-[#0A66C2] hover:underline disabled:opacity-50">
                      {busy === `${stage.id}:reopen` ? 'Reopening…' : 'Reopen this step'}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </main>
      </div>
    </>
  );
}
