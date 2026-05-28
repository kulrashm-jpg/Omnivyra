/**
 * Rollout timeline + controls.
 *
 * Shows: 6-stage timeline (legacy → full_production) with the active stage
 * highlighted + a status pill. Operator buttons: Promote, Pause/Resume,
 * Rollback, Reset, Force Promote.
 *
 * Every mutating button opens a `ConfirmDialog` that captures a reason.
 * The hook's `pendingAction` flag disables buttons while in-flight.
 */

import React, { useState } from 'react';
import { Card, MetricTile, SectionHeader, StatusBadge, relativeTimeMs, type StatusTone } from './PrimitiveTiles';
import ConfirmDialog from './ConfirmDialog';
import type { RolloutState, RolloutMode } from '../../../hooks/usePlannerControl';

const ROLLOUT_ORDER: RolloutMode[] = [
  'legacy',
  'distributed_pools_only',
  'streaming_only',
  'async_refinement',
  'full_progressive',
  'full_production',
];

function statusTone(status: RolloutState['status']): StatusTone {
  switch (status) {
    case 'in_canary':    return 'info';
    case 'promoting':    return 'info';
    case 'paused':       return 'warn';
    case 'rolled_back':  return 'critical';
    case 'idle':         return 'neutral';
  }
}

export default function RolloutPanel({
  state,
  pendingAction,
  callRollout,
}: {
  state: RolloutState;
  pendingAction: string | null;
  callRollout: (body: {
    action: 'promote' | 'rollback' | 'pause' | 'resume' | 'reset';
    reason?: string;
    targetMode?: RolloutMode;
    canarySoakMs?: number;
    force?: boolean;
  }) => void;
}) {
  const activeIdx = ROLLOUT_ORDER.indexOf(state.active_mode);
  const canPromote = activeIdx >= 0 && activeIdx < ROLLOUT_ORDER.length - 1;
  const nextMode = canPromote ? ROLLOUT_ORDER[activeIdx + 1] : null;
  const inCanary = state.status === 'in_canary';
  const canarySoakElapsedMs = state.canary_started_at ? Date.now() - state.canary_started_at : 0;
  const soakRemainingMs = state.canary_started_at
    ? Math.max(0, state.canary_soak_ms - canarySoakElapsedMs)
    : 0;

  const [dialog, setDialog] = useState<null | {
    title: string;
    description: React.ReactNode;
    confirmPhrase?: string;
    destructive?: boolean;
    onConfirm: (reason: string) => void;
  }>(null);

  const closeDialog = () => setDialog(null);

  return (
    <>
      <Card>
        <SectionHeader
          title="Planner rollout"
          subtitle="Staged promotion across six modes — see audit trail for every transition"
          right={<StatusBadge tone={statusTone(state.status)}>{state.status.toUpperCase()}</StatusBadge>}
        />

        {/* Stage timeline */}
        <ol className="grid grid-cols-1 sm:grid-cols-6 gap-1.5 mt-2">
          {ROLLOUT_ORDER.map((m, i) => {
            const isActive = m === state.active_mode;
            const isTarget = m === state.target_mode && !isActive;
            const isRollback = m === state.rollback_mode && !isActive;
            const isPast = i < activeIdx;
            return (
              <li
                key={m}
                className={[
                  'rounded-md border px-2 py-1.5 text-[11px]',
                  isActive ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' :
                  isTarget ? 'bg-sky-50 text-sky-800 border-sky-300' :
                  isRollback ? 'bg-amber-50 text-amber-800 border-amber-300' :
                  isPast ? 'bg-slate-100 text-slate-600 border-slate-200' :
                  'bg-white text-slate-500 border-slate-200',
                ].join(' ')}
              >
                <div className="font-mono text-[10px] opacity-75">{i + 1}/6</div>
                <div className="font-medium truncate">{m}</div>
              </li>
            );
          })}
        </ol>

        {/* Snapshot metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <MetricTile label="Active" value={state.active_mode} />
          <MetricTile label="Rollback target" value={state.rollback_mode} tone="warn" />
          <MetricTile
            label="Canary started"
            value={state.canary_started_at ? relativeTimeMs(state.canary_started_at) : '—'}
            hint={inCanary ? `soak remaining ${Math.round(soakRemainingMs / 60_000)}m` : undefined}
            tone={inCanary ? 'info' : 'neutral'}
          />
          <MetricTile
            label="Last operator"
            value={state.last_operator_id ?? 'system'}
            hint={state.last_reason}
          />
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            disabled={!canPromote || pendingAction !== null || state.status === 'rolled_back' || state.status === 'paused'}
            onClick={() => nextMode && setDialog({
              title: `Promote → ${nextMode}`,
              description: (
                <>
                  Advances active mode from <code>{state.active_mode}</code> to <code>{nextMode}</code>.
                  Sets rollback target to <code>{state.active_mode}</code>. Canary gates begin watching.
                  {soakRemainingMs > 0 && (
                    <div className="mt-2 text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      Soak not elapsed ({Math.round(soakRemainingMs / 60_000)}m remaining). Promote will be REFUSED unless you wait or use Force Promote.
                    </div>
                  )}
                </>
              ),
              confirmPhrase: nextMode,
              onConfirm: (reason) => {
                callRollout({ action: 'promote', reason });
                closeDialog();
              },
            })}
            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pendingAction === 'rollout:promote' ? 'Promoting…' : 'Promote →'}
          </button>

          {state.status === 'in_canary' && (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setDialog({
                title: 'Pause canary',
                description: 'Pauses progress through the staged rollout. Canary gates continue observing.',
                onConfirm: (reason) => { callRollout({ action: 'pause', reason }); closeDialog(); },
              })}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {pendingAction === 'rollout:pause' ? 'Pausing…' : 'Pause'}
            </button>
          )}

          {state.status === 'paused' && (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setDialog({
                title: 'Resume canary',
                description: 'Resumes the in-progress canary with the original start timestamp.',
                onConfirm: (reason) => { callRollout({ action: 'resume', reason }); closeDialog(); },
              })}
              className="px-3 py-1.5 rounded bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-40"
            >
              {pendingAction === 'rollout:resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}

          <button
            type="button"
            disabled={pendingAction !== null || state.status === 'rolled_back' || state.status === 'idle'}
            onClick={() => setDialog({
              title: `Rollback → ${state.rollback_mode}`,
              description: (
                <>
                  Reverts the cluster to <code>{state.rollback_mode}</code>. Subsequent promotes refuse until you Reset.
                </>
              ),
              confirmPhrase: state.rollback_mode,
              destructive: true,
              onConfirm: (reason) => { callRollout({ action: 'rollback', reason }); closeDialog(); },
            })}
            className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-40"
          >
            {pendingAction === 'rollout:rollback' ? 'Rolling back…' : 'Rollback'}
          </button>

          {state.status === 'rolled_back' && (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setDialog({
                title: 'Reset rollback block',
                description: 'Acknowledges the rollback and clears the block so promote() works again. Use after the cause has been investigated.',
                onConfirm: (reason) => { callRollout({ action: 'reset', reason }); closeDialog(); },
              })}
              className="px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-xs font-medium hover:bg-amber-100 disabled:opacity-40"
            >
              {pendingAction === 'rollout:reset' ? 'Resetting…' : 'Reset'}
            </button>
          )}

          <details className="ml-auto">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">Force promote (emergency)</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ROLLOUT_ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => setDialog({
                    title: `Force promote → ${m}`,
                    description: (
                      <>
                        EMERGENCY: bypasses the staged-order check and jumps directly to <code>{m}</code>.
                        Use only for incident response.
                      </>
                    ),
                    confirmPhrase: m,
                    destructive: true,
                    onConfirm: (reason) => {
                      callRollout({ action: 'promote', reason, targetMode: m, force: true });
                      closeDialog();
                    },
                  })}
                  className="px-2 py-0.5 text-[11px] rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  {m}
                </button>
              ))}
            </div>
          </details>
        </div>
      </Card>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmPhrase={dialog?.confirmPhrase}
        destructive={dialog?.destructive}
        pendingActionLabel={pendingAction?.startsWith('rollout:') ? 'Submitting…' : null}
        onConfirm={(reason) => dialog?.onConfirm(reason)}
        onCancel={closeDialog}
      />
    </>
  );
}
