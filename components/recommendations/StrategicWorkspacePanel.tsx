import React from 'react';
import StrategyIntelligencePanel, { type StrategyStatusPayload } from '../strategy/StrategyIntelligencePanel';

export type StrategicFlowState =
  | 'expansion'
  | 'momentum'
  | 'exploration'
  | 'consolidation'
  | 'default';

export type WorkspaceCardSignal = {
  journeyState: 'past' | 'current' | 'upcoming' | null;
  momentumState: 'execute' | 'plan' | 'consistent' | null;
  strategyStatus?: string;
  cardId?: string;
  cardTitle?: string;
};

export type StrategicWorkspacePanelProps = {
  flowState: StrategicFlowState;
  cardsWithSignals: WorkspaceCardSignal[];
  strategyStatusPayload?: StrategyStatusPayload | null;
  onScrollToCard?: (cardId: string) => void;
};

const POSITION_LABELS: Record<StrategicFlowState, string> = {
  expansion: 'Growing from what is already working',
  momentum: 'Good time to move forward',
  exploration: 'Review before committing',
  consolidation: 'Stay consistent with proven themes',
  default: 'Several good options to compare',
};

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
    lines.push('These recommendations build on themes that already fit your brand and direction.');
  }
  if (hasNewDirections) {
    lines.push('You also have a few newer directions worth reviewing before you commit.');
  }
  if (hasExecuteMomentum) {
    lines.push('Some opportunities are strong enough to turn into campaigns right away.');
  }
  const hasStrongSignals = hasContinuity || hasNewDirections || hasExecuteMomentum;
  if (flowState === 'consolidation') {
    lines.push('Right now, staying consistent is likely to work better than changing direction too quickly.');
  } else if (
    hasStrongSignals &&
    (flowState === 'exploration' ||
      flowState === 'default' ||
      flowState === 'momentum' ||
      flowState === 'expansion')
  ) {
    lines.push('Your strategy is still evolving, so compare options carefully before you build.');
  }

  const displayLines = lines.slice(0, 3);
  if (displayLines.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100" role="status" aria-label="Strategy summary">
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
      ? `${executeCount} opportunit${executeCount === 1 ? 'y' : 'ies'} look ready to turn into campaigns now.`
      : 'Nothing looks urgent yet, so this is a good moment to review and plan.';
  const upcomingCopy =
    upcomingCount === 0
      ? 'No additional directions need attention right now.'
      : `${upcomingCount} other direction${upcomingCount === 1 ? '' : 's'} may become stronger soon.`;
  const stabilityCopy =
    flowState === 'consolidation'
      ? 'Your current theme is consistent, so staying focused is likely the safer move.'
      : 'You still have room to test and compare different directions.';

  const showExecuteList = expandedSection === 'execute' && executeCount > 0;
  const showUpcomingList = expandedSection === 'upcoming' && upcomingCount > 0;

  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
      role="region"
      aria-label="Recommendation summary"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">What The AI Sees:</span>{' '}
            {POSITION_LABELS[flowState]}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">Ready To Act:</span>{' '}
            {executeCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedSection((s) => (s === 'execute' ? null : 'execute'))}
                  className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
                  aria-expanded={showExecuteList}
                >
                  {executeCount} opportunit{executeCount === 1 ? 'y' : 'ies'} worth acting on now
                </button>
                . {showExecuteList && onScrollToCard && 'Click a title below to jump to it.'}
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
                      onClick={() => onScrollToCard(c.cardId)}
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
            <span className="font-medium text-slate-800">Worth Watching:</span>{' '}
            {upcomingCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedSection((s) => (s === 'upcoming' ? null : 'upcoming'))}
                  className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
                  aria-expanded={showUpcomingList}
                >
                  {upcomingCount} direction{upcomingCount === 1 ? '' : 's'} to keep an eye on
                </button>
                . {showUpcomingList && onScrollToCard && 'Click a title below to jump to it.'}
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
                      onClick={() => onScrollToCard(c.cardId)}
                      className="text-left text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      {c.cardTitle ?? 'Direction to watch'}
                    </button>
                  ) : (
                    <span>{c.cardTitle ?? 'Direction to watch'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">How Stable This Direction Is:</span>{' '}
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
