'use client';

/**
 * SetupCard — the ONE reusable progressive-setup card (ONBOARD-005 §2).
 *
 * Presentational only. It renders a single server-derived onboarding stage —
 * title, status, why it matters, deterministic guidance (what completing it
 * unlocks / what stays blocked without it), required action, skip/dismiss when
 * allowed, estimated completion, and dependencies. It computes NOTHING: every
 * value comes from the canonical journey authority (onboardingJourneyService)
 * via useOnboardingJourney. Used by the progressive setup view and any other
 * onboarding surface, so there is one card, not many.
 */

import Link from 'next/link';
import type { JourneyStage, JourneyStageStatus } from '../../hooks/useOnboardingJourney';

export type SetupCardAction = 'skip' | 'dismiss' | 'reopen';

const STATUS_META: Record<JourneyStageStatus, { label: string; cls: string }> = {
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:     { label: 'Pending',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  not_started: { label: 'Not started', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  skipped:     { label: 'Skipped',     cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  dismissed:   { label: 'Dismissed',   cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  blocked:     { label: 'Blocked',     cls: 'bg-gray-100 text-gray-400 border-gray-200' },
};

/** Provider chip colour by social/integration state (§6). */
const PROVIDER_CLS: Record<string, string> = {
  connected:          'bg-emerald-50 text-emerald-700',
  detected:           'bg-sky-50 text-sky-700',
  pending:            'bg-amber-50 text-amber-700',
  expired:            'bg-orange-50 text-orange-700',
  reconnect_required: 'bg-orange-50 text-orange-700',
  failed:             'bg-red-50 text-red-600',
};

function humanizeMinutes(mins: number | undefined): string | null {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

export interface SetupCardProps {
  stage: JourneyStage;
  /** True when this stage is the server-derived current step. */
  isCurrent?: boolean;
  /** `"${stageId}:${action}"` while an action is in flight. */
  busy?: string | null;
  onAction?: (stageId: string, action: SetupCardAction) => void;
}

export default function SetupCard({ stage, isCurrent, busy, onAction }: SetupCardProps) {
  const meta = STATUS_META[stage.status];
  const actionable = stage.status !== 'completed' && stage.status !== 'blocked';
  const est = humanizeMinutes(stage.estimatedMinutes);
  const unmetDeps = (stage.dependencies ?? []).filter((d) => !d.met);

  return (
    <div
      data-testid={`setup-card-${stage.id}`}
      data-status={stage.status}
      className={`rounded-2xl border bg-white p-5 transition ${
        isCurrent ? 'border-[#0A66C2] shadow-[0_4px_16px_rgba(10,102,194,0.12)]' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[#0B1F33]">{stage.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`} data-testid="status-badge">
              {meta.label}
            </span>
            {stage.mandatory
              ? <span className="text-[11px] font-medium text-[#6B7C93]">Required</span>
              : <span className="text-[11px] font-medium text-[#9AA7B8]">Optional</span>}
            {est && actionable && <span className="text-[11px] text-[#9AA7B8]">· {est}</span>}
          </div>

          {/* Why it matters (§2/§4). */}
          <p className="mt-1 text-xs leading-relaxed text-[#6B7C93]">{stage.why}</p>

          {/* Live detail (connected platforms, detected CMS, reconnect hints). */}
          {stage.detail && <p className="mt-1.5 text-xs text-[#0B1F33]/70">{stage.detail}</p>}

          {/* Guidance: what completing this unlocks / what stays blocked (§4). */}
          {stage.guidance && stage.status !== 'completed' && (
            <div className="mt-2 space-y-0.5">
              {stage.guidance.unlocks && (
                <p className="text-[11px] text-emerald-700">
                  <span aria-hidden>✦ </span>Unlocks: {stage.guidance.unlocks}
                </p>
              )}
              {stage.status === 'blocked' && stage.guidance.blockedWithout && (
                <p className="text-[11px] text-gray-400">
                  <span aria-hidden>⊘ </span>{stage.guidance.blockedWithout}
                </p>
              )}
            </div>
          )}

          {/* Dependencies (§2/§3). */}
          {unmetDeps.length > 0 && (
            <p className="mt-1.5 text-[11px] text-gray-400" data-testid="deps">
              Complete first: {unmetDeps.map((d) => d.title).join(', ')}
            </p>
          )}

          {/* Provider breakdown for integration stages (§6). */}
          {stage.providers && stage.providers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="providers">
              {stage.providers.map((p) => (
                <span
                  key={`${p.platform}:${p.state}`}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${PROVIDER_CLS[p.state] ?? 'bg-gray-50 text-[#6B7C93]'}`}
                >
                  {p.platform}: {p.state.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {stage.status === 'completed' && (
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </div>

      {actionable && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={stage.href}
            className="rounded-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95"
            data-testid="continue"
          >
            {stage.status === 'in_progress' ? 'Continue' : 'Set up'}
          </Link>
          {stage.skippable && onAction && (
            <button
              disabled={!!busy}
              onClick={() => onAction(stage.id, 'skip')}
              className="text-xs text-[#6B7C93] hover:text-[#0A66C2] disabled:opacity-50"
            >
              {busy === `${stage.id}:skip` ? 'Skipping…' : 'Skip for now'}
            </button>
          )}
          {stage.dismissible && onAction && (
            <button
              disabled={!!busy}
              onClick={() => onAction(stage.id, 'dismiss')}
              className="text-xs text-[#6B7C93]/70 hover:text-[#0A66C2] disabled:opacity-50"
            >
              {busy === `${stage.id}:dismiss` ? 'Dismissing…' : "Don't need this"}
            </button>
          )}
        </div>
      )}

      {/* Blocked stages are never actionable — surface the reason instead. */}
      {stage.status === 'blocked' && unmetDeps.length === 0 && (
        <p className="mt-3 text-xs text-gray-400">Complete the earlier steps first.</p>
      )}

      {(stage.status === 'skipped' || stage.status === 'dismissed') && onAction && (
        <button
          disabled={!!busy}
          onClick={() => onAction(stage.id, 'reopen')}
          className="mt-3 text-xs text-[#0A66C2] hover:underline disabled:opacity-50"
        >
          {busy === `${stage.id}:reopen` ? 'Reopening…' : 'Reopen this step'}
        </button>
      )}
    </div>
  );
}
