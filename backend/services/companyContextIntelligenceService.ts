import { ownedDbTable } from '../db/writeOwner';
import { normalizeTaxonomyKey } from './companyContextTaxonomy';
import {
  buildFieldStates,
  markConflicting,
  resolveEntityState,
  resolveSectionState,
  type ConsistencyWarning,
  type EntityState,
  type FieldStateMap,
} from './companyContextGovernance';

export type IntelligenceReviewStatus =
  | 'missing'
  | 'unknown'
  | 'inferred'
  | 'user_confirmed'
  | 'stale'
  | 'conflicting'
  | 'deprecated'
  | 'system_generated'
  | 'needs_review';

export type IntelligenceSource =
  | 'user'
  | 'ai_inferred'
  | 'integration'
  | 'import'
  | 'system'
  | 'unknown';

export type IntelligenceState = EntityState;

export type IntelligenceMetadata = {
  confidence?: number | null;
  source?: IntelligenceSource | string | null;
  user_confirmed?: boolean | null;
  inferred_by?: string | null;
  last_verified_at?: string | null;
  stale_at?: string | null;
  review_status?: IntelligenceReviewStatus | string | null;
  entity_state?: EntityState | string | null;
  field_states?: FieldStateMap | null;
  updated_by?: string | null;
  update_source?: string | null;
  inference_reason?: string | null;
  source_signals?: Array<Record<string, unknown> | string> | null;
  inference_strength?: 'weak' | 'strong' | 'conflicting' | string | null;
  enrichment_provenance?: Record<string, unknown> | null;
};

