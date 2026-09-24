/**
 * PI WS-D — the tenant's own Offering context (the missing half of activation).
 *
 * `offeringIntelligence/**` was complete and unreachable: canonical contracts, a single builder, a
 * projection, twelve engines and an assembly — with no async context builder and no caller. This is
 * that builder, written to the same template as `leadUnderstanding/prospectContext.ts`: one async
 * function, ports that are the only place a table is touched, an explicit tenant, an injected `asOf`,
 * and every unmappable fact recorded as a gap rather than dropped.
 *
 * ─── IT DERIVES, IT DOES NOT STORE ────────────────────────────────────────
 * There is no offering table and this adds none. `leadUnderstanding` assembles at read time and
 * persists nothing — `lead_understanding_shadow` has a migration and no writer — and Offering
 * follows it. The tenant's offerings already live in `company_profiles`, which is the module's own
 * declared seed source (`fromSeed.ts` stamps `source: 'company_profile'`). A second store would be a
 * second owner of the same facts, and then two answers exist for one question.
 *
 * ─── WHAT company_profiles CANNOT SAY, SAID OUT LOUD ──────────────────────
 * The profile is ONE row per tenant. Its problem / value / outcome / differentiator columns describe
 * the BUSINESS, not an individual offering, and `products_services` does not distinguish a product
 * from a service. Those facts are still carried — every piece of evidence names the source it came
 * from — but the attribution is recorded as a gap, because a caller that cannot tell "this offering
 * solves X" from "this tenant solves X" will eventually assert the first.
 *
 * ─── IT FEEDS THE SEED, NOT THE ENGINES ───────────────────────────────────
 * Only `ctx.seed` is populated. The twelve engines score adoption, market fit, differentiation and
 * maturity from OBSERVED market evidence, and a tenant's own profile copy is not that. Feeding the
 * same self-description into the engine inputs would manufacture four scores out of one paragraph,
 * so the engines abstain here and the offering score abstains with them. That is the correct answer,
 * not a missing one: the facets Problem Fit needs come from the seed and are fully populated.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { OfferingIntelligenceContext } from './engines/engineTypes';
import type { OfferingSeedInput } from './fromSeed';
import { discoverOfferingSeeds, resolveOfferingId } from './fromSeed';

/** Bumped when the mapping changes, so a derived understanding traces to the shape that made it. */
export const TENANT_OFFERING_CONTEXT_VERSION = 'wsd.1';

/** The evidence source named on every fact this builder produces. */
export const TENANT_OFFERING_SOURCE = 'company_profiles';

/** A reason some available evidence did not reach the offering contracts intact. */
export interface TenantOfferingGap {
  readonly kind:
  | 'no_company_profile'
  | 'no_offering_named'
  | 'offerings_only_as_free_text'
  | 'offering_type_not_distinguished'
  | 'semantics_are_tenant_level_not_per_offering'
  | 'facet_has_no_profile_column';
  readonly detail: string;
  /** How many offerings or facets this affected, where that is countable. */
  readonly count?: number;
}

/** The offering-bearing columns of `company_profiles`. Nothing else is read. */
export const TENANT_OFFERING_PROFILE_COLUMNS: readonly string[] = [
  'products_services', 'products_services_list',
  'category', 'category_list',
  'industry', 'industry_list',
  'target_audience', 'target_audience_list',
  'brand_positioning', 'unique_value', 'competitive_advantages',
  'core_problem_statement', 'pain_symptoms',
  'desired_transformation', 'life_after_solution',
  'pricing_model',
];

/** One `company_profiles` row, narrowed to the columns above. */
export interface TenantOfferingProfileRow {
  products_services?: string | null;
  products_services_list?: unknown;
  category?: string | null;
  category_list?: unknown;
  industry?: string | null;
  industry_list?: unknown;
  target_audience?: string | null;
  target_audience_list?: unknown;
  brand_positioning?: string | null;
  unique_value?: string | null;
  competitive_advantages?: string | null;
  core_problem_statement?: string | null;
  pain_symptoms?: unknown;
  desired_transformation?: string | null;
  life_after_solution?: string | null;
  pricing_model?: string | null;
}

