import { listDecisionObjects, type PersistedDecisionObject } from '../services/decisionObjectService';
import {
  DEFAULT_INTELLIGENCE_UNITS,
  listCompanyIntelligenceUnits,
  type IntelligenceUnitWithConfig,
} from '../services/intelligenceUnitService';
import { composeReport, composeReportFromConfig } from '../services/reportComposerService';

function withOverrides(
  units: IntelligenceUnitWithConfig[],
  overrides: Record<string, Partial<Pick<IntelligenceUnitWithConfig, 'enabled' | 'priority_override'>>>
): IntelligenceUnitWithConfig[] {
  return units.map((unit) => ({
    ...unit,
    enabled: overrides[unit.id]?.enabled ?? unit.enabled,
    priority_override: overrides[unit.id]?.priority_override ?? unit.priority_override,
  }));
}

async function loadUnits(companyId: string): Promise<IntelligenceUnitWithConfig[]> {
  try {
    return await listCompanyIntelligenceUnits(companyId);
  } catch {
    return DEFAULT_INTELLIGENCE_UNITS.map((unit) => ({
      ...unit,
      enabled: true,
      priority_override: null,
    }));
  }
}

async function loadDecisions(companyId: string, reportTier: 'snapshot' | 'growth' | 'deep'): Promise<PersistedDecisionObject[]> {
  return listDecisionObjects({
    viewName: reportTier === 'snapshot' ? 'snapshot_view' : reportTier === 'growth' ? 'growth_view' : 'deep_view',
    companyId,
    status: ['open', 'resolved', 'ignored'],
    limit: 500,
  });
}

async function main(): Promise<void> {
  const companyId = process.argv[2];
  if (!companyId) {
    throw new Error('Usage: ts-node backend/scripts/validateIntelligenceUnitControl.ts <company-id>');
  }

  const [units, snapshotDecisions, deepDecisions] = await Promise.all([
    loadUnits(companyId),
    loadDecisions(companyId, 'snapshot'),
    loadDecisions(companyId, 'deep'),
  ]);

  const baselineSnapshot = composeReportFromConfig({
    companyId,
    reportTier: 'snapshot',
    units,
    decisions: snapshotDecisions,
  });
  const seoDisabledSnapshot = composeReportFromConfig({
    companyId,
    reportTier: 'snapshot',
    units: withOverrides(units, { 'IU-03': { enabled: false } }),
    decisions: snapshotDecisions,
  });

  const baselineDeep = composeReportFromConfig({
    companyId,
    reportTier: 'deep',
    units,
    decisions: deepDecisions,
  });
  const revenueDisabledDeep = composeReportFromConfig({
    companyId,
    reportTier: 'deep',
    units: withOverrides(units, { 'IU-05': { enabled: false } }),
    decisions: deepDecisions,
  });

  console.log(JSON.stringify({
    snapshot: {
      baseline_included: baselineSnapshot.summary.included_decisions,
      seo_disabled_included: seoDisabledSnapshot.summary.included_decisions,
      changed: baselineSnapshot.summary.included_decisions !== seoDisabledSnapshot.summary.included_decisions,
    },
    deep: {
      baseline_included: baselineDeep.summary.included_decisions,
      revenue_disabled_included: revenueDisabledDeep.summary.included_decisions,
      changed: baselineDeep.summary.included_decisions !== revenueDisabledDeep.summary.included_decisions,
    },
    baseline_snapshot_groups: baselineSnapshot.grouped_insights.map((group) => ({
      iu_id: group.iu_id,
      decision_count: group.decision_count,
      issue_types: group.issue_types,
    })),
    baseline_deep_groups: baselineDeep.grouped_insights.map((group) => ({
      iu_id: group.iu_id,
      decision_count: group.decision_count,
      issue_types: group.issue_types,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