export type CompanyRevenueSegment = IntelligenceMetadata & {
  id?: string;
  company_id?: string;
  customer_industry?: string | null;
  customer_industry_key?: string | null;
  customer_segment?: string | null;
  customer_segment_key?: string | null;
  geography?: string | null;
  geography_key?: string | null;
  revenue_percentage?: number | null;
  strategic_priority?: string | null;
  strategic_priority_key?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyGeographicExposure = IntelligenceMetadata & {
  id?: string;
  company_id?: string;
  geography?: string | null;
  geography_key?: string | null;
  exposure_type: 'revenue' | 'operations' | 'workforce' | 'customers' | 'vendors';
  exposure_type_key?: string | null;
  exposure_percentage?: number | null;
  criticality?: string | null;
  criticality_key?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyDependency = IntelligenceMetadata & {
  id?: string;
  company_id?: string;
  dependency_type:
    | 'cloud'
    | 'vendor'
    | 'supplier'
    | 'logistics'
    | 'labor'
    | 'platform'
    | 'channel'
    | 'regulatory'
    | 'technology'
    | 'other';
  dependency_type_key?: string | null;
  dependency_name?: string | null;
  dependency_region?: string | null;
  dependency_region_key?: string | null;
  criticality?: string | null;
  criticality_key?: string | null;
  operational_sensitivity?: string | null;
  operational_sensitivity_key?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyRegulatoryExposure = IntelligenceMetadata & {
  id?: string;
  company_id?: string;
  jurisdiction?: string | null;
  jurisdiction_key?: string | null;
  regulation_type?: string | null;
  regulation_type_key?: string | null;
  applicability?: string | null;
  severity?: string | null;
  severity_key?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyWorkforceProfile = IntelligenceMetadata & {
  company_id?: string;
  workforce_model?: string | null;
  workforce_model_key?: string | null;
  hiring_markets?: string[] | null;
  contractor_dependency_level?: string | null;
  contractor_dependency_level_key?: string | null;
  immigration_dependency_level?: string | null;
  immigration_dependency_level_key?: string | null;
  key_skill_dependencies?: string[] | null;
  labor_sensitivity_level?: string | null;
  labor_sensitivity_level_key?: string | null;
  remote_dependency_level?: string | null;
  remote_dependency_level_key?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyTechnologyDependency = IntelligenceMetadata & {
  id?: string;
  company_id?: string;
  provider_name?: string | null;
  provider_category?: string | null;
  provider_category_key?: string | null;
  criticality?: string | null;
  criticality_key?: string | null;
  spend_sensitivity?: string | null;
  spend_sensitivity_key?: string | null;
  operational_dependency?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompanyContextIntelligence = {
  revenue_segments: CompanyRevenueSegment[];
  geographic_exposures: CompanyGeographicExposure[];
  dependencies: CompanyDependency[];
  regulatory_exposures: CompanyRegulatoryExposure[];
  workforce_profile: CompanyWorkforceProfile | null;
  technology_dependencies: CompanyTechnologyDependency[];
  state: {
    revenue_segments: IntelligenceState;
    geographic_exposures: IntelligenceState;
    dependencies: IntelligenceState;
    regulatory_exposures: IntelligenceState;
    workforce_profile: IntelligenceState;
    technology_dependencies: IntelligenceState;
  };
  validation_warnings?: ConsistencyWarning[];
};

export type IntelligenceReadinessResult = {
  score: number;
  section_scores: {
    market_exposure: number;
    dependency: number;
    workforce: number;
    regulatory: number;
    geographic: number;
    strategic_state: number;
  };
  missing_sections: string[];
};

export type CompanyProfileLike = {
  name?: string | null;
  industry?: string | null;
  category?: string | null;
  products_services?: string | null;
  target_audience?: string | null;
  geography?: string | null;
  goals?: string | null;
  growth_priorities?: string | null;
  unique_value?: string | null;
  industry_list?: string[] | null;
  category_list?: string[] | null;
  products_services_list?: string[] | null;
  target_audience_list?: string[] | null;
  geography_list?: string[] | null;
  campaign_purpose_intent?: unknown;
  strategic_inputs?: unknown;
  report_settings?: {
    intelligence?: unknown;
    market_pulse?: unknown;
  } | null;
};

export type SaveCompanyContextIntelligenceOptions = {
  actorUserId?: string | null;
  updateSource?: 'manual' | 'ai_inference' | 'integration' | 'import' | 'system';
  createSnapshot?: boolean;
  snapshotPurpose?: string | null;
};

export type CompanyContextRelationship = {
  id?: string;
  company_id?: string;
  source_entity_type: string;
  source_entity_id?: string | null;
  relationship_type: 'serves' | 'depends_on' | 'exposed_to' | 'regulated_by' | 'competes_with' | 'operates_in';
  target_entity_type: string;
  target_entity_id?: string | null;
  weight?: number | null;
  confidence?: number | null;
  source?: IntelligenceSource | string | null;
  created_at?: string;
  updated_at?: string;
};

const VALID_SOURCES = new Set(['user', 'ai_inferred', 'integration', 'import', 'system', 'unknown']);
const VALID_REVIEW_STATUSES = new Set(['missing', 'unknown', 'inferred', 'user_confirmed', 'stale', 'needs_review', 'conflicting', 'deprecated', 'system_generated']);
const contextCache = new Map<string, { expiresAt: number; value: CompanyContextIntelligence }>();
const CONTEXT_CACHE_TTL_MS = 30_000;

function normalizeString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return text ? text : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item));
  }
  const text = normalizeString(value);
  return text ? text.split(/[,;/|]+/g).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeJsonArray(value: unknown): Array<Record<string, unknown> | string> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> | string =>
      typeof item === 'string' || (typeof item === 'object' && item !== null)
    );
  }
  return [];
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeMetadata(input: IntelligenceMetadata | null | undefined): Required<Pick<IntelligenceMetadata, 'source' | 'user_confirmed' | 'review_status'>> & IntelligenceMetadata {
  const source = normalizeString(input?.source);
  const userConfirmed = Boolean(input?.user_confirmed);
  const staleAt = normalizeString(input?.stale_at);
  const isStale = staleAt ? new Date(staleAt).getTime() <= Date.now() : false;
  const rawStatus = normalizeString(input?.review_status);
  const review_status =
    isStale ? 'stale'
      : userConfirmed ? 'user_confirmed'
        : rawStatus && VALID_REVIEW_STATUSES.has(rawStatus) ? rawStatus
          : source === 'ai_inferred' ? 'inferred'
            : source === 'user' ? 'needs_review'
              : 'unknown';

  return {
    confidence: normalizeNumber(input?.confidence),
    source: source && VALID_SOURCES.has(source) ? source : 'unknown',
    user_confirmed: userConfirmed,
    inferred_by: normalizeString(input?.inferred_by),
    last_verified_at: normalizeString(input?.last_verified_at),
    stale_at: staleAt,
    review_status,
    entity_state: resolveEntityState({
      ...input,
      source: source && VALID_SOURCES.has(source) ? source : 'unknown',
      user_confirmed: userConfirmed,
      review_status,
      stale_at: staleAt,
    }),
    field_states: input?.field_states ?? null,
    updated_by: normalizeString(input?.updated_by),
    update_source: normalizeString(input?.update_source) ?? 'manual',
    inference_reason: normalizeString(input?.inference_reason),
    source_signals: normalizeJsonArray(input?.source_signals),
    inference_strength: normalizeString(input?.inference_strength),
    enrichment_provenance: normalizeJsonObject(input?.enrichment_provenance),
  };
}

function deriveState(rows: IntelligenceMetadata[] | null | undefined): IntelligenceState {
  if (!rows || rows.length === 0) return 'missing';
  return resolveSectionState(rows.map((row) => resolveEntityState(row)));
}

function hasMeaningfulRow(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = row[key];
    if (Array.isArray(value)) return value.length > 0;
    return normalizeString(value) !== null || normalizeNumber(value) !== null;
  });
}

