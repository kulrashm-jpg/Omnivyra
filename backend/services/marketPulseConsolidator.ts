/**
 * Market Pulse consolidator: merge regional results into unified output.
 * Merge by topic name, combine regions, average priority, keep lowest shelf life, highest risk.
 * v2: region divergence, arbitrage detection, localized risk, early advantage.
 */

import type { MarketPulseTopic } from './opportunityGenerators';

export type RegionTopicInput = {
  region: string;
  topics: MarketPulseTopic[];
};

export type ArbitrageOpportunity = {
  topic: string;
  high_region: string;
  low_region: string;
  high_priority: number;
  low_priority: number;
  explanation: string;
};

export type LocalizedRiskPocket = {
  topic: string;
  region: string;
  risk_level: string;
  spike_reason: string;
};

export type ConsolidatedPulseOutput = {
  global_topics: Array<{
    topic: string;
    spike_reason: string;
    shelf_life_days: number;
    risk_level: string;
    priority_score: number;
    regions: string[];
    narrative_phase?: string;
    momentum_score?: number;
    velocity_score?: number;
    early_advantage?: boolean;
    primary_category?: string;
    secondary_tags?: string[];
  }>;
  region_specific_insights: Array<{ region: string; insight: string }>;
  risk_alerts: string[];
  execution_priority_order: string[];
  strategic_summary: string;
  region_divergence_score: number;
  arbitrage_opportunities: ArbitrageOpportunity[];
  localized_risk_pockets: LocalizedRiskPocket[];
};

const RISK_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const PHASE_ORDER: Record<string, number> = { EMERGING: 0, ACCELERATING: 1, PEAKING: 2, DECLINING: 3, STRUCTURAL: 4 };

function normalizeTopicName(s: string): string {
  return s.trim().toLowerCase();
}

