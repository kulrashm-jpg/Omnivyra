/**
 * Emergency controls — force degradation / force recovery / force lease
 * reclamation. Each button opens a confirmation dialog with phrase-typing
 * + reason capture.
 */

import React, { useState } from 'react';
import { Card, SectionHeader, StatusBadge } from './PrimitiveTiles';
import ConfirmDialog from './ConfirmDialog';
import type { ForceModeAction, ForceDegradationMode } from '../../../hooks/usePlannerControl';

export default function EmergencyPanel({
  pendingAction,
  callForceMode,
  currentClusterMode,
}: {
  pendingAction: string | null;
  callForceMode: (body: { action: ForceModeAction; mode?: ForceDegradationMode; reason?: string }) => void;
  currentClusterMode: string | undefined;
}) {
  const [dialog, setDialog] = useState<null | {
    title: string;
    description: React.ReactNode;
    confirmPhrase?: string;
    onConfirm: (reason: string) => void;
    destructive?: boolean;
  }>(null);

  const close = () => setDialog(null);
  const isInflight = (key: string) => pendingAction === key;

  return (
    <>
      <Card className="border-rose-300 bg-rose-50/30">
        <SectionHeader
          title="Emergency controls"
          subtitle="Use ONLY during active incidents. Every action is audited with operator id + reason."
          right={<StatusBadge tone="critical">DESTRUCTIVE</StatusBadge>}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(['elevated', 'degraded', 'critical'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setDialog({
                title: `Force degradation → ${mode}`,
                description: (
                  <>
                    Forces the cluster overload mode to <code>{mode}</code> regardless of the
                    measured pressure score. Bypasses hysteresis. Currently <code>{currentClusterMode ?? 'unknown'}</code>.
                    <br />
                    Use when an incident is in progress and the auto-detector hasn&apos;t
                    caught up yet.
                  </>
                ),
                confirmPhrase: mode,
                destructive: true,
                onConfirm: (reason) => { callForceMode({ action: 'force_degradation', mode, reason }); close(); },
              })}
              className="px-3 py-2 rounded border border-rose-300 bg-white text-rose-700 text-xs font-medium hover:bg-rose-50 disabled:opacity-40"
            >
              {isInflight('force:force_degradation') ? 'Forcing…' : `Force ${mode}`}
            </button>
          ))}
          <button
            type="button"
            disabled={pendingAction !== null}
            onClick={() => setDialog({
              title: 'Force recovery → normal',
              description: (
                <>
                  Resets the cluster overload mode to <code>normal</code> regardless of the
                  measured pressure score. Bypasses hysteresis.
                  <br />
                  Use after the underlying incident is resolved if the auto-detector hasn&apos;t
                  caught up.
                </>
              ),
              confirmPhrase: 'normal',
              onConfirm: (reason) => { callForceMode({ action: 'force_recovery', reason }); close(); },
            })}
            className="px-3 py-2 rounded border border-emerald-300 bg-white text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-40"
          >
            {isInflight('force:force_recovery') ? 'Forcing recovery…' : 'Force recovery'}
          </button>
          <button
            type="button"
            disabled={pendingAction !== null}
            onClick={() => setDialog({
              title: 'Force semaphore lease reclamation',
              description: (
                <>
                  Sweeps every pool&apos;s Redis ZSET and removes expired leases immediately.
                  Use after a known mass-worker-crash incident if dead leases haven&apos;t
                  cleared on their own within ~60s.
                </>
              ),
              confirmPhrase: 'reclaim',
              destructive: true,
              onConfirm: (reason) => { callForceMode({ action: 'force_lease_reclamation', reason }); close(); },
            })}
            className="px-3 py-2 rounded border border-amber-300 bg-white text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-40"
          >
            {isInflight('force:force_lease_reclamation') ? 'Reclaiming…' : 'Force lease reclamation'}
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmPhrase={dialog?.confirmPhrase}
        destructive={dialog?.destructive}
        pendingActionLabel={pendingAction?.startsWith('force:') ? 'Submitting…' : null}
        onConfirm={(reason) => dialog?.onConfirm(reason)}
        onCancel={close}
      />
    </>
  );
}