function readinessFromState(state: IntelligenceState, hasExplicitData: boolean): number {
  if (!hasExplicitData) return 0;
  if (state === 'user_confirmed') return 100;
  if (state === 'system_generated') return 80;
  if (state === 'inferred') return 70;
  if (state === 'low_confidence') return 40;
  if (state === 'conflicting') return 35;
  if (state === 'stale') return 45;
  if (state === 'unknown') return 30;
  return 0;
}

async function loadCompanyContextIntelligence(companyId: string): Promise<CompanyContextIntelligence> {
  const [
    revenueSegments,
    geographicExposures,
    dependencies,
    regulatoryExposures,
    workforceProfile,
    technologyDependencies,
  ] = await Promise.all([
    ownedDbTable('company_revenue_segments').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
    ownedDbTable('company_geographic_exposures').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
    ownedDbTable('company_dependencies').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
    ownedDbTable('company_regulatory_exposures').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
    ownedDbTable('company_workforce_profile').select('*').eq('company_id', companyId).maybeSingle(),
    ownedDbTable('company_technology_dependencies').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }),
  ]);

  if (revenueSegments.error) throw new Error(`Failed to load revenue segments: ${revenueSegments.error.message}`);
  if (geographicExposures.error) throw new Error(`Failed to load geographic exposures: ${geographicExposures.error.message}`);
  if (dependencies.error) throw new Error(`Failed to load dependencies: ${dependencies.error.message}`);
  if (regulatoryExposures.error) throw new Error(`Failed to load regulatory exposures: ${regulatoryExposures.error.message}`);
  if (workforceProfile.error) throw new Error(`Failed to load workforce profile: ${workforceProfile.error.message}`);
  if (technologyDependencies.error) throw new Error(`Failed to load technology dependencies: ${technologyDependencies.error.message}`);

  const workforce = (workforceProfile.data ?? null) as CompanyWorkforceProfile | null;
  const revenue = (revenueSegments.data ?? []) as CompanyRevenueSegment[];
  const geography = (geographicExposures.data ?? []) as CompanyGeographicExposure[];
  const deps = (dependencies.data ?? []) as CompanyDependency[];
  const regulatory = (regulatoryExposures.data ?? []) as CompanyRegulatoryExposure[];
  const tech = (technologyDependencies.data ?? []) as CompanyTechnologyDependency[];

  const context = {
    revenue_segments: revenue,
    geographic_exposures: geography,
    dependencies: deps,
    regulatory_exposures: regulatory,
    workforce_profile: workforce,
    technology_dependencies: tech,
    state: {
      revenue_segments: deriveState(revenue),
      geographic_exposures: deriveState(geography),
      dependencies: deriveState(deps),
      regulatory_exposures: deriveState(regulatory),
      workforce_profile: deriveState(workforce ? [workforce] : []),
      technology_dependencies: deriveState(tech),
    },
  };
  return {
    ...context,
    validation_warnings: validateCompanyContextIntelligence(context),
  };
}

