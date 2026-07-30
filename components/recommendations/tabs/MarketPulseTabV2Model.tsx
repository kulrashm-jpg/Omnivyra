/** Part 1/3 of MarketPulseTabV2.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

import { toTitle } from './MarketPulseTabV2Widgets';

export const MARKET_PULSE_CATEGORIES = [
  'competitor_moves',
  'product_positioning',
  'partnerships_alliances',
  'growth_expansion',
  'hiring_talent',
  'regulatory_policy',
  'capital_business_health',
  'demand_category_momentum',
  'technology_platform_shifts',
];

export const FOCUSED_MARKET_PULSE_CATEGORIES = ['technology_platform_shifts'];
export const EXPANDED_MARKET_PULSE_FALLBACK_CATEGORIES = [
  'product_positioning',
  'growth_expansion',
  'technology_platform_shifts',
];

export type ContextResponse = {
  companyId: string;
  profile: {
    name?: string | null;
    industry?: string | null;
    geography?: string | null;
    geography_list?: string[];
  };
  marketPulseProfile: {
    primary_operating_markets?: string[];
    target_expansion_markets?: string[];
    named_competitors?: string[];
    effective_market_focus?: string[];
    effective_competitors?: string[];
    business_model?: string;
    provider_type?: string;
    domain_role?: string;
    operating_model?: string;
    solution_domains?: string[];
    competitor_details?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
      // COMPETITOR-RESPONSE-001 — additive presentation fields.
      evidence_summary?: string | null;
      why_included?: string | null;
      evidence_sources?: string[] | null;
      observed_at?: string | null;
    }>;
    competitor_quality?: {
      highest_score?: number | null;
      threshold?: number | null;
      threshold_met?: boolean | null;
      detail_mode?: 'high_confidence' | 'expanded_context' | null;
    };
    market_alternatives?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
      use_case?: string | null;
      business_model?: string | null;
    }>;
    core_offerings?: string[];
    growth_priorities?: string[];
    partnership_priorities?: string[];
    critical_hiring_functions?: string[];
    regulatory_policy_sensitivity?: string[];
    default_categories?: string[];
    exclusions?: string[];
    preferred_regions?: string[];
  };
};

export type AutomationResponse = {
  settings?: {
    is_active?: boolean;
    objective?: string;
    categories?: string[];
    region_scope?: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom';
    custom_regions?: string[];
    competitor_scope?: 'profile_only' | 'auto_discover' | 'combined';
    custom_direction?: string | null;
    credit_acknowledged?: boolean;
  } | null;
};

export const SOURCE_STRATEGIES = [
  { value: 'hybrid', label: 'AI + API' },
  { value: 'ai', label: 'AI only' },
  { value: 'api', label: 'API only' },
] as const;

export type MarketPulseFinding = {
  id: string;
  canonical_event_key?: string | null;
  category: string;
  title: string;
  summary: string;
  impact_type: 'opportunity' | 'risk' | 'watch';
  why_it_matters: string;
  recommended_action: string;
  change_status: 'new' | 'updated' | 'unchanged' | 'resolved';
  confidence_score: number;
  relevance_score: number;
  regions: string[];
  /** Phase 1A: additive priority tier (P0 / P1 / P2) — nullable until backfill. */
  priority_tier?: 'P0' | 'P1' | 'P2' | null;
  freshness_score?: number | null;
  company_alignment_score?: number | null;
  /** Phase 1B: intelligence layer outputs (all nullable for legacy rows). */
  interpretation_text?: string | null;
  strategic_implication?: string | null;
  urgency_reason?: string | null;
  operational_impact?: string | null;
  opportunity_window?: string | null;
  affected_business_areas?: string[] | null;
  evidence_strength?: number | null;
  source_count?: number | null;
  source_diversity_score?: number | null;
  sources_json?: Array<Record<string, unknown>> | null;
  movement_summary?: {
    direction: 'Emerging' | 'Growing' | 'Stable' | 'Declining' | 'Accelerating';
    momentum: 'Low' | 'Moderate' | 'High';
    changes: string[];
    first_observation: boolean;
    compared_to_finding_id?: string | null;
  } | null;
  confidence_breakdown?: {
    components?: {
      source_count?: number;
      regions_count?: number;
      times_seen_prior?: number;
      distinct_source_kinds?: number;
      contradicting_findings?: number;
    };
  } | null;
  cluster_role?: 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly' | 'emerging_market_shift' | 'coordinated_competitor_movement' | null;
  alert_class?: 'strategic_risk' | 'competitor_escalation' | 'regulatory_exposure' | 'market_acceleration' | 'opportunity_breakout' | null;
  priority_explanation?: string | null;
  correlated_findings?: Array<{
    related_finding_id: string;
    related_finding_title: string;
    relation: string;
    score: number;
  }> | null;
  user_action_state?: 'open' | 'resolved' | 'snoozed' | 'escalated' | 'promoted' | null;
  resolved_at?: string | null;
  snoozed_until?: string | null;
  /** Phase 2 fields. */
  trajectory?: 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable' | null;
  escalation_level?: 'first_occurrence' | 'repeated' | 'escalating_pattern' | 'market_wide_propagation' | null;
  cluster_signal_ids?: string[] | null;
  related_intelligence_signal_ids?: string[] | null;
  historical_finding_ids?: string[] | null;
};

