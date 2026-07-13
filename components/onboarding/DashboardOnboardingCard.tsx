'use client';

/**
 * DashboardOnboardingCard — the persistent, journey-backed onboarding surface
 * (ONBOARD-002 §3/§5/§7).
 *
 * While onboarding is incomplete it shows a persistent card with progress, the
 * current stage, blocked state, required actions, a Continue button, and a
 * per-stage dismiss (only when the stage allows it). When the journey reaches
 * Platform Ready it replaces the card with the completion banner. It reads the
 * server-derived journey authority (useOnboardingJourney) and computes no
 * readiness itself — status + progress + next actions are all backend-authored.
 */

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/apiFetch';
import {
  useOnboardingJourney, CANONICAL_JOURNEY_HREF, type JourneyStageStatus,
} from '../../hooks/useOnboardingJourney';

// Same status vocabulary the canonical journey page uses (§5 — one vocabulary).
const STATUS_META: Record<JourneyStageStatus, { label: string; cls: string }> = {
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:     { label: 'Pending',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  not_started: { label: 'Not started', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  skipped:     { label: 'Skipped',     cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  dismissed:   { label: 'Dismissed',   cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  blocked:     { label: 'Blocked',     cls: 'bg-gray-100 text-gray-400 border-gray-200' },
};

export default function DashboardOnboardingCard() {
  const { journey, loading, refresh } = useOnboardingJourney();
  const [busy, setBusy] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Loading / unavailable → render nothing (no flash, no client-side guessing).
  if (loading || !journey) return null;

  // ── Platform Ready → completion banner (replaces the card, §3) ──
  if (journey.platformReady) {
    if (bannerDismissed) return null;
    return (
      <section aria-label="Onboarding complete" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-800">🎉 Platform Ready</p>
            <p className="mt-1 text-sm text-emerald-700">
              Every required step is complete. <Link href={CANONICAL_JOURNEY_HREF} className="font-semibold underline">Review your setup →</Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="text-emerald-500 hover:text-emerald-700"
            aria-label="Dismiss platform ready banner"
          >×</button>
        </div>
      </section>
    );
  }

  // ── Incomplete → persistent onboarding card (§3) ──
  const pct = journey.readiness.completionPercentage;
  const current = journey.stages.find((s) => s.id === journey.currentStep) ?? null;
  const currentMeta = current ? STATUS_META[current.status] : null;
  const blockedCount = journey.stages.filter((s) => s.status === 'blocked').length;
  const actions = journey.readiness.recommendations.slice(0, 3);

  const dismissCurrent = async () => {
    if (!current || !current.dismissible || busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/onboarding/journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: current.id, action: 'dismiss' }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Finish setting up Omnivyra" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Finish setting up Omnivyra</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {journey.readiness.reason} · <span className="text-slate-500">{journey.readiness.estimatedRemainingTime} left</span>
          </p>
        </div>
        <Link
          href={CANONICAL_JOURNEY_HREF}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Continue setup →
        </Link>
      </div>

      {/* Progress (server-derived percentage) */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{pct}% complete</span>
          {blockedCount > 0 && (
            <span className="text-gray-400">{blockedCount} step{blockedCount > 1 ? 's' : ''} waiting on earlier steps</span>
          )}
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Current stage */}
      {current && currentMeta && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            <span className="font-medium">Current step:</span> {current.title}
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${currentMeta.cls}`}>
            {currentMeta.label}
          </span>
        </div>
      )}

      {/* Required actions (server-recommended next steps) */}
      {actions.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {actions.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{a.title}</p>
                <p className="truncate text-xs text-slate-500">{a.why}</p>
              </div>
              <Link href={a.href} className="shrink-0 text-sm font-semibold text-emerald-700 hover:underline">Set up →</Link>
            </li>
          ))}
        </ul>
      )}

      {/* Dismiss — only when the current stage allows it */}
      {current?.dismissible && (
        <div className="mt-3 text-right">
          <button
            type="button"
            onClick={dismissCurrent}
            disabled={busy}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            {busy ? 'Dismissing…' : 'Dismiss this step'}
          </button>
        </div>
      )}
    </section>
  );
}
