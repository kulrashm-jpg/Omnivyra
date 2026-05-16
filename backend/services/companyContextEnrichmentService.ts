import { ownedDbTable } from '../db/writeOwner';
import {
  calculateIntelligenceReadiness,
  getCompanyContextIntelligence,
  saveCompanyContextIntelligence,
  type CompanyContextIntelligence,
  type CompanyDependency,
  type CompanyGeographicExposure,
  type CompanyProfileLike,
  type CompanyRegulatoryExposure,
  type CompanyTechnologyDependency,
  type CompanyWorkforceProfile,
  type IntelligenceMetadata,
} from './companyContextIntelligenceService';
import { normalizeTaxonomyKey } from './companyContextTaxonomy';
import { resolveConfidence, resolveEntityState, type EntityState } from './companyContextGovernance';

export type InferenceStrength = 'weak' | 'strong' | 'conflicting';
export type EnrichmentSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'modified' | 'snoozed' | 'expired';
export type EnrichmentTargetSection =
  | 'revenue_segments'
  | 'geographic_exposures'
  | 'dependencies'
  | 'regulatory_exposures'
  | 'workforce_profile'
  | 'technology_dependencies';

export type SourceSignal = {
  field: string;
  value: unknown;
  weight: number;
};

export type CompanyContextQualityMetadata = {
  intelligence_density_score: number;
  context_reliability_score: number;
  inference_coverage_score: number;
  stale_context_score: number;
  degraded_context: boolean;
  degradation_reasons: string[];
};

export type CompanyContextEnrichmentSuggestion = {
  id?: string;
  company_id?: string;
  run_id?: string | null;
  target_section: EnrichmentTargetSection;
  target_entity_type: string;
  suggestion_type: 'add_entity' | 'update_entity' | 'confirm_entity' | 'ask_user';
  payload: Record<string, unknown>;
  confidence: number;
  inference_strength: InferenceStrength;
  inference_reason: string;
  source_signals: SourceSignal[];
  impact_score: number;
  readiness_impact_estimate: number;
  status?: EnrichmentSuggestionStatus;
  review_note?: string | null;
  reviewed_at?: string | null;
  snoozed_until?: string | null;
  created_at?: string;
  updated_at?: string;
};

type EnrichmentInput = {
  companyId: string;
  profile?: CompanyProfileLike | null;
  actorUserId?: string | null;
  persist?: boolean;
};

const SECTION_WEIGHTS: Record<EnrichmentTargetSection, number> = {
  revenue_segments: 24,
  geographic_exposures: 22,
  dependencies: 20,
  workforce_profile: 14,
  regulatory_exposures: 12,
  technology_dependencies: 18,
};

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.join(' ');
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function profileText(profile?: CompanyProfileLike | null): string {
  return [
    profile?.name,
    profile?.industry,
    profile?.category,
    profile?.products_services,
    profile?.target_audience,
    profile?.geography,
    profile?.goals,
    profile?.growth_priorities,
    profile?.unique_value,
    profile?.industry_list,
    profile?.category_list,
    profile?.products_services_list,
    profile?.target_audience_list,
    profile?.geography_list,
    profile?.report_settings?.market_pulse,
  ].map(textOf).join(' ').toLowerCase();
}

function listFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreStrength(confidence: number, conflicting = false): InferenceStrength {
  if (conflicting) return 'conflicting';
  return confidence >= 0.72 ? 'strong' : 'weak';
}

function inferredMetadata(params: {
  inferredBy: string;
  reason: string;
  signals: SourceSignal[];
  confidence: number;
  strength?: InferenceStrength;
}): IntelligenceMetadata {
  return {
    source: 'ai_inferred',
    review_status: 'inferred',
    entity_state: params.confidence < 0.4 ? 'low_confidence' : 'inferred',
    user_confirmed: false,
    confidence: params.confidence,
    inferred_by: params.inferredBy,
    inference_reason: params.reason,
    source_signals: params.signals,
    inference_strength: params.strength ?? scoreStrength(params.confidence),
    enrichment_provenance: {
      pipeline: 'company_context_profile_inference',
      generated_at: new Date().toISOString(),
    },
  };
}

