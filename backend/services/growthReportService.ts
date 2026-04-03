import { composeReport } from './reportComposerService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import type { PersistedDecisionObject } from './decisionObjectService';
import {
  impactScore,
  rankByImpactConfidence,
  isOpportunitySignal,
} from './reportDecisionUtils';

const GROWTH_SECTION_DEFINITIONS = [
  {
    section_name: 'Expansion Opportunities',
    IU_ids: ['IU-11', 'IU-13'],
  },
  {
    section_name: 'Strategic Positioning',
    IU_ids: ['IU-15'],
  },
  {
    section_name: 'Authority and Revenue Scaling',
    IU_ids: ['IU-04', 'IU-05'],
  },
] as const;

const GROWTH_IU_IDS: Set<string> = new Set(
  GROWTH_SECTION_DEFINITIONS.flatMap((section) => section.IU_ids),
);

type GrowthInsight = {
  decision_id: string;
  title: string;
  description: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
};

type GrowthOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

type GrowthAction = {
  decision_id: string;
  title: string;
  recommendation: string;
  action_type: string;
  action_payload: Record<string, unknown>;
};

export interface GrowthReportSection {
  section_name: string;
  IU_ids: string[];
  insights: GrowthInsight[];
  opportunities: GrowthOpportunity[];
  actions: GrowthAction[];
}

export interface GrowthReport {
  report_type: 'growth';
  score: {
    available: true;
    value: null;
    label: null;
  };
  sections: GrowthReportSection[];
}

function toInsight(decision: PersistedDecisionObject): GrowthInsight {
  return {
    decision_id: decision.id,
    title: decision.title,
    description: decision.description,
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function toOpportunity(decision: PersistedDecisionObject): GrowthOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

function toAction(decision: PersistedDecisionObject): GrowthAction {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}

function mapDecisionsToGrowthGroups(
  decisions: PersistedDecisionObject[],
  growthUnits: IntelligenceUnitWithConfig[],
): Map<string, PersistedDecisionObject[]> {
  const groups = new Map<string, PersistedDecisionObject[]>();

  for (const decision of decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, growthUnits);
    if (!unit) continue;
    const current = groups.get(unit.id) ?? [];
    current.push(decision);
    groups.set(unit.id, current);
  }

  return groups;
}

function mergeUniqueDecisions(...decisionLists: PersistedDecisionObject[][]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const list of decisionLists) {
    for (const decision of list) {
      byId.set(decision.id, decision);
    }
  }
  return [...byId.values()];
}

export async function composeGrowthReport(companyId: string): Promise<GrowthReport> {
  const [growthComposed, deepComposed, units] = await Promise.all([
    composeReport({
      companyId,
      reportTier: 'growth',
      status: ['open'],
    }),
    composeReport({
      companyId,
      reportTier: 'deep',
      status: ['open'],
    }),
    listCompanyIntelligenceUnits(companyId),
  ]);

  const growthUnits = units.filter((unit) => unit.enabled && GROWTH_IU_IDS.has(unit.id));
  const mergedDecisions = mergeUniqueDecisions(growthComposed.decisions, deepComposed.decisions);
  const grouped = mapDecisionsToGrowthGroups(mergedDecisions, growthUnits);

  const sections: GrowthReportSection[] = GROWTH_SECTION_DEFINITIONS.map((section) => {
    const sectionDecisions = section.IU_ids
      .flatMap((iuId) => grouped.get(iuId) ?? [])
      .sort(rankByImpactConfidence);

    const insights = sectionDecisions
      .slice(0, 8)
      .map(toInsight);

    const opportunities = sectionDecisions
      .filter(isOpportunitySignal)
      .slice(0, 6)
      .map(toOpportunity);

    const actions = sectionDecisions
      .slice(0, 6)
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
    report_type: 'growth',
    score: {
      available: true,
      value: null,
      label: null,
    },
    sections,
  };
}
