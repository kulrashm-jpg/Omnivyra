import type {
  CompetitorIntelligenceResult,
  DetectedCompetitor,
} from './reportCompetitorIntelligenceService';

type ThreatLevel = 'low' | 'medium' | 'high';
type Tier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export type SnapshotCompetitorBrief = {
  name: string;
  tier: Tier;
  threat_level: ThreatLevel;
  differentiation: string;
};

export type CompetitiveSnapshotSummary = {
  top_threat: string;
  immediate_positioning_angle: string;
  action: string;
};

export type CompetitiveSnapshotReport = {
  competitors: SnapshotCompetitorBrief[];
  competitive_snapshot_summary: CompetitiveSnapshotSummary;
};

export type CompetitivePressureAnalysis = {
  competitors: Array<{
    name: string;
    tier: Tier;
    threat_level: ThreatLevel;
    authority_score: number;
    pressure_on: string[];
    action: string;
  }>;
  summary: {
    highest_pressure: string;
    primary_risk: string;
    next_action: string;
  };
};

export type CompetitiveStrategyMap = {
  tier_breakdown: {
    tier_1: SnapshotCompetitorBrief[];
    tier_2: SnapshotCompetitorBrief[];
    tier_3: SnapshotCompetitorBrief[];
  };
  opportunity_map: {
    whitespace_opportunities: string[];
    underexploited_icp_segments: string[];
    weak_competitor_areas: string[];
  };
  strategic_actions: {
    how_to_beat_tier_1: string;
    how_to_differentiate_from_tier_2: string;
    how_to_ignore_tier_3: string;
  };
};

export type StrategicPositionBlock = {
  positioning_statement: string;
  primary_battlefield: string;
  avoidance_zone: string;
  messaging_angle: string;
};

function threatWeight(threat: ThreatLevel | null | undefined): number {
  if (threat === 'high') return 3;
  if (threat === 'medium') return 2;
  return 1;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function readableList(values: string[], fallback: string): string {
  const cleaned = [...new Set(values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value)))];
  if (cleaned.length === 0) return fallback;
  if (cleaned.length === 1) return cleaned[0]!;
  return `${cleaned.slice(0, -1).join(', ')} and ${cleaned[cleaned.length - 1]}`;
}

function sortCompetitors(competitors: DetectedCompetitor[]): DetectedCompetitor[] {
  return [...competitors].sort((left, right) => {
    const threatDelta = threatWeight(right.positioning?.threat_level) - threatWeight(left.positioning?.threat_level);
    if (threatDelta !== 0) return threatDelta;
    const tierOrder: Record<Tier, number> = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };
    const tierDelta = tierOrder[left.tier] - tierOrder[right.tier];
    if (tierDelta !== 0) return tierDelta;
    const scoreDelta = Number(right.final_score ?? 0) - Number(left.final_score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return left.name.localeCompare(right.name);
  });
}

function toBrief(competitor: DetectedCompetitor): SnapshotCompetitorBrief {
  return {
    name: competitor.name,
    tier: competitor.tier,
    threat_level: competitor.positioning.threat_level,
    differentiation: competitor.positioning.differentiation,
  };
}

function topThreat(competitors: DetectedCompetitor[]): DetectedCompetitor | null {
  return sortCompetitors(competitors)[0] ?? null;
}

function competitorsByTier(competitors: DetectedCompetitor[], tier: Tier): DetectedCompetitor[] {
  return sortCompetitors(competitors.filter((competitor) => competitor.tier === tier));
}

function pressureAreas(competitor: DetectedCompetitor): string[] {
  const areas = new Set<string>();
  if (competitor.authority_score >= 0.65) {
    areas.add('SEO');
    areas.add('Brand authority');
  } else if (competitor.authority_score >= 0.45) {
    areas.add('Brand authority');
  }
  if (competitor.product_depth >= 0.65) areas.add('Content');
  if (competitor.icp_overlap >= 0.55) areas.add('Conversion');
  if (competitor.problem_overlap >= 0.6 || competitor.market_overlap >= 0.6) areas.add('AI visibility');
  if (areas.size === 0) areas.add('Content');
  return [...areas];
}

function actionForPressure(competitor: DetectedCompetitor): string {
  const areas = pressureAreas(competitor);
  if (areas.includes('SEO') && areas.includes('Brand authority')) {
    return `Counter ${competitor.name} with proof-led comparison pages, authority assets, and tighter category ownership.`;
  }
  if (areas.includes('Conversion')) {
    return `Use ${competitor.name} comparisons to sharpen ICP-specific proof and conversion messaging.`;
  }
  if (areas.includes('Content')) {
    return `Publish focused content that narrows the buyer problem ${competitor.name} addresses more broadly.`;
  }
  return `Monitor ${competitor.name} but prioritize higher-threat competitor battles first.`;
}

export function buildCompetitiveSnapshotReport(
  intelligence: CompetitorIntelligenceResult,
): CompetitiveSnapshotReport {
  const competitors = sortCompetitors(intelligence.detected_competitors).slice(0, 3);
  const threat = topThreat(competitors);
  const topThreatName = threat?.name ?? 'No final-gated competitor';
  const angle =
    intelligence.competitive_summary?.positioning_statement
    || threat?.positioning.differentiation
    || 'Position around the highest-fit customer problem before expanding into broader category claims.';

  return {
    competitors: competitors.map(toBrief),
    competitive_snapshot_summary: {
      top_threat: topThreatName,
      immediate_positioning_angle: angle,
      action: threat
        ? `Lead with the differentiation against ${threat.name} in homepage, comparison, and proof messaging.`
        : 'Collect more competitor evidence before committing positioning changes.',
    },
  };
}

