import { listDecisionObjects, type DecisionReportTier, type PersistedDecisionObject } from './decisionObjectService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import {
  classifyDecisionType,
  DECISION_TYPE_TAXONOMY_VERSION,
  type DecisionTypeCategory,
} from './decisionTypeRegistry';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';

export type ComposedDecisionInsight = {
  decision_id: string;
  iu_id: string;
  title: string;
  description: string;
  business_impact: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  priority_score: number;
  recommendation: string;
  action_type: string;
};

export type ComposedDecisionOpportunity = {
  decision_id: string;
  iu_id: string;
  title: string;
  issue_type: string;
  opportunity_score: number;
  confidence_score: number;
  recommendation: string;
};

export type ComposedDecisionAction = {
  decision_id: string;
  iu_id: string;
  title: string;
  action_type: string;
  recommendation: string;
  action_payload: Record<string, unknown>;
};

export type ComposedIntelligenceUnit = {
  iu_id: string;
  iu_name: string;
  category: string;
  priority: number;
  decision_count: number;
  score: {
    impact: number;
    confidence: number;
    priority: number;
  };
  diagnosis: {
    dominant_category: DecisionTypeCategory;
    top_issue_types: string[];
  };
  insights: ComposedDecisionInsight[];
  opportunities: ComposedDecisionOpportunity[];
  actions: ComposedDecisionAction[];
};

export type ComposedDiagnosis = {
  health_score: number;
  risk_score: number;
  opportunity_score: number;
  execution_pressure: number;
  dominant_categories: Array<{ category: DecisionTypeCategory; count: number }>;
  top_issue_types: Array<{ issue_type: string; count: number }>;
};

export type ComposedDecisionIntelligence = {
  company_id: string;
  report_tier: DecisionReportTier;
  taxonomy_version: string;
  summary: {
    total_decisions: number;
    included_decisions: number;
    excluded_decisions: number;
    intelligence_units: number;
  };
  diagnosis: ComposedDiagnosis;
  intelligence_units: ComposedIntelligenceUnit[];
  insights: ComposedDecisionInsight[];
  opportunities: ComposedDecisionOpportunity[];
  actions: ComposedDecisionAction[];
  decisions: PersistedDecisionObject[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision = 3): number {
  const base = 10 ** precision;
  return Math.round(value * base) / base;
}

function impactScore(decision: PersistedDecisionObject): number {
  return Math.max(
    Number(decision.impact_traffic ?? 0),
    Number(decision.impact_conversion ?? 0),
    Number(decision.impact_revenue ?? 0)
  );
}

function rankDecision(a: PersistedDecisionObject, b: PersistedDecisionObject): number {
  const executionDelta = Number(b.execution_score ?? 0) - Number(a.execution_score ?? 0);
  if (executionDelta !== 0) return executionDelta;

  const priorityDelta = Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0);
  if (priorityDelta !== 0) return priorityDelta;

  return impactScore(b) - impactScore(a);
}

function rankUnit(unit: IntelligenceUnitWithConfig): number {
  return unit.priority_override ?? Math.round(unit.cost_weight * 10);
}