/** Phase 2 executive panels — typed as the API returns. */
export type MomentumOverview = {
  history: Array<{ run_id: string; created_at: string; p0: number; p1: number; p2: number; total: number }>;
  trend: 'rising' | 'falling' | 'flat';
  current_p0: number;
  delta_p0_vs_prior: number;
};
export type CategoryAcceleration = {
  categories: Array<{ category: string; current_count: number; prior_count: number; delta: number; direction: 'up' | 'down' | 'flat' }>;
};
export type CompetitorPressure = {
  competitors: Array<{ name: string; finding_count: number; p0_count: number; has_escalation: boolean }>;
};
export type EscalationTimeline = {
  events: Array<{ finding_id: string; title: string; category: string; escalation_level: string; detected_at: string }>;
};
export type PropagationMap = {
  regions: Array<{ region: string; finding_count: number; p0_count: number }>;
};
export type TrendPersistence = {
  trends: Array<{ canonical_event_key: string; title: string; times_seen: number; last_priority_tier: string | null; trajectory: string | null; last_seen_at: string }>;
};

type ChangeSummary = {
  prior_run_id: string | null;
  prior_run_at: string | null;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  resolved_count: number;
  escalated_count: number;
  downgraded_count: number;
  emerging_categories: string[];
  disappearing_categories: string[];
  escalated_samples: Array<{
    finding_id: string;
    title: string;
    from_tier: string | null;
    to_tier: string | null;
  }>;
};

export type MarketDeltaSummary = {
  baseline: boolean;
  previous_run_id: string | null;
  market_direction: 'Expanding' | 'Stable' | 'Shifting' | 'Volatile';
  new_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  strengthening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  weakening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  retired_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
};

export type RunResponse = {
  run: {
    id: string;
    status: string;
    objective: string;
    categories: string[];
    created_at: string;
    completed_at?: string | null;
    progress_stage?: string | null;
    confidence_index?: number | null;
    legacy_status?: string | null;
    legacy_error?: string | null;
    /** Phase 1A: previously-dropped fields, now surfaced from consolidated_result. */
    strategic_summary?: string | null;
    risk_alerts?: string[] | null;
    region_divergence_score?: number | null;
    /** Phase 1B: run-level intelligence layer. */
    executive_summary?: string | null;
    top_takeaways?: string[] | null;
    immediate_attention_items?: Array<{
      finding_id: string | null;
      title: string;
      reason: string;
      priority_tier: string;
    }> | null;
    strategic_shift_assessment?: string | null;
    market_direction?: 'expanding' | 'contracting' | 'mixed' | 'stable' | null;
    opportunity_pressure?: number | null;
    risk_pressure?: number | null;
    change_summary?: ChangeSummary | null;
    prior_run_id?: string | null;
    market_delta_summary?: MarketDeltaSummary | null;
    /** Phase 2 executive panels. */
    momentum_overview?: MomentumOverview | null;
    category_acceleration?: CategoryAcceleration | null;
    competitor_pressure?: CompetitorPressure | null;
    escalation_timeline?: EscalationTimeline | null;
    propagation_map?: PropagationMap | null;
    trend_persistence?: TrendPersistence | null;
  };
  findings: MarketPulseFinding[];
};