export async function getCompanyContextIntelligence(
  companyId: string,
  options?: { useCache?: boolean }
): Promise<CompanyContextIntelligence> {
  if (options?.useCache !== false) {
    const cached = contextCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }
  const value = await loadCompanyContextIntelligence(companyId);
  contextCache.set(companyId, { value, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return value;
}

export async function getCompanyContextIntelligenceBatch(
  companyIds: string[],
): Promise<Record<string, CompanyContextIntelligence>> {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  const entries = await Promise.all(uniqueIds.map(async (companyId) => [companyId, await getCompanyContextIntelligence(companyId)] as const));
  return Object.fromEntries(entries);
}

function normalizeRevenueSegment(row: CompanyRevenueSegment, companyId: string) {
  const metadata = normalizeMetadata(row);
  const customerIndustry = normalizeString(row.customer_industry);
  const customerSegment = normalizeString(row.customer_segment);
  const geography = normalizeString(row.geography);
  const strategicPriority = normalizeString(row.strategic_priority);
  return {
    company_id: companyId,
    customer_industry: customerIndustry,
    customer_industry_key: normalizeTaxonomyKey('customer_industry', row.customer_industry_key ?? customerIndustry),
    customer_segment: customerSegment,
    customer_segment_key: normalizeTaxonomyKey('customer_segment', row.customer_segment_key ?? customerSegment),
    geography,
    geography_key: normalizeTaxonomyKey('geography', row.geography_key ?? geography),
    revenue_percentage: normalizeNumber(row.revenue_percentage),
    strategic_priority: strategicPriority,
    strategic_priority_key: normalizeTaxonomyKey('strategic_priority', row.strategic_priority_key ?? strategicPriority),
    notes: normalizeString(row.notes),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['customer_industry', 'customer_segment', 'geography', 'revenue_percentage', 'strategic_priority'], metadata.entity_state as EntityState),
  };
}

function normalizeGeographicExposure(row: CompanyGeographicExposure, companyId: string) {
  const metadata = normalizeMetadata(row);
  const geography = normalizeString(row.geography);
  const criticality = normalizeString(row.criticality) ?? 'unknown';
  return {
    company_id: companyId,
    geography,
    geography_key: normalizeTaxonomyKey('geography', row.geography_key ?? geography),
    exposure_type: row.exposure_type,
    exposure_type_key: normalizeTaxonomyKey('exposure_type', row.exposure_type_key ?? row.exposure_type),
    exposure_percentage: normalizeNumber(row.exposure_percentage),
    criticality,
    criticality_key: normalizeTaxonomyKey('criticality', row.criticality_key ?? criticality),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['geography', 'exposure_type', 'exposure_percentage', 'criticality'], metadata.entity_state as EntityState),
  };
}

function normalizeDependency(row: CompanyDependency, companyId: string) {
  const metadata = normalizeMetadata(row);
  const dependencyType = row.dependency_type;
  const dependencyRegion = normalizeString(row.dependency_region);
  const criticality = normalizeString(row.criticality) ?? 'unknown';
  const operationalSensitivity = normalizeString(row.operational_sensitivity);
  return {
    company_id: companyId,
    dependency_type: dependencyType,
    dependency_type_key: normalizeTaxonomyKey('dependency_type', row.dependency_type_key ?? dependencyType),
    dependency_name: normalizeString(row.dependency_name),
    dependency_region: dependencyRegion,
    dependency_region_key: normalizeTaxonomyKey('geography', row.dependency_region_key ?? dependencyRegion),
    criticality,
    criticality_key: normalizeTaxonomyKey('criticality', row.criticality_key ?? criticality),
    operational_sensitivity: operationalSensitivity,
    operational_sensitivity_key: normalizeTaxonomyKey('operational_sensitivity', row.operational_sensitivity_key ?? operationalSensitivity),
    notes: normalizeString(row.notes),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['dependency_type', 'dependency_name', 'dependency_region', 'criticality', 'operational_sensitivity'], metadata.entity_state as EntityState),
  };
}

function normalizeRegulatoryExposure(row: CompanyRegulatoryExposure, companyId: string) {
  const metadata = normalizeMetadata(row);
  const jurisdiction = normalizeString(row.jurisdiction);
  const regulationType = normalizeString(row.regulation_type);
  const severity = normalizeString(row.severity) ?? 'unknown';
  return {
    company_id: companyId,
    jurisdiction,
    jurisdiction_key: normalizeTaxonomyKey('geography', row.jurisdiction_key ?? jurisdiction),
    regulation_type: regulationType,
    regulation_type_key: normalizeTaxonomyKey('regulation_type', row.regulation_type_key ?? regulationType),
    applicability: normalizeString(row.applicability),
    severity,
    severity_key: normalizeTaxonomyKey('criticality', row.severity_key ?? severity),
    notes: normalizeString(row.notes),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['jurisdiction', 'regulation_type', 'applicability', 'severity'], metadata.entity_state as EntityState),
  };
}

