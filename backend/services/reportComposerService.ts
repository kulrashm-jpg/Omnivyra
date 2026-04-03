import { listDecisionObjects, type DecisionReportTier, type PersistedDecisionObject } from './decisionObjectService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';

export interface ReportComposerGroup {
  iu_id: string;
  iu_name: string;
  category: string;
  priority: number;
  decision_count: number;
  issue_types: string[];
  decisions: PersistedDecisionObject[];
}

export interface ComposedReport {
  company_id: string;
  report_tier: DecisionReportTier;
  enabled_ius: Array<{
    iu_id: string;
    name: string;
    enabled: boolean;
    priority_override: number | null;
  }>;
  summary: {
    total_decisions: number;
    included_decisions: number;
    excluded_decisions: number;
    groups: number;
  };
  grouped_insights: ReportComposerGroup[];
  decisions: PersistedDecisionObject[];
}

function rankUnit(unit: IntelligenceUnitWithConfig): number {
  return unit.priority_override ?? Math.round(unit.cost_weight * 10);
}

function distinctIssueTypes(decisions: PersistedDecisionObject[]): string[] {
  return [...new Set(decisions.map((decision) => decision.issue_type))].sort();
}

export function composeReportFromConfig(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  units: IntelligenceUnitWithConfig[];
  decisions: PersistedDecisionObject[];
}): ComposedReport {
  const enabledUnits = params.units.filter((unit) => unit.enabled);
  const includedDecisions: PersistedDecisionObject[] = [];
  const groups = new Map<string, ReportComposerGroup>();

  for (const decision of params.decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, enabledUnits);
    if (!unit) continue;

    includedDecisions.push(decision);
    const current = groups.get(unit.id) ?? {
      iu_id: unit.id,
      iu_name: unit.name,
      category: unit.category,
      priority: rankUnit(unit),
      decision_count: 0,
      issue_types: [],
      decisions: [],
    };
    current.decision_count += 1;
    current.decisions.push(decision);
    groups.set(unit.id, current);
  }

  const groupedInsights = [...groups.values()]
    .map((group) => ({
      ...group,
      issue_types: distinctIssueTypes(group.decisions),
      decisions: [...group.decisions].sort((a, b) => {
        const execDelta = Number(b.execution_score ?? 0) - Number(a.execution_score ?? 0);
        if (execDelta !== 0) return execDelta;
        return Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0);
      }),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.decision_count - a.decision_count;
    });

  return {
    company_id: params.companyId,
    report_tier: params.reportTier,
    enabled_ius: params.units.map((unit) => ({
      iu_id: unit.id,
      name: unit.name,
      enabled: unit.enabled,
      priority_override: unit.priority_override,
    })),
    summary: {
      total_decisions: params.decisions.length,
      included_decisions: includedDecisions.length,
      excluded_decisions: params.decisions.length - includedDecisions.length,
      groups: groupedInsights.length,
    },
    grouped_insights: groupedInsights,
    decisions: includedDecisions,
  };
}

export async function composeReport(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  status?: Array<'open' | 'resolved' | 'ignored'>;
  sourceService?: string;
}): Promise<ComposedReport> {
  const [units, decisions] = await Promise.all([
    listCompanyIntelligenceUnits(params.companyId),
    listDecisionObjects({
      viewName:
        params.reportTier === 'snapshot' ? 'snapshot_view' :
        params.reportTier === 'growth' ? 'growth_view' :
        'deep_view',
      companyId: params.companyId,
      sourceService: params.sourceService,
      status: params.status ?? ['open'],
      limit: 500,
    }),
  ]);

  return composeReportFromConfig({
    companyId: params.companyId,
    reportTier: params.reportTier,
    units,
    decisions,
  });
}