/** Everything this builder reads. One entry, one table. */
export interface TenantOfferingContextPorts {
  loadProfile(organizationId: string): Promise<TenantOfferingProfileRow | null>;
}

/** The default port. The ONLY place here that reaches a table. */
export const defaultTenantOfferingContextPorts: TenantOfferingContextPorts = {
  async loadProfile(organizationId: string): Promise<TenantOfferingProfileRow | null> {
    const { data, error } = await ownedDbTable('company_profiles')
      .select(TENANT_OFFERING_PROFILE_COLUMNS.join(', '))
      .eq('company_id', organizationId)          // tenant boundary — never optional
      .maybeSingle();
    if (error) throw new Error(`company_profiles read failed: ${error.message}`);
    return (data as unknown as TenantOfferingProfileRow) ?? null;
  },
};

export interface TenantOfferingContextInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  /** Injected. The deterministic instant; `asOf` for the seed and every engine. */
  readonly asOf: string;
}

export interface TenantOfferingContextResult {
  readonly version: string;
  readonly organizationId: string;
  /** One context per offering the tenant names. Empty when the tenant names none. */
  readonly contexts: readonly OfferingIntelligenceContext[];
  /** Which inputs answered, so explainability can name them. */
  readonly sources: { readonly profile: boolean; readonly curatedOfferingList: boolean };
  /** What was missing, unmappable or attributed more broadly than it reads. Never silently dropped. */
  readonly gaps: readonly TenantOfferingGap[];
  /** The row the seeds were derived from, so a caller can explain a facet without re-reading. */
  readonly profile: TenantOfferingProfileRow | null;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * A curated jsonb list, or a free-text column split on the platform's existing separators — the same
 * normalisation `activeLeadsCompanyContext` already applies to these columns, deliberately, because
 * a second reading of "what does this tenant sell" would be a second answer to one question.
 */
const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  const s = text(v);
  return s ? s.split(/[,;|]+/g).map((x) => x.trim()).filter(Boolean) : [];
};

/** Facets of the 24-facet ontology that no `company_profiles` column can fill. */
export const FACETS_WITHOUT_A_PROFILE_COLUMN: readonly string[] = [
  'offeringType', 'features', 'packaging', 'deployment', 'integrations',
  'compliance', 'lifecycle', 'roadmap', 'adoption', 'ecosystem',
];

/**
 * Project one tenant profile row into offering seeds. Pure and deterministic — it maps, it never
 * fetches and never fabricates: an empty column produces no seed field, and a seed's absent fields
 * abstain in `offeringFromSeed`.
 */