function normalizeTechnologyDependency(row: CompanyTechnologyDependency, companyId: string) {
  const metadata = normalizeMetadata(row);
  const providerCategory = normalizeString(row.provider_category);
  const criticality = normalizeString(row.criticality) ?? 'unknown';
  const spendSensitivity = normalizeString(row.spend_sensitivity) ?? 'unknown';
  return {
    company_id: companyId,
    provider_name: normalizeString(row.provider_name),
    provider_category: providerCategory,
    provider_category_key: normalizeTaxonomyKey('provider_category', row.provider_category_key ?? providerCategory),
    criticality,
    criticality_key: normalizeTaxonomyKey('criticality', row.criticality_key ?? criticality),
    spend_sensitivity: spendSensitivity,
    spend_sensitivity_key: normalizeTaxonomyKey('criticality', row.spend_sensitivity_key ?? spendSensitivity),
    operational_dependency: normalizeString(row.operational_dependency),
    notes: normalizeString(row.notes),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['provider_name', 'provider_category', 'criticality', 'spend_sensitivity', 'operational_dependency'], metadata.entity_state as EntityState),
  };
}

function normalizeWorkforceProfile(row: CompanyWorkforceProfile | null | undefined, companyId: string) {
  if (!row) return null;
  const metadata = normalizeMetadata(row);
  const workforceModel = normalizeString(row.workforce_model);
  const contractorLevel = normalizeString(row.contractor_dependency_level) ?? 'unknown';
  const immigrationLevel = normalizeString(row.immigration_dependency_level) ?? 'unknown';
  const laborLevel = normalizeString(row.labor_sensitivity_level) ?? 'unknown';
  const remoteLevel = normalizeString(row.remote_dependency_level) ?? 'unknown';
  return {
    company_id: companyId,
    workforce_model: workforceModel,
    workforce_model_key: normalizeTaxonomyKey('workforce_model', row.workforce_model_key ?? workforceModel),
    hiring_markets: normalizeStringArray(row.hiring_markets),
    contractor_dependency_level: contractorLevel,
    contractor_dependency_level_key: normalizeTaxonomyKey('criticality', row.contractor_dependency_level_key ?? contractorLevel),
    immigration_dependency_level: immigrationLevel,
    immigration_dependency_level_key: normalizeTaxonomyKey('criticality', row.immigration_dependency_level_key ?? immigrationLevel),
    key_skill_dependencies: normalizeStringArray(row.key_skill_dependencies),
    labor_sensitivity_level: laborLevel,
    labor_sensitivity_level_key: normalizeTaxonomyKey('criticality', row.labor_sensitivity_level_key ?? laborLevel),
    remote_dependency_level: remoteLevel,
    remote_dependency_level_key: normalizeTaxonomyKey('criticality', row.remote_dependency_level_key ?? remoteLevel),
    ...metadata,
    field_states: row.field_states ?? buildFieldStates(row as Record<string, unknown>, ['workforce_model', 'hiring_markets', 'contractor_dependency_level', 'immigration_dependency_level', 'key_skill_dependencies', 'labor_sensitivity_level', 'remote_dependency_level'], metadata.entity_state as EntityState),
  };
}

export function validateCompanyContextIntelligence(
  intelligence: Omit<CompanyContextIntelligence, 'validation_warnings'>
): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];
  const geographies = intelligence.geographic_exposures ?? [];
  const revenueGeos = geographies.filter((row) => row.exposure_type === 'revenue');
  const operatingGeos = geographies.filter((row) => row.exposure_type === 'operations');
  const highUsRevenue = revenueGeos.some((row) => row.geography_key === 'us' && Number(row.exposure_percentage ?? 0) >= 80);
  const nonUsOps = operatingGeos.some((row) => row.geography_key && row.geography_key !== 'us' && Number(row.exposure_percentage ?? 0) > 0);
  if (highUsRevenue && nonUsOps) {
    warnings.push({
      code: 'geo_revenue_operations_mismatch',
      severity: 'warning',
      message: 'Revenue exposure is mostly US while operational exposure includes non-US markets. Confirm whether this is domestic-only, export-led, or globally operated.',
      entity_type: 'company_geographic_exposure',
    });
  }

  const workforce = intelligence.workforce_profile;
  const highLaborDependencies = (intelligence.dependencies ?? []).filter(
    (row) => row.dependency_type_key === 'labor' && ['high', 'critical'].includes(String(row.criticality_key || row.criticality || ''))
  );
  if (workforce?.labor_sensitivity_level_key === 'low' && highLaborDependencies.length > 0) {
    warnings.push({
      code: 'labor_sensitivity_dependency_conflict',
      severity: 'warning',
      message: 'Workforce profile says labor sensitivity is low, but labor dependencies are marked high or critical.',
      entity_type: 'company_workforce_profile',
    });
  }

  const cloudCritical = (intelligence.technology_dependencies ?? []).some(
    (row) => row.provider_category_key === 'cloud_infrastructure' && ['high', 'critical'].includes(String(row.criticality_key || row.criticality || ''))
  );
  const dependencyCloudLow = (intelligence.dependencies ?? []).some(
    (row) => row.dependency_type_key === 'cloud' && ['low', 'none'].includes(String(row.criticality_key || row.criticality || ''))
  );
  if (cloudCritical && dependencyCloudLow) {
    warnings.push({
      code: 'cloud_dependency_criticality_conflict',
      severity: 'warning',
      message: 'Technology dependency marks cloud as high/critical while operational dependency marks cloud as low.',
      entity_type: 'company_technology_dependency',
    });
  }

  return warnings;
}

