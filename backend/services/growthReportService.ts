import { composeReport } from './reportComposerService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { resolveAnalyticsReportInput } from './analyticsInputResolver';
import { buildCompetitorIntelligence } from './reportCompetitorIntelligenceService';
import {
  buildCompetitiveStrategyMap,
  type CompetitiveStrategyMap,
  type StrategicPositionBlock,
} from './reportCompetitorStrategyService';
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
  competitive_strategy_map: CompetitiveStrategyMap | null;
  strategic_position: StrategicPositionBlock | null;
  sections: GrowthReportSection[];
}

type GrowthReportOptions = {
  resolvedInput?: ResolvedReportInput | null;
};

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

async function resolveGrowthInput(companyId: string, resolvedInput?: ResolvedReportInput | null): Promise<ResolvedReportInput | null> {
  if (resolvedInput) return resolvedInput;
  try {
    return await resolveAnalyticsReportInput({
      companyId,
      reportCategory: 'growth',
    });
  } catch (error) {
    console.warn('[competitor-strategy][growth-input-resolution-failed]', {
      company_id: companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildGrowthCompetitorStrategy(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput: ResolvedReportInput | null;
}): {
  competitiveStrategyMap: CompetitiveStrategyMap | null;
  strategicPosition: StrategicPositionBlock | null;
} {
  if (!params.resolvedInput) return { competitiveStrategyMap: null, strategicPosition: null };
  try {
    const intelligence = buildCompetitorIntelligence({
      decisions: params.decisions,
      resolvedInput: params.resolvedInput,
    });
    const strategy = buildCompetitiveStrategyMap(intelligence);
    return {
      competitiveStrategyMap: strategy.competitive_strategy_map,
      strategicPosition: strategy.strategic_position,
    };
  } catch (error) {
    console.warn('[competitor-strategy][growth-build-failed]', {
      company_id: params.resolvedInput.companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { competitiveStrategyMap: null, strategicPosition: null };
  }
}

function buildCompetitiveStrategySection(
  strategyMap: CompetitiveStrategyMap | null,
  strategicPosition: StrategicPositionBlock | null,
): GrowthReportSection[] {
  if (!strategyMap || !strategicPosition) return [];

  const tierInsight = (label: string, items: CompetitiveStrategyMap['tier_breakdown']['tier_1']) => ({
    decision_id: `competitive_strategy_${label.toLowerCase().replace(/\s+/g, '_')}`,
    title: `${label} competitor pressure`,
    description: items.length
      ? items.map((item) => `${item.name}: ${item.threat_level} threat, ${item.differentiation}`).join(' ')
      : `${label} has no final-gated competitors in this report.`,
    issue_type: 'competitor_strategy',
    confidence_score: 0.9,
    impact_score: items.some((item) => item.threat_level === 'high') ? 86 : 68,
    recommendation: label === 'Tier 1'
      ? strategyMap.strategic_actions.how_to_beat_tier_1
      : label === 'Tier 2'
        ? strategyMap.strategic_actions.how_to_differentiate_from_tier_2
        : strategyMap.strategic_actions.how_to_ignore_tier_3,
    action_type: 'improve_content',
  });

  return [
    {
      section_name: 'Competitive Strategy Map',
      IU_ids: ['IU-15'],
      insights: [
        tierInsight('Tier 1', strategyMap.tier_breakdown.tier_1),
        tierInsight('Tier 2', strategyMap.tier_breakdown.tier_2),
        tierInsight('Tier 3', strategyMap.tier_breakdown.tier_3),
      ],
      opportunities: [
        ...strategyMap.opportunity_map.whitespace_opportunities.slice(0, 2).map((item, index) => ({
          decision_id: `competitive_whitespace_${index}`,
          title: item,
          recommendation: 'Turn this into a comparison, proof, or answer-ready asset.',
          confidence_score: 0.84,
          action_type: 'improve_content',
        })),
        ...strategyMap.opportunity_map.underexploited_icp_segments.slice(0, 2).map((item, index) => ({
          decision_id: `competitive_icp_${index}`,
          title: item,
          recommendation: 'Use this ICP angle in landing page messaging and campaign targeting.',
          confidence_score: 0.82,
          action_type: 'improve_content',
        })),
      ],
      actions: [
        {
          decision_id: 'competitive_action_tier_1',
          title: 'How to beat Tier 1 competitors',
          recommendation: strategyMap.strategic_actions.how_to_beat_tier_1,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 1', focus: 'direct_competitors' },
        },
        {
          decision_id: 'competitive_action_tier_2',
          title: 'How to differentiate from Tier 2',
          recommendation: strategyMap.strategic_actions.how_to_differentiate_from_tier_2,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 2', focus: 'alternatives' },
        },
        {
          decision_id: 'competitive_action_tier_3',
          title: 'How to ignore Tier 3',
          recommendation: strategyMap.strategic_actions.how_to_ignore_tier_3,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 3', focus: 'substitutes' },
        },
      ],
    },
    {
      section_name: 'Your Strategic Position',
      IU_ids: ['IU-15'],
      insights: [
        {
          decision_id: 'strategic_position_statement',
          title: 'Your Strategic Position',
          description: strategicPosition.positioning_statement,
          issue_type: 'competitor_positioning',
          confidence_score: 0.9,
          impact_score: 88,
          recommendation: strategicPosition.messaging_angle,
          action_type: 'improve_content',
        },
      ],
      opportunities: [
        {
          decision_id: 'strategic_position_battlefield',
          title: `Primary battlefield: ${strategicPosition.primary_battlefield}`,
          recommendation: `Compete here with proof, comparison pages, and sharper ICP messaging. Avoid ${strategicPosition.avoidance_zone}.`,
          confidence_score: 0.88,
          action_type: 'improve_content',
        },
      ],
      actions: [
        {
          decision_id: 'strategic_position_messaging',
          title: 'Messaging angle',
          recommendation: strategicPosition.messaging_angle,
          action_type: 'improve_content',
          action_payload: {
            primary_battlefield: strategicPosition.primary_battlefield,
            avoidance_zone: strategicPosition.avoidance_zone,
          },
        },
      ],
    },
  ];
}

export async function composeGrowthReport(companyId: string, options?: GrowthReportOptions): Promise<GrowthReport> {
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
  const resolvedInput = await resolveGrowthInput(companyId, options?.resolvedInput ?? null);
  const growthStrategy = buildGrowthCompetitorStrategy({
    decisions: mergedDecisions,
    resolvedInput,
  });
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

  const competitiveSections = buildCompetitiveStrategySection(
    growthStrategy.competitiveStrategyMap,
    growthStrategy.strategicPosition,
  );

  return {
    report_type: 'growth',
    score: {
      available: true,
      value: null,
      label: null,
    },
    competitive_strategy_map: growthStrategy.competitiveStrategyMap,
    strategic_position: growthStrategy.strategicPosition,
    sections: [...sections, ...competitiveSections],
  };
}
