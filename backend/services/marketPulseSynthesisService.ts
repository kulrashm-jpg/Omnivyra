import { ownedDbTable } from '../db/writeOwner';
import { getCompanyContextIntelligence } from './companyContextIntelligenceService';
import { calculateContextQualityMetadata } from './companyContextEnrichmentService';

type SignalRow = {
  id: string;
  signal_category: string;
  title: string;
  summary: string;
  geography?: string | null;
  affected_domains?: string[] | null;
  affected_functions?: string[] | null;
  tags?: string[] | null;
  freshness_score?: number | null;
  urgency_level?: string | null;
  confidence_score?: number | null;
  strategic_operational_class?: string | null;
  opportunity_risk_class?: string | null;
  time_horizon_class?: string | null;
  conflict_group_key?: string | null;
  weak_signal?: boolean | null;
  published_at?: string | null;
};

type RelevanceRow = {
  signal_id: string;
  relevance_score: number;
  exposure_score: number;
  dependency_score: number;
  geography_score: number;
  workforce_score: number;
  regulatory_score: number;
  strategic_priority_score: number;
  confidence_score: number;
  degraded_context: boolean;
  degradation_reasons?: string[] | null;
  explanation_summary?: string | null;
  explanation_payload?: Record<string, unknown> | null;
  marketpulse_signals?: SignalRow | null;
  marketpulse_signal_impacts?: Array<{
    impact_type: string;
    impact_direction: string;
    severity: number;
    confidence: number;
    rationale: string;
  }> | null;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => needle && lower.includes(needle.toLowerCase()));
}

function pressureTypeFor(signal: SignalRow, impactDomains: string[]): string {
  const text = `${signal.signal_category} ${signal.title} ${signal.summary}`.toLowerCase();
  if (includesAny(text, ['visa', 'hiring', 'labor', 'talent']) || impactDomains.includes('workforce')) return 'hiring_pressure';
  if (includesAny(text, ['regulation', 'compliance', 'policy', 'tax']) || impactDomains.includes('compliance')) return 'compliance_pressure';
  if (includesAny(text, ['cloud', 'platform', 'ai', 'gpu']) || impactDomains.includes('technology')) return 'technology_pressure';
  if (includesAny(text, ['logistics', 'export', 'import'])) return 'logistics_pressure';
  if (includesAny(text, ['supply'])) return 'supply_chain_pressure';
  if (includesAny(text, ['funding', 'investor', 'rate'])) return 'investor_pressure';
  if (includesAny(text, ['pricing', 'margin', 'cost'])) return 'margin_pressure';
  if (includesAny(text, ['competitor'])) return 'competitive_pressure';
  if (includesAny(text, ['geopolitic', 'war', 'sanction'])) return 'geopolitical_pressure';
  return 'operational_pressure';
}

function relationshipType(parent: SignalRow, related: SignalRow): 'supports' | 'contradicts' | 'amplifies' | 'correlates_with' | 'precedes' | 'follows' {
  if (parent.opportunity_risk_class && related.opportunity_risk_class && parent.opportunity_risk_class !== related.opportunity_risk_class) {
    return 'contradicts';
  }
  const parentTime = new Date(parent.published_at ?? '').getTime();
  const relatedTime = new Date(related.published_at ?? '').getTime();
  if (!Number.isNaN(parentTime) && !Number.isNaN(relatedTime) && Math.abs(parentTime - relatedTime) > 7 * 24 * 60 * 60 * 1000) {
    return parentTime < relatedTime ? 'precedes' : 'follows';
  }
  if ((parent.urgency_level === 'high' || parent.urgency_level === 'critical') && parent.signal_category === related.signal_category) {
    return 'amplifies';
  }
  if (parent.signal_category === related.signal_category || parent.conflict_group_key === related.conflict_group_key) {
    return 'supports';
  }
  return 'correlates_with';
}

