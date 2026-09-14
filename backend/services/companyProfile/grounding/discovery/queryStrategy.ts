/**
 * CPG-006 — field-specific query construction (§5).
 *
 * Searching the bare company name for every field is the failure this file
 * exists to prevent: it returns the homepage for all of them, which is the one
 * source the registry marks `neverFor` revenue. The query must express the
 * CLAIM being sought, not merely the company.
 *
 * ⚠️ THE QUERY IS NEVER EVIDENCE. Asking "Cloudflare annual revenue" asserts
 * nothing about Cloudflare's revenue. Queries shape discovery only; every value
 * still has to survive retrieval, entity resolution, field authority and the
 * resolver.
 *
 * Queries are bounded (two per field, per DISCOVERY_LIMITS) and deterministic —
 * the same company and field always produce the same queries, so a discovery run
 * is reproducible.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Query templates per field. `{c}` is the company name. */
const FIELD_QUERIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ceo: ['{c} CEO', '{c} leadership team'],
  founder: ['{c} founder', '{c} founded by'],
  leadership: ['{c} leadership team', '{c} executive team'],

  revenue: ['{c} annual revenue', '{c} financial results annual report'],
  annual_revenue: ['{c} annual revenue', '{c} annual report financials'],

  funding: ['{c} funding round raised', '{c} investment series'],
  valuation: ['{c} valuation', '{c} valued at funding'],

  products_services: ['{c} products and services', '{c} platform overview'],
  company_description: ['{c} company overview', '{c} about the company'],

  founded_year: ['{c} founded year', '{c} company history'],
  employee_count: ['{c} number of employees', '{c} headcount'],
  headquarters: ['{c} headquarters location', '{c} head office'],
  industry: ['{c} industry sector', '{c} what does the company do'],

  expansion: ['{c} expansion new market', '{c} opens office'],
  growth_signal: ['{c} growth announcement', '{c} milestone announcement'],
});

/**
 * Fields Omnivyra DERIVES rather than observes. Discovery is refused for them:
 * searching "{c} ideal customer profile" returns marketing copy, and treating
 * that as evidence of an ICP would launder synthesis into fact.
 */
export const NON_DISCOVERABLE_FIELDS: ReadonlySet<string> = new Set([
  'ideal_customer_profile', 'target_audience', 'pain_symptoms',
  'brand_voice', 'brand_positioning', 'content_themes', 'competitive_advantages',
  'unique_value',
]);

export interface QueryPlan {
  field: string;
  queries: string[];
  /** Null when discoverable; a reason when discovery is deliberately refused. */
  refusedReason: string | null;
}

export function buildQueryPlan(companyName: string, field: string): QueryPlan {
  const c = companyName.trim();
  if (!c) return { field, queries: [], refusedReason: 'no company name supplied' };

  if (NON_DISCOVERABLE_FIELDS.has(field)) {
    return {
      field, queries: [],
      refusedReason:
        `"${field}" is Omnivyra synthesis, not an observable public fact. Search would return marketing copy, ` +
        'and promoting that to evidence would launder interpretation into fact.',
    };
  }

  const templates = FIELD_QUERIES[field];
  if (!templates) {
    return { field, queries: [], refusedReason: `no query strategy defined for field "${field}"` };
  }
  return { field, queries: templates.map((t) => t.replace('{c}', c)), refusedReason: null };
}

export function isDiscoverable(field: string): boolean {
  return !NON_DISCOVERABLE_FIELDS.has(field) && Boolean(FIELD_QUERIES[field]);
}

export function discoverableFields(): string[] {
  return Object.keys(FIELD_QUERIES).sort();
}
