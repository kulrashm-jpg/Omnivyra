import { ownedDbTable } from '../db/writeOwner';
import {
  getCompanyContextIntelligence,
  type CompanyContextIntelligence,
  type CompanyProfileLike,
} from './companyContextIntelligenceService';
import { calculateContextQualityMetadata, type CompanyContextQualityMetadata } from './companyContextEnrichmentService';

export type MarketPulseSignalCategory =
  | 'regulation'
  | 'funding'
  | 'hiring'
  | 'labor'
  | 'macroeconomics'
  | 'geopolitics'
  | 'supply_chain'
  | 'commodity'
  | 'technology'
  | 'AI'
  | 'cybersecurity'
  | 'cloud'
  | 'competitor'
  | 'mergers_acquisitions'
  | 'market_sentiment'
  | 'consumer_behavior'
  | 'logistics'
  | 'taxation'
  | 'currency'
  | 'exports_imports'
  | 'compliance'
  | 'infrastructure'
  | 'energy'
  | 'public_policy'
  | 'investor_activity';

export type MarketPulseSignal = {
  id?: string;
  signal_type: string;
  signal_category: MarketPulseSignalCategory;
  title: string;
  summary: string;
  source_url?: string | null;
  source_name?: string | null;
  source_type?: string | null;
  source_credibility?: number | null;
  geography?: string | null;
  industries?: string[];
  affected_domains?: string[];
  affected_functions?: string[];
  tags?: string[];
  published_at?: string | null;
  freshness_score?: number | null;
  urgency_level?: 'low' | 'medium' | 'high' | 'critical';
  novelty_score?: number | null;
  confidence_score?: number | null;
  causality_summary?: string | null;
  strategic_operational_class?: 'strategic' | 'operational' | 'mixed';
  opportunity_risk_class?: 'opportunity' | 'risk' | 'mixed';
  time_horizon_class?: 'immediate' | 'long_term' | 'mixed';
  relevance_scope_class?: 'direct' | 'indirect';
  locality_class?: 'local' | 'global' | 'regional';
  duplicate_key?: string | null;
  conflict_group_key?: string | null;
  weak_signal?: boolean;
};

export type MarketPulseSignalImpact = {
  impact_type: 'revenue' | 'cost' | 'operations' | 'workforce' | 'compliance' | 'supply_chain' | 'technology' | 'brand' | 'strategy';
  impact_direction: 'positive' | 'negative' | 'mixed';
  severity: number;
  confidence: number;
  rationale: string;
};

export type MarketPulsePersonalizationControls = {
  follow_topics: string[];
  mute_topics: string[];
  prioritize_categories: string[];
  follow_competitors: string[];
  follow_regions: string[];
  reduce_operational_noise: boolean;
  increase_strategic_alerts: boolean;
};