export type HistoryItem = {
  id: string;
  mode: string;
  objective: string;
  categories: string[];
  status: string;
  credits_consumed: number;
  created_at: string;
  completed_at?: string | null;
};

export type PendingRunState = {
  created_at: string;
  status: 'pending' | 'running';
  progress_stage?: string | null;
};

export type SignalSignificance = 'Critical' | 'Important' | 'Monitor' | 'Background';
export type MarketDimension = 'all' | 'technology' | 'competition' | 'talent' | 'regulation' | 'capital_markets' | 'supply_chain' | 'customer_demand' | 'geography';
export type AttentionFilter = 'all' | 'critical' | 'important' | 'growing' | 'emerging' | 'new_since_last_pulse';
type MarketNarrative = {
  id: string;
  title: string;
  direction: NonNullable<MarketPulseFinding['movement_summary']>['direction'];
  significance: SignalSignificance;
  supportingFindings: MarketPulseFinding[];
  summary: string;
};

export const MARKET_DIMENSIONS: Array<{ id: MarketDimension; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'technology', label: 'Technology' },
  { id: 'competition', label: 'Competition' },
  { id: 'talent', label: 'Talent' },
  { id: 'regulation', label: 'Regulation' },
  { id: 'capital_markets', label: 'Capital Markets' },
  { id: 'supply_chain', label: 'Supply Chain' },
  { id: 'customer_demand', label: 'Customer Demand' },
  { id: 'geography', label: 'Geography' },
];