function toInsight(decision: PersistedDecisionObject, iuId: string): ComposedDecisionInsight {
  return {
    decision_id: decision.id,
    iu_id: iuId,
    title: decision.title,
    description: decision.description,
    business_impact: buildDecisionBusinessImpact(decision),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    priority_score: Number(decision.priority_score ?? 0),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function isOpportunityDecision(decision: PersistedDecisionObject): boolean {
  const normalizedType = String(decision.issue_type ?? '').toLowerCase();
  if (/(opportunity|growth|capture|expansion|scale)/.test(normalizedType)) return true;

  const category = classifyDecisionType(normalizedType);
  if (category === 'opportunity') return true;

  return Number(decision.priority_score ?? 0) >= 65 && impactScore(decision) >= 45;
}

function toOpportunity(decision: PersistedDecisionObject, iuId: string): ComposedDecisionOpportunity {
  const confidence = Number(decision.confidence_score ?? 0);
  const score = clamp(Math.round((Number(decision.priority_score ?? 0) * 0.7) + (impactScore(decision) * 0.3)), 0, 100);

  return {
    decision_id: decision.id,
    iu_id: iuId,
    title: decision.title,
    issue_type: decision.issue_type,
    opportunity_score: score,
    confidence_score: confidence,
    recommendation: decision.recommendation,
  };
}

function toAction(decision: PersistedDecisionObject, iuId: string): ComposedDecisionAction {
  return {
    decision_id: decision.id,
    iu_id: iuId,
    title: decision.title,
    action_type: decision.action_type,
    recommendation: decision.recommendation,
    action_payload: decision.action_payload ?? {},
  };
}

function summarizeTopCounts(values: string[], limit: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildDiagnosis(decisions: PersistedDecisionObject[], opportunities: ComposedDecisionOpportunity[]): ComposedDiagnosis {
  const categories = summarizeTopCounts(
    decisions.map((decision) => classifyDecisionType(decision.issue_type)),
    6,
  );
  const issueTypes = summarizeTopCounts(
    decisions.map((decision) => decision.issue_type),
    10,
  );

  const avgPriority = average(decisions.map((decision) => Number(decision.priority_score ?? 0)));
  const avgConfidence = average(decisions.map((decision) => Number(decision.confidence_score ?? 0))) * 100;
  const avgImpact = average(decisions.map((decision) => impactScore(decision)));
  const riskPressure = categories
    .filter((entry) => entry.value === 'risk' || entry.value === 'trust' || entry.value === 'velocity')
    .reduce((sum, entry) => sum + entry.count, 0);

  const opportunityStrength = opportunities.length > 0
    ? average(opportunities.map((opportunity) => opportunity.opportunity_score))
    : 0;

  return {
    health_score: clamp(Math.round((avgConfidence * 0.35) + (avgImpact * 0.3) + ((100 - avgPriority) * 0.35)), 0, 100),
    risk_score: clamp(Math.round((riskPressure * 8) + (avgPriority * 0.45)), 0, 100),
    opportunity_score: clamp(Math.round((opportunityStrength * 0.7) + (avgImpact * 0.3)), 0, 100),
    execution_pressure: clamp(Math.round((avgPriority * 0.6) + ((100 - avgConfidence) * 0.4)), 0, 100),
    dominant_categories: categories.map((entry) => ({
      category: entry.value as DecisionTypeCategory,
      count: entry.count,
    })),
    top_issue_types: issueTypes.map((entry) => ({
      issue_type: entry.value,
      count: entry.count,
    })),
  };
}

function unitDominantCategory(decisions: PersistedDecisionObject[]): DecisionTypeCategory {
  const top = summarizeTopCounts(decisions.map((decision) => classifyDecisionType(decision.issue_type)), 1)[0];
  return (top?.value as DecisionTypeCategory) ?? 'risk';
}

export function composeDecisionIntelligenceFromConfig(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  units: IntelligenceUnitWithConfig[];
  decisions: PersistedDecisionObject[];
}): ComposedDecisionIntelligence {
  const enabledUnits = params.units.filter((unit) => unit.enabled);
  const included: PersistedDecisionObject[] = [];
  const groups = new Map<string, { unit: IntelligenceUnitWithConfig; decisions: PersistedDecisionObject[] }>();

  for (const decision of params.decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, enabledUnits);
    if (!unit) continue;

    included.push(decision);
    const current = groups.get(unit.id) ?? { unit, decisions: [] };
    current.decisions.push(decision);
    groups.set(unit.id, current);
  }

  const intelligenceUnits: ComposedIntelligenceUnit[] = [...groups.values()]
    .map((group) => {
      const ranked = [...group.decisions].sort(rankDecision);
      const insights = ranked.map((decision) => toInsight(decision, group.unit.id));
      const opportunities = ranked.filter(isOpportunityDecision).map((decision) => toOpportunity(decision, group.unit.id));
      const actions = ranked.slice(0, Math.min(8, ranked.length)).map((decision) => toAction(decision, group.unit.id));

      return {
        iu_id: group.unit.id,
        iu_name: group.unit.name,
        category: group.unit.category,
        priority: rankUnit(group.unit),
        decision_count: ranked.length,
        score: {
          impact: round(average(ranked.map((decision) => impactScore(decision))), 2),
          confidence: round(average(ranked.map((decision) => Number(decision.confidence_score ?? 0))), 3),
          priority: round(average(ranked.map((decision) => Number(decision.priority_score ?? 0))), 2),
        },
        diagnosis: {
          dominant_category: unitDominantCategory(ranked),
          top_issue_types: summarizeTopCounts(ranked.map((decision) => decision.issue_type), 4).map((entry) => entry.value),
        },
        insights,
        opportunities,
        actions,
      };
    })
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return right.decision_count - left.decision_count;
    });

  const insights = intelligenceUnits.flatMap((unit) => unit.insights);
  const opportunities = intelligenceUnits.flatMap((unit) => unit.opportunities)
    .sort((a, b) => b.opportunity_score - a.opportunity_score);
  const actions = intelligenceUnits.flatMap((unit) => unit.actions);

  return {
    company_id: params.companyId,
    report_tier: params.reportTier,
    taxonomy_version: DECISION_TYPE_TAXONOMY_VERSION,
    summary: {
      total_decisions: params.decisions.length,
      included_decisions: included.length,
      excluded_decisions: params.decisions.length - included.length,
      intelligence_units: intelligenceUnits.length,
    },
    diagnosis: buildDiagnosis(included, opportunities),
    intelligence_units: intelligenceUnits,
    insights,
    opportunities,
    actions,
    decisions: included,
  };
}