function hasUserConfirmedEntity(rows: Array<IntelligenceMetadata> | null | undefined, predicate: (row: any) => boolean): boolean {
  return Boolean(rows?.some((row) => row.user_confirmed && predicate(row)));
}

function hasEntity(rows: Array<Record<string, unknown>> | null | undefined, predicate: (row: Record<string, unknown>) => boolean): boolean {
  return Boolean(rows?.some(predicate));
}

function suggestion(params: Omit<CompanyContextEnrichmentSuggestion, 'suggestion_type' | 'status'> & {
  suggestion_type?: CompanyContextEnrichmentSuggestion['suggestion_type'];
}): CompanyContextEnrichmentSuggestion {
  return {
    suggestion_type: params.suggestion_type ?? 'add_entity',
    status: 'pending',
    ...params,
  };
}

function buildProfileInferences(
  profile: CompanyProfileLike | null | undefined,
  context: CompanyContextIntelligence,
): CompanyContextEnrichmentSuggestion[] {
  const text = profileText(profile);
  const suggestions: CompanyContextEnrichmentSuggestion[] = [];
  const industries = listFrom(profile?.industry_list?.length ? profile?.industry_list : profile?.industry);
  const geographies = listFrom(profile?.geography_list?.length ? profile?.geography_list : profile?.geography);
  const audience = listFrom(profile?.target_audience_list?.length ? profile?.target_audience_list : profile?.target_audience);
  const products = listFrom(profile?.products_services_list?.length ? profile?.products_services_list : profile?.products_services);

  for (const geo of geographies.slice(0, 3)) {
    const geoKey = normalizeTaxonomyKey('geography', geo);
    if (!geoKey || hasEntity(context.geographic_exposures as any, (row) => row.geography_key === geoKey && row.exposure_type === 'customers')) continue;
    const confidence = geoKey === 'unknown' ? 0.45 : 0.68;
    const signals = [{ field: 'profile.geography', value: geo, weight: 0.8 }];
    const reason = `Profile geography includes ${geo}, but customer/market exposure is not captured as structured intelligence.`;
    suggestions.push(suggestion({
      target_section: 'geographic_exposures',
      target_entity_type: 'company_geographic_exposure',
      payload: {
        geography: geo,
        geography_key: geoKey,
        exposure_type: 'customers',
        exposure_type_key: 'customers',
        criticality: 'medium',
        criticality_key: 'medium',
        ...inferredMetadata({ inferredBy: 'profile_geography_inference_v1', reason, signals, confidence }),
      },
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.geographic_exposures,
      readiness_impact_estimate: context.geographic_exposures.length === 0 ? 22 : 8,
    }));
  }

  if (audience.length > 0 && context.revenue_segments.length === 0) {
    const segment = audience[0];
    const industry = industries[0] || profile?.industry || 'Unknown';
    const confidence = industries.length > 0 ? 0.63 : 0.48;
    const signals = [
      { field: 'profile.target_audience', value: segment, weight: 0.7 },
      { field: 'profile.industry', value: industry, weight: 0.45 },
    ];
    const reason = `Target audience suggests a possible revenue segment, but revenue dependency is missing.`;
    suggestions.push(suggestion({
      target_section: 'revenue_segments',
      target_entity_type: 'company_revenue_segment',
      payload: {
        customer_industry: industry,
        customer_industry_key: normalizeTaxonomyKey('customer_industry', industry),
        customer_segment: segment,
        customer_segment_key: normalizeTaxonomyKey('customer_segment', segment),
        geography: geographies[0] || null,
        geography_key: normalizeTaxonomyKey('geography', geographies[0]),
        strategic_priority: 'high',
        strategic_priority_key: 'high',
        notes: 'Inferred from profile target audience. Confirm revenue dependency before downstream use.',
        ...inferredMetadata({ inferredBy: 'profile_revenue_segment_inference_v1', reason, signals, confidence }),
      },
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.revenue_segments,
      readiness_impact_estimate: 24,
    }));
  }

  const isSaasOrAi = /\b(saas|software|ai|artificial intelligence|machine learning|app|platform)\b/.test(text);
  if (
    isSaasOrAi &&
    hasUserConfirmedEntity(context.dependencies, (row) =>
      row.dependency_type_key === 'cloud' && ['none', 'low'].includes(String(row.criticality_key || row.criticality || ''))
    )
  ) {
    const confidence = 0.66;
    const signals = [
      { field: 'profile.products_services', value: products.slice(0, 3), weight: 0.7 },
      { field: 'confirmed_context.dependencies', value: 'cloud low/none', weight: 0.8 },
    ];
    const reason = `Software/AI profile signals conflict with a user-confirmed low cloud dependency.`;
    suggestions.push(suggestion({
      target_section: 'dependencies',
      target_entity_type: 'company_dependency',
      suggestion_type: 'confirm_entity',
      payload: {
        review_target: 'cloud_dependency_criticality',
        suggested_question: 'Confirm whether cloud infrastructure is truly low criticality for this software/AI business.',
        ...inferredMetadata({ inferredBy: 'cloud_dependency_conflict_inference_v1', reason, signals, confidence, strength: 'conflicting' }),
      },
      confidence,
      inference_strength: 'conflicting',
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.dependencies,
      readiness_impact_estimate: 6,
    }));
  } else if (isSaasOrAi && !hasUserConfirmedEntity(context.dependencies, (row) => row.dependency_type_key === 'cloud')) {
    const confidence = /\b(saas|software platform|cloud|ai)\b/.test(text) ? 0.76 : 0.58;
    const signals = [
      { field: 'profile.products_services', value: products.slice(0, 3), weight: 0.7 },
      { field: 'profile.industry', value: industries, weight: 0.5 },
    ];
    const reason = `Software/AI profile signals commonly imply cloud or platform infrastructure dependency.`;
    suggestions.push(suggestion({
      target_section: 'dependencies',
      target_entity_type: 'company_dependency',
      payload: {
        dependency_type: 'cloud',
        dependency_type_key: 'cloud',
        dependency_name: 'Cloud infrastructure',
        criticality: confidence >= 0.72 ? 'high' : 'medium',
        criticality_key: confidence >= 0.72 ? 'high' : 'medium',
        operational_sensitivity: 'high',
        operational_sensitivity_key: 'high',
        notes: 'Inferred dependency. Confirm actual providers before treating as authoritative.',
        ...inferredMetadata({ inferredBy: 'cloud_dependency_inference_v1', reason, signals, confidence }),
      } as CompanyDependency,
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.dependencies,
      readiness_impact_estimate: context.dependencies.length === 0 ? 20 : 7,
    }));

    if (!hasUserConfirmedEntity(context.technology_dependencies, (row) => row.provider_category_key === 'cloud_infrastructure')) {
      suggestions.push(suggestion({
        target_section: 'technology_dependencies',
        target_entity_type: 'company_technology_dependency',
        payload: {
          provider_name: 'Unknown cloud provider',
          provider_category: 'Cloud infrastructure',
          provider_category_key: 'cloud_infrastructure',
          criticality: confidence >= 0.72 ? 'high' : 'medium',
          criticality_key: confidence >= 0.72 ? 'high' : 'medium',
          spend_sensitivity: 'medium',
          spend_sensitivity_key: 'medium',
          operational_dependency: 'Likely infrastructure dependency inferred from software/AI profile.',
          ...inferredMetadata({ inferredBy: 'technology_dependency_inference_v1', reason, signals, confidence: Math.max(0.52, confidence - 0.08) }),
        } as CompanyTechnologyDependency,
        confidence: Math.max(0.52, confidence - 0.08),
        inference_strength: scoreStrength(Math.max(0.52, confidence - 0.08)),
        inference_reason: reason,
        source_signals: signals,
        impact_score: SECTION_WEIGHTS.technology_dependencies,
        readiness_impact_estimate: context.technology_dependencies.length === 0 ? 18 : 6,
      }));
    }
  }

  if (/\b(ai|llm|gpu|model|machine learning)\b/.test(text) && !hasUserConfirmedEntity(context.technology_dependencies, (row) => row.provider_category_key === 'ai_model_provider')) {
    const confidence = 0.7;
    const signals = [{ field: 'profile.products_services', value: products, weight: 0.75 }];
    const reason = `AI-oriented product/service language suggests AI model, GPU, or inference infrastructure exposure.`;
    suggestions.push(suggestion({
      target_section: 'technology_dependencies',
      target_entity_type: 'company_technology_dependency',
      payload: {
        provider_name: 'AI/GPU infrastructure',
        provider_category: 'AI model provider',
        provider_category_key: 'ai_model_provider',
        criticality: 'high',
        criticality_key: 'high',
        spend_sensitivity: 'high',
        spend_sensitivity_key: 'high',
        operational_dependency: 'Likely AI model or GPU dependency inferred from profile.',
        ...inferredMetadata({ inferredBy: 'ai_dependency_inference_v1', reason, signals, confidence }),
      } as CompanyTechnologyDependency,
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.technology_dependencies,
      readiness_impact_estimate: context.technology_dependencies.length === 0 ? 18 : 8,
    }));
  }

  if (/\b(it services|consulting|agency|outsourcing|professional services)\b/.test(text) && /\b(us|usa|united states)\b/.test(text)) {
    const confidence = 0.57;
    const signals = [
      { field: 'profile.industry/category', value: `${profile?.industry || ''} ${profile?.category || ''}`, weight: 0.55 },
      { field: 'profile.geography', value: geographies, weight: 0.45 },
    ];
    const reason = `Services profile with US market signals can imply hiring, contractor, or immigration sensitivity.`;
    if (!context.workforce_profile?.user_confirmed) {
      suggestions.push(suggestion({
        target_section: 'workforce_profile',
        target_entity_type: 'company_workforce_profile',
        payload: {
          workforce_model: 'Unknown',
          workforce_model_key: 'unknown',
          hiring_markets: geographies,
          contractor_dependency_level: 'medium',
          contractor_dependency_level_key: 'medium',
          immigration_dependency_level: 'medium',
          immigration_dependency_level_key: 'medium',
          labor_sensitivity_level: 'medium',
          labor_sensitivity_level_key: 'medium',
          remote_dependency_level: 'unknown',
          remote_dependency_level_key: 'unknown',
          ...inferredMetadata({ inferredBy: 'services_workforce_inference_v1', reason, signals, confidence }),
        } as CompanyWorkforceProfile,
        confidence,
        inference_strength: scoreStrength(confidence),
        inference_reason: reason,
        source_signals: signals,
        impact_score: SECTION_WEIGHTS.workforce_profile,
        readiness_impact_estimate: context.workforce_profile ? 5 : 14,
      }));
    }
  }

  if (/\b(manufactur|export|import|supply chain|logistics|retail|commerce)\b/.test(text) && !hasUserConfirmedEntity(context.dependencies, (row) => row.dependency_type_key === 'logistics')) {
    const confidence = /\b(manufactur|export|import|supply chain)\b/.test(text) ? 0.74 : 0.54;
    const signals = [{ field: 'profile.business_context', value: text.slice(0, 220), weight: 0.7 }];
    const reason = `Manufacturing/export/import/commerce signals suggest logistics or supply-chain sensitivity.`;
    suggestions.push(suggestion({
      target_section: 'dependencies',
      target_entity_type: 'company_dependency',
      payload: {
        dependency_type: 'logistics',
        dependency_type_key: 'logistics',
        dependency_name: 'Logistics / supply chain',
        criticality: confidence >= 0.72 ? 'high' : 'medium',
        criticality_key: confidence >= 0.72 ? 'high' : 'medium',
        operational_sensitivity: 'high',
        operational_sensitivity_key: 'high',
        ...inferredMetadata({ inferredBy: 'supply_chain_dependency_inference_v1', reason, signals, confidence }),
      } as CompanyDependency,
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.dependencies,
      readiness_impact_estimate: context.dependencies.length === 0 ? 20 : 8,
    }));
  }

  if (/\b(fintech|financial|payments|banking|lending|insurance)\b/.test(text) && !hasUserConfirmedEntity(context.regulatory_exposures, (row) => row.regulation_type_key === 'financial_compliance')) {
    const india = /\b(india|rbi)\b/.test(text);
    const confidence = india ? 0.78 : 0.68;
    const signals = [
      { field: 'profile.industry', value: industries, weight: 0.65 },
      { field: 'profile.geography', value: geographies, weight: 0.35 },
    ];
    const reason = india
      ? 'FinTech profile with India signals suggests RBI/financial compliance exposure.'
      : 'Financial-services profile suggests financial compliance exposure.';
    suggestions.push(suggestion({
      target_section: 'regulatory_exposures',
      target_entity_type: 'company_regulatory_exposure',
      payload: {
        jurisdiction: india ? 'India' : geographies[0] || 'Unknown',
        jurisdiction_key: normalizeTaxonomyKey('geography', india ? 'India' : geographies[0]),
        regulation_type: 'Financial compliance',
        regulation_type_key: 'financial_compliance',
        applicability: 'Likely applicable; confirm products, licenses, and operating jurisdictions.',
        severity: 'high',
        severity_key: 'high',
        ...inferredMetadata({ inferredBy: 'financial_regulatory_inference_v1', reason, signals, confidence }),
      } as CompanyRegulatoryExposure,
      confidence,
      inference_strength: scoreStrength(confidence),
      inference_reason: reason,
      source_signals: signals,
      impact_score: SECTION_WEIGHTS.regulatory_exposures,
      readiness_impact_estimate: context.regulatory_exposures.length === 0 ? 12 : 6,
    }));
  }

  return suggestions
    .sort((a, b) => (b.impact_score + b.readiness_impact_estimate + b.confidence * 10) - (a.impact_score + a.readiness_impact_estimate + a.confidence * 10))
    .slice(0, 6);
}

