import { fetchNetworkIntelligence } from './networkIntelligenceService';
import { fetchPlaybookEffectiveness } from './playbookEffectivenessService';
import { buildWeekOverWeekMetrics } from './weekOverWeekService';
import { buildCampaignBaselineMetrics } from './campaignBaselineService';

export type ExecutiveAlertsInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
};

export type ExecutiveAlert = {
  alert_type: string;
  severity: 'info' | 'warning' | 'attention';
  title: string;
  reason: string;
  supporting_metrics: Record<string, any>;
  first_detected_at: string | null;
};

const severityRank: Record<ExecutiveAlert['severity'], number> = {
  attention: 3,
  warning: 2,
  info: 1,
};

const orderAlerts = (alerts: ExecutiveAlert[]) =>
  alerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);

const toIso = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const computeEligibilityRate = (rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows']) => {
  if (rows.length === 0) return 0;
  const eligible = rows.filter((row) => row.eligibility === true).length;
  return eligible / rows.length;
};

const getLatestActivityAt = (rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows']) =>
  rows
    .map((row) => row.last_action_at || row.last_seen_at || row.first_seen_at)
    .map((value) => toIso(value))
    .filter(Boolean)
    .sort()
    .pop() || null;

const findMetric = (
  metrics: Awaited<ReturnType<typeof buildWeekOverWeekMetrics>>['metrics'],
  metric: string
) => metrics.find((row) => row.metric === metric);

export const buildExecutiveAlerts = async (input: ExecutiveAlertsInput) => {
  const [wow, mom, campaign, network, playbooks] = await Promise.all([
    buildWeekOverWeekMetrics(input, 'wow'),
    buildWeekOverWeekMetrics(input, 'mom'),
    buildCampaignBaselineMetrics(input),
    fetchNetworkIntelligence(input),
    fetchPlaybookEffectiveness(input),
  ]);

  const alerts: ExecutiveAlert[] = [];

  const wowExecution = findMetric(wow.metrics, 'execution_rate');
  if (wowExecution && wowExecution.delta_percent <= -20) {
    alerts.push({
      alert_type: 'wow_execution_rate_drop',
      severity: 'attention',
      title: 'Execution rate declined week-over-week',
      reason: `Execution rate moved ${wowExecution.delta_percent.toFixed(1)}% compared to the prior week.`,
      supporting_metrics: wowExecution,
      first_detected_at: wow.windows.current_window.end,
    });
  }

  const wowActions = findMetric(wow.metrics, 'actions_executed');
  if (wowActions && wowActions.delta_percent <= -20) {
    alerts.push({
      alert_type: 'wow_actions_executed_drop',
      severity: 'warning',
      title: 'Executed actions softened week-over-week',
      reason: `Executed actions moved ${wowActions.delta_percent.toFixed(1)}% compared to the prior week.`,
      supporting_metrics: wowActions,
      first_detected_at: wow.windows.current_window.end,
    });
  }

  const momActions = findMetric(mom.metrics, 'actions_created');
  if (momActions && momActions.delta_percent <= -30) {
    alerts.push({
      alert_type: 'mom_actions_created_drop',
      severity: 'warning',
      title: 'Action creation slowed month-over-month',
      reason: `Actions created moved ${momActions.delta_percent.toFixed(1)}% compared to the prior month.`,
      supporting_metrics: momActions,
      first_detected_at: mom.windows.current_window.end,
    });
  }

  const campaignExecution = campaign.metrics.find((metric) => metric.metric === 'execution_rate');
  if (campaignExecution && campaignExecution.outcome === 'underperformed') {
    alerts.push({
      alert_type: 'campaign_execution_underperformed',
      severity: 'warning',
      title: 'Campaign execution underperformed baseline',
      reason: `Execution rate lift is ${campaignExecution.lift_percent.toFixed(1)}% versus baseline.`,
      supporting_metrics: campaignExecution,
      first_detected_at: campaign.windows.campaign_window.end,
    });
  }

  const eligibilityRate = computeEligibilityRate(network.rows);
  if (network.rows.length > 0 && eligibilityRate < 0.4) {
    alerts.push({
      alert_type: 'low_eligibility_rate',
      severity: 'attention',
      title: 'Eligibility rate remains low',
      reason: `Eligibility rate is ${(eligibilityRate * 100).toFixed(1)}% across the observed window.`,
      supporting_metrics: { eligibility_rate: eligibilityRate, total_users: network.rows.length },
      first_detected_at: getLatestActivityAt(network.rows),
    });
  }

  const lowPlaybook = [...playbooks.records]
    .filter((row) => row.discovered_users_count >= 5)
    .sort((a, b) => a.execution_rate - b.execution_rate)[0];
  if (lowPlaybook && lowPlaybook.execution_rate <= 0.2) {
    alerts.push({
      alert_type: 'playbook_execution_low',
      severity: 'info',
      title: 'Playbook execution rate is lagging',
      reason: `${lowPlaybook.playbook_name} execution rate is ${(lowPlaybook.execution_rate * 100).toFixed(
        1
      )}%.`,
      supporting_metrics: lowPlaybook,
      first_detected_at: lowPlaybook.last_activity_at ? toIso(lowPlaybook.last_activity_at) : null,
    });
  }

  return { alerts: orderAlerts(alerts) };
};