function applyValidationWarnings<T extends CompanyContextIntelligence>(
  intelligence: T,
  warnings: ConsistencyWarning[],
): T {
  let next = intelligence;
  for (const warning of warnings) {
    if (warning.code === 'labor_sensitivity_dependency_conflict' && next.workforce_profile) {
      next = { ...next, workforce_profile: markConflicting(next.workforce_profile, ['labor_sensitivity_level']) };
    }
    if (warning.code === 'cloud_dependency_criticality_conflict') {
      next = {
        ...next,
        technology_dependencies: next.technology_dependencies.map((row) =>
          row.provider_category_key === 'cloud_infrastructure' ? markConflicting(row, ['criticality']) : row
        ),
      };
    }
  }
  return next;
}

async function replaceRows<T>(
  table: string,
  companyId: string,
  rows: T[],
): Promise<void> {
  const deleteResult = await ownedDbTable(table).delete().eq('company_id', companyId);
  if (deleteResult.error) throw new Error(`Failed to replace ${table}: ${deleteResult.error.message}`);
  if (rows.length === 0) return;
  const insertResult = await ownedDbTable(table).insert(rows as Array<Record<string, unknown>>);
  if (insertResult.error) throw new Error(`Failed to insert ${table}: ${insertResult.error.message}`);
}

async function writeAuditEvent(params: {
  companyId: string;
  actorUserId?: string | null;
  action: string;
  updateSource: string;
  beforeContext?: CompanyContextIntelligence | null;
  afterContext?: CompanyContextIntelligence | null;
  validationWarnings?: ConsistencyWarning[];
}) {
  const result = await ownedDbTable('company_context_audit_events').insert({
    company_id: params.companyId,
    actor_user_id: params.actorUserId ?? null,
    action: params.action,
    update_source: params.updateSource,
    before_context: params.beforeContext ?? null,
    after_context: params.afterContext ?? null,
    validation_warnings: params.validationWarnings ?? [],
  });
  if (result.error) console.warn('[company-context-intelligence] audit write failed', result.error.message);
}

export async function createCompanyContextSnapshot(params: {
  companyId: string;
  context?: CompanyContextIntelligence | null;
  readiness?: IntelligenceReadinessResult | null;
  validationWarnings?: ConsistencyWarning[];
  createdBy?: string | null;
  createdFor?: string | null;
}) {
  const context = params.context ?? await getCompanyContextIntelligence(params.companyId, { useCache: false });
  const latest = await ownedDbTable('company_context_snapshots')
    .select('snapshot_version')
    .eq('company_id', params.companyId)
    .order('snapshot_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`Failed to read latest context snapshot: ${latest.error.message}`);
  const snapshotVersion = Number(latest.data?.snapshot_version ?? 0) + 1;
  const result = await ownedDbTable('company_context_snapshots')
    .insert({
      company_id: params.companyId,
      snapshot_version: snapshotVersion,
      context_payload: context,
      readiness_payload: params.readiness ?? null,
      validation_warnings: params.validationWarnings ?? context.validation_warnings ?? [],
      created_by: params.createdBy ?? null,
      created_for: params.createdFor ?? null,
    })
    .select('*')
    .single();
  if (result.error) throw new Error(`Failed to create context snapshot: ${result.error.message}`);
  return result.data;
}

export async function getCompanyContextRelationships(companyId: string): Promise<CompanyContextRelationship[]> {
  const result = await ownedDbTable('company_context_relationships')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });
  if (result.error) throw new Error(`Failed to load context relationships: ${result.error.message}`);
  return (result.data ?? []) as CompanyContextRelationship[];
}