function highestRisk(a: string, b: string): string {
  return RISK_ORDER[b] > RISK_ORDER[a] ? b : a;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function pickEarliestPhase(phases: (string | undefined)[]): string | undefined {
  const valid = phases.filter((p): p is string => !!p && PHASE_ORDER[p] !== undefined);
  if (valid.length === 0) return undefined;
  return valid.reduce((a, b) => (PHASE_ORDER[a] < PHASE_ORDER[b] ? a : b));
}

type RegionData = { region: string; priority_score: number; risk_level: string; narrative_phase?: string; momentum_score?: number };

export function consolidateMarketPulseResults(
  regionResults: Record<string, { topics: MarketPulseTopic[] } | { error: true; message?: string }>
): ConsolidatedPulseOutput {
  const byTopicKey = new Map<
    string,
    {
      topic: string;
      spike_reason: string;
      shelf_life_days: number;
      risk_level: string;
      regionData: RegionData[];
    }
  >();

  const riskAlerts: string[] = [];
  const regionInsights: Array<{ region: string; insight: string }> = [];
  const arbitrageOpportunities: ArbitrageOpportunity[] = [];
  const localizedRiskPockets: LocalizedRiskPocket[] = [];

  for (const [region, result] of Object.entries(regionResults)) {
    if ('error' in result && result.error) continue;
    if (!('topics' in result)) continue;

    const topics = Array.isArray(result.topics) ? result.topics : [];
    if (topics.length === 0) {
      regionInsights.push({ region, insight: 'No pulse signals captured' });
      continue;
    }

    const topTopics = topics.slice(0, 3).map((t) => t.topic).join(', ');
    regionInsights.push({ region, insight: `Top signals: ${topTopics}` });

    for (const t of topics) {
      const key = normalizeTopicName(t.topic);
      if (!key) continue;

      const shelfLife = Math.min(30, Math.max(1, t.shelf_life_days ?? 7));
      const priority = Math.max(0, Math.min(1, t.priority_score ?? 0.5));
      const riskLevel = t.risk_level ?? 'LOW';
      const rd: RegionData = {
        region,
        priority_score: priority,
        risk_level: riskLevel,
        narrative_phase: t.narrative_phase,
        momentum_score: t.momentum_score,
      };

      const existing = byTopicKey.get(key);
      if (existing) {
        existing.shelf_life_days = Math.min(existing.shelf_life_days, shelfLife);
        existing.risk_level = highestRisk(existing.risk_level, riskLevel);
        existing.regionData.push(rd);
      } else {
        byTopicKey.set(key, {
          topic: t.topic,
          spike_reason: t.spike_reason ?? '',
          shelf_life_days: shelfLife,
          risk_level: riskLevel,
          regionData: [rd],
        });
      }

      if (riskLevel === 'HIGH') {
        riskAlerts.push(`${t.topic} (${region}): ${t.spike_reason}`);
      }
    }
  }

  let regionDivergenceScore = 0;
  const dispersions: number[] = [];

  const globalTopics = Array.from(byTopicKey.values()).map((v) => {
    const priorities = v.regionData.map((r) => r.priority_score);
    const avgPriority = priorities.length > 0 ? priorities.reduce((a, b) => a + b, 0) / priorities.length : 0.5;
    const avgMomentum =
      v.regionData.some((r) => r.momentum_score != null)
        ? (v.regionData.filter((r) => r.momentum_score != null) as { momentum_score: number }[])
            .reduce((s, r) => s + r.momentum_score, 0) / v.regionData.filter((r) => r.momentum_score != null).length
        : undefined;

    const dispersion = stdDev(priorities);
    if (v.regionData.length > 1) dispersions.push(dispersion);
    if (dispersion > 0.25) {
      regionDivergenceScore = Math.min(1, (regionDivergenceScore || 0) + 0.2 + (dispersion - 0.25));
    }

    const maxP = Math.max(...priorities);
    const minP = Math.min(...priorities);
    if (maxP > 0.7 && minP < 0.4 && v.regionData.length >= 2) {
      const highR = v.regionData.find((r) => r.priority_score === maxP)!;
      const lowR = v.regionData.find((r) => r.priority_score === minP)!;
      arbitrageOpportunities.push({
        topic: v.topic,
        high_region: highR.region,
        low_region: lowR.region,
        high_priority: maxP,
        low_priority: minP,
        explanation: `${v.topic} is high priority (${(maxP * 100).toFixed(0)}%) in ${highR.region} but low (${(minP * 100).toFixed(0)}%) in ${lowR.region}. Potential regional arbitrage.`,
      });
    }

    const highRiskRegions = v.regionData.filter((r) => r.risk_level === 'HIGH');
    if (highRiskRegions.length === 1) {
      const r = highRiskRegions[0];
      localizedRiskPockets.push({
        topic: v.topic,
        region: r.region,
        risk_level: 'HIGH',
        spike_reason: v.spike_reason,
      });
    }

    const narrativePhase = pickEarliestPhase(v.regionData.map((r) => r.narrative_phase));
    const earlyAdvantage =
      narrativePhase === 'EMERGING' && v.shelf_life_days >= 5;

    return {
      topic: v.topic,
      spike_reason: v.spike_reason,
      shelf_life_days: v.shelf_life_days,
      risk_level: v.risk_level,
      priority_score: avgPriority,
      regions: [...new Set(v.regionData.map((r) => r.region))],
      narrative_phase: narrativePhase,
      momentum_score: avgMomentum,
      early_advantage: earlyAdvantage,
    };
  });

  if (dispersions.length > 0 && regionDivergenceScore === 0) {
    const avgDispersion = dispersions.reduce((a, b) => a + b, 0) / dispersions.length;
    if (avgDispersion > 0.25) {
      regionDivergenceScore = Math.min(1, 0.3 + (avgDispersion - 0.25) * 1.5);
    }
  }

  globalTopics.sort((a, b) => b.priority_score - a.priority_score);
  const execution_priority_order = globalTopics.map((t) => t.topic);

  const topicCount = globalTopics.length;
  const avgPriority =
    topicCount > 0
      ? globalTopics.reduce((s, t) => s + t.priority_score, 0) / topicCount
      : 0;
  const avgShelfLife =
    topicCount > 0
      ? globalTopics.reduce((s, t) => s + t.shelf_life_days, 0) / topicCount
      : 0;

  const strategic_summary = `Market pulse: ${topicCount} consolidated topics. ` +
    `Avg priority ${(avgPriority * 100).toFixed(0)}%, avg shelf life ${avgShelfLife.toFixed(0)} days. ` +
    (riskAlerts.length > 0 ? `${riskAlerts.length} risk alert(s). ` : '') +
    (arbitrageOpportunities.length > 0 ? `${arbitrageOpportunities.length} arbitrage opportunity(ies). ` : '') +
    (localizedRiskPockets.length > 0 ? `${localizedRiskPockets.length} localized risk pocket(s). ` : '') +
    `Execution order: ${execution_priority_order.slice(0, 5).join(', ')}${execution_priority_order.length > 5 ? '…' : ''}.`;

  return {
    global_topics: globalTopics,
    region_specific_insights: regionInsights,
    risk_alerts: riskAlerts.slice(0, 10),
    execution_priority_order,
    strategic_summary,
    region_divergence_score: Math.min(1, regionDivergenceScore),
    arbitrage_opportunities: arbitrageOpportunities.slice(0, 10),
    localized_risk_pockets: localizedRiskPockets.slice(0, 10),
  };
}
