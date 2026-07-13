'use client';

/**
 * /onboarding/journey — the progressive setup experience (ONBOARD-005).
 *
 * ONE resumable, server-derived view over the canonical journey authority
 * (/api/onboarding/journey → onboardingJourneyService). It renders the
 * server-derived truth through the reusable SetupCard (§2) and never computes
 * progress, completion, or dependencies itself — so refresh, new login, and
 * partial completion all resume identically. Stages are grouped by state so the
 * user always sees what is complete, what is next, what is blocked, what is
 * optional, and what to do to reach Platform Ready.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { apiFetch } from '../../lib/apiFetch';
import SetupCard, { type SetupCardAction } from '../../components/onboarding/SetupCard';
import type { JourneyStage, OnboardingJourney } from '../../hooks/useOnboardingJourney';

const RESOLVED = new Set(['completed', 'skipped', 'dismissed']);

export default function OnboardingJourneyPage() {
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/onboarding/journey');
      if (!res.ok) { setError('Could not load your onboarding progress.'); setLoading(false); return; }
      setJourney((await res.json()) as OnboardingJourney);
    } catch {
      setError('Network error loading onboarding.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (stage: string, action: SetupCardAction) => {
    setBusy(`${stage}:${action}`);
    setError(null);
    try {
      const res = await apiFetch('/api/onboarding/journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, action }),
      });
      if (res.ok) setJourney((await res.json()) as OnboardingJourney);
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

  // Progressive grouping — derived only for display order; the authority owns
  // status/currentStep/platformReady (§7). "Up next" = the current step; then
  // the remaining actionable stages; optional resolved (skipped/dismissed);
  // finally completed.
  const groups = useMemo(() => {
    const stages = journey?.stages ?? [];
    const current = journey?.currentStep;
    const upNext: JourneyStage[] = [];
    const todo: JourneyStage[] = [];
    const blocked: JourneyStage[] = [];
    const resolvedOptional: JourneyStage[] = [];
    const done: JourneyStage[] = [];
    for (const s of stages) {
      if (s.status === 'completed') { done.push(s); continue; }
      if (s.status === 'skipped' || s.status === 'dismissed') { resolvedOptional.push(s); continue; }
      if (s.status === 'blocked') { blocked.push(s); continue; }
      if (s.id === current) upNext.push(s);
      else todo.push(s);
    }
    return { upNext, todo, blocked, resolvedOptional, done };
  }, [journey]);

  const pct = journey?.readiness?.completionPercentage ?? 0;

  const renderCard = (s: JourneyStage) => (
    <SetupCard
      key={s.id}
      stage={s}
      isCurrent={journey?.currentStep === s.id}
      busy={busy}
      onAction={act}
    />
  );

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

          {/* Progress — straight from the authority (§7). */}
          {journey && !loading && (
            <div className="mt-5" aria-label="Setup progress">
              <div className="flex items-center justify-between text-xs font-medium text-[#6B7C93]">
                <span>{journey.platformReady ? 'Setup complete' : journey.readiness.reason}</span>
                <span>{pct}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all" style={{ width: `${pct}%` }} />
              </div>
              {!journey.platformReady && (
                <p className="mt-1.5 text-[11px] text-[#9AA7B8]">
                  Estimated time left: {journey.readiness.estimatedRemainingTime}
                </p>
              )}
            </div>
          )}

          {journey?.platformReady && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-sm font-semibold text-emerald-800">🎉 Your platform is ready.</p>
              <p className="mt-1 text-sm text-emerald-700">Every required step is done. <Link href="/command-center" className="font-semibold underline">Go to your dashboard →</Link></p>
            </div>
          )}

          {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          {loading && <p className="mt-8 text-sm text-[#6B7C93]">Loading your progress…</p>}

          {journey && !loading && (
            <div className="mt-6 space-y-8">
              {groups.upNext.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0A66C2]">Up next</h2>
                  <div className="space-y-3">{groups.upNext.map(renderCard)}</div>
                </section>
              )}
              {groups.todo.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7C93]">To do</h2>
                  <div className="space-y-3">{groups.todo.map(renderCard)}</div>
                </section>
              )}
              {groups.blocked.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9AA7B8]">Blocked — finish the steps above first</h2>
                  <div className="space-y-3">{groups.blocked.map(renderCard)}</div>
                </section>
              )}
              {groups.resolvedOptional.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9AA7B8]">Skipped — you can reopen these</h2>
                  <div className="space-y-3">{groups.resolvedOptional.map(renderCard)}</div>
                </section>
              )}
              {groups.done.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Completed</h2>
                  <div className="space-y-3">{groups.done.map(renderCard)}</div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