export async function saveCompanyContextRelationships(
  companyId: string,
  relationships: CompanyContextRelationship[],
): Promise<CompanyContextRelationship[]> {
  const rows = relationships
    .filter((row) => row.source_entity_type && row.relationship_type && row.target_entity_type)
    .map((row) => ({
      company_id: companyId,
      source_entity_type: row.source_entity_type,
      source_entity_id: row.source_entity_id ?? null,
      relationship_type: row.relationship_type,
      target_entity_type: row.target_entity_type,
      target_entity_id: row.target_entity_id ?? null,
      weight: normalizeNumber(row.weight),
      confidence: normalizeNumber(row.confidence),
      source: VALID_SOURCES.has(String(row.source ?? 'unknown')) ? row.source ?? 'unknown' : 'unknown',
    }));
  await replaceRows('company_context_relationships', companyId, rows);
  return getCompanyContextRelationships(companyId);
}

export async function saveCompanyContextIntelligence(
  companyId: string,
  input: Partial<CompanyContextIntelligence>,
  options?: SaveCompanyContextIntelligenceOptions,
): Promise<CompanyContextIntelligence> {
  const beforeContext = await getCompanyContextIntelligence(companyId, { useCache: false }).catch(() => null);
  const updatedBy = options?.actorUserId ?? null;
  const updateSource = options?.updateSource ?? 'manual';
  const revenueSegments = (input.revenue_segments ?? [])
    .map((row) => normalizeRevenueSegment({ ...row, updated_by: updatedBy, update_source: updateSource }, companyId))
    .filter((row) => hasMeaningfulRow(row, ['customer_industry', 'customer_segment', 'geography', 'revenue_percentage', 'strategic_priority', 'notes']));

  const geographicExposures = (input.geographic_exposures ?? [])
    .map((row) => normalizeGeographicExposure({ ...row, updated_by: updatedBy, update_source: updateSource }, companyId))
    .filter((row) => row.exposure_type && hasMeaningfulRow(row, ['geography', 'exposure_percentage', 'criticality']));

  const dependencies = (input.dependencies ?? [])
    .map((row) => normalizeDependency({ ...row, updated_by: updatedBy, update_source: updateSource }, companyId))
    .filter((row) => row.dependency_type && hasMeaningfulRow(row, ['dependency_name', 'dependency_region', 'criticality', 'operational_sensitivity', 'notes']));

  const regulatoryExposures = (input.regulatory_exposures ?? [])
    .map((row) => normalizeRegulatoryExposure({ ...row, updated_by: updatedBy, update_source: updateSource }, companyId))
    .filter((row) => hasMeaningfulRow(row, ['jurisdiction', 'regulation_type', 'applicability', 'severity', 'notes']));

  const technologyDependencies = (input.technology_dependencies ?? [])
    .map((row) => normalizeTechnologyDependency({ ...row, updated_by: updatedBy, update_source: updateSource }, companyId))
    .filter((row) => hasMeaningfulRow(row, ['provider_name', 'provider_category', 'criticality', 'spend_sensitivity', 'operational_dependency', 'notes']));

  const workforceProfile = normalizeWorkforceProfile(input.workforce_profile ? { ...input.workforce_profile, updated_by: updatedBy, update_source: updateSource } : input.workforce_profile, companyId);

  const normalizedContext = applyValidationWarnings({
    revenue_segments: revenueSegments as CompanyRevenueSegment[],
    geographic_exposures: geographicExposures as CompanyGeographicExposure[],
    dependencies: dependencies as CompanyDependency[],
    regulatory_exposures: regulatoryExposures as CompanyRegulatoryExposure[],
    workforce_profile: workforceProfile as CompanyWorkforceProfile | null,
    technology_dependencies: technologyDependencies as CompanyTechnologyDependency[],
    state: {
      revenue_segments: deriveState(revenueSegments),
      geographic_exposures: deriveState(geographicExposures),
      dependencies: deriveState(dependencies),
      regulatory_exposures: deriveState(regulatoryExposures),
      workforce_profile: deriveState(workforceProfile ? [workforceProfile] : []),
      technology_dependencies: deriveState(technologyDependencies),
    },
  }, validateCompanyContextIntelligence({
    revenue_segments: revenueSegments as CompanyRevenueSegment[],
    geographic_exposures: geographicExposures as CompanyGeographicExposure[],
    dependencies: dependencies as CompanyDependency[],
    regulatory_exposures: regulatoryExposures as CompanyRegulatoryExposure[],
    workforce_profile: workforceProfile as CompanyWorkforceProfile | null,
    technology_dependencies: technologyDependencies as CompanyTechnologyDependency[],
    state: {
      revenue_segments: deriveState(revenueSegments),
      geographic_exposures: deriveState(geographicExposures),
      dependencies: deriveState(dependencies),
      regulatory_exposures: deriveState(regulatoryExposures),
      workforce_profile: deriveState(workforceProfile ? [workforceProfile] : []),
      technology_dependencies: deriveState(technologyDependencies),
    },
  }));
  const validationWarnings = validateCompanyContextIntelligence(normalizedContext);

  await Promise.all([
    replaceRows('company_revenue_segments', companyId, normalizedContext.revenue_segments),
    replaceRows('company_geographic_exposures', companyId, normalizedContext.geographic_exposures),
    replaceRows('company_dependencies', companyId, normalizedContext.dependencies),
    replaceRows('company_regulatory_exposures', companyId, normalizedContext.regulatory_exposures),
    replaceRows('company_technology_dependencies', companyId, normalizedContext.technology_dependencies),
  ]);

  if (normalizedContext.workforce_profile && hasMeaningfulRow(normalizedContext.workforce_profile as Record<string, unknown>, [
    'workforce_model',
    'hiring_markets',
    'contractor_dependency_level',
    'immigration_dependency_level',
    'key_skill_dependencies',
    'labor_sensitivity_level',
    'remote_dependency_level',
  ])) {
    const upsertResult = await ownedDbTable('company_workforce_profile').upsert(normalizedContext.workforce_profile, { onConflict: 'company_id' });
    if (upsertResult.error) throw new Error(`Failed to save workforce profile: ${upsertResult.error.message}`);
  } else {
    const deleteResult = await ownedDbTable('company_workforce_profile').delete().eq('company_id', companyId);
    if (deleteResult.error) throw new Error(`Failed to clear workforce profile: ${deleteResult.error.message}`);
  }

  contextCache.delete(companyId);
  const afterContext = await getCompanyContextIntelligence(companyId, { useCache: false });
  await writeAuditEvent({
    companyId,
    actorUserId: updatedBy,
    action: 'save_context_intelligence',
    updateSource,
    beforeContext,
    afterContext,
    validationWarnings,
  });
  if (options?.createSnapshot) {
    await createCompanyContextSnapshot({
      companyId,
      context: afterContext,
      readiness: calculateIntelligenceReadiness({ intelligence: afterContext }),
      validationWarnings,
      createdBy: updatedBy,
      createdFor: options.snapshotPurpose ?? 'context_intelligence_save',
    }).catch((error) => console.warn('[company-context-intelligence] snapshot failed', error?.message));
  }
  return afterContext;
}