async function loadRelevantSignals(companyId: string): Promise<RelevanceRow[]> {
  const result = await ownedDbTable('marketpulse_company_signal_relevance')
    .select('*, marketpulse_signals(*), marketpulse_signal_impacts(*)')
    .eq('company_id', companyId)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(80);
  if (result.error) throw new Error(`Failed to load MarketPulse synthesis inputs: ${result.error.message}`);
  return (result.data ?? []) as RelevanceRow[];
}

async function synthesizeRelationships(rows: RelevanceRow[]) {
  const signals = rows.map((row) => row.marketpulse_signals).filter((row): row is SignalRow => Boolean(row?.id));
  const relationships: Array<Record<string, unknown>> = [];
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      const a = signals[i];
      const b = signals[j];
      const sharedDomains = (a.affected_domains ?? []).filter((domain) => (b.affected_domains ?? []).includes(domain));
      const sharedTags = (a.tags ?? []).filter((tag) => (b.tags ?? []).includes(tag));
      const sameConflictGroup = a.conflict_group_key && a.conflict_group_key === b.conflict_group_key;
      if (sharedDomains.length === 0 && sharedTags.length === 0 && !sameConflictGroup) continue;
      const type = relationshipType(a, b);
      relationships.push({
        parent_signal_id: a.id,
        related_signal_id: b.id,
        relationship_type: type,
        confidence: clamp(45 + sharedDomains.length * 15 + sharedTags.length * 5 + (sameConflictGroup ? 15 : 0) - (type === 'contradicts' ? 5 : 0)),
        rationale: `${type.replace(/_/g, ' ')} based on shared domains (${sharedDomains.join(', ') || 'none'}) and tags (${sharedTags.slice(0, 4).join(', ') || 'none'}).`,
      });
    }
  }
  if (relationships.length > 0) {
    await ownedDbTable('marketpulse_signal_relationships').upsert(relationships, {
      onConflict: 'parent_signal_id,related_signal_id,relationship_type',
    });
  }
  return relationships;
}

