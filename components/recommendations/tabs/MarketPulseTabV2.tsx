import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

const MARKET_PULSE_CATEGORIES = [
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

const FOCUSED_MARKET_PULSE_CATEGORIES = ['technology_platform_shifts'];
const EXPANDED_MARKET_PULSE_FALLBACK_CATEGORIES = [
  'product_positioning',
  'growth_expansion',
  'technology_platform_shifts',
];

type ContextResponse = {
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

type AutomationResponse = {
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

const SOURCE_STRATEGIES = [
  { value: 'hybrid', label: 'AI + API' },
  { value: 'ai', label: 'AI only' },
  { value: 'api', label: 'API only' },
] as const;

type MarketPulseFinding = {
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
type MomentumOverview = {
  history: Array<{ run_id: string; created_at: string; p0: number; p1: number; p2: number; total: number }>;
  trend: 'rising' | 'falling' | 'flat';
  current_p0: number;
  delta_p0_vs_prior: number;
};
type CategoryAcceleration = {
  categories: Array<{ category: string; current_count: number; prior_count: number; delta: number; direction: 'up' | 'down' | 'flat' }>;
};
type CompetitorPressure = {
  competitors: Array<{ name: string; finding_count: number; p0_count: number; has_escalation: boolean }>;
};
type EscalationTimeline = {
  events: Array<{ finding_id: string; title: string; category: string; escalation_level: string; detected_at: string }>;
};
type PropagationMap = {
  regions: Array<{ region: string; finding_count: number; p0_count: number }>;
};
type TrendPersistence = {
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

type MarketDeltaSummary = {
  baseline: boolean;
  previous_run_id: string | null;
  market_direction: 'Expanding' | 'Stable' | 'Shifting' | 'Volatile';
  new_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  strengthening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  weakening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
  retired_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category?: string | null }>;
};

type RunResponse = {
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

type HistoryItem = {
  id: string;
  mode: string;
  objective: string;
  categories: string[];
  status: string;
  credits_consumed: number;
  created_at: string;
  completed_at?: string | null;
};

type PendingRunState = {
  created_at: string;
  status: 'pending' | 'running';
  progress_stage?: string | null;
};

type SignalSignificance = 'Critical' | 'Important' | 'Monitor' | 'Background';
type MarketDimension = 'all' | 'technology' | 'competition' | 'talent' | 'regulation' | 'capital_markets' | 'supply_chain' | 'customer_demand' | 'geography';
type AttentionFilter = 'all' | 'critical' | 'important' | 'growing' | 'emerging' | 'new_since_last_pulse';
type MarketNarrative = {
  id: string;
  title: string;
  direction: NonNullable<MarketPulseFinding['movement_summary']>['direction'];
  significance: SignalSignificance;
  supportingFindings: MarketPulseFinding[];
  summary: string;
};

const MARKET_DIMENSIONS: Array<{ id: MarketDimension; label: string }> = [
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

const ATTENTION_FILTERS: Array<{ id: AttentionFilter; label: string }> = [
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

function findingMatchesDimension(
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

function findingMatchesAttention(finding: MarketPulseFinding, filter: AttentionFilter): boolean {
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

function deriveSignalSignificance(finding: MarketPulseFinding): SignalSignificance {
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

function sortBySignalAttention(findings: MarketPulseFinding[]): MarketPulseFinding[] {
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

function compactTakeaway(finding: MarketPulseFinding): string {
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

function buildMarketNarratives(findings: MarketPulseFinding[]): MarketNarrative[] {
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

function SignalExplainability({ finding }: { finding: MarketPulseFinding }) {
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

const MOVEMENT_DIRECTION_STYLE: Record<NonNullable<MarketPulseFinding['movement_summary']>['direction'], string> = {
  Emerging: 'bg-blue-50 text-blue-800 border-blue-100',
  Growing: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  Stable: 'bg-slate-50 text-slate-700 border-slate-200',
  Declining: 'bg-amber-50 text-amber-800 border-amber-100',
  Accelerating: 'bg-rose-50 text-rose-800 border-rose-100',
};

const MOVEMENT_MOMENTUM_STYLE: Record<NonNullable<MarketPulseFinding['movement_summary']>['momentum'], string> = {
  Low: 'bg-slate-100 text-slate-700',
  Moderate: 'bg-indigo-50 text-indigo-700',
  High: 'bg-rose-100 text-rose-800',
};

const SIGNIFICANCE_STYLE: Record<SignalSignificance, string> = {
  Critical: 'bg-rose-600 text-white border-rose-600',
  Important: 'bg-amber-100 text-amber-900 border-amber-200',
  Monitor: 'bg-blue-50 text-blue-800 border-blue-100',
  Background: 'bg-slate-100 text-slate-600 border-slate-200',
};

function SignificancePill({ significance }: { significance: SignalSignificance }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SIGNIFICANCE_STYLE[significance]}`}>
      {significance}
    </span>
  );
}

function SignificanceBadge({ finding }: { finding: MarketPulseFinding }) {
  const significance = deriveSignalSignificance(finding);
  return <SignificancePill significance={significance} />;
}

function SignalMovement({ finding }: { finding: MarketPulseFinding }) {
  const movement = finding.movement_summary;
  if (!movement) return null;
  const changes = movement.changes?.length
    ? movement.changes
    : movement.first_observation
      ? ['First observation.']
      : [];

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-white/80 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${MOVEMENT_DIRECTION_STYLE[movement.direction]}`}>
          {movement.direction}
        </span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ${MOVEMENT_MOMENTUM_STYLE[movement.momentum]}`}>
          Momentum: {movement.momentum}
        </span>
      </div>
      {changes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
          <span className="font-semibold text-slate-700">What changed:</span>
          {changes.map((change) => (
            <span key={change}>{change}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutiveScanStrip({ findings }: { findings: MarketPulseFinding[] }) {
  const ranked = sortBySignalAttention(findings);
  const snapshot = ranked.reduce(
    (acc, finding) => {
      const significance = deriveSignalSignificance(finding);
      const direction = finding.movement_summary?.direction;
      if (significance === 'Critical') acc.critical += 1;
      if (significance === 'Important') acc.important += 1;
      if (direction === 'Growing' || direction === 'Accelerating') acc.growing += 1;
      if (direction === 'Emerging') acc.emerging += 1;
      if (direction === 'Declining') acc.declining += 1;
      return acc;
    },
    { critical: 0, important: 0, growing: 0, emerging: 0, declining: 0 },
  );
  const topDevelopments = ranked.slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market snapshot</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2">
            {[
              ['Critical', snapshot.critical, 'text-rose-700'],
              ['Important', snapshot.important, 'text-amber-700'],
              ['Growing', snapshot.growing, 'text-emerald-700'],
              ['Emerging', snapshot.emerging, 'text-blue-700'],
              ['Declining', snapshot.declining, 'text-slate-700'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className={`text-lg font-bold ${color}`}>{value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top developments</div>
          <div className="mt-3 space-y-2">
            {topDevelopments.map((finding) => {
              const significance = deriveSignalSignificance(finding);
              const direction = finding.movement_summary?.direction ?? 'Stable';
              return (
                <div key={finding.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SignificanceBadge finding={finding} />
                    <span className="text-[11px] font-semibold text-slate-500">{direction}</span>
                    <span className="text-sm font-semibold text-slate-900">{finding.title}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{compactTakeaway(finding)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const MARKET_DIRECTION_STYLE: Record<MarketDeltaSummary['market_direction'], string> = {
  Expanding: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  Stable: 'bg-slate-50 text-slate-700 border-slate-200',
  Shifting: 'bg-blue-50 text-blue-800 border-blue-100',
  Volatile: 'bg-rose-50 text-rose-800 border-rose-100',
};

function DeltaSignalList({
  title,
  items,
  tone,
}: {
  title: string;
  items: MarketDeltaSummary['new_signals'];
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
        <div className={`text-sm font-bold ${tone}`}>{items.length}</div>
      </div>
      {items.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
          {items.slice(0, 3).map((item, index) => (
            <li key={item.id ?? item.canonical_event_key ?? `${title}-${index}`} className="truncate">
              {item.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SinceLastPulseStrip({ delta }: { delta: MarketDeltaSummary | null | undefined }) {
  if (!delta) return null;

  if (delta.baseline) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Since last pulse</div>
        <p className="mt-2 text-sm font-medium text-slate-800">Baseline pulse established. Future runs will show market change.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Since last pulse</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">Market change summary</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${MARKET_DIRECTION_STYLE[delta.market_direction]}`}>
          {delta.market_direction}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <DeltaSignalList title="New signals" items={delta.new_signals} tone="text-blue-700" />
        <DeltaSignalList title="Strengthening" items={delta.strengthening_signals} tone="text-emerald-700" />
        <DeltaSignalList title="Weakening" items={delta.weakening_signals} tone="text-amber-700" />
        <DeltaSignalList title="Retired" items={delta.retired_signals} tone="text-slate-600" />
      </div>
    </section>
  );
}

function filterDeltaSummary(delta: MarketDeltaSummary | null | undefined, dimension: MarketDimension): MarketDeltaSummary | null | undefined {
  if (!delta || delta.baseline || dimension === 'all') return delta;

  const matches = (item: MarketDeltaSummary['new_signals'][number]) => {
    return findingMatchesDimension(
      {
        category: item.category ?? '',
        title: item.title,
        summary: '',
        regions: [],
        cluster_role: null,
        alert_class: null,
      },
      dimension,
    );
  };
  const newSignals = delta.new_signals.filter(matches);
  const strengtheningSignals = delta.strengthening_signals.filter(matches);
  const weakeningSignals = delta.weakening_signals.filter(matches);
  const retiredSignals = delta.retired_signals.filter(matches);
  const expansionPressure = newSignals.length + strengtheningSignals.length;
  const contractionPressure = weakeningSignals.length + retiredSignals.length;
  const marketDirection: MarketDeltaSummary['market_direction'] =
    expansionPressure > 0 && contractionPressure > 0
      ? 'Volatile'
      : expansionPressure > contractionPressure
        ? 'Expanding'
        : contractionPressure > expansionPressure
          ? 'Shifting'
          : 'Stable';

  return {
    ...delta,
    market_direction: marketDirection,
    new_signals: newSignals,
    strengthening_signals: strengtheningSignals,
    weakening_signals: weakeningSignals,
    retired_signals: retiredSignals,
  };
}

function DimensionFilters({
  activeDimension,
  counts,
  onChange,
}: {
  activeDimension: MarketDimension;
  counts: Record<MarketDimension, number>;
  onChange: (dimension: MarketDimension) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market dimensions</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MARKET_DIMENSIONS.map((dimension) => {
          const active = activeDimension === dimension.id;
          return (
            <button
              key={dimension.id}
              type="button"
              onClick={() => onChange(dimension.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {dimension.label} ({counts[dimension.id] ?? 0})
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AttentionFilters({
  activeFilter,
  counts,
  onChange,
}: {
  activeFilter: AttentionFilter;
  counts: Record<AttentionFilter, number>;
  onChange: (filter: AttentionFilter) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attention</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ATTENTION_FILTERS.map((filter) => {
          const active = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onChange(filter.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'border-indigo-700 bg-indigo-700 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {filter.label} ({counts[filter.id] ?? 0})
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MarketNarrativesSection({ findings }: { findings: MarketPulseFinding[] }) {
  const narratives = buildMarketNarratives(findings);
  if (narratives.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market narratives</div>
          <h4 className="mt-1 text-base font-semibold text-slate-950">Broader movements across signals</h4>
        </div>
        <span className="text-xs text-slate-500">{narratives.length} connected stor{narratives.length === 1 ? 'y' : 'ies'}</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {narratives.map((narrative) => (
          <article key={narrative.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SignificancePill significance={narrative.significance} />
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MOVEMENT_DIRECTION_STYLE[narrative.direction]}`}>
                {narrative.direction}
              </span>
            </div>
            <h5 className="mt-2 text-sm font-bold text-slate-950">{narrative.title}</h5>
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Supporting findings</div>
              <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
                {narrative.supportingFindings.slice(0, 4).map((finding) => (
                  <li key={finding.id} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    <span>{finding.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700">{narrative.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

type MarketPulseLoadError = Error & {
  status?: number;
};

const OBJECTIVES = [
  { value: 'growth', label: 'Growth' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'product', label: 'Product' },
  { value: 'risk', label: 'Risk' },
] as const;

function toTitle(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildResolvedRegionPreview(
  context: ContextResponse | null,
  scope: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom',
  customRegions: string,
) {
  if (!context) return [];
  const trimmedCustomRegions = customRegions.split(',').map((item) => item.trim()).filter(Boolean);
  const profileMarkets = context.marketPulseProfile.primary_operating_markets ?? [];
  const expansionMarkets = context.marketPulseProfile.target_expansion_markets ?? [];
  const preferredRegions = context.marketPulseProfile.preferred_regions ?? [];
  const geographyList = context.profile.geography_list ?? [];
  const geography = context.profile.geography ? [context.profile.geography] : [];

  const resolved = scope === 'custom'
    ? trimmedCustomRegions
    : scope === 'expansion_markets'
      ? (expansionMarkets.length ? expansionMarkets : preferredRegions)
      : scope === 'all_defaults'
        ? [...profileMarkets, ...expansionMarkets, ...preferredRegions]
        : profileMarkets.length
          ? profileMarkets
          : preferredRegions.length
            ? preferredRegions
            : geographyList.length
              ? geographyList
              : geography;

  return Array.from(new Set(resolved)).filter(Boolean);
}

function buildFocusedCategoryDefaults(context: ContextResponse | null): string[] {
  const profileDefaults = context?.marketPulseProfile.default_categories ?? [];
  const preferred = FOCUSED_MARKET_PULSE_CATEGORIES.find((category) => profileDefaults.includes(category));
  return [preferred ?? FOCUSED_MARKET_PULSE_CATEGORIES[0]];
}

function buildExpandedCategoryDefaults(context: ContextResponse | null): string[] {
  const profileDefaults = (context?.marketPulseProfile.default_categories ?? [])
    .filter((category) => MARKET_PULSE_CATEGORIES.includes(category));
  const categories = profileDefaults.length > 0 ? profileDefaults : EXPANDED_MARKET_PULSE_FALLBACK_CATEGORIES;
  return Array.from(new Set(categories)).filter((category) => MARKET_PULSE_CATEGORIES.includes(category));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1B: tier-grouped feed with per-finding action rail.
// P0 dominant (rose ring + larger card + interruptive title), P1 visible
// (amber accent), P2 compact (collapsed by default with expand toggle).
// ─────────────────────────────────────────────────────────────────────────────
type FeedSectionProps = {
  tieredFindings: {
    P0: MarketPulseFinding[];
    P1: MarketPulseFinding[];
    P2: MarketPulseFinding[];
    hidden: number;
  };
  actioningFindingId: string | null;
  findingStateOverrides: Record<string, MarketPulseFinding['user_action_state']>;
  performFindingAction: (
    finding: MarketPulseFinding,
    actionType: 'resolve' | 'reopen' | 'snooze' | 'escalate' | 'promote' | 'share' | 'generate',
    payload?: Record<string, unknown>,
  ) => Promise<void>;
};

const ALERT_CLASS_LABEL: Record<NonNullable<MarketPulseFinding['alert_class']>, { label: string; color: string }> = {
  strategic_risk:        { label: 'Strategic risk',        color: 'bg-rose-100 text-rose-800' },
  competitor_escalation: { label: 'Competitor escalation', color: 'bg-purple-100 text-purple-800' },
  regulatory_exposure:   { label: 'Regulatory exposure',   color: 'bg-orange-100 text-orange-800' },
  market_acceleration:   { label: 'Market acceleration',   color: 'bg-emerald-100 text-emerald-800' },
  opportunity_breakout:  { label: 'Opportunity breakout',  color: 'bg-teal-100 text-teal-800' },
};

const CLUSTER_ROLE_LABEL: Record<NonNullable<MarketPulseFinding['cluster_role']>, string> = {
  isolated:                       'Isolated',
  repeated:                       'Recurring',
  market_wide:                    'Market-wide',
  localized_anomaly:              'Localized anomaly',
  emerging_market_shift:          'Emerging shift',
  coordinated_competitor_movement:'Coordinated competitor move',
};

function FindingCard({
  finding,
  tier,
  onAction,
  loading,
  stateOverride,
}: {
  finding: MarketPulseFinding;
  tier: 'P0' | 'P1' | 'P2';
  onAction: FeedSectionProps['performFindingAction'];
  loading: boolean;
  stateOverride: MarketPulseFinding['user_action_state'];
}) {
  const ringClass =
    tier === 'P0' ? 'border-rose-300 ring-2 ring-rose-200/60 shadow-sm'
    : tier === 'P1' ? 'border-amber-200'
    : 'border-gray-200';
  const tierBadge =
    tier === 'P0' ? 'bg-rose-600 text-white'
    : tier === 'P1' ? 'bg-amber-500 text-white'
    : 'bg-gray-200 text-gray-700';
  const titleClass = tier === 'P0' ? 'text-base font-bold' : tier === 'P1' ? 'text-sm font-semibold' : 'text-sm font-medium';
  const padding = tier === 'P0' ? 'p-5' : tier === 'P1' ? 'p-4' : 'p-3';
  const stateLabel = stateOverride ?? finding.user_action_state ?? 'open';

  const confidenceColor = finding.confidence_score >= 75 ? 'text-emerald-700' : finding.confidence_score >= 50 ? 'text-amber-700' : 'text-gray-500';
  const evidenceColor = (finding.evidence_strength ?? 0) >= 0.7 ? 'text-emerald-700' : (finding.evidence_strength ?? 0) >= 0.5 ? 'text-amber-700' : 'text-gray-500';
  const changeBadge = finding.change_status === 'new' ? 'bg-blue-100 text-blue-800'
    : finding.change_status === 'updated' ? 'bg-amber-100 text-amber-800'
    : finding.change_status === 'resolved' ? 'bg-emerald-100 text-emerald-800'
    : 'bg-gray-100 text-gray-600';

  return (
    <div className={`rounded-xl border ${ringClass} bg-white ${padding}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${tierBadge}`}>{tier}</span>
          <span className={`text-gray-900 ${titleClass}`}>{finding.title}</span>
          <SignificanceBadge finding={finding} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {finding.alert_class && ALERT_CLASS_LABEL[finding.alert_class] && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ALERT_CLASS_LABEL[finding.alert_class].color}`}>
              {ALERT_CLASS_LABEL[finding.alert_class].label}
            </span>
          )}
          {finding.cluster_role && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {CLUSTER_ROLE_LABEL[finding.cluster_role]}
            </span>
          )}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{finding.category.replace(/_/g, ' ')}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${changeBadge}`}>{finding.change_status}</span>
        </div>
      </div>

      <SignalMovement finding={finding} />

      {/* Phase 1B interpretation block — replaces the legacy "summary + why_it_matters" pair when present. */}
      {finding.interpretation_text ? (
        <p className="mt-2 text-sm text-gray-800 leading-relaxed">{finding.interpretation_text}</p>
      ) : (
        <p className="mt-2 text-sm text-gray-600">{finding.summary}</p>
      )}

      {finding.strategic_implication && (
        <p className="mt-2 text-sm text-gray-700"><span className="font-semibold text-gray-900">Strategic implication:</span> {finding.strategic_implication}</p>
      )}
      {finding.urgency_reason && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-rose-700">Urgency:</span> {finding.urgency_reason}</p>
      )}
      {finding.opportunity_window && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-amber-700">Window:</span> {finding.opportunity_window}</p>
      )}
      {finding.operational_impact && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-gray-900">Owner:</span> {finding.operational_impact}</p>
      )}
      {finding.affected_business_areas && finding.affected_business_areas.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Affects</span>
          {finding.affected_business_areas.map((area) => (
            <span key={area} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{area}</span>
          ))}
        </div>
      )}

      <SignalExplainability finding={finding} />

      {/* Trust + scoring footer. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className={`font-semibold ${confidenceColor}`}>Conf {Math.round(finding.confidence_score)}</span>
        <span className="text-gray-500">·</span>
        <span className="font-semibold text-gray-700">Rel {Math.round(finding.relevance_score)}</span>
        {typeof finding.evidence_strength === 'number' && (
          <>
            <span className="text-gray-500">·</span>
            <span className={`font-semibold ${evidenceColor}`}>Trust {Math.round((finding.evidence_strength ?? 0) * 100)}</span>
          </>
        )}
        {typeof finding.company_alignment_score === 'number' && (
          <>
            <span className="text-gray-500">·</span>
            <span className="font-semibold text-indigo-700">Align {Math.round((finding.company_alignment_score ?? 0) * 100)}</span>
          </>
        )}
        <span className="text-gray-500">·</span>
        <span className="text-gray-500">{finding.regions?.length ? finding.regions.join(', ') : 'Global'}</span>
      </div>

      {/* Correlated peers. */}
      {finding.correlated_findings && finding.correlated_findings.length > 0 && (
        <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-gray-600">Related signals ({finding.correlated_findings.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {finding.correlated_findings.slice(0, 4).map((c, idx) => (
              <li key={idx}>· <span className="font-medium">{c.related_finding_title}</span> <span className="text-gray-500">({c.relation.replace(/_/g, ' ')}, {(c.score * 100).toFixed(0)}%)</span></li>
            ))}
          </ul>
        </details>
      )}

      {/* Action rail. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-3">
        {stateLabel === 'resolved' ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => onAction(finding, 'reopen')}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >Reopen</button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => onAction(finding, 'resolve')}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >Mark resolved</button>
        )}
        <button
          type="button"
          disabled={loading || stateLabel === 'snoozed'}
          onClick={() => onAction(finding, 'snooze', { days: 7 })}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >Snooze 7d</button>
        <button
          type="button"
          disabled={loading || stateLabel === 'escalated'}
          onClick={() => onAction(finding, 'escalate')}
          className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >Track escalation</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'promote')}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          title="Create an opportunity and prefill the campaign builder"
        >Promote to campaign</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'generate')}
          className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
          title="Hand off this finding's context to the content generator"
        >Generate response</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'share')}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="Copy a shareable summary to your clipboard"
        >Share</button>
        {stateLabel !== 'open' && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{stateLabel}</span>
        )}
      </div>
    </div>
  );
}

function FeedSection({ tieredFindings, actioningFindingId, findingStateOverrides, performFindingAction }: FeedSectionProps) {
  const [showP2, setShowP2] = useState(false);
  return (
    <section className="space-y-4">
      {tieredFindings.P0.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">P0</span>
            <h4 className="text-sm font-semibold text-gray-900">Decide this week — {tieredFindings.P0.length}</h4>
          </div>
          <div className="space-y-3">
            {tieredFindings.P0.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                tier="P0"
                onAction={performFindingAction}
                loading={actioningFindingId === f.id}
                stateOverride={findingStateOverrides[f.id]}
              />
            ))}
          </div>
        </div>
      )}

      {tieredFindings.P1.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">P1</span>
            <h4 className="text-sm font-semibold text-gray-900">Review this cycle — {tieredFindings.P1.length}</h4>
          </div>
          <div className="space-y-2">
            {tieredFindings.P1.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                tier="P1"
                onAction={performFindingAction}
                loading={actioningFindingId === f.id}
                stateOverride={findingStateOverrides[f.id]}
              />
            ))}
          </div>
        </div>
      )}

      {tieredFindings.P2.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowP2((v) => !v)}
            className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50"
          >
            <span className="rounded bg-gray-200 px-2 py-0.5 text-[11px] font-bold tracking-wide text-gray-700">P2</span>
            <h4 className="text-sm font-semibold text-gray-900">Watchlist — {tieredFindings.P2.length}</h4>
            <span className="text-xs text-gray-500">{showP2 ? '(hide)' : '(show)'}</span>
          </button>
          {showP2 && (
            <div className="space-y-2">
              {tieredFindings.P2.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  tier="P2"
                  onAction={performFindingAction}
                  loading={actioningFindingId === f.id}
                  stateOverride={findingStateOverrides[f.id]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tieredFindings.hidden > 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {tieredFindings.hidden} resolved/snoozed finding{tieredFindings.hidden === 1 ? '' : 's'} hidden from feed.
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ExecutivePanels — operational command center surface.
// Renders momentum overview, category acceleration, competitor pressure,
// propagation map, escalation timeline, and trend persistence in a compact
// 2x3 grid that scans top-to-bottom in <30 seconds.
// ─────────────────────────────────────────────────────────────────────────────
function MomentumPanel({ data }: { data: MomentumOverview | null | undefined }) {
  if (!data || data.history.length === 0) return null;
  const max = Math.max(1, ...data.history.map((h) => h.total));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Momentum (last {data.history.length} runs)</span>
        <span className={`text-xs font-semibold ${data.trend === 'rising' ? 'text-rose-700' : data.trend === 'falling' ? 'text-emerald-700' : 'text-gray-600'}`}>
          {data.trend === 'rising' ? '↑' : data.trend === 'falling' ? '↓' : '→'}
          {' '}P0 {data.delta_p0_vs_prior >= 0 ? '+' : ''}{data.delta_p0_vs_prior}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-1 h-14">
        {[...data.history].reverse().map((h) => {
          const heightPct = Math.max(8, (h.total / max) * 100);
          return (
            <div key={h.run_id} className="flex-1 flex flex-col-reverse gap-0.5" title={`${new Date(h.created_at).toLocaleDateString()} · P0 ${h.p0} · P1 ${h.p1} · P2 ${h.p2}`}>
              <div className="bg-gray-300" style={{ height: `${(h.p2 / max) * 100}%` }} />
              <div className="bg-amber-400" style={{ height: `${(h.p1 / max) * 100}%` }} />
              <div className="bg-rose-500" style={{ height: `${(h.p0 / max) * 100}%`, minHeight: h.p0 > 0 ? '2px' : '0' }} />
              {/* placeholder so the column has at least minHeightPct of paint */}
              <div className="border-b border-gray-200 mt-auto" style={{ visibility: heightPct < 8 ? 'visible' : 'hidden' }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryAccelerationPanel({ data }: { data: CategoryAcceleration | null | undefined }) {
  if (!data || data.categories.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Category acceleration</span>
      <ul className="mt-2 space-y-1">
        {data.categories.slice(0, 5).map((c) => (
          <li key={c.category} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{c.category.replace(/_/g, ' ')}</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-900">{c.current_count}</span>
              {c.delta !== 0 && (
                <span className={`font-semibold ${c.direction === 'up' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {c.direction === 'up' ? '↑' : '↓'}{Math.abs(c.delta)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompetitorPressurePanel({ data }: { data: CompetitorPressure | null | undefined }) {
  if (!data || data.competitors.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Competitor pressure</span>
      <ul className="mt-2 space-y-1">
        {data.competitors.slice(0, 5).map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-gray-900 capitalize">{c.name}</span>
            <span className="flex items-center gap-1.5">
              {c.has_escalation && <span className="text-[10px] font-bold text-amber-700">↑</span>}
              {c.p0_count > 0 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">P0 {c.p0_count}</span>}
              <span className="text-gray-700">{c.finding_count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PropagationPanel({ data }: { data: PropagationMap | null | undefined }) {
  if (!data || data.regions.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Regional propagation</span>
      <ul className="mt-2 space-y-1">
        {data.regions.slice(0, 5).map((r) => (
          <li key={r.region} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-gray-900 uppercase">{r.region}</span>
            <span className="flex items-center gap-1.5">
              {r.p0_count > 0 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">P0 {r.p0_count}</span>}
              <span className="text-gray-700">{r.finding_count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscalationTimelinePanel({ data }: { data: EscalationTimeline | null | undefined }) {
  if (!data || data.events.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Escalation timeline</span>
      <ul className="mt-2 space-y-1">
        {data.events.slice(0, 5).map((e) => (
          <li key={e.finding_id} className="flex items-start justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{e.title}</span>
            <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${e.escalation_level === 'market_wide_propagation' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
              {e.escalation_level === 'market_wide_propagation' ? 'PROPAGATING' : 'ESCALATING'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendPersistencePanel({ data }: { data: TrendPersistence | null | undefined }) {
  if (!data || data.trends.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Recurring patterns</span>
      <ul className="mt-2 space-y-1">
        {data.trends.slice(0, 5).map((t) => (
          <li key={t.canonical_event_key} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{t.title}</span>
            <span className="flex items-center gap-1.5">
              {t.trajectory && <span className={`text-[10px] font-semibold ${t.trajectory === 'accelerating' ? 'text-rose-700' : t.trajectory === 'fading' ? 'text-emerald-700' : 'text-gray-600'}`}>{t.trajectory}</span>}
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{t.times_seen}×</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExecutivePanels({ run }: { run: RunResponse['run'] }) {
  const hasAnyPanel = !!(
    run.momentum_overview ||
    run.category_acceleration?.categories?.length ||
    run.competitor_pressure?.competitors?.length ||
    run.propagation_map?.regions?.length ||
    run.escalation_timeline?.events?.length ||
    run.trend_persistence?.trends?.length
  );
  if (!hasAnyPanel) return null;
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <MomentumPanel data={run.momentum_overview} />
      <CategoryAccelerationPanel data={run.category_acceleration} />
      <CompetitorPressurePanel data={run.competitor_pressure} />
      <PropagationPanel data={run.propagation_map} />
      <EscalationTimelinePanel data={run.escalation_timeline} />
      <TrendPersistencePanel data={run.trend_persistence} />
    </section>
  );
}

export default function MarketPulseTabV2(props: OpportunityTabProps) {
  const { companyId, fetchWithAuth } = props;
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [mode, setMode] = useState<'one_time' | 'automated'>('one_time');
  const [objective, setObjective] = useState<'growth' | 'expansion' | 'hiring' | 'partnerships' | 'product' | 'risk'>('product');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [regionScope, setRegionScope] = useState<'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom'>('profile_markets');
  const [customRegions, setCustomRegions] = useState('');
  const [competitorScope, setCompetitorScope] = useState<'profile_only' | 'auto_discover' | 'combined'>('combined');
  const [sourceStrategy, setSourceStrategy] = useState<'ai' | 'api' | 'hybrid'>('ai');
  const [customDirection, setCustomDirection] = useState('');
  const [creditAcknowledged, setCreditAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRunState | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Phase 1B: feed-first UX state.
  // Default: setup collapsed UNLESS the user has never run a scan yet (no
  // history rows present after initial load — see the auto-expand effect below).
  const [scanSetupOpen, setScanSetupOpen] = useState(false);
  const [scanSetupAutoOpened, setScanSetupAutoOpened] = useState(false);
  const [actioningFindingId, setActioningFindingId] = useState<string | null>(null);
  const [activeDimension, setActiveDimension] = useState<MarketDimension>('all');
  const [activeAttentionFilter, setActiveAttentionFilter] = useState<AttentionFilter>('all');
  // Track local action overrides so the UI updates instantly without
  // re-polling the run after a user mutation.
  const [findingStateOverrides, setFindingStateOverrides] = useState<Record<string, MarketPulseFinding['user_action_state']>>({});

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    const load = async () => {
      setLoadingContext(true);
      try {
        const res = await fetchWithAuth(`/api/market-pulse/context?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to load Market Pulse context');
        }
        const data = (await res.json()) as ContextResponse;
        if (!active) return;
        setContext(data);
        setSelectedCategories(buildFocusedCategoryDefaults(data));
      } catch (error) {
        if (!active) return;
        setErrorMessage((error as Error).message || 'Failed to load Market Pulse context');
      } finally {
        if (active) setLoadingContext(false);
      }
    };

    const loadAutomation = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/automation?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as AutomationResponse;
        if (!active) return;
        if (data?.settings) {
          setAutomationEnabled(Boolean(data.settings.is_active));
          setCreditAcknowledged(Boolean(data.settings.credit_acknowledged));
        }
      } catch {
        // ignore
      }
    };

    const loadHistory = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setHistory(Array.isArray(data?.history) ? data.history : []);
      } catch {
        // ignore
      }
    };

    void load();
    void loadAutomation();
    void loadHistory();
    return () => {
      active = false;
    };
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!runId || !companyId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setRunning(false);
            setPendingRun(null);
            setErrorMessage('Market Pulse finished or changed state, but this browser session is no longer authorized to refresh it. Refresh the page or sign in again.');
            window.clearInterval(timer);
          }
          if (res.status === 404 || res.status === 409) {
            const err = await res.json().catch(() => ({}));
            setRunning(false);
            setRunId(null);
            setPendingRun(null);
            setErrorMessage(err?.error || 'Market Pulse completed, but this run is not available in the current company context.');
            window.clearInterval(timer);
          }
          return;
        }
        const data = (await res.json()) as RunResponse;
        setRunResult(data);
        setPendingRun(null);
        setErrorMessage(null);
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          const historyRes = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            setHistory(Array.isArray(historyData?.history) ? historyData.history : []);
          }
        }
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          setRunning(false);
          window.clearInterval(timer);
        }
      } catch {
        // Keep transient network failures from tearing down a legitimate scan.
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [companyId, fetchWithAuth, runId]);

  const allVisibleRankedFindings = useMemo(() => {
    return sortBySignalAttention(runResult?.findings ?? []).filter((f) => {
      const state = findingStateOverrides[f.id] ?? f.user_action_state ?? 'open';
      return state === 'open' || state === 'escalated';
    });
  }, [runResult, findingStateOverrides]);

  const dimensionCounts = useMemo(() => {
    return MARKET_DIMENSIONS.reduce((acc, dimension) => {
      acc[dimension.id] = allVisibleRankedFindings.filter((finding) => findingMatchesDimension(finding, dimension.id)).length;
      return acc;
    }, {} as Record<MarketDimension, number>);
  }, [allVisibleRankedFindings]);

  const dimensionRankedFindings = useMemo(() => {
    return allVisibleRankedFindings.filter((finding) => findingMatchesDimension(finding, activeDimension));
  }, [activeDimension, allVisibleRankedFindings]);

  const attentionCounts = useMemo(() => {
    return ATTENTION_FILTERS.reduce((acc, filter) => {
      acc[filter.id] = dimensionRankedFindings.filter((finding) => findingMatchesAttention(finding, filter.id)).length;
      return acc;
    }, {} as Record<AttentionFilter, number>);
  }, [dimensionRankedFindings]);

  const visibleRankedFindings = useMemo(() => {
    return dimensionRankedFindings.filter((finding) => findingMatchesAttention(finding, activeAttentionFilter));
  }, [activeAttentionFilter, dimensionRankedFindings]);

  const filteredMarketDeltaSummary = useMemo(() => {
    return filterDeltaSummary(runResult?.run.market_delta_summary, activeDimension);
  }, [activeDimension, runResult]);

  const groupedFindings = useMemo(() => {
    const findings = visibleRankedFindings;
    return {
      top: findings.filter((item) => item.change_status === 'new' || item.change_status === 'updated').slice(0, 6),
      risks: findings.filter((item) => item.impact_type === 'risk'),
      watch: findings.filter((item) => item.impact_type === 'watch'),
      opportunities: findings.filter((item) => item.impact_type === 'opportunity'),
    };
  }, [visibleRankedFindings]);

  // First-time visitor → auto-open Scan Setup so the form is discoverable.
  // Once history loads with at least one row, the disclosure stays whatever
  // the user last toggled it to.
  useEffect(() => {
    if (scanSetupAutoOpened) return;
    if (history.length === 0 && !runResult && !pendingRun) {
      setScanSetupOpen(true);
      setScanSetupAutoOpened(true);
    } else if (history.length > 0) {
      setScanSetupAutoOpened(true);
    }
  }, [history, runResult, pendingRun, scanSetupAutoOpened]);

  // Phase 1A: change-diff strip — counts of new / updated / unchanged / resolved
  // and priority-tier counts. Renders above results when the run has findings.
  const changeDiff = useMemo(() => {
    const findings = runResult?.findings ?? [];
    const out = { new: 0, updated: 0, unchanged: 0, resolved: 0, p0: 0, p1: 0, p2: 0 };
    for (const f of findings) {
      if (f.change_status === 'new') out.new++;
      else if (f.change_status === 'updated') out.updated++;
      else if (f.change_status === 'unchanged') out.unchanged++;
      else if (f.change_status === 'resolved') out.resolved++;
      if (f.priority_tier === 'P0') out.p0++;
      else if (f.priority_tier === 'P1') out.p1++;
      else out.p2++;
    }
    return out;
  }, [runResult]);

  // Phase 1B: tier-grouped feed (P0 dominant, P1 visible, P2 compact).
  // Filters out resolved/snoozed by default so the feed only shows actionable items.
  const tieredFindings = useMemo(() => {
    const visible = visibleRankedFindings;
    return {
      P0: visible.filter((f) => f.priority_tier === 'P0'),
      P1: visible.filter((f) => f.priority_tier === 'P1'),
      P2: visible.filter((f) => !f.priority_tier || f.priority_tier === 'P2'),
      hidden: dimensionRankedFindings.length - visible.length,
    };
  }, [dimensionRankedFindings, visibleRankedFindings]);
  const hasPrioritizedFeed = Boolean(
    runResult && tieredFindings.P0.length + tieredFindings.P1.length + tieredFindings.P2.length > 0
  );

  // Phase 1B + 2: per-finding action handler. Optimistic local update, then
  // POST. `promote` and `generate` route to dedicated Phase 2 endpoints;
  // others use the standard /action endpoint.
  const performFindingAction = async (
    finding: MarketPulseFinding,
    actionType: 'resolve' | 'reopen' | 'snooze' | 'escalate' | 'promote' | 'share' | 'generate',
    payload?: Record<string, unknown>,
  ) => {
    if (!companyId) return;
    setActioningFindingId(finding.id);
    setErrorMessage(null);

    // Optimistic local state.
    const nextState: MarketPulseFinding['user_action_state'] =
      actionType === 'resolve' ? 'resolved'
      : actionType === 'reopen' ? 'open'
      : actionType === 'snooze' ? 'snoozed'
      : actionType === 'escalate' ? 'escalated'
      : actionType === 'promote' ? 'promoted'
      : finding.user_action_state ?? 'open';
    if (actionType !== 'share' && actionType !== 'generate') {
      setFindingStateOverrides((prev) => ({ ...prev, [finding.id]: nextState }));
    }

    if (actionType === 'share' && typeof navigator !== 'undefined' && navigator.clipboard) {
      const text = `[Market Pulse · ${finding.priority_tier ?? 'P?'} ${finding.impact_type}] ${finding.title}\n\n${finding.interpretation_text ?? finding.summary}\n\nWhy it matters: ${finding.why_it_matters}\nRecommended action: ${finding.recommended_action}`;
      try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }

    try {
      // Phase 2: dedicated /promote endpoint that creates an opportunity_items
      // row + builds the campaign payload. Then we stash it in sessionStorage
      // and navigate to the recommendations planner.
      if (actionType === 'promote') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to promote finding');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem('market_pulse_promote_bridge', JSON.stringify({
              finding_id: finding.id,
              opportunity_id: data.opportunity_id,
              campaign_payload: data.campaign_payload,
              issued_at: new Date().toISOString(),
            }));
          } catch { /* ignore quota */ }
          // Navigate to recommendations hub — campaign builder consumes the bridge.
          window.location.assign('/recommendations?from=market_pulse');
        }
        return;
      }

      // Phase 2: dedicated /generate-response endpoint that returns a handoff
      // payload + suggested target URLs. We stash + navigate.
      if (actionType === 'generate') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/generate-response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to prepare generation context');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(data.handoff_token, JSON.stringify(data.handoff_payload));
          } catch { /* ignore quota */ }
          // Default target = post creator. The bridge payload survives a
          // navigate so the user can change destination via the content menu.
          const target = (payload?.target as string | undefined) ?? data.suggested_targets.post_creator;
          window.location.assign(target);
        }
        return;
      }

      // Default: legacy /action endpoint (resolve / snooze / escalate / share / reopen).
      const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: actionType,
          payload: payload ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to ${actionType} finding`);
      }
    } catch (error) {
      // Roll back the optimistic override.
      setFindingStateOverrides((prev) => {
        const next = { ...prev };
        delete next[finding.id];
        return next;
      });
      setErrorMessage((error as Error).message || `Failed to ${actionType} finding`);
    } finally {
      setActioningFindingId(null);
    }
  };

  // Phase 2: record "shown" for each visible finding once per session per
  // finding. The endpoint is idempotent per UTC day, so even multiple
  // remounts are safe — but we de-dupe client-side to avoid the network
  // calls.
  const shownRecordedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!companyId || !runResult || runResult.findings.length === 0) return;
    const toRecord = runResult.findings
      .filter((f) => !shownRecordedRef.current.has(f.id))
      .slice(0, 50);
    if (toRecord.length === 0) return;
    for (const f of toRecord) shownRecordedRef.current.add(f.id);
    void Promise.allSettled(
      toRecord.map((f) =>
        fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(f.id)}/shown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }),
      ),
    );
  }, [companyId, fetchWithAuth, runResult]);

  const resolvedRegionPreview = useMemo(
    () => buildResolvedRegionPreview(context, regionScope, customRegions),
    [context, regionScope, customRegions]
  );

  const loadRunResult = async (targetRunId: string, attempts = 1): Promise<RunResponse> => {
    let lastError: MarketPulseLoadError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await wait(1200 * attempt);
      const resultRes = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(targetRunId)}?companyId=${encodeURIComponent(companyId)}`);
      if (resultRes.ok) {
        return (await resultRes.json()) as RunResponse;
      }

      const err = await resultRes.json().catch(() => ({}));
      lastError = new Error(err?.error || `Failed to load Market Pulse run (${resultRes.status})`) as MarketPulseLoadError;
      lastError.status = resultRes.status;

      if (resultRes.status === 401 || resultRes.status === 403 || resultRes.status === 404 || resultRes.status === 409) {
        break;
      }
    }

    throw lastError ?? new Error('Failed to load Market Pulse run');
  };

  const loadMostRecentRunResult = async (): Promise<RunResponse | null> => {
    const historyRes = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
    if (!historyRes.ok) return null;

    const historyData = await historyRes.json();
    const nextHistory = Array.isArray(historyData?.history) ? historyData.history as HistoryItem[] : [];
    setHistory(nextHistory);

    const latestLoadableRun = nextHistory.find((item) =>
      ['completed', 'completed_with_warnings', 'failed'].includes(String(item.status ?? '').toLowerCase())
    ) ?? nextHistory[0];
    if (!latestLoadableRun?.id) return null;

    return loadRunResult(latestLoadableRun.id, 1);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const runScan = async () => {
    if (!companyId) return;
    setRunning(true);
    setErrorMessage(null);
    setRunResult(null);
    setPendingRun({
      created_at: new Date().toISOString(),
      status: 'pending',
      progress_stage: 'INITIALIZING',
    });
    try {
      const res = await fetchWithAuth('/api/market-pulse/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          mode,
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          source_strategy: sourceStrategy,
          custom_direction: customDirection.trim() || null,
          delivery_mode: mode === 'automated' ? 'daily_digest' : 'page_only',
          credit_acknowledged: creditAcknowledged,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start Market Pulse run');
      }
      const data = await res.json();
      const nextRunId = String(data.runId);
      if (!nextRunId || nextRunId === 'undefined' || nextRunId === 'null') {
        throw new Error('Market Pulse started, but the server did not return a valid run id');
      }
      setRunId(nextRunId);
      setPendingRun((current) => current ? { ...current, status: 'running', progress_stage: 'INITIALIZING' } : current);

      if (!['pending', 'running'].includes(String(data.status ?? '').toLowerCase())) {
        try {
          const result = await loadRunResult(nextRunId, 3);
          setRunResult(result);
          setPendingRun(null);
          setRunning(false);
          setErrorMessage(null);
        } catch (resultError) {
          const status = (resultError as MarketPulseLoadError).status;
          if (status === 404 || status === 409) {
            const fallbackResult = await loadMostRecentRunResult().catch(() => null);
            if (fallbackResult) {
              setRunResult(fallbackResult);
              setPendingRun(null);
              setRunning(false);
              setErrorMessage(null);
              return;
            }

            setRunning(false);
            setRunId(null);
            setPendingRun(null);
            setErrorMessage((resultError as Error).message || 'Market Pulse completed, but the run could not be found for this company.');
            return;
          }

          setPendingRun({
            created_at: new Date().toISOString(),
            status: 'running',
            progress_stage: 'FINALIZING',
          });
          setErrorMessage(
            `${(resultError as Error).message || 'Market Pulse completed, but results could not be loaded'}. Retrying result load...`
          );
        }
      }
    } catch (error) {
      setRunning(false);
      setPendingRun(null);
      setErrorMessage((error as Error).message || 'Failed to start Market Pulse run');
    }
  };

  const saveAutomation = async () => {
    if (!companyId) return;
    setAutomationLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth('/api/market-pulse/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          is_active: automationEnabled,
          cadence: 'daily',
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          custom_direction: customDirection.trim() || null,
          credit_acknowledged: creditAcknowledged,
          warning_copy_version: 'v1',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save automation');
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to save automation');
    } finally {
      setAutomationLoading(false);
    }
  };

  const stopScan = async () => {
    if (!companyId || !runId) return;
    setCancelLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const alreadyFinished = typeof err?.error === 'string' && err.error.toLowerCase().includes('already finished');
        if (!alreadyFinished) {
          throw new Error(err?.error || 'Failed to stop Market Pulse run');
        }
      }
      const data = await res.json().catch(() => ({}));

      const cancelledAt = new Date().toISOString();
      setRunning(false);
      setRunId(null);
      setPendingRun(null);
      setRunResult((current) => current ? {
        ...current,
        run: {
          ...current.run,
          status: data?.alreadyFinished ? String(data.status ?? current.run.status) : 'failed',
          completed_at: current.run.completed_at ?? cancelledAt,
          legacy_error: data?.alreadyFinished ? current.run.legacy_error : 'Cancelled by user',
        },
      } : null);
      if (!data?.alreadyFinished) {
        setErrorMessage(null);
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to stop Market Pulse run');
    } finally {
      setCancelLoading(false);
    }
  };

  const activeScanStatusPanel = running ? (
    <div className="mt-3 w-full max-w-3xl">
      <EngineJobStatusPanel
        status={String(runResult?.run?.status ?? pendingRun?.status ?? 'pending').toUpperCase()}
        progressStage={runResult?.run?.progress_stage ?? pendingRun?.progress_stage}
        confidenceIndex={runResult?.run?.confidence_index}
        error={runResult?.run?.legacy_error}
        createdAt={runResult?.run?.created_at ?? pendingRun?.created_at}
        durationHint="Scan in progress. You can keep this page open while Market Pulse collects and consolidates signals."
      />
    </div>
  ) : null;

  if (!companyId) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view Market Pulse.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Market Pulse</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900">Monitor the market with company-aware filters</h3>
            <p className="mt-2 text-sm text-gray-600">
              Use company profile context, category selection, and geography scope to surface only the external developments that matter.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{context?.profile?.name || 'Company context'}</span>
            <span className="ml-2 text-indigo-700">{context?.profile?.industry || 'Industry pending'}</span>
          </div>
        </div>
      </div>

      {errorMessage && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMessage}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Phase 1B EXECUTIVE FEED HEADER — renders when run has results.
              Pressure indicators, top changes, dominant categories, risk/opp balance. */}
          {runResult && runResult.findings.length > 0 && (
            <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-[260px]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Decision intelligence</p>
                  {runResult.run.executive_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.executive_summary}</p>
                  ) : runResult.run.strategic_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.strategic_summary}</p>
                  ) : (
                    <p className="mt-2 text-base text-gray-500">No executive summary yet — run a scan or wait for the cron to land one.</p>
                  )}
                </div>
                {runResult.run.market_direction && (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    runResult.run.market_direction === 'expanding' ? 'bg-emerald-100 text-emerald-800'
                    : runResult.run.market_direction === 'contracting' ? 'bg-rose-100 text-rose-800'
                    : runResult.run.market_direction === 'mixed' ? 'bg-amber-100 text-amber-800'
                    : 'bg-gray-100 text-gray-700'
                  }`}>
                    {runResult.run.market_direction}
                  </span>
                )}
              </div>

              {/* Pressure bar — visualizes risk vs opportunity balance. */}
              {(typeof runResult.run.opportunity_pressure === 'number' || typeof runResult.run.risk_pressure === 'number') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <span>Risk pressure {Math.round((runResult.run.risk_pressure ?? 0) * 100)}%</span>
                    <span>Opportunity pressure {Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%</span>
                  </div>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="bg-rose-400" style={{ width: `${Math.round((runResult.run.risk_pressure ?? 0) * 100)}%` }} />
                    <div className="bg-emerald-400" style={{ width: `${Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}

              {/* Top takeaways. */}
              {runResult.run.top_takeaways && runResult.run.top_takeaways.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
                  {runResult.run.top_takeaways.map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Strategic shift assessment. */}
              {runResult.run.strategic_shift_assessment && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-white/80 p-3 text-sm text-gray-700">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Shift assessment</span>
                  <p className="mt-1">{runResult.run.strategic_shift_assessment}</p>
                </div>
              )}

              {/* Immediate-attention list — P0s requiring action. */}
              {runResult.run.immediate_attention_items && runResult.run.immediate_attention_items.length > 0 && (
                <div className="mt-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-600">Immediate attention</span>
                  <ul className="mt-2 space-y-1.5">
                    {runResult.run.immediate_attention_items.slice(0, 5).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-sm">
                        <span className="rounded-full bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">{item.priority_tier}</span>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{item.title}</div>
                          <div className="text-xs text-rose-700">{item.reason}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Change-summary chips — emerging/disappearing categories + escalations. */}
              {runResult.run.change_summary && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {runResult.run.change_summary.escalated_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                      ↑ {runResult.run.change_summary.escalated_count} escalated
                    </span>
                  )}
                  {runResult.run.change_summary.downgraded_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                      ↓ {runResult.run.change_summary.downgraded_count} downgraded
                    </span>
                  )}
                  {runResult.run.change_summary.emerging_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800" title={runResult.run.change_summary.emerging_categories.join(', ')}>
                      + {runResult.run.change_summary.emerging_categories.length} emerging {runResult.run.change_summary.emerging_categories.length === 1 ? 'category' : 'categories'}
                    </span>
                  )}
                  {runResult.run.change_summary.disappearing_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600" title={runResult.run.change_summary.disappearing_categories.join(', ')}>
                      − {runResult.run.change_summary.disappearing_categories.length} disappearing
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Phase 2 EXECUTIVE PANELS — momentum, category acceleration,
              competitor pressure, propagation map, escalation timeline,
              trend persistence. Renders only when at least one panel has data. */}
          {runResult && runResult.findings.length > 0 && (
            <ExecutivePanels run={runResult.run} />
          )}

          {/* Scan Setup — collapsed by default once a run exists; expanded on first visit. */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setScanSetupOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-900">{scanSetupOpen ? 'Adjust scan' : 'Scan setup'}</span>
                {!scanSetupOpen && context && (
                  <span className="text-xs text-gray-500">
                    · {selectedCategories.length} categor{selectedCategories.length === 1 ? 'y' : 'ies'}
                    {' · '}{objective}
                    {' · '}{regionScope === 'custom' ? 'custom regions' : regionScope.replace(/_/g, ' ')}
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500">{scanSetupOpen ? 'Collapse' : 'Expand'}</span>
            </button>

            {!scanSetupOpen ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runScan}
                  disabled={running || loadingContext || selectedCategories.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {running ? 'Running scan...' : 'Run Market Pulse'}
                </button>
                {running && runId && (
                  <button
                    type="button"
                    onClick={stopScan}
                    disabled={cancelLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                  >
                    {cancelLoading ? 'Stopping...' : 'Stop scan'}
                  </button>
                )}
                {runResult?.run?.created_at && (
                  <span className="text-xs text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
                )}
                {activeScanStatusPanel}
              </div>
            ) : (
              <div className="mt-4">

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'one_time' | 'automated')} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="one_time">One-time scan</option>
                  <option value="automated">Automated monitoring</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Objective</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {OBJECTIVES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Region scope</label>
                <select value={regionScope} onChange={(e) => setRegionScope(e.target.value as typeof regionScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_markets">Market focus</option>
                  <option value="expansion_markets">Expansion markets</option>
                  <option value="all_defaults">All defaults</option>
                  <option value="custom">Custom regions</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Competitor scope</label>
                <select value={competitorScope} onChange={(e) => setCompetitorScope(e.target.value as typeof competitorScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_only">Profile competitors</option>
                  <option value="auto_discover">Auto-discover</option>
                  <option value="combined">Combine both</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Research mode</label>
                <select value={sourceStrategy} onChange={(e) => setSourceStrategy(e.target.value as typeof sourceStrategy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {SOURCE_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom regions</label>
                <input value={customRegions} onChange={(e) => setCustomRegions(e.target.value)} disabled={regionScope !== 'custom'} placeholder="Comma-separated: US, Canada, UK" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
                <p className="mt-2 text-xs text-gray-500">
                  Active regions: {resolvedRegionPreview.length ? resolvedRegionPreview.join(', ') : 'Global fallback'}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom direction</label>
                <textarea value={customDirection} onChange={(e) => setCustomDirection(e.target.value)} rows={3} placeholder="Example: Track North America expansion, visa friction, and partnership signals for IT services." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Signal categories</label>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(buildFocusedCategoryDefaults(context))}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      selectedCategories.length === 1 && selectedCategories[0] === buildFocusedCategoryDefaults(context)[0]
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Focused
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(buildExpandedCategoryDefaults(context))}
                    className="rounded-md px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:text-gray-900"
                  >
                    Expanded
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategories(MARKET_PULSE_CATEGORIES)}
                    className="rounded-md px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:text-gray-900"
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_PULSE_CATEGORIES.map((category) => {
                  const active = selectedCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {toTitle(category)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={runScan}
                disabled={running || loadingContext || selectedCategories.length === 0}
                className="inline-flex min-h-[56px] items-center gap-3 rounded-2xl bg-gray-900 px-7 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                {running ? 'Running scan...' : 'Run Market Pulse'}
              </button>
              {running && runId && (
                <button
                  type="button"
                  onClick={stopScan}
                  disabled={cancelLoading}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {cancelLoading ? 'Stopping...' : 'Stop scan'}
                </button>
              )}
              {runResult?.run?.created_at && (
                <span className="text-sm text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
              )}
              {activeScanStatusPanel}
            </div>
            {context && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus</div>
                  <div className="mt-1">{context.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Domain Role</div>
                  <div className="mt-1">{context.marketPulseProfile.domain_role || context.marketPulseProfile.provider_type || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Policy Sensitivity</div>
                  <div className="mt-1">{context.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
                </div>
              </div>
            )}
              </div>
            )}
          </section>

          {runResult && runResult.findings.length > 0 && (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <DimensionFilters
                activeDimension={activeDimension}
                counts={dimensionCounts}
                onChange={setActiveDimension}
              />
              <AttentionFilters
                activeFilter={activeAttentionFilter}
                counts={attentionCounts}
                onChange={setActiveAttentionFilter}
              />
            </div>
          )}

          {runResult && dimensionRankedFindings.length > 0 && (
            <ExecutiveScanStrip findings={dimensionRankedFindings} />
          )}

          {runResult && (
            <SinceLastPulseStrip delta={filteredMarketDeltaSummary} />
          )}

          {runResult && visibleRankedFindings.length > 1 && (
            <MarketNarrativesSection findings={visibleRankedFindings} />
          )}

          {runResult && runResult.findings.length > 0 && visibleRankedFindings.length === 0 && (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
              No Market Pulse findings match these filters yet.
            </section>
          )}

          {/* Phase 1B FEED — tier-grouped, action-rail-equipped finding cards.
              Replaces the four impact-grouped lists in the legacy Results section
              when at least one finding has a priority_tier (i.e. post-1A run). */}
          {runResult && runResult.findings.length > 0 && hasPrioritizedFeed && (
            <FeedSection
              tieredFindings={tieredFindings}
              actioningFindingId={actioningFindingId}
              findingStateOverrides={findingStateOverrides}
              performFindingAction={performFindingAction}
            />
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-semibold text-gray-900">
                {hasPrioritizedFeed ? 'Run summary' : 'Results'}
              </h4>
            </div>

            {!runResult && pendingRun && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(pendingRun.status).toUpperCase()}
                  progressStage={pendingRun.progress_stage}
                  createdAt={pendingRun.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {runResult?.run?.status && ['pending', 'running', 'completed', 'completed_with_warnings', 'failed'].includes(String(runResult.run.status).toLowerCase()) && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(runResult.run.status).toUpperCase()}
                  progressStage={runResult.run.progress_stage}
                  confidenceIndex={runResult.run.confidence_index}
                  error={runResult.run.legacy_error}
                  createdAt={runResult.run.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {!runResult && <div className="text-sm text-gray-500">Run a scan to see structured Market Pulse findings here.</div>}

            {runResult && (
              <div className="space-y-6">
                {/* Phase 1A: executive summary chip — surfaces strategic_summary
                    that the legacy consolidator already produced but V2 sync
                    was dropping on the floor. */}
                {runResult.run.strategic_summary && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Executive summary</div>
                    <p className="mt-2 text-sm text-indigo-900">{runResult.run.strategic_summary}</p>
                  </div>
                )}

                {/* Phase 1A: "What changed since last run" diff strip — combines
                    change_status counts (new/updated/unchanged/resolved) with
                    priority-tier counts (P0/P1/P2). */}
                {runResult.findings.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">What changed</span>
                      {changeDiff.new > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          {changeDiff.new} new
                        </span>
                      )}
                      {changeDiff.updated > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {changeDiff.updated} updated
                        </span>
                      )}
                      {changeDiff.resolved > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {changeDiff.resolved} resolved
                        </span>
                      )}
                      {changeDiff.unchanged > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                          {changeDiff.unchanged} unchanged
                        </span>
                      )}
                      <span className="ml-2 inline-flex items-center gap-2 text-xs text-gray-500">
                        <span className="text-gray-400">·</span>
                        <span className="font-medium text-rose-700">{changeDiff.p0} P0</span>
                        <span className="font-medium text-amber-700">{changeDiff.p1} P1</span>
                        <span className="font-medium text-gray-500">{changeDiff.p2} P2</span>
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Status</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{toTitle(runResult.run.status)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Findings</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{runResult.findings.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">New / Updated</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.top.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Risks</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.risks.length}</div>
                  </div>
                </div>

                {/* Phase 1A: surface risk_alerts the consolidator emitted. */}
                {(runResult.run.risk_alerts ?? []).length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Risk alerts</div>
                    <ul className="mt-2 space-y-1 text-sm text-amber-900">
                      {(runResult.run.risk_alerts ?? []).slice(0, 5).map((alert, idx) => (
                        <li key={idx}>• {alert}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!hasPrioritizedFeed && [
                  { title: 'Top Strategic Findings', items: groupedFindings.top },
                  { title: 'Risk Signals', items: groupedFindings.risks },
                  { title: 'Watch List', items: groupedFindings.watch },
                  { title: 'Opportunity Signals', items: groupedFindings.opportunities },
                ].map((section) => (
                  <div key={section.title}>
                    <h5 className="mb-3 text-sm font-semibold text-gray-900">{section.title}</h5>
                    {section.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No items in this section yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {section.items.map((item) => {
                          // Phase 1A: priority-tier ring + colored chip; falls back
                          // to neutral gray when priority_tier is null (legacy rows).
                          const tierRing = item.priority_tier === 'P0'
                            ? 'border-rose-300 ring-1 ring-rose-200'
                            : item.priority_tier === 'P1'
                              ? 'border-amber-200'
                              : 'border-gray-200';
                          const tierBadge = item.priority_tier === 'P0'
                            ? 'bg-rose-100 text-rose-800'
                            : item.priority_tier === 'P1'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700';
                          const changeBadge = item.change_status === 'new'
                            ? 'bg-blue-100 text-blue-800'
                            : item.change_status === 'updated'
                              ? 'bg-amber-100 text-amber-800'
                              : item.change_status === 'resolved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-100 text-gray-600';
                          const confidenceColor = item.confidence_score >= 75
                            ? 'text-emerald-700'
                            : item.confidence_score >= 50
                              ? 'text-amber-700'
                              : 'text-gray-500';
                          return (
                            <div key={item.id} className={`rounded-xl border p-4 ${tierRing}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                {item.priority_tier && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ${tierBadge}`}>
                                    {item.priority_tier}
                                  </span>
                                )}
                                <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                                <SignificanceBadge finding={item} />
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{toTitle(item.category)}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs ${changeBadge}`}>{toTitle(item.change_status)}</span>
                              </div>
                              <SignalMovement finding={item} />
                              <p className="mt-2 text-sm text-gray-600">{item.summary}</p>
                              <p className="mt-2 text-sm text-gray-800"><strong>Why it matters:</strong> {item.why_it_matters}</p>
                              <p className="mt-1 text-sm text-gray-800"><strong>Recommended action:</strong> {item.recommended_action}</p>
                              <SignalExplainability finding={item} />
                              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                                <span className={`font-semibold ${confidenceColor}`}>
                                  Confidence {Math.round(item.confidence_score)}
                                </span>
                                <span className="text-gray-500">·</span>
                                <span className="font-semibold text-gray-700">Relevance {Math.round(item.relevance_score)}</span>
                                {typeof item.company_alignment_score === 'number' && (
                                  <>
                                    <span className="text-gray-500">·</span>
                                    <span className="font-semibold text-indigo-700">
                                      Alignment {Math.round((item.company_alignment_score ?? 0) * 100)}
                                    </span>
                                  </>
                                )}
                                <span className="text-gray-500">·</span>
                                <span className="text-gray-500">Regions: {item.regions?.length ? item.regions.join(', ') : 'Global'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Recent runs</h4>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-sm text-gray-500">No Market Pulse history yet.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{toTitle(item.status)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{toTitle(item.objective)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{item.mode === 'automated' ? 'Automated' : 'One-time'}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString()} · Credits: {item.credits_consumed ?? 0}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      {(item.categories || []).map(toTitle).join(', ') || 'No categories'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-gray-900">Automation</h4>
            </div>
            <p className="text-sm text-gray-600">
              When enabled, the Market Pulse cron runs once per UTC day (~04:30) for your company using the settings saved here. Each successful automated scan consumes credits.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={automationEnabled} onChange={(e) => setAutomationEnabled(e.target.checked)} className="mt-1" />
              <span>Enable daily Market Pulse monitoring</span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={creditAcknowledged} onChange={(e) => setCreditAcknowledged(e.target.checked)} className="mt-1" />
              <span>I understand automated scans will consume credits on each completed run.</span>
            </label>
            <button type="button" onClick={saveAutomation} disabled={automationLoading || (automationEnabled && !creditAcknowledged)} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {automationLoading ? 'Saving...' : 'Save automation'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Profile-backed defaults</h4>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <div><strong>Market focus:</strong> {context?.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
              <div><strong>Domain role:</strong> {context?.marketPulseProfile.domain_role || context?.marketPulseProfile.provider_type || 'Not set'}</div>
              <div><strong>Solution domains:</strong> {context?.marketPulseProfile.solution_domains?.join(', ') || 'Not set'}</div>
              <div><strong>Policy sensitivity:</strong> {context?.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
