/**
 * Active Leads — Company Context Loader (PR-CAR-1).
 *
 * Reads existing company profile data and normalizes it into a single
 * shape the source-recommendation engine consumes. Best-effort: missing
 * fields lower the returned confidence but never throw.
 *
 * The seven fields surfaced match the product spec:
 *   industry, products, services, icp, geography, revenue stage, competitors
 *
 * Read sources (in order of preference, highest-confidence first):
 *   - companies.industry                         (single)
 *   - company_profiles.industry_list[]           (curated)
 *   - company_profiles.industry                  (free text)
 *   - company_profiles.products_services_list[]  (curated)
 *   - company_profiles.products_services         (free text)
 *   - company_profiles.ideal_customer_profile    (free text)
 *   - company_profiles.target_customer_segment   (free text)
 *   - company_profiles.target_audience_list[]    (curated)
 *   - company_profiles.target_audience           (free text)
 *   - company_profiles.geography_list[]          (curated)
 *   - company_profiles.geography                 (free text)
 *   - company_profiles.report_settings.market_pulse.primary_operating_markets[]
 *   - company_profiles.report_settings.company_facts.revenue_range
 *   - company_profiles.competitors_list[]        (curated)
 *   - company_profiles.competitors               (free text)
 *   - company_profiles.report_settings.market_pulse.named_competitors[]
 *   - company_profiles.report_settings.market_pulse.competitor_details[].name
 *
 * No new tables; no migration. This is pure read + normalize.
 */

import { ownedDbTable } from '../db/writeOwner';
import { adoptLeadCompanyIdentity } from './companyIntelligence/adoption/consumers/leadIntelligenceConsumer';

export type CompanyContextField = {
  /** Lower-cased + trimmed values for matching. Deduped. */
  values: string[];
  /** Original-casing values for display. Deduped by lower-case. */
  display: string[];
  /** True when at least one value is present. */
  present: boolean;
  /**
   * Tables/columns the value(s) came from, in the order they were
   * appended. Useful for explainability and ops debugging.
   */
  sources: string[];
};

export type CompanyContextFieldName =
  | 'industry'
  | 'products'
  | 'services'
  | 'icp'
  | 'geography'
  | 'revenueStage'
  | 'competitors';

export const COMPANY_CONTEXT_FIELDS: readonly CompanyContextFieldName[] = [
  'industry',
  'products',
  'services',
  'icp',
  'geography',
  'revenueStage',
  'competitors',
] as const;

export type CompanyContext = {
  companyId: string;
  industry: CompanyContextField;
  products: CompanyContextField;
  services: CompanyContextField;
  icp: CompanyContextField;
  geography: CompanyContextField;
  revenueStage: CompanyContextField;
  competitors: CompanyContextField;
  /**
   * 0..1. Fraction of the seven spec fields that are populated. UI
   * surfaces this as "low confidence — fill out your company profile
   * to improve recommendations" when below ~0.5.
   */
  confidence: number;
  /** Field names that are absent. Drives the UI "missing fields" CTA. */
  missingFields: CompanyContextFieldName[];
  /** Names of underlying reads that failed; empty on the happy path. */
  loadErrors: string[];
  loadedAt: string;
};

function emptyField(): CompanyContextField {
  return { values: [], display: [], present: false, sources: [] };
}

function splitToList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function appendField(field: CompanyContextField, raw: string[], source: string): void {
  if (raw.length === 0) return;
  const seenLower = new Set(field.values);
  let appended = false;
  for (const item of raw) {
    const lower = item.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    field.values.push(lower);
    field.display.push(item);
    appended = true;
  }
  if (appended) {
    field.sources.push(source);
    field.present = true;
  }
}

type CompaniesRow = {
  id?: string | null;
  industry?: string | null;
};

type ProfileRow = {
  industry?: string | null;
  industry_list?: string[] | null;
  category?: string | null;
  category_list?: string[] | null;
  products_services?: string | null;
  products_services_list?: string[] | null;
  target_audience?: string | null;
  target_audience_list?: string[] | null;
  target_customer_segment?: string | null;
  ideal_customer_profile?: string | null;
  geography?: string | null;
  geography_list?: string[] | null;
  competitors?: string | null;
  competitors_list?: string[] | null;
  report_settings?: {
    company_facts?: {
      revenue_range?: string | null;
    } | null;
    market_pulse?: {
      primary_operating_markets?: string[] | null;
      named_competitors?: string[] | null;
      competitor_details?: Array<{ name?: string | null }> | null;
    } | null;
  } | null;
};