export const ATTENTION_FILTERS: Array<{ id: AttentionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'important', label: 'Important' },
  { id: 'growing', label: 'Growing' },
  { id: 'emerging', label: 'Emerging' },
  { id: 'new_since_last_pulse', label: 'New Since Last Pulse' },
];

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sourceFieldText(source: Record<string, unknown>): string {
  const fields = [
    'role',
    'source_role',
    'source_type',
    'type',
    'kind',
    'category',
    'label',
  ];

  return fields
    .map((field) => source[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function countSourcesByExplicitRole(
  sources: Array<Record<string, unknown>> | null | undefined,
  role: 'analyst' | 'competitor',
): number {
  if (!Array.isArray(sources) || sources.length === 0) return 0;

  const matched = new Set<string>();
  sources.forEach((source, index) => {
    const text = sourceFieldText(source);
    if (!text.includes(role)) return;
    const key = String(source.id ?? source.url ?? source.name ?? source.title ?? index);
    matched.add(key);
  });

  return matched.size;
}

function sourceEvidence(finding: MarketPulseFinding): {
  sourceCount: number;
  distinctSourceKinds: number;
  recurrence: number;
  regionCount: number;
  competitorCount: number;
  analystCount: number;
  historicalCount: number;
  relatedSignalCount: number;
} {
  const components = finding.confidence_breakdown?.components ?? {};
  const regions = (finding.regions ?? []).filter((region) => region && region.toLowerCase() !== 'global');
  return {
    sourceCount: Number(finding.source_count ?? components.source_count ?? 0),
    distinctSourceKinds: Number(components.distinct_source_kinds ?? 0),
    recurrence: Number(components.times_seen_prior ?? 0),
    regionCount: regions.length || ((finding.regions ?? []).some((region) => region?.toLowerCase() === 'global') ? 1 : 0),
    competitorCount: countSourcesByExplicitRole(finding.sources_json, 'competitor'),
    analystCount: countSourcesByExplicitRole(finding.sources_json, 'analyst'),
    historicalCount: finding.historical_finding_ids?.length ?? 0,
    relatedSignalCount: finding.related_intelligence_signal_ids?.length ?? 0,
  };
}

function textMatchesAny(value: string, patterns: string[]): boolean {
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function findingMatchesDimension(
  finding: Pick<MarketPulseFinding, 'category' | 'title' | 'summary' | 'regions' | 'cluster_role' | 'alert_class'>,
  dimension: MarketDimension,
): boolean {
  if (dimension === 'all') return true;

  const category = String(finding.category ?? '');
  const text = `${finding.title ?? ''} ${finding.summary ?? ''} ${category}`.toLowerCase();

  if (dimension === 'technology') {
    return category === 'technology_platform_shifts'
      || category === 'product_positioning'
      || textMatchesAny(text, ['technology', 'platform', 'ai ', 'api', 'software', 'integration', 'automation']);
  }
  if (dimension === 'competition') {
    return category === 'competitor_moves'
      || finding.cluster_role === 'coordinated_competitor_movement'
      || finding.alert_class === 'competitor_escalation'
      || textMatchesAny(text, ['competitor', 'rival', 'market share', 'positioning']);
  }
  if (dimension === 'talent') {
    return category === 'hiring_talent' || textMatchesAny(text, ['hiring', 'talent', 'recruit', 'workforce', 'layoff']);
  }
  if (dimension === 'regulation') {
    return category === 'regulatory_policy'
      || finding.alert_class === 'regulatory_exposure'
      || textMatchesAny(text, ['regulation', 'policy', 'compliance', 'law', 'legal']);
  }
  if (dimension === 'capital_markets') {
    return category === 'capital_business_health'
      || textMatchesAny(text, ['capital', 'funding', 'valuation', 'revenue', 'profit', 'investment', 'ipo']);
  }
  if (dimension === 'supply_chain') {
    return textMatchesAny(text, ['supply chain', 'supplier', 'vendor', 'procurement', 'logistics', 'inventory', 'distribution']);
  }
  if (dimension === 'customer_demand') {
    return category === 'demand_category_momentum'
      || textMatchesAny(text, ['demand', 'customer', 'buyer', 'adoption', 'usage', 'pipeline']);
  }
  if (dimension === 'geography') {
    const regions = finding.regions ?? [];
    return category === 'growth_expansion'
      || regions.some((region) => region && region.toLowerCase() !== 'global')
      || textMatchesAny(text, ['region', 'market expansion', 'geography', 'north america', 'europe', 'asia']);
  }

  return true;
}

export function findingMatchesAttention(finding: MarketPulseFinding, filter: AttentionFilter): boolean {
  if (filter === 'all') return true;

  const significance = deriveSignalSignificance(finding);
  const direction = finding.movement_summary?.direction;

  if (filter === 'critical') return significance === 'Critical';
  if (filter === 'important') return significance === 'Critical' || significance === 'Important';
  if (filter === 'growing') return direction === 'Growing' || direction === 'Accelerating';
  if (filter === 'emerging') return direction === 'Emerging';
  if (filter === 'new_since_last_pulse') {
    return Boolean(finding.movement_summary?.first_observation) || finding.change_status === 'new';
  }

  return true;
}

export function deriveSignalSignificance(finding: MarketPulseFinding): SignalSignificance {
  const evidence = sourceEvidence(finding);
  const hasCompetitorInvolvement = evidence.competitorCount > 0 || finding.cluster_role === 'coordinated_competitor_movement';
  const hasAnalystInvolvement = evidence.analystCount > 0;
  const hasHistoricalPersistence = evidence.recurrence > 0 || evidence.historicalCount > 0;
  const hasRelatedSignals = evidence.relatedSignalCount > 0 || (finding.cluster_signal_ids?.length ?? 0) > 0;
  const hasSourceDiversity = evidence.distinctSourceKinds >= 2 || evidence.sourceCount >= 3;
  const hasGeographicSpread = evidence.regionCount >= 2;
  const momentum = finding.movement_summary?.momentum ?? 'Low';
  const direction = finding.movement_summary?.direction ?? null;
  const hasHighAttentionEvidence = [
    momentum === 'High' || direction === 'Accelerating',
    hasCompetitorInvolvement,
    hasAnalystInvolvement,
    hasHistoricalPersistence,
    hasRelatedSignals,
    hasSourceDiversity,
    hasGeographicSpread,
  ].some(Boolean);
  const hasModerateAttentionEvidence = [
    momentum === 'Moderate' || direction === 'Growing',
    hasHistoricalPersistence,
    hasRelatedSignals,
    hasSourceDiversity,
    hasGeographicSpread,
  ].some(Boolean);

  if (finding.priority_tier === 'P0') return hasHighAttentionEvidence ? 'Critical' : 'Important';
  if (finding.priority_tier === 'P1') return 'Important';
  if (finding.priority_tier === 'P2') return hasModerateAttentionEvidence ? 'Monitor' : 'Background';
  if (hasHighAttentionEvidence) return 'Important';
  if (hasModerateAttentionEvidence) return 'Monitor';
  return 'Background';
}

const SIGNIFICANCE_RANK: Record<SignalSignificance, number> = {
  Critical: 4,
  Important: 3,
  Monitor: 2,
  Background: 1,
};

const PRIORITY_TIER_RANK: Record<string, number> = {
  P0: 3,
  P1: 2,
  P2: 1,
};

const MOMENTUM_RANK: Record<string, number> = {
  High: 3,
  Moderate: 2,
  Low: 1,
};

export function sortBySignalAttention(findings: MarketPulseFinding[]): MarketPulseFinding[] {
  return [...findings].sort((a, b) => {
    const significanceDelta = SIGNIFICANCE_RANK[deriveSignalSignificance(b)] - SIGNIFICANCE_RANK[deriveSignalSignificance(a)];
    if (significanceDelta !== 0) return significanceDelta;
    const tierDelta = (PRIORITY_TIER_RANK[b.priority_tier ?? ''] ?? 0) - (PRIORITY_TIER_RANK[a.priority_tier ?? ''] ?? 0);
    if (tierDelta !== 0) return tierDelta;
    const momentumDelta = (MOMENTUM_RANK[b.movement_summary?.momentum ?? ''] ?? 0) - (MOMENTUM_RANK[a.movement_summary?.momentum ?? ''] ?? 0);
    if (momentumDelta !== 0) return momentumDelta;
    const bEvidence = sourceEvidence(b);
    const aEvidence = sourceEvidence(a);
    return (
      (bEvidence.relatedSignalCount + bEvidence.historicalCount + bEvidence.sourceCount + bEvidence.regionCount)
      - (aEvidence.relatedSignalCount + aEvidence.historicalCount + aEvidence.sourceCount + aEvidence.regionCount)
    );
  });
}

export function compactTakeaway(finding: MarketPulseFinding): string {
  const text = finding.strategic_implication
    || finding.interpretation_text
    || finding.summary
    || finding.why_it_matters
    || finding.title;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 150) return normalized;
  return `${normalized.slice(0, 147).trim()}...`;
}

function dominantDirection(findings: MarketPulseFinding[]): MarketNarrative['direction'] {
  const directions: MarketNarrative['direction'][] = ['Accelerating', 'Growing', 'Emerging', 'Declining', 'Stable'];
  const counts = new Map<MarketNarrative['direction'], number>();
  findings.forEach((finding) => {
    const direction = finding.movement_summary?.direction ?? 'Stable';
    counts.set(direction, (counts.get(direction) ?? 0) + 1);
  });
  return directions.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? 'Stable';
}

function highestSignificance(findings: MarketPulseFinding[]): SignalSignificance {
  return findings
    .map(deriveSignalSignificance)
    .sort((a, b) => SIGNIFICANCE_RANK[b] - SIGNIFICANCE_RANK[a])[0] ?? 'Background';
}

function narrativeTitle(label: string, direction: MarketNarrative['direction']): string {
  if (direction === 'Accelerating') return `${label} Accelerating`;
  if (direction === 'Growing') return `${label} Growing`;
  if (direction === 'Emerging') return `${label} Emerging`;
  if (direction === 'Declining') return `${label} Softening`;
  return `${label} Holding Steady`;
}

function narrativeSummary(label: string, findings: MarketPulseFinding[]): string {
  const titles = findings.slice(0, 3).map((finding) => finding.title);
  const supportText = formatList(titles);
  return `Multiple visible findings are clustering around ${label.toLowerCase()}, including ${supportText}. Read together, they show this is a connected market movement rather than a single isolated signal.`;
}

function addNarrativeCandidate(
  groups: Map<string, { label: string; findings: Map<string, MarketPulseFinding> }>,
  key: string,
  label: string,
  finding: MarketPulseFinding,
) {
  const existing = groups.get(key) ?? { label, findings: new Map<string, MarketPulseFinding>() };
  existing.findings.set(finding.id, finding);
  groups.set(key, existing);
}

export function buildMarketNarratives(findings: MarketPulseFinding[]): MarketNarrative[] {
  const ranked = sortBySignalAttention(findings);
  const groups = new Map<string, { label: string; findings: Map<string, MarketPulseFinding> }>();

  ranked.forEach((finding) => {
    addNarrativeCandidate(groups, `category:${finding.category}`, toTitle(finding.category), finding);

    if (finding.cluster_role && finding.cluster_role !== 'isolated') {
      addNarrativeCandidate(groups, `cluster_role:${finding.cluster_role}`, toTitle(finding.cluster_role), finding);
    }

    (finding.cluster_signal_ids ?? []).forEach((id) => {
      addNarrativeCandidate(groups, `cluster_signal:${id}`, 'Shared Signal Cluster', finding);
    });

    (finding.related_intelligence_signal_ids ?? []).forEach((id) => {
      addNarrativeCandidate(groups, `related_signal:${id}`, 'Related Intelligence Movement', finding);
    });
  });

  const seenSupportSets = new Set<string>();
  return Array.from(groups.entries())
    .map(([key, group]) => {
      const supportingFindings = sortBySignalAttention(Array.from(group.findings.values())).slice(0, 5);
      const supportKey = supportingFindings.map((finding) => finding.id).sort().join('|');
      if (supportingFindings.length < 2 || seenSupportSets.has(supportKey)) return null;
      seenSupportSets.add(supportKey);
      const direction = dominantDirection(supportingFindings);
      const significance = highestSignificance(supportingFindings);
      return {
        id: key,
        title: narrativeTitle(group.label, direction),
        direction,
        significance,
        supportingFindings,
        summary: narrativeSummary(group.label, supportingFindings),
      } satisfies MarketNarrative;
    })
    .filter((item): item is MarketNarrative => Boolean(item))
    .sort((a, b) => {
      const significanceDelta = SIGNIFICANCE_RANK[b.significance] - SIGNIFICANCE_RANK[a.significance];
      if (significanceDelta !== 0) return significanceDelta;
      const sizeDelta = b.supportingFindings.length - a.supportingFindings.length;
      if (sizeDelta !== 0) return sizeDelta;
      return (MOMENTUM_RANK[b.direction] ?? 0) - (MOMENTUM_RANK[a.direction] ?? 0);
    })
    .slice(0, 5);
}

function buildSignalExplainability(finding: MarketPulseFinding): string[] {
  const items: string[] = [];
  const evidence = sourceEvidence(finding);
  const timesSeenPrior = evidence.recurrence;
  const regions = (finding.regions ?? []).filter((region) => region && region.toLowerCase() !== 'global');
  const historicalCount = finding.historical_finding_ids?.length ?? 0;
  const relatedSignalCount = finding.related_intelligence_signal_ids?.length ?? 0;
  const clusterSignalCount = finding.cluster_signal_ids?.length ?? 0;
  const competitorSourceCount = evidence.competitorCount;
  const analystSourceCount = evidence.analystCount;

  if (evidence.sourceCount > 0 || historicalCount > 0 || relatedSignalCount > 0 || clusterSignalCount > 0) {
    const basis: string[] = [];
    if (evidence.sourceCount > 0) basis.push('current Market Pulse scan');
    if (historicalCount > 0) basis.push(pluralize(historicalCount, 'historical finding'));
    if (relatedSignalCount > 0) basis.push(pluralize(relatedSignalCount, 'related intelligence signal'));
    if (clusterSignalCount > 0) basis.push(pluralize(clusterSignalCount, 'signal cluster'));
    items.push(`Detection basis: ${formatList(basis)}`);
  }

  if (Number.isFinite(timesSeenPrior) && timesSeenPrior > 0) {
    items.push(`Consecutive runs observed: ${timesSeenPrior + 1}`);
  } else if (finding.change_status === 'new') {
    items.push('Consecutive runs observed: first observed in this scan');
  }

  if (finding.trajectory) {
    items.push(`Mention trend: ${toTitle(finding.trajectory)}`);
  } else if (finding.change_status === 'updated') {
    items.push('Mention trend: updated since the previous matching run');
  } else if (finding.change_status === 'new') {
    items.push('Mention trend: newly detected');
  }

  if (evidence.sourceCount > 0) {
    const sourceText = evidence.distinctSourceKinds > 1
      ? `${pluralize(evidence.sourceCount, 'source')} across ${pluralize(evidence.distinctSourceKinds, 'evidence type')}`
      : pluralize(evidence.sourceCount, 'source');
    items.push(`Source diversity: ${sourceText}`);
  }

  if (regions.length > 0) {
    items.push(`Geographic spread: ${formatList(regions)}`);
  } else if ((finding.regions ?? []).some((region) => region?.toLowerCase() === 'global')) {
    items.push('Geographic spread: Global');
  }

  if (finding.cluster_role === 'coordinated_competitor_movement') {
    items.push('Competitor participation: coordinated competitor movement detected');
  } else if (competitorSourceCount > 0) {
    items.push(`Competitor participation: referenced by ${pluralize(competitorSourceCount, 'competitor source')}`);
  }

  if (analystSourceCount > 0) {
    items.push(`Analyst participation: reinforced by ${pluralize(analystSourceCount, 'analyst source')}`);
  }

  return items;
}

export function SignalExplainability({ finding }: { finding: MarketPulseFinding }) {
  const items = buildSignalExplainability(finding);
  if (items.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Why this signal appeared
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const MOVEMENT_DIRECTION_STYLE: Record<NonNullable<MarketPulseFinding['movement_summary']>['direction'], string> = {
  Emerging: 'bg-blue-50 text-blue-800 border-blue-100',
  Growing: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  Stable: 'bg-slate-50 text-slate-700 border-slate-200',
  Declining: 'bg-amber-50 text-amber-800 border-amber-100',
  Accelerating: 'bg-rose-50 text-rose-800 border-rose-100',
};

export const MOVEMENT_MOMENTUM_STYLE: Record<NonNullable<MarketPulseFinding['movement_summary']>['momentum'], string> = {
  Low: 'bg-slate-100 text-slate-700',
  Moderate: 'bg-indigo-50 text-indigo-700',
  High: 'bg-rose-100 text-rose-800',
};

export const SIGNIFICANCE_STYLE: Record<SignalSignificance, string> = {
  Critical: 'bg-rose-600 text-white border-rose-600',
  Important: 'bg-amber-100 text-amber-900 border-amber-200',
  Monitor: 'bg-blue-50 text-blue-800 border-blue-100',
  Background: 'bg-slate-100 text-slate-600 border-slate-200',
};