export async function composeDecisionIntelligence(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  status?: Array<'open' | 'resolved' | 'ignored'>;
  sourceService?: string;
  entityType?: PersistedDecisionObject['entity_type'];
  entityId?: string | null;
}): Promise<ComposedDecisionIntelligence> {
  const [units, decisions] = await Promise.all([
    listCompanyIntelligenceUnits(params.companyId),
    listDecisionObjects({
      viewName:
        params.reportTier === 'snapshot'
          ? 'snapshot_view'
          : params.reportTier === 'growth'
            ? 'growth_view'
            : 'deep_view',
      companyId: params.companyId,
      sourceService: params.sourceService,
      entityType: params.entityType,
      entityId: params.entityId,
      status: params.status ?? ['open'],
      limit: 500,
    }),
  ]);

  return composeDecisionIntelligenceFromConfig({
    companyId: params.companyId,
    reportTier: params.reportTier,
    units,
    decisions,
  });
}

export type CampaignInsightCategory = 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';

function toCampaignCategory(category: DecisionTypeCategory): CampaignInsightCategory {
  if (category === 'governance') return 'GOVERNANCE';
  if (category === 'execution' || category === 'velocity') return 'EXECUTION';
  if (category === 'performance' || category === 'risk' || category === 'distribution') return 'PERFORMANCE';
  return 'CONTENT_STRATEGY';
}

export function composeCampaignOptimizationView(campaignId: string, composition: ComposedDecisionIntelligence): {
  campaignId: string;
  insights: Array<{
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    category: CampaignInsightCategory;
    headline: string;
    explanation: string;
    recommendedAction: string;
  }>;
  roi: {
    roiScore: number;
    performanceScore: number;
    governanceStabilityScore: number;
    executionReliabilityScore: number;
    optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
    recommendation: string;
  };
} {
  const insights = composition.insights
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 10)
    .map((insight) => ({
      priority: insight.priority_score >= 70 ? 'HIGH' as const : insight.priority_score >= 45 ? 'MEDIUM' as const : 'LOW' as const,
      category: toCampaignCategory(classifyDecisionType(insight.issue_type)),
      headline: insight.title,
      explanation: insight.description,
      recommendedAction: insight.recommendation,
    }));

  const governanceCount = insights.filter((item) => item.category === 'GOVERNANCE').length;
  const executionCount = insights.filter((item) => item.category === 'EXECUTION').length;
  const avgPriority = composition.insights.length > 0
    ? average(composition.insights.map((item) => item.priority_score))
    : 0;
  const avgImpact = composition.insights.length > 0
    ? average(composition.insights.map((item) => item.impact_score))
    : 0;

  const performanceScore = clamp(Math.round(100 - avgImpact * 0.6), 0, 100);
  const governanceStabilityScore = clamp(Math.round(100 - governanceCount * 12), 0, 100);
  const executionReliabilityScore = clamp(Math.round(100 - executionCount * 10 - avgPriority * 0.25), 0, 100);
  const roiScore = clamp(
    Math.round((performanceScore * 0.4) + (governanceStabilityScore * 0.3) + (executionReliabilityScore * 0.3)),
    0,
    100,
  );

  const optimizationSignal = roiScore >= 80
    ? 'HIGH_POTENTIAL'
    : roiScore < 50
      ? 'AT_RISK'
      : 'STABLE';

  return {
    campaignId,
    insights,
    roi: {
      roiScore,
      performanceScore,
      governanceStabilityScore,
      executionReliabilityScore,
      optimizationSignal,
      recommendation:
        insights[0]?.recommendedAction ??
        'No active decision signals indicate critical optimization risk.',
    },
  };
}
