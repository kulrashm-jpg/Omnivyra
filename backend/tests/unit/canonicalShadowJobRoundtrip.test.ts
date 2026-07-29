/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-008 · Phase D.1 — round-trip-safe idempotency integration test.
 *
 * Reproduces the production defect: the canary's second run re-wrote because the idempotency check compared
 * a Postgres-jsonb-round-tripped `prior` (key order NOT preserved) against a freshly-produced in-memory
 * `record` via JSON.stringify. This test persists → reloads through a faithful jsonb round-trip (keys
 * reordered, undefined dropped) → reruns, and asserts ZERO additional writes with the stable comparison.
 */
import { runCanonicalShadowJob, type ShadowEvidence, type ShadowPersistDeps } from '../../services/companyIntelligence/production/canonicalShadowJob';

const ASOF = '2026-07-29T00:00:00.000Z';

const EVIDENCE: ShadowEvidence = {
  facts: { company_id: 'embro', name: 'Embro Sales & Service', website_url: 'https://www.embrosales.in/', products_services_list: ['Advanced embroidery machines'], competitors_list: [] },
  extraction: {
    category: { value: 'Industrial embroidery & sewing machinery', source: 'website' },
    industry: { value: 'Manufacturing', source: 'website' },
    business_model: { value: 'B2B sales & service', source: 'website' },
    provider_type: { value: 'hardware & service provider', source: 'website' },
    solution_domains: { value: 'embroidery; industrial equipment', source: 'website' },
  },
};

/** Faithful Postgres jsonb simulation: object key order is NOT preserved (reversed here) and undefined is dropped. */
function jsonbRoundTrip(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(jsonbRoundTrip);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).filter((k) => obj[k] !== undefined).reverse()) out[k] = jsonbRoundTrip(obj[k]);
  return out;
}

function jsonbDeps(initial: Record<string, unknown>): ShadowPersistDeps & { store: () => Record<string, unknown>; writes: number } {
  let rs = jsonbRoundTrip(initial) as Record<string, unknown>;
  let writes = 0;
  return {
    readReportSettings: async () => rs,
    writeReportSettings: async (_id, next) => { rs = jsonbRoundTrip(next) as Record<string, unknown>; writes++; },
    store: () => rs,
    get writes() { return writes; },
  } as ShadowPersistDeps & { store: () => Record<string, unknown>; writes: number };
}

describe('Phase D.1 · idempotency survives a PostgreSQL jsonb round-trip', () => {
  it('persist → reload (jsonb round-trip) → rerun ⇒ zero additional writes', async () => {
    const deps = jsonbDeps({ market_pulse: { keep: true }, entity_archetype: { a: 1, b: 2 } });
    const first = await runCanonicalShadowJob('embro', ASOF, EVIDENCE, deps);   // persist
    const afterFirst = JSON.stringify(deps.store());                            // reloaded (round-tripped)
    const second = await runCanonicalShadowJob('embro', ASOF, EVIDENCE, deps);  // rerun
    expect(first.wrote).toBe(true);
    expect(second.wrote).toBe(false);            // FIXED — stable comparison detects the unchanged snapshot
    expect(deps.writes).toBe(1);                 // exactly one physical write across two runs
    expect(JSON.stringify(deps.store())).toBe(afterFirst); // no mutation on rerun
    // isolation preserved through round-trips
    expect(deps.store().market_pulse).toEqual({ keep: true });
    expect(deps.store().canonical_understanding).toBeDefined();
  });

  it('a genuinely different snapshot (different asOf) still writes', async () => {
    const deps = jsonbDeps({});
    await runCanonicalShadowJob('embro', ASOF, EVIDENCE, deps);
    const changed = await runCanonicalShadowJob('embro', '2026-07-30T00:00:00.000Z', EVIDENCE, deps);
    expect(changed.wrote).toBe(true);            // built_at differs ⇒ not a no-op
    expect(deps.writes).toBe(2);
  });
});
