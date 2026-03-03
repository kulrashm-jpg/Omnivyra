import React from 'react';

/** Strategic flow state from list-level aggregation (TrendCampaignsTab). */
export type StrategicFlowState =
  | 'expansion'
  | 'momentum'
  | 'exploration'
  | 'consolidation'
  | 'default';

/** Per-card signals used for workspace summary. Read-only. */
export type WorkspaceCardSignal = {
  journeyState: 'past' | 'current' | 'upcoming' | null;
  momentumState: 'execute' | 'plan' | 'consistent' | null;
  strategyStatus?: string;
};

export type StrategicWorkspacePanelProps = {
  flowState: StrategicFlowState;
  cardsWithSignals: WorkspaceCardSignal[];
};

const POSITION_LABELS: Record<StrategicFlowState, string> = {
  expansion: 'Expansion Phase',
  momentum: 'Momentum Phase',
  exploration: 'Exploration Phase',
  consolidation: 'Consolidation Phase',
  default: 'Multiple opportunities',
};

/** Strategy Memory Snapshot: perceived continuity from current-state signals only. Max 2–3 lines; hidden if no signals. */
function StrategyMemorySnapshot(props: {
  flowState: StrategicFlowState;
  cardsWithSignals: WorkspaceCardSignal[];
}) {
  const { flowState, cardsWithSignals } = props;
  const hasContinuity = cardsWithSignals.some(
    (c) => c.strategyStatus === 'continuation' || c.strategyStatus === 'expansion'
  );
  const hasNewDirections = cardsWithSignals.some((c) => c.journeyState === 'upcoming');
  const hasExecuteMomentum = cardsWithSignals.some((c) => c.momentumState === 'execute');

  const lines: string[] = [];
  if (hasContinuity) {
    lines.push('Your current strategy is building on previously established themes.');
  }
  if (hasNewDirections) {
    lines.push('New strategic directions are emerging alongside your current focus.');
  }
  if (hasExecuteMomentum) {
    lines.push('Execution-ready opportunities have increased since your last strategic phase.');
  }
  const hasStrongSignals = hasContinuity || hasNewDirections || hasExecuteMomentum;
  if (flowState === 'consolidation') {
    lines.push('Your strategy is currently stabilizing around proven directions.');
  } else if (hasStrongSignals && (flowState === 'exploration' || flowState === 'default' || flowState === 'momentum' || flowState === 'expansion')) {
    lines.push('Your strategy is actively evolving and exploring new paths.');
  }

  const displayLines = lines.slice(0, 3);
  if (displayLines.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100" role="status" aria-label="Strategy memory snapshot">
      <div className="space-y-0.5">
        {displayLines.map((line, i) => (
          <p key={i} className="text-xs text-slate-500 italic">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function StrategicWorkspacePanel(props: StrategicWorkspacePanelProps) {
  const { flowState, cardsWithSignals } = props;

  const executeCount = cardsWithSignals.filter((c) => c.momentumState === 'execute').length;
  const upcomingCount = cardsWithSignals.filter((c) => c.journeyState === 'upcoming').length;
  const momentumCopy =
    executeCount > 0
      ? `${executeCount} opportunity${executeCount === 1 ? '' : 's'} ready for execution.`
      : 'Building planning momentum.';
  const upcomingCopy =
    upcomingCount === 0
      ? 'No upcoming directions yet.'
      : `${upcomingCount} strategic direction${upcomingCount === 1 ? '' : 's'} forming.`;
  const stabilityCopy =
    flowState === 'consolidation'
      ? 'Strong continuity detected.'
      : 'Flexible — exploring new directions.';

  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
      role="region"
      aria-label="Strategic Workspace"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Current Position:</span>{' '}
            {POSITION_LABELS[flowState]}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Momentum Zone:</span>{' '}
            {momentumCopy}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Upcoming Opportunities:</span>{' '}
            {upcomingCopy}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Strategic Stability:</span>{' '}
            {stabilityCopy}
          </p>
        </div>
      </div>
      <StrategyMemorySnapshot flowState={flowState} cardsWithSignals={cardsWithSignals} />
    </div>
  );
}

export default StrategicWorkspacePanel;
