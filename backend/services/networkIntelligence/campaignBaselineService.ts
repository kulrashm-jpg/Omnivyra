import { fetchNetworkIntelligence } from './networkIntelligenceService';
import { fetchPlaybookEffectiveness } from './playbookEffectivenessService';
import { getPlaybookById } from '../playbooks/playbookService';

export type CampaignBaselineInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
};

export type CampaignBaselineMetric = {
  metric: 'eligible_users' | 'actions_created' | 'actions_executed' | 'execution_rate';
  campaign_value: number;
  baseline_value: number;
  lift_percent: number;
  outcome: 'outperformed' | 'underperformed' | 'matched';
};

const clampPercent = (value: number) =>
  Number.isFinite(value) ? Math.max(-100, Math.min(1000, value)) : 0;

const computeLift = (campaign: number, baseline: number) => {
  if (baseline === 0) {
    if (campaign === 0) return 0;
    return 100;
  }
  return clampPercent(((campaign - baseline) / baseline) * 100);
};

const computeOutcome = (campaign: number, baseline: number) => {
  if (campaign > baseline) return 'outperformed';
  if (campaign < baseline) return 'underperformed';
  return 'matched';
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const resolveCampaignWindow = async (input: CampaignBaselineInput) => {
  const now = new Date();
  if (input.playbook_id) {
    const playbook = await getPlaybookById(
      input.playbook_id,
      input.tenant_id,
      input.organization_id
    );
    const campaignStart = toDate((playbook as any)?.campaign_start_at);
    const campaignEnd = toDate((playbook as any)?.campaign_end_at);
    if (campaignStart && campaignEnd && campaignEnd > campaignStart) {
      return { start: campaignStart, end: campaignEnd };
    }
    const createdAt = toDate((playbook as any)?.created_at);
    if (createdAt && now > createdAt) {
      return { start: createdAt, end: now };
    }
  }
  const fallbackStart = new Date(now);
  fallbackStart.setDate(fallbackStart.getDate() - 30);
  return { start: fallbackStart, end: now };
};

const buildWindowPair = (campaign: { start: Date; end: Date }) => {
  const durationMs = Math.max(0, campaign.end.getTime() - campaign.start.getTime());
  const baselineEnd = new Date(campaign.start);
  const baselineStart = new Date(campaign.start.getTime() - durationMs);
  return { campaign, baseline: { start: baselineStart, end: baselineEnd } };
};

const computeMetrics = (rows: Awaited<ReturnType<typeof fetchNetworkIntelligence>>['rows'], records: Awaited<ReturnType<typeof fetchPlaybookEffectiveness>>['records']) => {
  const eligible_users = rows.filter((row) => row.eligibility === true).length;
  const totals = records.reduce(
    (acc, row) => {
      acc.actions_created += row.actions_created_count ?? 0;
      acc.actions_executed += row.actions_executed_count ?? 0;
      return acc;
    },
    { actions_created: 0, actions_executed: 0 }
  );
  const execution_rate =
    totals.actions_created > 0 ? totals.actions_executed / totals.actions_created : 0;
  return {
    eligible_users,
    actions_created: totals.actions_created,
    actions_executed: totals.actions_executed,
    execution_rate,
  };
};

export const buildCampaignBaselineMetrics = async (input: CampaignBaselineInput) => {
  const { campaign, baseline } = buildWindowPair(await resolveCampaignWindow(input));

  const campaignFilters = {
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    platform: input.platform,
    playbook_id: input.playbook_id,
    start_date: campaign.start.toISOString(),
    end_date: campaign.end.toISOString(),
  };
  const baselineFilters = {
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    platform: input.platform,
    playbook_id: input.playbook_id,
    start_date: baseline.start.toISOString(),
    end_date: baseline.end.toISOString(),
  };

  const [campaignNetwork, baselineNetwork, campaignPlaybooks, baselinePlaybooks] =
    await Promise.all([
      fetchNetworkIntelligence(campaignFilters),
      fetchNetworkIntelligence(baselineFilters),
      fetchPlaybookEffectiveness(campaignFilters),
      fetchPlaybookEffectiveness(baselineFilters),
    ]);

  const campaignMetrics = computeMetrics(campaignNetwork.rows, campaignPlaybooks.records);
  const baselineMetrics = computeMetrics(baselineNetwork.rows, baselinePlaybooks.records);

  const metrics: CampaignBaselineMetric[] = [
    {
      metric: 'eligible_users',
      campaign_value: campaignMetrics.eligible_users,
      baseline_value: baselineMetrics.eligible_users,
      lift_percent: computeLift(campaignMetrics.eligible_users, baselineMetrics.eligible_users),
      outcome: computeOutcome(campaignMetrics.eligible_users, baselineMetrics.eligible_users),
    },
    {
      metric: 'actions_created',
      campaign_value: campaignMetrics.actions_created,
      baseline_value: baselineMetrics.actions_created,
      lift_percent: computeLift(campaignMetrics.actions_created, baselineMetrics.actions_created),
      outcome: computeOutcome(campaignMetrics.actions_created, baselineMetrics.actions_created),
    },
    {
      metric: 'actions_executed',
      campaign_value: campaignMetrics.actions_executed,
      baseline_value: baselineMetrics.actions_executed,
      lift_percent: computeLift(campaignMetrics.actions_executed, baselineMetrics.actions_executed),
      outcome: computeOutcome(campaignMetrics.actions_executed, baselineMetrics.actions_executed),
    },
    {
      metric: 'execution_rate',
      campaign_value: campaignMetrics.execution_rate,
      baseline_value: baselineMetrics.execution_rate,
      lift_percent: computeLift(campaignMetrics.execution_rate, baselineMetrics.execution_rate),
      outcome: computeOutcome(campaignMetrics.execution_rate, baselineMetrics.execution_rate),
    },
  ];

  return {
    metrics,
    windows: {
      campaign_window: {
        start: campaign.start.toISOString(),
        end: campaign.end.toISOString(),
      },
      baseline_window: {
        start: baseline.start.toISOString(),
        end: baseline.end.toISOString(),
      },
    },
  };
};