export function buildCompetitivePressureAnalysis(
  intelligence: CompetitorIntelligenceResult,
): CompetitivePressureAnalysis {
  const competitors = sortCompetitors(intelligence.detected_competitors).slice(0, 5);
  const rows = competitors.map((competitor) => ({
    name: competitor.name,
    tier: competitor.tier,
    threat_level: competitor.positioning.threat_level,
    authority_score: competitor.authority_score,
    pressure_on: pressureAreas(competitor),
    action: actionForPressure(competitor),
  }));
  const threat = topThreat(competitors);

  return {
    competitors: rows,
    summary: {
      highest_pressure: threat?.name ?? 'No final-gated competitor',
      primary_risk:
        intelligence.competitive_summary?.key_risk
        || (threat ? `${threat.name} is the strongest current pressure point.` : 'Competitive risk is still being established.'),
      next_action:
        threat ? actionForPressure(threat) : 'Run competitor discovery again after more market data is available.',
    },
  };
}

function opportunityTextFromWeakness(competitor: DetectedCompetitor): string[] {
  return competitor.positioning.weaknesses_vs_company.map((weakness) =>
    `${competitor.name}: ${weakness}`,
  );
}

function uniqueLimited(values: string[], fallback: string, max = 4): string[] {
  const unique = [...new Set(values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value)))];
  return unique.length > 0 ? unique.slice(0, max) : [fallback];
}

export function buildCompetitiveStrategyMap(
  intelligence: CompetitorIntelligenceResult,
): {
  competitive_strategy_map: CompetitiveStrategyMap;
  strategic_position: StrategicPositionBlock;
} {
  const competitors = sortCompetitors(intelligence.detected_competitors);
  const tier1 = competitorsByTier(competitors, 'Tier 1');
  const tier2 = competitorsByTier(competitors, 'Tier 2');
  const tier3 = competitorsByTier(competitors, 'Tier 3');
  const topTier1Names = readableList(tier1.map((competitor) => competitor.name).slice(0, 2), 'Tier 1 competitors');
  const topTier2Names = readableList(tier2.map((competitor) => competitor.name).slice(0, 2), 'Tier 2 alternatives');
  const tier3Names = readableList(tier3.map((competitor) => competitor.name).slice(0, 2), 'Tier 3 substitutes');
  const directCategories = readableList(tier1.map((competitor) => competitor.category).slice(0, 2), 'the highest-fit category');
  const substituteCategories = readableList(tier3.map((competitor) => competitor.category).slice(0, 2), 'broad substitute categories');
  const threat = topThreat(competitors);

  const whitespace = uniqueLimited(
    [
      ...(intelligence.keyword_gap?.missing_keywords ?? []).map((keyword) => `Own comparison and education content around "${keyword}".`),
      ...(intelligence.answer_gap?.missing_answers ?? []).map((answer) => `Create answer-ready content for "${answer}".`),
      ...(tier1.length > 0 ? [`Build proof assets around where ${topTier1Names} are broader than the company's focused use case.`] : []),
    ],
    'Create comparison and decision-stage assets around the highest-fit customer problem.',
  );

  const underexploitedIcp = uniqueLimited(
    competitors
      .filter((competitor) => competitor.icp_overlap < 0.55)
      .map((competitor) => `${competitor.name} leaves room to own the sharper ICP implied by the company's focused positioning.`),
    'Prioritize the ICP segment with the strongest fit to the company focus before broadening the market claim.',
  );

  const weakAreas = uniqueLimited(
    competitors.flatMap(opportunityTextFromWeakness),
    'Competitors are broader than the company, so specificity is the main exploitable weakness.',
  );

  return {
    competitive_strategy_map: {
      tier_breakdown: {
        tier_1: tier1.map(toBrief),
        tier_2: tier2.map(toBrief),
        tier_3: tier3.map(toBrief),
      },
      opportunity_map: {
        whitespace_opportunities: whitespace,
        underexploited_icp_segments: underexploitedIcp,
        weak_competitor_areas: weakAreas,
      },
      strategic_actions: {
        how_to_beat_tier_1: `Beat ${topTier1Names} by making the company's narrower outcome, proof, and comparison pages more specific than broad category suites.`,
        how_to_differentiate_from_tier_2: `Differentiate from ${topTier2Names} by naming the exact use case, ICP, and workflow they only partially cover.`,
        how_to_ignore_tier_3: `Ignore ${tier3Names} for roadmap priority; address them only with lightweight substitute-objection messaging.`,
      },
    },
    strategic_position: {
      positioning_statement:
        intelligence.competitive_summary?.positioning_statement
        || `Position around ${threat?.positioning.differentiation ?? 'the highest-fit competitor gap'}.`,
      primary_battlefield: directCategories,
      avoidance_zone: substituteCategories,
      messaging_angle:
        intelligence.competitive_summary?.key_advantage
        || `Win by being more specific than ${readableList(competitors.map((competitor) => competitor.name).slice(0, 2), 'the competitor set')}.`,
    },
  };
}
