import { fetchNetworkIntelligence } from './networkIntelligenceService';
import { fetchPlaybookEffectiveness } from './playbookEffectivenessService';

export type WeekOverWeekFilters = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
};

export type ComparisonType = 'wow' | 'mom';

export type WeekOverWeekMetric = {
  metric: 'eligible_users' | 'actions_created' | 'actions_executed' | 'execution_rate';
  current_value: number;
  previous_value: number;
  delta_percent: number;
  trend: 'up' | 'down' | 'flat';
};

const clampPercent = (value: number) =>
  Number.isFinite(value) ? Math.max(-100, Math.min(1000, value)) : 0;

const buildWindow = (anchor: Date, daysAgoStart: number, daysAgoEnd: number) => {
  const end = new Date(anchor);
  end.setDate(end.getDate() - daysAgoEnd);
  const start = new Date(anchor);
  start.setDate(start.getDate() - daysAgoStart);
  return { start: start.toISOString(), end: end.toISOString() };
};

const computeDelta = (current: number, previous: number) => {
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }
  return clampPercent(((current - previous) / previous) * 100);
};

const computeTrend = (current: number, previous: number): 'up' | 'down' | 'flat' => {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
};

export const buildWeekOverWeekMetrics = async (
  filters: WeekOverWeekFilters,
  comparisonType: ComparisonType = 'wow'
) => {
  const now = new Date();
  const windowSize = comparisonType === 'mom' ? 30 : 7;
  const currentWindow = buildWindow(now, windowSize, 0);
  const previousWindow = buildWindow(now, windowSize * 2, windowSize);

  const currentFilters = {
    ...filters,
    start_date: currentWindow.start,
    end_date: currentWindow.end,
  };
  const previousFilters = {
    ...filters,
    start_date: previousWindow.start,
    end_date: previousWindow.end,
  };

  const [currentNetwork, previousNetwork, currentPlaybooks, previousPlaybooks] =
    await Promise.all([
      fetchNetworkIntelligence(currentFilters),
      fetchNetworkIntelligence(previousFilters),
      fetchPlaybookEffectiveness(currentFilters),
      fetchPlaybookEffectiveness(previousFilters),
    ]);

  const currentEligible = currentNetwork.rows.filter((row) => row.eligibility === true).length;
  const previousEligible = previousNetwork.rows.filter((row) => row.eligibility === true).length;

  const sumActions = (records: typeof currentPlaybooks.records) =>
    records.reduce(
      (acc, row) => {
        acc.created += row.actions_created_count ?? 0;
        acc.executed += row.actions_executed_count ?? 0;
        return acc;
      },
      { created: 0, executed: 0 }
    );

  const currentActionTotals = sumActions(currentPlaybooks.records);
  const previousActionTotals = sumActions(previousPlaybooks.records);

  const currentExecutionRate =
    currentActionTotals.created > 0
      ? currentActionTotals.executed / currentActionTotals.created
      : 0;
  const previousExecutionRate =
    previousActionTotals.created > 0
      ? previousActionTotals.executed / previousActionTotals.created
      : 0;

  const metrics: WeekOverWeekMetric[] = [
    {
      metric: 'eligible_users',
      current_value: currentEligible,
      previous_value: previousEligible,
      delta_percent: computeDelta(currentEligible, previousEligible),
      trend: computeTrend(currentEligible, previousEligible),
    },
    {
      metric: 'actions_created',
      current_value: currentActionTotals.created,
      previous_value: previousActionTotals.created,
      delta_percent: computeDelta(currentActionTotals.created, previousActionTotals.created),
      trend: computeTrend(currentActionTotals.created, previousActionTotals.created),
    },
    {
      metric: 'actions_executed',
      current_value: currentActionTotals.executed,
      previous_value: previousActionTotals.executed,
      delta_percent: computeDelta(currentActionTotals.executed, previousActionTotals.executed),
      trend: computeTrend(currentActionTotals.executed, previousActionTotals.executed),
    },
    {
      metric: 'execution_rate',
      current_value: currentExecutionRate,
      previous_value: previousExecutionRate,
      delta_percent: computeDelta(currentExecutionRate, previousExecutionRate),
      trend: computeTrend(currentExecutionRate, previousExecutionRate),
    },
  ];

  return {
    metrics,
    windows: {
      current_window: currentWindow,
      previous_window: previousWindow,
    },
  };
};