async function safeFetchCompany(companyId: string, errors: string[]): Promise<CompaniesRow | null> {
  try {
    const { data, error } = await ownedDbTable('companies')
      .select('id, industry')
      .eq('id', companyId)
      .maybeSingle();
    if (error) {
      errors.push(`companies: ${error.message}`);
      return null;
    }
    return (data as CompaniesRow) ?? null;
  } catch (err) {
    errors.push(`companies: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function safeFetchProfile(companyId: string, errors: string[]): Promise<ProfileRow | null> {
  try {
    const { data, error } = await ownedDbTable('company_profiles')
      .select(
        [
          'industry',
          'industry_list',
          'category',
          'category_list',
          'products_services',
          'products_services_list',
          'target_audience',
          'target_audience_list',
          'target_customer_segment',
          'ideal_customer_profile',
          'geography',
          'geography_list',
          'competitors',
          'competitors_list',
          'report_settings',
        ].join(', '),
      )
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) {
      errors.push(`company_profiles: ${error.message}`);
      return null;
    }
    return (data as ProfileRow) ?? null;
  } catch (err) {
    errors.push(`company_profiles: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const loadErrors: string[] = [];

  const context: CompanyContext = {
    companyId,
    industry: emptyField(),
    products: emptyField(),
    services: emptyField(),
    icp: emptyField(),
    geography: emptyField(),
    revenueStage: emptyField(),
    competitors: emptyField(),
    confidence: 0,
    missingFields: [],
    loadErrors,
    loadedAt: new Date().toISOString(),
  };

  if (!companyId) {
    context.missingFields = [...COMPANY_CONTEXT_FIELDS];
    return context;
  }

  const [company, profile] = await Promise.all([
    safeFetchCompany(companyId, loadErrors),
    safeFetchProfile(companyId, loadErrors),
  ]);

  // U3·Consumer-5: the source-recommendation surface consumes the company's `category` (→ industry
  // bucket). It obtains that identity through the canonical projection seam. Flag OFF (default) ⇒ same
  // profile row, byte-identical. `industry`/`category_list` are not projection-owned and are unchanged.
  const identityProfile = adoptLeadCompanyIdentity(profile, companyId, new Date().toISOString());

  // ---- industry ----
  appendField(context.industry, splitToList(company?.industry), 'companies.industry');
  appendField(context.industry, splitToList(profile?.industry_list), 'company_profiles.industry_list');
  appendField(context.industry, splitToList(profile?.industry), 'company_profiles.industry');
  appendField(context.industry, splitToList(identityProfile?.category_list), 'company_profiles.category_list');
  appendField(context.industry, splitToList(identityProfile?.category), 'company_profiles.category');

  // ---- products ----
  // Phase-1 simplification: products & services share company_profiles.products_services
  // — there is no separate services column today. The engine MAY weight
  // them differently, so we still expose them as distinct fields.
  appendField(
    context.products,
    splitToList(profile?.products_services_list),
    'company_profiles.products_services_list',
  );
  appendField(
    context.products,
    splitToList(profile?.products_services),
    'company_profiles.products_services',
  );

  // ---- services ----
  appendField(
    context.services,
    splitToList(profile?.products_services_list),
    'company_profiles.products_services_list',
  );
  appendField(
    context.services,
    splitToList(profile?.products_services),
    'company_profiles.products_services',
  );

  // ---- icp ----
  appendField(
    context.icp,
    splitToList(profile?.ideal_customer_profile),
    'company_profiles.ideal_customer_profile',
  );
  appendField(
    context.icp,
    splitToList(profile?.target_customer_segment),
    'company_profiles.target_customer_segment',
  );
  appendField(
    context.icp,
    splitToList(profile?.target_audience_list),
    'company_profiles.target_audience_list',
  );
  appendField(context.icp, splitToList(profile?.target_audience), 'company_profiles.target_audience');

  // ---- geography ----
  appendField(context.geography, splitToList(profile?.geography_list), 'company_profiles.geography_list');
  appendField(context.geography, splitToList(profile?.geography), 'company_profiles.geography');
  appendField(
    context.geography,
    splitToList(profile?.report_settings?.market_pulse?.primary_operating_markets),
    'company_profiles.report_settings.market_pulse.primary_operating_markets',
  );

  // ---- revenue stage ----
  // The spec calls for a structured revenue stage. Today we only have
  // a free-text revenue_range under report_settings.company_facts.
  // Treated as a single value when present.
  appendField(
    context.revenueStage,
    splitToList(profile?.report_settings?.company_facts?.revenue_range),
    'company_profiles.report_settings.company_facts.revenue_range',
  );

  // ---- competitors ----
  appendField(
    context.competitors,
    splitToList(profile?.competitors_list),
    'company_profiles.competitors_list',
  );
  appendField(context.competitors, splitToList(profile?.competitors), 'company_profiles.competitors');
  appendField(
    context.competitors,
    splitToList(profile?.report_settings?.market_pulse?.named_competitors),
    'company_profiles.report_settings.market_pulse.named_competitors',
  );
  const competitorDetailNames = (profile?.report_settings?.market_pulse?.competitor_details ?? [])
    .map((row) => (row?.name ? String(row.name).trim() : ''))
    .filter(Boolean);
  appendField(
    context.competitors,
    competitorDetailNames,
    'company_profiles.report_settings.market_pulse.competitor_details',
  );

  // ---- confidence + missing fields ----
  const presentCount = COMPANY_CONTEXT_FIELDS.reduce(
    (count, name) => count + (context[name].present ? 1 : 0),
    0,
  );
  context.confidence = COMPANY_CONTEXT_FIELDS.length === 0
    ? 0
    : presentCount / COMPANY_CONTEXT_FIELDS.length;
  context.missingFields = COMPANY_CONTEXT_FIELDS.filter((name) => !context[name].present);

  return context;
}

/**
 * Convenience: collapse the context into the existing
 * communityDiscoveryService input shape (industryCategory + keywords +
 * competitors + icp). Lets PR-CAR-2 wire the loader into the existing
 * discovery flow without changing the engine signature.
 */
export function toDiscoveryProfileInput(context: CompanyContext): {
  industryCategory: string;
  description: string;
  icp: string;
  keywords: string[];
  competitors: string[];
} {
  return {
    industryCategory: context.industry.display.join(', '),
    description: context.products.display.join(', '),
    icp: context.icp.display.join(', '),
    keywords: [...context.products.values, ...context.services.values],
    competitors: context.competitors.display,
  };
}