type RelevanceResult = {
  relevance_score: number;
  exposure_score: number;
  dependency_score: number;
  geography_score: number;
  workforce_score: number;
  regulatory_score: number;
  strategic_priority_score: number;
  confidence_score: number;
  degraded_context: boolean;
  degradation_reasons: string[];
  explanation_summary: string;
  explanation_payload: Record<string, unknown>;
  digest_types: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function normalizeCategory(value: string): MarketPulseSignalCategory {
  const text = value.toLowerCase();
  if (includesAny(text, ['regulatory', 'policy'])) return 'regulation';
  if (includesAny(text, ['hiring', 'talent'])) return 'hiring';
  if (includesAny(text, ['capital', 'funding', 'investor'])) return 'funding';
  if (includesAny(text, ['competitor'])) return 'competitor';
  if (includesAny(text, ['cloud'])) return 'cloud';
  if (includesAny(text, ['ai', 'model', 'gpu'])) return 'AI';
  if (includesAny(text, ['supply', 'logistics'])) return 'supply_chain';
  if (includesAny(text, ['technology', 'platform'])) return 'technology';
  return 'market_sentiment';
}

export function classifySignal(input: {
  title: string;
  summary: string;
  category: MarketPulseSignalCategory;
  impactType?: string | null;
  regions?: string[];
  momentumScore?: number | null;
  riskLevel?: string | null;
}) {
  const text = `${input.title} ${input.summary} ${input.category}`.toLowerCase();
  const strategic =
    includesAny(text, ['funding', 'merger', 'acquisition', 'market', 'competitor', 'policy', 'regulation']) ||
    input.category === 'funding' ||
    input.category === 'competitor' ||
    input.category === 'investor_activity';
  const operational =
    includesAny(text, ['hiring', 'labor', 'cloud', 'security', 'supply', 'logistics', 'compliance']) ||
    ['hiring', 'labor', 'cloud', 'cybersecurity', 'supply_chain', 'logistics', 'compliance'].includes(input.category);
  const risk = input.impactType === 'risk' || includesAny(text, ['risk', 'decline', 'ban', 'breach', 'shortage', 'tariff']);
  const opportunity = input.impactType === 'opportunity' || includesAny(text, ['growth', 'funding', 'expansion', 'demand', 'launch']);
  return {
    strategic_operational_class: strategic && operational ? 'mixed' : strategic ? 'strategic' : 'operational' as 'strategic' | 'operational' | 'mixed',
    opportunity_risk_class: risk && opportunity ? 'mixed' : risk ? 'risk' : opportunity ? 'opportunity' : 'mixed' as 'opportunity' | 'risk' | 'mixed',
    time_horizon_class: includesAny(text, ['policy', 'regulation', 'investment', 'long-term', 'multi-year']) ? 'long_term' : 'immediate' as 'immediate' | 'long_term',
    relevance_scope_class: includesAny(text, ['your', 'sector', 'industry', 'region']) ? 'direct' : 'indirect' as 'direct' | 'indirect',
    locality_class: (input.regions?.length ?? 0) === 1 ? 'local' : (input.regions?.length ?? 0) > 1 ? 'regional' : 'global' as 'local' | 'regional' | 'global',
  };
}

export function buildSignalFromFinding(input: {
  title: string;
  summary: string;
  category: string;
  regions: string[];
  impactType: 'opportunity' | 'risk' | 'watch';
  confidenceScore?: number | null;
  freshnessScore?: number | null;
  momentumScore?: number | null;
  canonicalEventKey?: string | null;
  sourceName?: string | null;
}) {
  const signalCategory = normalizeCategory(input.category);
  const text = `${input.title} ${input.summary} ${signalCategory}`;
  const affectedDomains = unique([
    includesAny(text, ['cloud', 'platform', 'ai', 'technology']) ? 'technology' : null,
    includesAny(text, ['hiring', 'labor', 'visa', 'talent']) ? 'workforce' : null,
    includesAny(text, ['regulation', 'policy', 'compliance']) ? 'compliance' : null,
    includesAny(text, ['logistics', 'supply', 'export', 'import']) ? 'supply_chain' : null,
    includesAny(text, ['funding', 'demand', 'customer']) ? 'revenue' : null,
  ]);
  const affectedFunctions = unique([
    affectedDomains.includes('workforce') ? 'people' : null,
    affectedDomains.includes('technology') ? 'engineering' : null,
    affectedDomains.includes('compliance') ? 'legal' : null,
    affectedDomains.includes('supply_chain') ? 'operations' : null,
    affectedDomains.includes('revenue') ? 'go_to_market' : null,
  ]);
  const urgency = input.impactType === 'risk'
    ? 'high'
    : (input.momentumScore ?? 0) > 0.7
      ? 'high'
      : 'medium';
  const classification = classifySignal({
    title: input.title,
    summary: input.summary,
    category: signalCategory,
    impactType: input.impactType,
    regions: input.regions,
    momentumScore: input.momentumScore,
  });
  const signal: MarketPulseSignal = {
    signal_type: input.category,
    signal_category: signalCategory,
    title: input.title,
    summary: input.summary,
    source_name: input.sourceName ?? 'Market Pulse scan',
    source_type: 'system',
    source_credibility: 65,
    geography: input.regions[0] ?? 'Global',
    industries: [],
    affected_domains: affectedDomains,
    affected_functions: affectedFunctions,
    tags: unique([signalCategory, ...affectedDomains, ...input.regions]),
    published_at: new Date().toISOString(),
    freshness_score: input.freshnessScore ?? 75,
    urgency_level: urgency,
    novelty_score: input.canonicalEventKey ? 65 : 50,
    confidence_score: input.confidenceScore ?? 55,
    causality_summary: input.summary,
    duplicate_key: input.canonicalEventKey ? slugify(`${input.canonicalEventKey}-${input.title}`) : slugify(`${input.title}-${input.summary}`),
    conflict_group_key: slugify(`${signalCategory}-${input.regions.join('-') || 'global'}`),
    weak_signal: (input.confidenceScore ?? 55) < 45,
    ...classification,
  };
  const direction = input.impactType === 'risk' ? 'negative' : input.impactType === 'opportunity' ? 'positive' : 'mixed';
  const impacts: MarketPulseSignalImpact[] = affectedDomains.length > 0
    ? affectedDomains.map((domain) => ({
        impact_type: domain === 'supply_chain' ? 'supply_chain' : domain as MarketPulseSignalImpact['impact_type'],
        impact_direction: direction,
        severity: input.impactType === 'risk' ? 72 : 58,
        confidence: input.confidenceScore ?? 55,
        rationale: `${domain.replace(/_/g, ' ')} is affected because the signal references ${input.summary || input.title}.`,
      }))
    : [{
        impact_type: 'strategy',
        impact_direction: direction,
        severity: 45,
        confidence: input.confidenceScore ?? 55,
        rationale: 'General strategic market movement without a more specific affected domain.',
      }];
  return { signal, impacts };
}

async function loadPersonalization(companyId: string): Promise<MarketPulsePersonalizationControls> {
  const result = await ownedDbTable('marketpulse_personalization_controls')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  const row = result.data as Partial<MarketPulsePersonalizationControls> | null;
  return {
    follow_topics: row?.follow_topics ?? [],
    mute_topics: row?.mute_topics ?? [],
    prioritize_categories: row?.prioritize_categories ?? [],
    follow_competitors: row?.follow_competitors ?? [],
    follow_regions: row?.follow_regions ?? [],
    reduce_operational_noise: Boolean(row?.reduce_operational_noise),
    increase_strategic_alerts: Boolean(row?.increase_strategic_alerts),
  };
}

export async function saveMarketPulsePersonalizationControls(
  companyId: string,
  input: Partial<MarketPulsePersonalizationControls>,
  actorUserId?: string | null,
) {
  const row = {
    company_id: companyId,
    follow_topics: input.follow_topics ?? [],
    mute_topics: input.mute_topics ?? [],
    prioritize_categories: input.prioritize_categories ?? [],
    follow_competitors: input.follow_competitors ?? [],
    follow_regions: input.follow_regions ?? [],
    reduce_operational_noise: Boolean(input.reduce_operational_noise),
    increase_strategic_alerts: Boolean(input.increase_strategic_alerts),
    updated_by: actorUserId ?? null,
  };
  const result = await ownedDbTable('marketpulse_personalization_controls')
    .upsert(row, { onConflict: 'company_id' })
    .select('*')
    .single();
  if (result.error) throw new Error(`Failed to save MarketPulse controls: ${result.error.message}`);
  return result.data;
}

function scoreCompanyRelevance(params: {
  signal: MarketPulseSignal;
  impacts: MarketPulseSignalImpact[];
  intelligence: CompanyContextIntelligence | null;
  quality: CompanyContextQualityMetadata;
  profile?: CompanyProfileLike | null;
  personalization: MarketPulsePersonalizationControls;
}): RelevanceResult {
  const { signal, impacts, intelligence, quality, profile, personalization } = params;
  const signalText = `${signal.title} ${signal.summary} ${(signal.tags ?? []).join(' ')} ${signal.signal_category}`.toLowerCase();
  const reasons: string[] = [];

  const revenueMatches = intelligence?.revenue_segments.filter((segment) =>
    includesAny(signalText, [
      segment.customer_industry ?? '',
      segment.customer_industry_key ?? '',
      segment.customer_segment ?? '',
      segment.customer_segment_key ?? '',
    ].filter(Boolean))
  ) ?? [];
  const geoMatches = intelligence?.geographic_exposures.filter((geo) =>
    includesAny(signalText, [geo.geography ?? '', geo.geography_key ?? '', signal.geography ?? ''].filter(Boolean))
  ) ?? [];
  const depMatches = intelligence?.dependencies.filter((dep) =>
    includesAny(signalText, [dep.dependency_type ?? '', dep.dependency_type_key ?? '', dep.dependency_name ?? '', dep.operational_sensitivity_key ?? ''].filter(Boolean))
  ) ?? [];
  const techMatches = intelligence?.technology_dependencies.filter((dep) =>
    includesAny(signalText, [dep.provider_category ?? '', dep.provider_category_key ?? '', dep.provider_name ?? ''].filter(Boolean))
  ) ?? [];
  const regulatoryMatches = intelligence?.regulatory_exposures.filter((reg) =>
    includesAny(signalText, [reg.regulation_type ?? '', reg.regulation_type_key ?? '', reg.jurisdiction ?? '', reg.jurisdiction_key ?? ''].filter(Boolean))
  ) ?? [];
  const workforce = intelligence?.workforce_profile ?? null;
  const workforceMatch = Boolean(workforce && (
    ['hiring', 'labor'].includes(signal.signal_category) ||
    includesAny(signalText, ['visa', 'immigration', 'labor', 'hiring', 'workforce', ...(workforce.hiring_markets ?? [])])
  ));

  let exposureScore = revenueMatches.length ? 70 : 0;
  if (revenueMatches.some((row) => ['high', 'critical'].includes(String(row.strategic_priority_key || row.strategic_priority)))) exposureScore += 15;
  const geographyScore = geoMatches.length ? Math.min(90, 45 + geoMatches.length * 15) : includesAny(signalText, profile?.geography_list ?? []) ? 45 : 0;
  const dependencyScore = Math.min(100, depMatches.length * 28 + techMatches.length * 30);
  const workforceScore = workforceMatch ? 65 : 0;
  const regulatoryScore = regulatoryMatches.length ? 75 : ['regulation', 'compliance', 'public_policy', 'taxation'].includes(signal.signal_category) ? 30 : 0;
  let strategicPriorityScore = impacts.some((impact) => impact.impact_type === 'strategy' || impact.impact_type === 'revenue') ? 40 : 0;
  if (includesAny(signalText, profile?.growth_priorities ? [profile.growth_priorities] : [])) strategicPriorityScore += 25;

  if (revenueMatches.length) reasons.push(`${revenueMatches.length} revenue/customer exposure match`);
  if (geoMatches.length) reasons.push(`${geoMatches.length} geography exposure match`);
  if (depMatches.length || techMatches.length) reasons.push(`${depMatches.length + techMatches.length} dependency match`);
  if (workforceMatch) reasons.push('workforce sensitivity matched');
  if (regulatoryMatches.length) reasons.push('regulatory exposure matched');

  const reliabilityMultiplier = quality.context_reliability_score < 45 ? 0.78 : quality.context_reliability_score < 65 ? 0.9 : 1;
  const densityBoost = quality.intelligence_density_score < 45 ? 8 : 0;
  const urgency = signal.urgency_level === 'critical' ? 18 : signal.urgency_level === 'high' ? 12 : signal.urgency_level === 'medium' ? 6 : 0;
  const novelty = (signal.novelty_score ?? 50) * 0.08;
  const sourceConfidence = ((signal.confidence_score ?? 50) + (signal.source_credibility ?? 50)) / 2;
  const personalizationBoost =
    personalization.prioritize_categories.includes(signal.signal_category) ? 12 :
      personalization.follow_topics.some((topic) => includesAny(signalText, [topic])) ? 10 :
        personalization.follow_regions.some((region) => includesAny(signalText, [region])) ? 8 :
          0;
  const muted = personalization.mute_topics.some((topic) => includesAny(signalText, [topic]));
  const operationalPenalty = personalization.reduce_operational_noise && signal.strategic_operational_class === 'operational' ? 12 : 0;
  const strategicBoost = personalization.increase_strategic_alerts && signal.strategic_operational_class !== 'operational' ? 8 : 0;

  const base =
    exposureScore * 0.18 +
    dependencyScore * 0.2 +
    geographyScore * 0.17 +
    workforceScore * 0.12 +
    regulatoryScore * 0.16 +
    strategicPriorityScore * 0.1 +
    sourceConfidence * 0.07 +
    urgency +
    novelty +
    densityBoost +
    personalizationBoost +
    strategicBoost -
    operationalPenalty -
    (muted ? 35 : 0);

  const degraded = quality.degraded_context || quality.context_reliability_score < 45 || quality.intelligence_density_score < 35;
  const degradationReasons = unique([
    ...quality.degradation_reasons,
    quality.context_reliability_score < 45 ? 'confidence_amplification_reduced' : null,
    quality.intelligence_density_score < 35 ? 'sparse_context_widened_cautiously' : null,
    muted ? 'muted_by_personalization' : null,
  ]);
  const relevanceScore = clamp(base * reliabilityMultiplier);
  const confidenceScore = clamp(sourceConfidence * reliabilityMultiplier - (signal.weak_signal ? 15 : 0));
  const digestTypes = unique([
    signal.strategic_operational_class !== 'operational' ? 'executive' : null,
    signal.strategic_operational_class !== 'strategic' ? 'operational' : null,
    ['funding', 'investor_activity', 'mergers_acquisitions'].includes(signal.signal_category) ? 'funding' : null,
    ['regulation', 'compliance', 'taxation', 'public_policy'].includes(signal.signal_category) ? 'regulation' : null,
    ['hiring', 'labor'].includes(signal.signal_category) ? 'hiring' : null,
  ]);

  return {
    relevance_score: relevanceScore,
    exposure_score: clamp(exposureScore),
    dependency_score: clamp(dependencyScore),
    geography_score: clamp(geographyScore),
    workforce_score: clamp(workforceScore),
    regulatory_score: clamp(regulatoryScore),
    strategic_priority_score: clamp(strategicPriorityScore),
    confidence_score: confidenceScore,
    degraded_context: degraded,
    degradation_reasons: degradationReasons,
    explanation_summary: reasons.length
      ? `Relevant because ${reasons.join(', ')}.`
      : degraded
        ? 'Context is sparse, so relevance is widened cautiously and confidence is reduced.'
        : 'General market signal with indirect relevance.',
    explanation_payload: {
      reasons,
      matched_context: {
        revenue_segments: revenueMatches.map((row) => ({ customer_industry: row.customer_industry, segment: row.customer_segment, geography: row.geography })),
        geographies: geoMatches.map((row) => ({ geography: row.geography, type: row.exposure_type, criticality: row.criticality })),
        dependencies: [...depMatches, ...techMatches].map((row: any) => ({ type: row.dependency_type ?? row.provider_category, name: row.dependency_name ?? row.provider_name, criticality: row.criticality })),
        regulatory: regulatoryMatches.map((row) => ({ jurisdiction: row.jurisdiction, regulation_type: row.regulation_type, severity: row.severity })),
        workforce: workforceMatch ? { labor_sensitivity_level: workforce?.labor_sensitivity_level, hiring_markets: workforce?.hiring_markets } : null,
      },
      signal_classification: {
        strategic_operational_class: signal.strategic_operational_class,
        opportunity_risk_class: signal.opportunity_risk_class,
        time_horizon_class: signal.time_horizon_class,
        relevance_scope_class: signal.relevance_scope_class,
        locality_class: signal.locality_class,
      },
      quality,
    },
    digest_types: digestTypes.length ? digestTypes : ['custom'],
  };
}

export async function persistMarketPulseSignalForCompany(params: {
  companyId: string;
  signal: MarketPulseSignal;
  impacts: MarketPulseSignalImpact[];
  profile?: CompanyProfileLike | null;
}) {
  const insertSignal = await ownedDbTable('marketpulse_signals')
    .upsert(params.signal, { onConflict: 'duplicate_key' })
    .select('*')
    .single();
  if (insertSignal.error || !insertSignal.data) {
    throw new Error(insertSignal.error?.message || 'Failed to persist MarketPulse signal');
  }
  const signal = insertSignal.data as MarketPulseSignal & { id: string };

  const existingImpacts = await ownedDbTable('marketpulse_signal_impacts').select('id').eq('signal_id', signal.id).limit(1);
  if (!existingImpacts.data?.length && params.impacts.length > 0) {
    const impactResult = await ownedDbTable('marketpulse_signal_impacts').insert(
      params.impacts.map((impact) => ({ ...impact, signal_id: signal.id }))
    );
    if (impactResult.error) throw new Error(`Failed to persist MarketPulse impacts: ${impactResult.error.message}`);
  }

  const [intelligence, personalization] = await Promise.all([
    getCompanyContextIntelligence(params.companyId).catch(() => null),
    loadPersonalization(params.companyId).catch(() => ({
      follow_topics: [],
      mute_topics: [],
      prioritize_categories: [],
      follow_competitors: [],
      follow_regions: [],
      reduce_operational_noise: false,
      increase_strategic_alerts: false,
    })),
  ]);
  const quality = calculateContextQualityMetadata(intelligence);
  const relevance = scoreCompanyRelevance({
    signal,
    impacts: params.impacts,
    intelligence,
    quality,
    profile: params.profile,
    personalization,
  });

  const relevanceResult = await ownedDbTable('marketpulse_company_signal_relevance')
    .upsert({
      company_id: params.companyId,
      signal_id: signal.id,
      ...relevance,
    }, { onConflict: 'company_id,signal_id' })
    .select('*')
    .single();
  if (relevanceResult.error) throw new Error(`Failed to persist MarketPulse relevance: ${relevanceResult.error.message}`);
  return { signal, impacts: params.impacts, relevance: relevanceResult.data };
}

export async function getAdaptiveMarketPulseFeed(companyId: string, digestType: string = 'executive') {
  const rows = await ownedDbTable('marketpulse_company_signal_relevance')
    .select('*, marketpulse_signals(*), marketpulse_signal_impacts(*)')
    .eq('company_id', companyId)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  if (rows.error) throw new Error(`Failed to load adaptive MarketPulse feed: ${rows.error.message}`);
  const seen = new Set<string>();
  return (rows.data ?? [])
    .filter((row: any) => {
      const signal = row.marketpulse_signals;
      if (!signal) return false;
      if (digestType !== 'all' && Array.isArray(row.digest_types) && row.digest_types.length > 0 && !row.digest_types.includes(digestType)) return false;
      if ((signal.freshness_score ?? 0) < 20) return false;
      const key = signal.duplicate_key ?? signal.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}