export function calculateContextQualityMetadata(intelligence: CompanyContextIntelligence | null): CompanyContextQualityMetadata {
  const sections: EnrichmentTargetSection[] = [
    'revenue_segments',
    'geographic_exposures',
    'dependencies',
    'workforce_profile',
    'regulatory_exposures',
    'technology_dependencies',
  ];
  const rows = [
    ...(intelligence?.revenue_segments ?? []),
    ...(intelligence?.geographic_exposures ?? []),
    ...(intelligence?.dependencies ?? []),
    ...(intelligence?.regulatory_exposures ?? []),
    ...(intelligence?.technology_dependencies ?? []),
    ...(intelligence?.workforce_profile ? [intelligence.workforce_profile] : []),
  ];
  const populated = sections.filter((section) => {
    const value = intelligence?.[section];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }).length;
  const density = Math.round((populated / sections.length) * 100);
  const confidences = rows.map(resolveConfidence).filter((value): value is number => value != null);
  const confirmed = rows.filter((row) => row.user_confirmed).length;
  const inferred = rows.filter((row) => row.source === 'ai_inferred' || row.entity_state === 'inferred').length;
  const stale = rows.filter((row) => resolveEntityState(row) === 'stale').length;
  const conflicting = rows.filter((row) => resolveEntityState(row) === 'conflicting').length;
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  const reliability = Math.round(Math.max(0, Math.min(100,
    avgConfidence * 55 +
      (rows.length ? (confirmed / rows.length) * 35 : 0) -
      (conflicting * 12) -
      (stale * 8)
  )));
  const inferenceCoverage = Math.round(rows.length ? (inferred / rows.length) * 100 : 0);
  const staleScore = Math.round(rows.length ? (stale / rows.length) * 100 : 0);
  const degradationReasons = [
    density < 45 ? 'low_density' : null,
    reliability < 45 ? 'low_reliability' : null,
    conflicting > 0 ? 'conflicting_context' : null,
    staleScore > 30 ? 'stale_context' : null,
  ].filter((item): item is string => Boolean(item));
  return {
    intelligence_density_score: density,
    context_reliability_score: reliability,
    inference_coverage_score: inferenceCoverage,
    stale_context_score: staleScore,
    degraded_context: degradationReasons.length > 0,
    degradation_reasons: degradationReasons,
  };
}

