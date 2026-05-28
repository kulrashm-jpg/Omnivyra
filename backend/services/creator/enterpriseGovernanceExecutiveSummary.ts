/**
 * Enterprise Governance — Executive Reporting (Phase 7).
 *
 * Computes a concise executive-grade rollup over the existing
 * aggregators (creativeOpsDashboard, telemetry, governance pipeline,
 * notification queue, alerting state). Designed for a single-pane
 * leadership view — health scores, trends, and one-line headlines.
 *
 * Pure read aggregator. No new persistence. No new tables.
 * Bounded — every aggregation reuses the underlying bounded reads.
 */

import {
  getCampaignHealthSummary,
  getApprovalCycleTiming,
  getGovernanceAnalytics,
} from './creativeOpsDashboard';
import { computeOrgStrategicMemory } from './creatorPerformanceTelemetry';
import { listActiveAlerts, type EnterpriseAlertSeverity } from './enterpriseGovernanceAlerting';
import { listNotifications } from './enterpriseGovernanceNotificationDelivery';

export type ExecutiveHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ExecutiveSummary = {
  companyId: string;
  computedAt: string;
  campaign: {
    totalAssets: number;
    publishedRate: number;
    approvalProgress: number;
    rejectionRate: number;
    staleCount: number;
    bottleneck: string | null;
  };
  qa: {
    avgDraftToApprovedHours: number;
    avgDraftToPublishedHours: number;
    reviewerAttribution: Record<string, number>;
  };
  governance: {
    totalEscalations: number;
    overdueEscalations: number;
    severeViolations24h: number;
    criticalActiveAlerts: number;
  };
  strategy: {
    topStrategies: Array<{ strategy: string; samples: number; successRate: number; averageQaScore: number }>;
    bestEmotionalDirection: string | null;
    bestRealismProfile: string | null;
    bestPlatform: string | null;
  };
  operationsHealth: {
    unacknowledgedNotifications: number;
    activeAlerts: Record<EnterpriseAlertSeverity, number>;
  };
  /** A → F enterprise health grade composed from the above. */
  overallHealthGrade: ExecutiveHealthGrade;
  /** Top 3 one-line operational headlines. */
  headlines: string[];
};

function gradeFromScore(score: number): ExecutiveHealthGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function computeExecutiveSummary(companyId: string): ExecutiveSummary {
  const health = getCampaignHealthSummary(companyId, null);
  const timing = getApprovalCycleTiming(companyId);
  const governance = getGovernanceAnalytics(companyId);
  const strategicMem = computeOrgStrategicMemory(companyId);
  const alerts = listActiveAlerts({ companyId });
  const notifs = listNotifications({ companyId, acknowledged: false, limit: 500 });

  const activeAlertsBySev: Record<EnterpriseAlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const a of alerts) activeAlertsBySev[a.severity] += 1;

  // Severe violations in last 24h — count from listed escalations metadata.
  let severe24h = 0;
  // governance.totalEscalations is over all time; for "last 24h" we
  // approximate using byReason and treat severe_governance_violation
  // as the proxy. (The dashboard service already filters bounded.)
  severe24h = (governance.byReason as Record<string, number>)['severe_governance_violation'] ?? 0;

  // Health score composition (0..100):
  //   - 30% publish rate
  //   - 20% (1 - rejection rate)
  //   - 20% no critical alerts
  //   - 15% no overdue escalations
  //   - 15% no severe violations
  const publishComponent = Math.min(1, health.publishedRate) * 30;
  const rejectionComponent = (1 - Math.min(1, health.rejectionRate)) * 20;
  const alertComponent = activeAlertsBySev.critical === 0 ? 20 : Math.max(0, 20 - activeAlertsBySev.critical * 5);
  const overdueComponent = governance.overdueEscalations === 0 ? 15 : Math.max(0, 15 - governance.overdueEscalations * 3);
  const severeComponent = severe24h === 0 ? 15 : Math.max(0, 15 - severe24h * 3);
  const score = publishComponent + rejectionComponent + alertComponent + overdueComponent + severeComponent;
  const grade = gradeFromScore(score);

  // Headlines — chosen by severity heuristics.
  const headlines: string[] = [];
  if (activeAlertsBySev.critical > 0) {
    headlines.push(`${activeAlertsBySev.critical} critical operational alert(s) active`);
  }
  if (health.staleCount > 0) {
    headlines.push(`${health.staleCount} review(s) stale > 7 days — bottleneck at ${health.bottleneckState ?? 'unknown'}`);
  }
  if (governance.overdueEscalations > 0) {
    headlines.push(`${governance.overdueEscalations} escalation(s) past deadline`);
  }
  if (notifs.length > 10) {
    headlines.push(`${notifs.length} unacknowledged notifications`);
  }
  if (health.publishedRate > 0.5 && headlines.length === 0) {
    headlines.push(`Publish throughput healthy: ${(health.publishedRate * 100).toFixed(0)}% of assets reached publication`);
  }
  if (headlines.length === 0) {
    headlines.push('No operational headlines — system nominal');
  }

  // Top strategies from strategic memory (already bounded). May be null
  // when telemetry has no events yet for this org.
  const topStrategies = (strategicMem?.topStrategies ?? [])
    .slice(0, 5)
    .map((s) => ({
      strategy: String(s.strategy),
      samples: s.samples,
      successRate: s.successRate,
      averageQaScore: s.averageQaScore,
    }));

  return {
    companyId,
    computedAt: new Date().toISOString(),
    campaign: {
      totalAssets: health.totalAssets,
      publishedRate: health.publishedRate,
      approvalProgress: health.approvalProgress,
      rejectionRate: health.rejectionRate,
      staleCount: health.staleCount,
      bottleneck: health.bottleneckState,
    },
    qa: {
      avgDraftToApprovedHours: timing.averageDraftToApprovedHours,
      avgDraftToPublishedHours: timing.averageDraftToPublishedHours,
      reviewerAttribution: timing.reviewerAttribution,
    },
    governance: {
      totalEscalations: governance.totalEscalations,
      overdueEscalations: governance.overdueEscalations,
      severeViolations24h: severe24h,
      criticalActiveAlerts: activeAlertsBySev.critical,
    },
    strategy: {
      topStrategies,
      bestEmotionalDirection: strategicMem?.bestEmotionalDirection ?? null,
      bestRealismProfile: strategicMem?.bestRealismProfile ?? null,
      bestPlatform: strategicMem?.bestPlatform ?? null,
    },
    operationsHealth: {
      unacknowledgedNotifications: notifs.length,
      activeAlerts: activeAlertsBySev,
    },
    overallHealthGrade: grade,
    headlines: headlines.slice(0, 3),
  };
}
