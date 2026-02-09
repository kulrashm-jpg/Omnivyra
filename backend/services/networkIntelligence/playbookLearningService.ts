import { fetchNetworkIntelligence } from './networkIntelligenceService';
import { buildWeekOverWeekMetrics } from './weekOverWeekService';
import { buildCampaignBaselineMetrics } from './campaignBaselineService';
import { buildExecutiveAlerts } from './executiveAlertsService';

export type PlaybookLearningInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
};

export type PlaybookLearningRecord = {
  playbook_id: string | null;
  playbook_name: string;
  learning_state: 'improving' | 'stable' | 'volatile' | 'decaying' | 'insufficient_data';
  confidence: 'low' | 'medium' | 'high';
  supporting_signals: string[];
  first_observed_at: string | null;
  last_updated_at: string | null;
};

const POSITIVE_DELTA = 10;
const NEGATIVE_DELTA = -10;
const VOLATILE_DELTA = 30;

const toIso = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const getFirstObservedAt = (rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows']) => {
  return (
    rows
      .map((row) => toIso(row.first_seen_at))
      .filter(Boolean)
      .sort()
      .shift() || null
  );
};

const getLastUpdatedAt = (rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows']) => {
  return (
    rows
      .map((row) => toIso(row.last_action_at || row.last_seen_at || row.first_seen_at))
      .filter(Boolean)
      .sort()
      .pop() || null
  );
};

const sumActionsCreated = (
  rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows']
) => rows.reduce((acc, row) => acc + (row.total_actions_created ?? 0), 0);

const formatDelta = (label: string, delta: number) => `${label} ${delta.toFixed(1)}%`;

const buildSignals = (input: {
  wowExecution?: number;
  wowExecuted?: number;
  momExecution?: number;
  momExecuted?: number;
  campaignExecutionLift?: number;
  campaignOutcome?: 'outperformed' | 'underperformed' | 'matched';
  alerts: Awaited<ReturnType<typeof buildExecutiveAlerts>>['alerts'];
}) => {
  const signals: string[] = [];
  let positive = 0;
  let negative = 0;
  let volatile = false;

  const applyDelta = (label: string, value?: number) => {
    if (typeof value !== 'number') return;
    signals.push(formatDelta(label, value));
    if (value >= POSITIVE_DELTA) positive += 1;
    if (value <= NEGATIVE_DELTA) negative += 1;
    if (Math.abs(value) >= VOLATILE_DELTA) volatile = true;
  };

  applyDelta('WoW execution rate', input.wowExecution);
  applyDelta('WoW actions executed', input.wowExecuted);
  applyDelta('MoM execution rate', input.momExecution);
  applyDelta('MoM actions executed', input.momExecuted);

  if (typeof input.campaignExecutionLift === 'number') {
    signals.push(`Campaign execution lift ${input.campaignExecutionLift.toFixed(1)}%`);
    if (input.campaignExecutionLift >= POSITIVE_DELTA && input.campaignOutcome === 'outperformed') {
      positive += 1;
    }
    if (input.campaignExecutionLift <= NEGATIVE_DELTA && input.campaignOutcome === 'underperformed') {
      negative += 1;
    }
  }

  input.alerts.forEach((alert) => {
    signals.push(`Alert: ${alert.title}`);
    if (alert.severity === 'attention') negative += 1;
    if (alert.severity === 'warning') negative += 1;
  });

  return { signals, positive, negative, volatile };
};

const resolveLearningState = (input: {
  hasData: boolean;
  positive: number;
  negative: number;
  volatile: boolean;
}) => {
  if (!input.hasData) return 'insufficient_data' as const;
  if (input.positive > 0 && input.negative > 0) return 'volatile' as const;
  if (input.negative >= 2) return 'decaying' as const;
  if (input.positive >= 2) return 'improving' as const;
  if (input.volatile) return 'volatile' as const;
  return 'stable' as const;
};

const resolveConfidence = (totalUsers: number, actionsCreated: number) => {
  if (totalUsers >= 20 && actionsCreated >= 20) return 'high' as const;
  if (totalUsers >= 10 && actionsCreated >= 10) return 'medium' as const;
  return 'low' as const;
};

export const buildPlaybookLearning = async (input: PlaybookLearningInput) => {
  const baseRows = await fetchNetworkIntelligence(input);
  const playbookMap = new Map<string, string>();
  baseRows.rows.forEach((row) => {
    if (row.playbook_id) {
      playbookMap.set(row.playbook_id, row.playbook_name || 'Unassigned');
    }
  });

  const playbookIds = input.playbook_id ? [input.playbook_id] : Array.from(playbookMap.keys());
  if (playbookIds.length === 0) {
    return { records: [] as PlaybookLearningRecord[] };
  }

  const records: PlaybookLearningRecord[] = [];

  for (const playbookId of playbookIds) {
    const playbookRows = baseRows.rows.filter((row) => row.playbook_id === playbookId);
    const totalUsers = playbookRows.length;
    const actionsCreated = sumActionsCreated(playbookRows);
    const hasData = totalUsers >= 5 || actionsCreated >= 5;

    const wow = await buildWeekOverWeekMetrics(
      { ...input, playbook_id: playbookId },
      'wow'
    );
    const mom = await buildWeekOverWeekMetrics(
      { ...input, playbook_id: playbookId },
      'mom'
    );
    const campaign = await buildCampaignBaselineMetrics({
      ...input,
      playbook_id: playbookId,
    });
    const alerts = await buildExecutiveAlerts({ ...input, playbook_id: playbookId });

    const wowExecution = wow.metrics.find((metric) => metric.metric === 'execution_rate');
    const wowExecuted = wow.metrics.find((metric) => metric.metric === 'actions_executed');
    const momExecution = mom.metrics.find((metric) => metric.metric === 'execution_rate');
    const momExecuted = mom.metrics.find((metric) => metric.metric === 'actions_executed');
    const campaignExecution = campaign.metrics.find((metric) => metric.metric === 'execution_rate');

    const signalResult = buildSignals({
      wowExecution: wowExecution?.delta_percent,
      wowExecuted: wowExecuted?.delta_percent,
      momExecution: momExecution?.delta_percent,
      momExecuted: momExecuted?.delta_percent,
      campaignExecutionLift: campaignExecution?.lift_percent,
      campaignOutcome: campaignExecution?.outcome,
      alerts: alerts.alerts,
    });

    const learning_state = resolveLearningState({
      hasData,
      positive: signalResult.positive,
      negative: signalResult.negative,
      volatile: signalResult.volatile,
    });

    records.push({
      playbook_id: playbookId,
      playbook_name: playbookMap.get(playbookId) || 'Unassigned',
      learning_state,
      confidence: resolveConfidence(totalUsers, actionsCreated),
      supporting_signals: signalResult.signals,
      first_observed_at: getFirstObservedAt(playbookRows),
      last_updated_at: getLastUpdatedAt(playbookRows),
    });
  }

  return { records };
};
