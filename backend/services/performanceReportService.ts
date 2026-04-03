import { composeReport } from './reportComposerService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import {
  impactScore,
  rankByImpactConfidence,
  isOpportunitySignal,
} from './reportDecisionUtils';
import { buildPublicDomainAuditDecisions } from './publicDomainAuditService';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';

const PERFORMANCE_SECTION_DEFINITIONS = [
  {
    section_name: 'Funnel and Journey Diagnostics',
    IU_ids: ['IU-02', 'IU-10'],
  },
  {
    section_name: 'Conversion and Behavior Quality',
    IU_ids: ['IU-06', 'IU-08', 'IU-09'],
  },
  {
    section_name: 'Engagement and Efficiency Friction',
    IU_ids: ['IU-07', 'IU-14'],
  },
] as const;

const PERFORMANCE_IU_IDS: Set<string> = new Set(
  PERFORMANCE_SECTION_DEFINITIONS.flatMap((section) => section.IU_ids),
);

type PerformanceInsight = {
  decision_id: string;
  title: string;
  description: string;
  business_impact: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
};

type PerformanceOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

type PerformanceAction = {
  decision_id: string;
  title: string;
  recommendation: string;
  action_type: string;
  action_payload: Record<string, unknown>;
};

export interface PerformanceReportSection {
  section_name: string;
  IU_ids: string[];
  insights: PerformanceInsight[];
  opportunities: PerformanceOpportunity[];
  actions: PerformanceAction[];
}

export interface PerformanceReport {
  report_type: 'performance';
  score: {
    available: true;
    value: null;
    label: null;
  };
  sections: PerformanceReportSection[];
}

type PerformanceReportOptions = {
  resolvedInput?: ResolvedReportInput | null;
};

function toInsight(decision: PersistedDecisionObject): PerformanceInsight {
  return {
    decision_id: decision.id,
    title: decision.title,
    description: decision.description,
    business_impact: buildDecisionBusinessImpact(decision),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function toOpportunity(decision: PersistedDecisionObject): PerformanceOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

function toAction(decision: PersistedDecisionObject): PerformanceAction {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}

function mapDecisionsToPerformanceGroups(
  decisions: PersistedDecisionObject[],
  performanceUnits: IntelligenceUnitWithConfig[],
): Map<string, PersistedDecisionObject[]> {
  const groups = new Map<string, PersistedDecisionObject[]>();

  for (const decision of decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, performanceUnits);
    if (!unit) continue;
    const current = groups.get(unit.id) ?? [];
    current.push(decision);
    groups.set(unit.id, current);
  }

  return groups;
}

export async function composePerformanceReport(
  companyId: string,
  options?: PerformanceReportOptions,
): Promise<PerformanceReport> {
  const [baseReport, units] = await Promise.all([
    composeReport({
      companyId,
      reportTier: 'deep',
      status: ['open'],
    }),
    listCompanyIntelligenceUnits(companyId),
  ]);
  const publicAudit = await buildPublicDomainAuditDecisions({
    companyId,
    reportTier: 'deep',
    resolvedInput: options?.resolvedInput ?? null,
  });

  const performanceUnits = units.filter((unit) => unit.enabled && PERFORMANCE_IU_IDS.has(unit.id));
  const grouped = mapDecisionsToPerformanceGroups(
    [...baseReport.decisions, ...publicAudit.decisions],
    performanceUnits,
  );

  const sections: PerformanceReportSection[] = PERFORMANCE_SECTION_DEFINITIONS.map((section) => {
    const sectionDecisions = section.IU_ids
      .flatMap((iuId) => grouped.get(iuId) ?? [])
      .sort(rankByImpactConfidence);

    const insights = sectionDecisions
      .slice(0, 7)
      .map(toInsight);

    const opportunities = sectionDecisions
      .filter(isOpportunitySignal)
      .slice(0, 5)
      .map(toOpportunity);

    const actions = sectionDecisions
      .slice(0, 5)
      .map(toAction);

    return {
      section_name: section.section_name,
      IU_ids: [...section.IU_ids],
      insights,
      opportunities,
      actions,
    };
  });

  return {
    report_type: 'performance',
    score: {
      available: true,
      value: null,
      label: null,
    },
    sections,
  };
}