export function calculateIntelligenceReadiness(params: {
  intelligence: CompanyContextIntelligence | null;
  profile?: {
    growth_priorities?: string | null;
    goals?: string | null;
    campaign_purpose_intent?: unknown;
    strategic_inputs?: unknown;
    report_settings?: { intelligence?: unknown } | null;
  } | null;
}): IntelligenceReadinessResult {
  const intelligence = params.intelligence;
  const state = intelligence?.state;
  const strategicFields = [
    params.profile?.growth_priorities,
    params.profile?.goals,
    params.profile?.campaign_purpose_intent,
    params.profile?.strategic_inputs,
    params.profile?.report_settings?.intelligence,
  ];
  const hasStrategicState = strategicFields.some((value) => {
    if (value == null) return false;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return String(value).trim().length > 0;
  });

  const section_scores = {
    market_exposure: readinessFromState(state?.revenue_segments ?? 'missing', (intelligence?.revenue_segments.length ?? 0) > 0),
    dependency: Math.round((
      readinessFromState(state?.dependencies ?? 'missing', (intelligence?.dependencies.length ?? 0) > 0) +
      readinessFromState(state?.technology_dependencies ?? 'missing', (intelligence?.technology_dependencies.length ?? 0) > 0)
    ) / 2),
    workforce: readinessFromState(state?.workforce_profile ?? 'missing', Boolean(intelligence?.workforce_profile)),
    regulatory: readinessFromState(state?.regulatory_exposures ?? 'missing', (intelligence?.regulatory_exposures.length ?? 0) > 0),
    geographic: readinessFromState(state?.geographic_exposures ?? 'missing', (intelligence?.geographic_exposures.length ?? 0) > 0),
    strategic_state: hasStrategicState ? 70 : 0,
  };

  const missing_sections = Object.entries(section_scores)
    .filter(([, score]) => score < 50)
    .map(([key]) => key);

  const score = Math.round(
    section_scores.market_exposure * 0.2 +
      section_scores.dependency * 0.2 +
      section_scores.workforce * 0.15 +
      section_scores.regulatory * 0.15 +
      section_scores.geographic * 0.2 +
      section_scores.strategic_state * 0.1
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    section_scores,
    missing_sections,
  };
}