async function synthesizeTrends(rows: RelevanceRow[]) {
  const grouped = new Map<string, RelevanceRow[]>();
  for (const row of rows) {
    const signal = row.marketpulse_signals;
    if (!signal) continue;
    const domains = signal.affected_domains?.length ? signal.affected_domains : ['market'];
    for (const domain of domains) {
      const key = `${signal.signal_category}:${domain}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
  }
  const trends: Array<Record<string, unknown>> = [];
  for (const [key, group] of grouped) {
    if (group.length === 0) continue;
    const signals = group.map((row) => row.marketpulse_signals).filter((row): row is SignalRow => Boolean(row));
    const supportingSignals = signals.map((signal) => signal.id);
    const contradictorySignals = signals
      .filter((signal) => signal.opportunity_risk_class === 'opportunity')
      .length > 0 && signals.filter((signal) => signal.opportunity_risk_class === 'risk').length > 0
        ? signals.filter((signal) => signal.opportunity_risk_class === 'opportunity').map((signal) => signal.id)
        : [];
    const avgRelevance = group.reduce((sum, row) => sum + Number(row.relevance_score ?? 0), 0) / Math.max(group.length, 1);
    const avgConfidence = group.reduce((sum, row) => sum + Number(row.confidence_score ?? 0), 0) / Math.max(group.length, 1);
    const highUrgency = signals.filter((signal) => ['high', 'critical'].includes(String(signal.urgency_level))).length;
    const velocity = clamp(group.length * 10 + highUrgency * 8);
    const [category, domain] = key.split(':');
    const pattern = group.length >= 4 ? 'structural_trend' : group.length >= 2 ? 'recurring_pattern' : 'isolated_event';
    const direction = group.length >= 3 && highUrgency >= 2 ? 'accelerating' : group.length >= 2 ? 'emerging' : 'stable';
    trends.push({
      trend_category: category,
      title: `${domain.replace(/_/g, ' ')} pressure in ${category.replace(/_/g, ' ')}`,
      summary: `${group.length} signal${group.length === 1 ? '' : 's'} indicate ${domain.replace(/_/g, ' ')} movement in ${category.replace(/_/g, ' ')}.`,
      involved_signal_count: group.length,
      signal_velocity: velocity,
      confidence: clamp(avgConfidence * (contradictorySignals.length ? 0.82 : 1)),
      trend_direction: direction,
      trend_pattern: pattern,
      affected_industries: unique(signals.flatMap((signal) => signal.tags ?? []).filter((tag) => !['technology', 'workforce', 'compliance', 'revenue'].includes(tag))).slice(0, 8),
      affected_geographies: unique(signals.map((signal) => signal.geography ?? '').filter(Boolean)),
      impact_domains: unique(signals.flatMap((signal) => signal.affected_domains ?? [])),
      supporting_signals: supportingSignals,
      contradictory_signals: contradictorySignals,
      causal_summary: group.length > 1
        ? `Repeated ${category} signals with shared ${domain} impact indicate ${pattern.replace(/_/g, ' ')}.`
        : `Single ${category} signal; retained as isolated event until corroborated.`,
    });
  }
  const persisted: any[] = [];
  for (const trend of trends.slice(0, 12)) {
    const result = await ownedDbTable('marketpulse_trends').insert(trend).select('*').single();
    if (!result.error && result.data) persisted.push(result.data);
  }
  return persisted;
}

async function synthesizePressures(companyId: string, rows: RelevanceRow[], trends: any[]) {
  const intelligence = await getCompanyContextIntelligence(companyId).catch(() => null);
  const quality = calculateContextQualityMetadata(intelligence);
  const grouped = new Map<string, RelevanceRow[]>();
  for (const row of rows) {
    const signal = row.marketpulse_signals;
    if (!signal) continue;
    const domains = signal.affected_domains ?? [];
    const type = pressureTypeFor(signal, domains);
    grouped.set(type, [...(grouped.get(type) ?? []), row]);
  }
  const pressures: any[] = [];
  for (const [pressureType, group] of grouped) {
    const strongSignals = group.filter((row) => Number(row.relevance_score ?? 0) >= 55 && Number(row.confidence_score ?? 0) >= 45);
    if (strongSignals.length < 2 && !trends.some((trend) => String(trend.title).toLowerCase().includes(pressureType.split('_')[0]))) continue;
    const signals = group.map((row) => row.marketpulse_signals).filter((row): row is SignalRow => Boolean(row));
    const matchingTrends = trends.filter((trend) =>
      (trend.impact_domains ?? []).some((domain: string) => pressureType.includes(domain)) ||
      String(trend.title).toLowerCase().includes(pressureType.split('_')[0])
    );
    const contradictions = signals.filter((signal) => signal.opportunity_risk_class === 'opportunity').length > 0 &&
      signals.filter((signal) => signal.opportunity_risk_class === 'risk').length > 0
        ? ['Signals include both risk and opportunity framing.']
        : [];
    const avgSeverity = group.reduce((sum, row) => sum + Number(row.relevance_score ?? 0), 0) / Math.max(group.length, 1);
    const avgConfidence = group.reduce((sum, row) => sum + Number(row.confidence_score ?? 0), 0) / Math.max(group.length, 1);
    const confidence = clamp(avgConfidence * (strongSignals.length >= 3 ? 1 : 0.82) * (contradictions.length ? 0.78 : 1) * (quality.context_reliability_score < 45 ? 0.82 : 1));
    const synthesisStrength = strongSignals.length >= 3 && matchingTrends.length > 0 && confidence >= 65 ? 'strong' : strongSignals.length >= 2 ? 'moderate' : 'weak';
    const payload = {
      company_id: companyId,
      pressure_type: pressureType,
      pressure_direction: signals.filter((signal) => signal.opportunity_risk_class === 'risk').length >= signals.length / 2 ? 'increasing' : 'mixed',
      severity: clamp(avgSeverity + matchingTrends.length * 8),
      confidence,
      contributing_signals: unique(signals.map((signal) => signal.id)),
      contributing_trends: unique(matchingTrends.map((trend) => trend.id)),
      rationale: `${pressureType.replace(/_/g, ' ')} is based on ${strongSignals.length} corroborating signal${strongSignals.length === 1 ? '' : 's'} and ${matchingTrends.length} related trend${matchingTrends.length === 1 ? '' : 's'}.`,
      affected_business_areas: unique(signals.flatMap((signal) => signal.affected_domains ?? [])),
      causal_chain: signals.slice(0, 5).map((signal) => ({
        signal_id: signal.id,
        cause: signal.title,
        effect: `${pressureType.replace(/_/g, ' ')} via ${(signal.affected_domains ?? []).join(', ') || signal.signal_category}`,
      })),
      uncertainty_factors: unique([
        quality.context_reliability_score < 45 ? 'Company context reliability is low.' : '',
        strongSignals.length < 3 ? 'Fewer than three corroborating high-quality signals.' : '',
        ...group.flatMap((row) => row.degradation_reasons ?? []),
      ]),
      contradictory_factors: contradictions,
      synthesis_strength: synthesisStrength,
    };
    const result = await ownedDbTable('marketpulse_business_pressures').insert(payload).select('*').single();
    if (!result.error && result.data) pressures.push(result.data);
  }
  return pressures;
}

async function synthesizeNarratives(companyId: string, trends: any[], pressures: any[]) {
  const narratives: any[] = [];
  for (const pressure of pressures.slice(0, 8)) {
    const relatedTrends = trends.filter((trend) => (pressure.contributing_trends ?? []).includes(trend.id));
    const confidence = clamp(Number(pressure.confidence ?? 0) * ((pressure.contradictory_factors ?? []).length ? 0.82 : 1));
    const title = `${String(pressure.pressure_type).replace(/_/g, ' ')} is ${String(pressure.pressure_direction).replace(/_/g, ' ')}`;
    const narrative = {
      company_id: companyId,
      narrative_type: pressure.pressure_type,
      title,
      narrative_summary: `${title} based on ${pressure.contributing_signals?.length ?? 0} signals and ${relatedTrends.length} trend${relatedTrends.length === 1 ? '' : 's'}. This is synthesized intelligence, not a forecast.`,
      supporting_signals: pressure.contributing_signals ?? [],
      supporting_trends: relatedTrends.map((trend) => trend.id),
      supporting_pressures: [pressure.id],
      confidence,
      severity: pressure.severity,
      time_horizon: Number(pressure.severity ?? 0) >= 75 ? 'immediate' : 'near_term',
      causal_chain: pressure.causal_chain ?? [],
      uncertainty_factors: pressure.uncertainty_factors ?? [],
      contradictory_factors: pressure.contradictory_factors ?? [],
      duplicate_key: slugify(`${companyId}-${pressure.pressure_type}-${pressure.pressure_direction}`),
    };
    const result = await ownedDbTable('marketpulse_narratives')
      .upsert(narrative, { onConflict: 'company_id,duplicate_key' })
      .select('*')
      .single();
    if (!result.error && result.data) narratives.push(result.data);
  }
  return narratives;
}

async function synthesizeDigest(companyId: string, digestType: 'executive' | 'operational' | 'funding' | 'workforce' | 'compliance' | 'macroeconomic' | 'industry_specific', trends: any[], pressures: any[], narratives: any[]) {
  const filteredPressures = pressures.filter((pressure) => {
    if (digestType === 'workforce') return pressure.pressure_type === 'hiring_pressure';
    if (digestType === 'compliance') return pressure.pressure_type === 'compliance_pressure';
    if (digestType === 'funding') return pressure.pressure_type === 'investor_pressure';
    if (digestType === 'operational') return ['operational_pressure', 'technology_pressure', 'logistics_pressure', 'supply_chain_pressure'].includes(pressure.pressure_type);
    return true;
  });
  const topPressures = filteredPressures.sort((a, b) => Number(b.severity ?? 0) - Number(a.severity ?? 0)).slice(0, 5);
  const topTrends = trends.sort((a, b) => Number(b.signal_velocity ?? 0) - Number(a.signal_velocity ?? 0)).slice(0, 5);
  const topNarratives = narratives.sort((a, b) => Number(b.severity ?? 0) - Number(a.severity ?? 0)).slice(0, 5);
  const confidenceValues = [...topPressures, ...topTrends, ...topNarratives].map((item) => Number(item.confidence ?? 0)).filter(Boolean);
  const confidence = clamp(confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0);
  const riskCount = topPressures.filter((pressure) => String(pressure.pressure_direction) === 'increasing').length;
  const digest = {
    company_id: companyId,
    digest_type: digestType,
    title: `${digestType.replace(/_/g, ' ')} MarketPulse synthesis`,
    summary: topNarratives.length
      ? topNarratives.map((narrative) => narrative.narrative_summary).join(' ')
      : 'No sufficiently corroborated multi-signal synthesis yet; isolated signals remain in the adaptive feed.',
    major_pressures: topPressures.map((pressure) => pressure.id),
    strategic_opportunities: topNarratives.filter((narrative) => String(narrative.narrative_summary).includes('opportunity')).map((narrative) => narrative.id),
    emerging_risks: topNarratives.filter((narrative) => Number(narrative.severity ?? 0) >= 65).map((narrative) => narrative.id),
    trend_shifts: topTrends.map((trend) => trend.id),
    market_momentum: riskCount >= 3 ? 'risk_pressure' : topTrends.some((trend) => trend.trend_direction === 'accelerating') ? 'accelerating' : 'mixed',
    confidence,
    insight_payload: {
      pressures: topPressures.map((pressure) => ({ id: pressure.id, type: pressure.pressure_type, severity: pressure.severity, confidence: pressure.confidence })),
      trends: topTrends.map((trend) => ({ id: trend.id, title: trend.title, direction: trend.trend_direction, pattern: trend.trend_pattern })),
      narratives: topNarratives.map((narrative) => ({ id: narrative.id, title: narrative.title, confidence: narrative.confidence })),
      causal_explainability: topPressures.flatMap((pressure) => pressure.causal_chain ?? []).slice(0, 8),
    },
  };
  const result = await ownedDbTable('marketpulse_intelligence_digests').insert(digest).select('*').single();
  if (result.error) throw new Error(`Failed to create MarketPulse digest: ${result.error.message}`);
  return result.data;
}

export async function synthesizeMarketPulseIntelligence(companyId: string) {
  const rows = await loadRelevantSignals(companyId);
  if (rows.length === 0) {
    return { relationships: [], trends: [], pressures: [], narratives: [], digests: [] };
  }
  const relationships = await synthesizeRelationships(rows);
  const trends = await synthesizeTrends(rows);
  const pressures = await synthesizePressures(companyId, rows, trends);
  const narratives = await synthesizeNarratives(companyId, trends, pressures);
  const digests = await Promise.all([
    synthesizeDigest(companyId, 'executive', trends, pressures, narratives),
    synthesizeDigest(companyId, 'operational', trends, pressures, narratives).catch(() => null),
    synthesizeDigest(companyId, 'workforce', trends, pressures, narratives).catch(() => null),
    synthesizeDigest(companyId, 'compliance', trends, pressures, narratives).catch(() => null),
  ]);
  return {
    relationships,
    trends,
    pressures,
    narratives,
    digests: digests.filter(Boolean),
  };
}

export async function getMarketPulseSynthesis(companyId: string, digestType: string = 'executive') {
  const [pressures, narratives, digest, trends] = await Promise.all([
    ownedDbTable('marketpulse_business_pressures').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(8),
    ownedDbTable('marketpulse_narratives').select('*').eq('company_id', companyId).order('severity', { ascending: false }).limit(8),
    ownedDbTable('marketpulse_intelligence_digests').select('*').eq('company_id', companyId).eq('digest_type', digestType).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ownedDbTable('marketpulse_trends').select('*').order('updated_at', { ascending: false }).limit(8),
  ]);
  return {
    pressures: pressures.data ?? [],
    narratives: narratives.data ?? [],
    digest: digest.data ?? null,
    trends: trends.data ?? [],
  };
}
