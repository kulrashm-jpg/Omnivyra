/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-009 · Phase D.2 — semantic idempotency test matrix.
 *
 * Certifies decideCanonicalPersistence + the runCanonicalShadowJob semantic no-op: the write fires only on
 * meaningful identity evolution; metadata (built_at/freshness/ordering) never writes; evidence degradation
 * does not erase identity. Cases: identical, timestamp-only, abstention→grounded (A), grounded→grounded (B),
 * grounded→different (C), grounded→abstention (D).
 */
import {
  produceShadowCanonical,
  decideCanonicalPersistence,
  runCanonicalShadowJob,
  type ShadowEvidence,
  type ShadowPersistDeps,
} from '../../services/companyIntelligence/production/canonicalShadowJob';

const ASOF = '2026-07-29T00:00:00.000Z';
const ASOF_LATER = '2026-07-30T12:34:56.000Z';
const facts = { company_id: 'embro', name: 'Embro Sales & Service', website_url: 'https://www.embrosales.in/', products_services_list: ['Advanced embroidery machines'], competitors_list: [] };

const base = {
  category: { value: 'Industrial embroidery & sewing machinery', source: 'website' },
  industry: { value: 'Manufacturing', source: 'website' },
  provider_type: { value: 'service_provider', source: 'website' },
  products_services: { value: 'embroidery machines; sewing machines', source: 'website' },
  target_audience: { value: 'garment manufacturers', source: 'website' },
  solution_domains: { value: 'embroidery; industrial equipment', source: 'website' }, // grounded in BOTH ⇒ only business_model differs
};
const EV_full = (): ShadowEvidence => ({ facts, extraction: { ...base, business_model: { value: 'B2B sales & service', source: 'website' } } });
const EV_no_bm = (): ShadowEvidence => ({ facts, extraction: { ...base } }); // only business_model abstains
const EV_diff_cat = (): ShadowEvidence => ({ facts, extraction: { ...EV_full().extraction, category: { value: 'Textile manufacturing equipment', source: 'website' } } });

const rec = (ev: ShadowEvidence, asOf = ASOF) => produceShadowCanonical(ev, asOf).record;

describe('Phase D.2 · decideCanonicalPersistence — evidence-evolution matrix', () => {
  it('INITIAL: no prior ⇒ persist', () => {
    expect(decideCanonicalPersistence(null, rec(EV_full()))).toEqual({ persist: true, reason: 'INITIAL' });
  });
  it('B grounded→same grounded (identical evidence) ⇒ no write', () => {
    expect(decideCanonicalPersistence(rec(EV_full()), rec(EV_full()))).toEqual({ persist: false, reason: 'IDENTICAL' });
  });
  it('timestamp-only (same identity, different built_at) ⇒ no write', () => {
    const older = rec(EV_full(), ASOF);
    const newer = rec(EV_full(), ASOF_LATER);
    expect(older.built_at).not.toBe(newer.built_at);        // metadata differs
    expect(decideCanonicalPersistence(older, newer)).toEqual({ persist: false, reason: 'IDENTICAL' });
  });
  it('A abstention→grounded (business_model gained) ⇒ persist IMPROVED', () => {
    expect(decideCanonicalPersistence(rec(EV_no_bm()), rec(EV_full()))).toEqual({ persist: true, reason: 'IMPROVED' });
  });
  it('C grounded→different (category changed) ⇒ persist CHANGED', () => {
    expect(decideCanonicalPersistence(rec(EV_full()), rec(EV_diff_cat()))).toEqual({ persist: true, reason: 'CHANGED' });
  });
  it('D grounded→abstention (business_model lost) ⇒ no write, DEGRADATION_PROTECTED', () => {
    expect(decideCanonicalPersistence(rec(EV_full()), rec(EV_no_bm()))).toEqual({ persist: false, reason: 'DEGRADATION_PROTECTED' });
  });
});

/** jsonb round-trip store (keys reordered, undefined dropped) to prove semantics survive persistence. */
function jsonbRoundTrip(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(jsonbRoundTrip);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).filter((k) => obj[k] !== undefined).reverse()) out[k] = jsonbRoundTrip(obj[k]);
  return out;
}
function jsonbDeps(): ShadowPersistDeps & { store: () => Record<string, unknown> | null; writes: number } {
  let rs: Record<string, unknown> | null = null;
  let writes = 0;
  return {
    readReportSettings: async () => rs,
    writeReportSettings: async (_id, next) => { rs = jsonbRoundTrip(next) as Record<string, unknown>; writes++; },
    store: () => rs,
    get writes() { return writes; },
  } as ShadowPersistDeps & { store: () => Record<string, unknown> | null; writes: number };
}

describe('Phase D.2 · runCanonicalShadowJob end-to-end (jsonb round-trip)', () => {
  it('the canary scenario: run→run(improved)→run(identical) converges to no-write', async () => {
    const deps = jsonbDeps();
    const r1 = await runCanonicalShadowJob('embro', ASOF, EV_no_bm(), deps);       // INITIAL
    const r2 = await runCanonicalShadowJob('embro', ASOF_LATER, EV_full(), deps);  // A: gained business_model + solution_domains
    const r3 = await runCanonicalShadowJob('embro', '2026-08-01T00:00:00.000Z', EV_full(), deps); // identical identity, later ts
    expect([r1.wrote, r1.reason]).toEqual([true, 'INITIAL']);
    expect([r2.wrote, r2.reason]).toEqual([true, 'IMPROVED']);
    expect([r3.wrote, r3.reason]).toEqual([false, 'IDENTICAL']); // ← timestamp-only, no write (the fix)
    expect(deps.writes).toBe(2);
  });

  it('degradation after a grounded snapshot does not erase identity (no write)', async () => {
    const deps = jsonbDeps();
    await runCanonicalShadowJob('embro', ASOF, EV_full(), deps);                    // grounded
    const degraded = await runCanonicalShadowJob('embro', ASOF_LATER, EV_no_bm(), deps); // D
    expect([degraded.wrote, degraded.reason]).toEqual([false, 'DEGRADATION_PROTECTED']);
    expect(deps.writes).toBe(1);
    // prior grounded snapshot preserved
    const canon = deps.store()!.canonical_understanding as { understanding: { facets: { worldView: { value: { businessModel?: string } } } } };
    expect(canon.understanding.facets.worldView.value.businessModel).toBeTruthy();
  });
});