export function offeringSeedsFromProfile(
  row: TenantOfferingProfileRow | null,
  input: TenantOfferingContextInput,
): { seeds: OfferingSeedInput[]; gaps: TenantOfferingGap[]; curated: boolean } {
  const gaps: TenantOfferingGap[] = [];
  if (!row) {
    return {
      seeds: [], curated: false,
      gaps: [{ kind: 'no_company_profile', detail: `no company_profiles row for tenant ${input.organizationId}` }],
    };
  }

  const curatedNames = list(row.products_services_list);
  const curated = curatedNames.length > 0;
  const names = curated ? curatedNames : list(row.products_services);
  if (!curated && names.length > 0) {
    gaps.push({
      kind: 'offerings_only_as_free_text',
      detail: 'products_services_list is empty; offering names were split out of the free-text products_services column',
      count: names.length,
    });
  }
  if (names.length === 0) {
    gaps.push({ kind: 'no_offering_named', detail: 'neither products_services_list nor products_services names an offering' });
    return { seeds: [], gaps, curated };
  }

  // The tenant-level semantics. Read once, attributed to every offering, and declared as such below.
  const problems = [text(row.core_problem_statement), ...list(row.pain_symptoms)].filter((s): s is string => !!s);
  const outcomes = [text(row.desired_transformation), text(row.life_after_solution)].filter((s): s is string => !!s);
  const differentiators = list(row.competitive_advantages);
  const industries = list(row.industry_list).length ? list(row.industry_list) : list(row.industry);
  const personas = list(row.target_audience_list).length ? list(row.target_audience_list) : list(row.target_audience);
  const category = list(row.category_list)[0] ?? text(row.category) ?? undefined;

  const shared = {
    category,
    positioning: text(row.brand_positioning) ?? undefined,
    valueProposition: text(row.unique_value) ?? undefined,
    customerProblems: problems.length ? problems : undefined,
    outcomes: outcomes.length ? outcomes : undefined,
    differentiators: differentiators.length ? differentiators : undefined,
    industries: industries.length ? industries : undefined,
    personas: personas.length ? personas : undefined,
    pricingModel: text(row.pricing_model) ?? undefined,
  };

  // Discovery, dedup and ordering stay in `discoverOfferingSeeds` — one implementation, not two.
  // `offerings` rather than `products`/`services`, because the column does not say which it is.
  const discovered = discoverOfferingSeeds({
    companyId: input.organizationId,
    asOf: input.asOf,
    source: TENANT_OFFERING_SOURCE,
    offerings: names,
  });
  const seeds = discovered.map((s) => ({ ...s, ...shared }));

  gaps.push({
    kind: 'offering_type_not_distinguished',
    detail: 'company_profiles.products_services does not separate a product from a service; offeringType abstains rather than guessing',
    count: seeds.length,
  });
  const attributed = Object.entries(shared).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (attributed.length) {
    gaps.push({
      kind: 'semantics_are_tenant_level_not_per_offering',
      detail: `company_profiles holds one row per tenant, so ${attributed.join(', ')} describe the business and are attributed to all ${seeds.length} offering(s) rather than observed per offering`,
      count: attributed.length,
    });
  }
  gaps.push({
    kind: 'facet_has_no_profile_column',
    detail: `no company_profiles column can fill: ${FACETS_WITHOUT_A_PROFILE_COLUMN.join(', ')}`,
    count: FACETS_WITHOUT_A_PROFILE_COLUMN.length,
  });

  return { seeds, gaps, curated };
}

/**
 * Build the offering context for one tenant, from the tenant's own stored profile.
 *
 * Deterministic given its inputs and `asOf`: it reads, maps and returns. It calls no clock, draws no
 * random value and writes nothing, so two builds over unchanged data produce identical contexts.
 *
 * Returns null when the tenant has no profile row at all — which is not the same as a tenant whose
 * profile names no offering. The first could not be asked; the second answered and has nothing.
 */
export async function buildTenantOfferingContext(
  input: TenantOfferingContextInput,
  ports: TenantOfferingContextPorts = defaultTenantOfferingContextPorts,
): Promise<TenantOfferingContextResult | null> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to build a tenant offering context');
  }
  if (!input.asOf?.trim()) {
    throw new Error('asOf is required — an offering understanding is never anchored to ambient time');
  }

  const row = await ports.loadProfile(input.organizationId);
  if (!row) return null;

  const { seeds, gaps, curated } = offeringSeedsFromProfile(row, input);
  const contexts: OfferingIntelligenceContext[] = seeds.map((seed) => ({
    key: { companyId: input.organizationId, offeringId: resolveOfferingId(seed.name) },
    asOf: input.asOf,
    seed,
    // No engine input: see the header. The engines abstain rather than score a tenant's own copy.
  }));

  return {
    version: TENANT_OFFERING_CONTEXT_VERSION,
    organizationId: input.organizationId,
    contexts,
    sources: { profile: true, curatedOfferingList: curated },
    gaps,
    profile: row,
  };
}
