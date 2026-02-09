import { fetchNetworkIntelligence } from './networkIntelligenceService';
import { buildCampaignBaselineMetrics } from './campaignBaselineService';
import { buildExecutiveAlerts } from './executiveAlertsService';
import { buildPlaybookLearning } from './playbookLearningService';

export type RecommendationInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
};

export type RecommendationItem = {
  category: string;
  suggestion: string;
  confidence: 'low' | 'medium' | 'high';
  requires_review: true;
  supporting_signals: string[];
};

const addRecommendation = (
  list: RecommendationItem[],
  item: RecommendationItem
) => {
  const key = `${item.category}:${item.suggestion}`;
  if (list.some((existing) => `${existing.category}:${existing.suggestion}` === key)) return;
  list.push(item);
};

export const buildRecommendations = async (input: RecommendationInput) => {
  const [learning, alerts, campaign, network] = await Promise.all([
    buildPlaybookLearning(input),
    buildExecutiveAlerts(input),
    buildCampaignBaselineMetrics(input),
    fetchNetworkIntelligence(input),
  ]);

  const recommendations: RecommendationItem[] = [];

  const decaying = learning.records.filter((record) => record.learning_state === 'decaying');
  if (decaying.length > 0) {
    addRecommendation(recommendations, {
      category: 'Playbook Health',
      suggestion: 'Review playbook tone and cadence for decaying performance.',
      confidence: 'medium',
      requires_review: true,
      supporting_signals: decaying.flatMap((record) => record.supporting_signals).slice(0, 5),
    });
  }

  const volatile = learning.records.filter((record) => record.learning_state === 'volatile');
  if (volatile.length > 0) {
    addRecommendation(recommendations, {
      category: 'Stability',
      suggestion: 'Stabilize posting windows and reduce abrupt execution swings.',
      confidence: 'medium',
      requires_review: true,
      supporting_signals: volatile.flatMap((record) => record.supporting_signals).slice(0, 5),
    });
  }

  const campaignExecution = campaign.metrics.find((metric) => metric.metric === 'execution_rate');
  if (campaignExecution && campaignExecution.outcome === 'underperformed') {
    addRecommendation(recommendations, {
      category: 'Campaign Effectiveness',
      suggestion: 'Revisit platform mix and targeting for the current campaign window.',
      confidence: 'medium',
      requires_review: true,
      supporting_signals: [
        `Campaign execution lift ${campaignExecution.lift_percent.toFixed(1)}%`,
      ],
    });
  }

  const lowEligibilityAlert = alerts.alerts.find((alert) => alert.alert_type === 'low_eligibility_rate');
  if (lowEligibilityAlert) {
    addRecommendation(recommendations, {
      category: 'Audience Quality',
      suggestion: 'Review discovery sources to improve eligibility rate.',
      confidence: 'low',
      requires_review: true,
      supporting_signals: [lowEligibilityAlert.reason],
    });
  }

  if (network.summaries.by_platform.length > 0) {
    const totals = network.summaries.totals.discovered_users || 0;
    const top = [...network.summaries.by_platform].sort(
      (a, b) => b.discovered_users - a.discovered_users
    )[0];
    const share = totals > 0 ? top.discovered_users / totals : 0;
    if (share >= 0.7) {
      addRecommendation(recommendations, {
        category: 'Platform Mix',
        suggestion: 'Explore additional platforms to reduce concentration risk.',
        confidence: 'low',
        requires_review: true,
        supporting_signals: [
          `${top.label} accounts for ${(share * 100).toFixed(1)}% of discovered users.`,
        ],
      });
    }
  }

  return { recommendations };
};