export async function runCompanyContextEnrichment(input: EnrichmentInput) {
  const context = await getCompanyContextIntelligence(input.companyId, { useCache: false });
  const suggestions = buildProfileInferences(input.profile, context);
  const quality = calculateContextQualityMetadata(context);
  const readiness = calculateIntelligenceReadiness({ intelligence: context, profile: input.profile });

  if (!input.persist) {
    return { context, suggestions, quality, readiness, run: null };
  }

  const existingSuggestions = await getCompanyContextEnrichmentSuggestions(input.companyId).catch(() => []);
  const existingKeys = new Set(existingSuggestions.map((item) => `${item.target_section}:${item.inference_reason}`));
  const newSuggestions = suggestions.filter((item) => !existingKeys.has(`${item.target_section}:${item.inference_reason}`));

  const runResult = await ownedDbTable('company_context_enrichment_runs')
    .insert({
      company_id: input.companyId,
      run_type: 'profile_inference',
      status: 'completed',
      source: 'system',
      input_profile: input.profile ?? null,
      quality_payload: quality,
      suggestions_count: newSuggestions.length,
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single();
  if (runResult.error) throw new Error(`Failed to create enrichment run: ${runResult.error.message}`);

  const rows = newSuggestions.map((item) => ({
    company_id: input.companyId,
    run_id: runResult.data.id,
    target_section: item.target_section,
    target_entity_type: item.target_entity_type,
    suggestion_type: item.suggestion_type,
    payload: item.payload,
    confidence: item.confidence,
    inference_strength: item.inference_strength,
    inference_reason: item.inference_reason,
    source_signals: item.source_signals,
    impact_score: item.impact_score,
    readiness_impact_estimate: item.readiness_impact_estimate,
    status: item.status ?? 'pending',
  }));
  if (rows.length > 0) {
    const insertResult = await ownedDbTable('company_context_enrichment_suggestions').insert(rows);
    if (insertResult.error) throw new Error(`Failed to store enrichment suggestions: ${insertResult.error.message}`);
  }

  const persisted = await getCompanyContextEnrichmentSuggestions(input.companyId);
  return { context, suggestions: persisted, quality, readiness, run: runResult.data };
}

export async function getCompanyContextEnrichmentSuggestions(companyId: string): Promise<CompanyContextEnrichmentSuggestion[]> {
  const result = await ownedDbTable('company_context_enrichment_suggestions')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['pending', 'snoozed'])
    .order('impact_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(8);
  if (result.error) throw new Error(`Failed to load enrichment suggestions: ${result.error.message}`);
  const now = Date.now();
  return ((result.data ?? []) as CompanyContextEnrichmentSuggestion[])
    .filter((item) => !item.snoozed_until || new Date(item.snoozed_until).getTime() <= now || item.status === 'pending');
}

function appendPayloadToContext(
  context: CompanyContextIntelligence,
  suggestion: CompanyContextEnrichmentSuggestion,
  overridePayload?: Record<string, unknown> | null,
): CompanyContextIntelligence {
  const payload = {
    ...suggestion.payload,
    ...(overridePayload ?? {}),
    source: 'ai_inferred',
    review_status: overridePayload ? 'needs_review' : 'inferred',
    user_confirmed: false,
    update_source: overridePayload ? 'manual' : 'ai_inference',
  };
  switch (suggestion.target_section) {
    case 'revenue_segments':
      return { ...context, revenue_segments: [...context.revenue_segments, payload as any] };
    case 'geographic_exposures':
      return { ...context, geographic_exposures: [...context.geographic_exposures, payload as CompanyGeographicExposure] };
    case 'dependencies':
      return { ...context, dependencies: [...context.dependencies, payload as CompanyDependency] };
    case 'regulatory_exposures':
      return { ...context, regulatory_exposures: [...context.regulatory_exposures, payload as CompanyRegulatoryExposure] };
    case 'technology_dependencies':
      return { ...context, technology_dependencies: [...context.technology_dependencies, payload as CompanyTechnologyDependency] };
    case 'workforce_profile':
      if (context.workforce_profile?.user_confirmed) return context;
      return { ...context, workforce_profile: { ...(context.workforce_profile ?? {}), ...payload } as CompanyWorkforceProfile };
    default:
      return context;
  }
}

export async function reviewCompanyContextEnrichmentSuggestion(params: {
  companyId: string;
  suggestionId: string;
  action: 'accepted' | 'rejected' | 'modified' | 'snoozed';
  actorUserId?: string | null;
  modifiedPayload?: Record<string, unknown> | null;
  reviewNote?: string | null;
}) {
  const suggestionResult = await ownedDbTable('company_context_enrichment_suggestions')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('id', params.suggestionId)
    .maybeSingle();
  if (suggestionResult.error) throw new Error(`Failed to load enrichment suggestion: ${suggestionResult.error.message}`);
  if (!suggestionResult.data) throw new Error('Enrichment suggestion not found');
  const suggestion = suggestionResult.data as CompanyContextEnrichmentSuggestion;
  const beforeContext = await getCompanyContextIntelligence(params.companyId, { useCache: false });
  let afterContext = beforeContext;
  if (
    (params.action === 'accepted' || params.action === 'modified') &&
    ['add_entity', 'update_entity'].includes(suggestion.suggestion_type)
  ) {
    afterContext = appendPayloadToContext(beforeContext, suggestion, params.action === 'modified' ? params.modifiedPayload ?? {} : null);
    afterContext = await saveCompanyContextIntelligence(params.companyId, afterContext, {
      actorUserId: params.actorUserId,
      updateSource: params.action === 'modified' ? 'manual' : 'ai_inference',
      createSnapshot: true,
      snapshotPurpose: `enrichment_suggestion_${params.action}`,
    });
  }

  const quality = calculateContextQualityMetadata(afterContext);
  const snoozedUntil = params.action === 'snoozed'
    ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const updateResult = await ownedDbTable('company_context_enrichment_suggestions')
    .update({
      status: params.action,
      review_note: params.reviewNote ?? null,
      reviewed_by: params.actorUserId ?? null,
      reviewed_at: new Date().toISOString(),
      snoozed_until: snoozedUntil,
    })
    .eq('company_id', params.companyId)
    .eq('id', params.suggestionId);
  if (updateResult.error) throw new Error(`Failed to update enrichment suggestion: ${updateResult.error.message}`);

  await ownedDbTable('company_context_review_events').insert({
    company_id: params.companyId,
    suggestion_id: params.suggestionId,
    actor_user_id: params.actorUserId ?? null,
    action: params.action,
    before_payload: beforeContext,
    after_payload: afterContext,
    quality_payload: quality,
  });

  return {
    intelligence_context: afterContext,
    quality,
    suggestions: await getCompanyContextEnrichmentSuggestions(params.companyId),
  };
}
