import React from 'react';
import StrategyIntelligencePanel, { type StrategyStatusPayload } from '../strategy/StrategyIntelligencePanel';

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
  /** When set, enables "click count to see which cards" and optional scroll-to-card. */
  cardId?: string;
  cardTitle?: string;
};

export type StrategicWorkspacePanelProps = {
  flowState: StrategicFlowState;
  cardsWithSignals: WorkspaceCardSignal[];
  /** Optional strategy-status payload for intelligence panel (awareness, drift, trend, bias, AI pressure). */
  strategyStatusPayload?: StrategyStatusPayload | null;
  /** Optional: when user clicks a listed opportunity/direction, scroll that card into view. */
  onScrollToCard?: (cardId: string) => void;
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
  const { flowState, cardsWithSignals, strategyStatusPayload, onScrollToCard } = props;
  const [expandedSection, setExpandedSection] = React.useState<'execute' | 'upcoming' | null>(null);

  const executeCards = cardsWithSignals.filter((c) => c.momentumState === 'execute');
  const upcomingCards = cardsWithSignals.filter((c) => c.journeyState === 'upcoming');
  const executeCount = executeCards.length;
  const upcomingCount = upcomingCards.length;
  const momentumCopy =
    executeCount > 0
      ? `${executeCount} opportunit${executeCount === 1 ? 'y' : 'ies'} ready for execution.`
      : 'Building planning momentum.';
  const upcomingCopy =
    upcomingCount === 0
      ? 'No upcoming directions yet.'
      : `${upcomingCount} strategic direction${upcomingCount === 1 ? '' : 's'} forming.`;
  const stabilityCopy =
    flowState === 'consolidation'
      ? 'Strong continuity detected.'
      : 'Flexible — exploring new directions.';

  const showExecuteList = expandedSection === 'execute' && executeCount > 0;
  const showUpcomingList = expandedSection === 'upcoming' && upcomingCount > 0;

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
            {executeCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedSection((s) => (s === 'execute' ? null : 'execute'))}
                  className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
                  aria-expanded={showExecuteList}
                >
                  {executeCount} opportunit{executeCount === 1 ? 'y' : 'ies'} ready for execution
                </button>
                . {showExecuteList && onScrollToCard && ' (click a title below to scroll to it)'}
              </>
            ) : (
              momentumCopy
            )}
          </p>
          {showExecuteList && (
            <ul className="mt-2 ml-4 space-y-1 list-disc text-sm text-slate-600">
              {executeCards.map((c) => (
                <li key={c.cardId ?? undefined}>
                  {c.cardId && onScrollToCard ? (
                    <button
                      type="button"
                      onClick={() => onScrollToCard(c.cardId!)}
                      className="text-left text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      {c.cardTitle ?? 'Opportunity'}
                    </button>
                  ) : (
                    <span>{c.cardTitle ?? 'Opportunity'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Upcoming Opportunities:</span>{' '}
            {upcomingCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedSection((s) => (s === 'upcoming' ? null : 'upcoming'))}
                  className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
                  aria-expanded={showUpcomingList}
                >
                  {upcomingCount} strategic direction{upcomingCount === 1 ? '' : 's'} forming
                </button>
                . {showUpcomingList && onScrollToCard && ' (click a title below to scroll to it)'}
              </>
            ) : (
              upcomingCopy
            )}
          </p>
          {showUpcomingList && (
            <ul className="mt-2 ml-4 space-y-1 list-disc text-sm text-slate-600">
              {upcomingCards.map((c) => (
                <li key={c.cardId ?? undefined}>
                  {c.cardId && onScrollToCard ? (
                    <button
                      type="button"
                      onClick={() => onScrollToCard(c.cardId!)}
                      className="text-left text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      {c.cardTitle ?? 'Strategic direction'}
                    </button>
                  ) : (
                    <span>{c.cardTitle ?? 'Strategic direction'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Strategic Stability:</span>{' '}
            {stabilityCopy}
          </p>
        </div>
      </div>
      <StrategyMemorySnapshot flowState={flowState} cardsWithSignals={cardsWithSignals} />
      <StrategyIntelligencePanel data={strategyStatusPayload} />
    </div>
  );
}

export default StrategicWorkspacePanel;
