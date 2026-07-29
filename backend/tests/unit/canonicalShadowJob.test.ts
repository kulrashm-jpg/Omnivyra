/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-004 · Phase C — Producer Isolation certification.
 *
 * Certifies the isolated producer-only path: grounded evidence → A.5 producer → persist ONLY
 * report_settings.canonical_understanding. Proves persistence isolation (no legacy identity / sibling key /
 * refresh_history mutation), idempotency (unchanged evidence ⇒ identical record + zero extra mutation),
 * evidence-derivation + abstention, and independence from legacy pollution.
 */
import {
  produceShadowCanonical,
  applyCanonicalUnderstandingOnly,
  runCanonicalShadowJob,
  type ShadowEvidence,
  type ShadowPersistDeps,
} from '../../services/companyIntelligence/production/canonicalShadowJob';

const ASOF = '2026-07-29T00:00:00.000Z';

// Embro grounded evidence: manufacturing identity from AI extraction; facts.industry deliberately polluted.
const EMBRO_EVIDENCE = (pollutedIndustry?: string): ShadowEvidence => ({
  facts: {
    company_id: 'embro', name: 'Embro Sales & Service', website_url: 'https://www.embrosales.in/',
    products_services_list: ['Advanced embroidery machines', 'Industrial sewing machines', 'Genuine spare parts'],
    industry: pollutedIndustry, competitors_list: [],
  },
  extraction: {
    category: { value: 'Industrial embroidery & sewing machinery and service', source: 'website' },
    industry: { value: 'Manufacturing', source: 'website' },
    products_services: { value: 'embroidery machines; sewing machines', source: 'website' },
    target_audience: { value: 'garment manufacturers; embroidery businesses', source: 'website' },
    business_model: { value: 'B2B sales & service', source: 'website' },
    provider_type: { value: 'hardware & service provider', source: 'website' },
    solution_domains: { value: 'embroidery; industrial equipment', source: 'website' },
  },
});

// A realistic existing report_settings (the sibling keys that MUST remain byte-identical).
const EXISTING_RS = () => ({
  market_pulse: { competitor_details: [{ name: 'X' }], v: 1 },
  industry_review: { user_industry: 'Customer Engagement, Decision Support', conflict: false },
  entity_archetype: { source: 'heuristic', primary_archetype: 'HYBRID_ENTITY', inferred_at: '2026-07-29T13:04:33.236Z' },
  refresh_history: [{ at: '2026-07-29T13:05:08.731Z', action: 'REFRESH_FULL' }],
  knowledge_version: 4,
  knowledge_snapshots: [{ entity: { version: 1 } }],
  competitor_intelligence: [{ name: 'Y' }],
});

function memoryDeps(initial: Record<string, unknown> | null): ShadowPersistDeps & { store: () => Record<string, unknown> | null; writes: number } {
  let rs = initial;
  let writes = 0;
  return {
    readReportSettings: async () => rs,
    writeReportSettings: async (_id, next) => { rs = next; writes++; },
    store: () => rs,
    get writes() { return writes; },
  } as ShadowPersistDeps & { store: () => Record<string, unknown> | null; writes: number };
}

describe('Phase C · persistence isolation (only canonical_understanding changes)', () => {
  it('pure merge preserves every sibling report_settings key byte-identical', () => {
    const existing = EXISTING_RS();
    const { record } = produceShadowCanonical(EMBRO_EVIDENCE(), ASOF);
    const merged = applyCanonicalUnderstandingOnly(existing, record);
    for (const k of Object.keys(existing)) {
      expect(merged[k]).toEqual((existing as Record<string, unknown>)[k]); // untouched
    }
    expect(merged.canonical_understanding).toEqual(record); // additive
    // The original object is not mutated in place.
    expect('canonical_understanding' in existing).toBe(false);
  });

  it('job writes ONLY report_settings; legacy identity columns are never in the persistence surface', () => {
    const deps = memoryDeps(EXISTING_RS());
    // The ShadowPersistDeps contract can ONLY carry report_settings — there is no channel to write
    // industry/category/entity_archetype/refresh_history columns. This is the structural isolation guarantee.
    return runCanonicalShadowJob('embro', ASOF, EMBRO_EVIDENCE(), deps).then((res) => {
      expect(res.wrote).toBe(true);
      const rs = deps.store()!;
      // sibling keys preserved
      expect(rs.entity_archetype).toEqual(EXISTING_RS().entity_archetype);
      expect(rs.industry_review).toEqual(EXISTING_RS().industry_review);
      expect(rs.refresh_history).toEqual(EXISTING_RS().refresh_history);
      expect(rs.market_pulse).toEqual(EXISTING_RS().market_pulse);
      // only canonical_understanding added
      expect(rs.canonical_understanding).toBeDefined();
    });
  });
});

describe('Phase C · idempotency (unchanged evidence ⇒ identical record + zero extra mutation)', () => {
  it('second run with identical evidence is a no-op (wrote=false) and leaves report_settings identical', async () => {
    const deps = memoryDeps(EXISTING_RS());
    const first = await runCanonicalShadowJob('embro', ASOF, EMBRO_EVIDENCE(), deps);
    const afterFirst = JSON.stringify(deps.store());
    const second = await runCanonicalShadowJob('embro', ASOF, EMBRO_EVIDENCE(), deps);
    const afterSecond = JSON.stringify(deps.store());
    expect(first.wrote).toBe(true);
    expect(second.wrote).toBe(false);          // idempotent skip
    expect(afterSecond).toBe(afterFirst);      // zero additional mutation
    expect(deps.writes).toBe(1);               // exactly one write across two runs
  });
});

describe('Phase C · evidence-derivation, abstention, and no legacy pollution', () => {
  it('canonical is evidence-derived and never inherits legacy pollution even with polluted facts.industry', () => {
    const { record } = produceShadowCanonical(EMBRO_EVIDENCE('Customer Engagement, Decision Support'), ASOF);
    const blob = JSON.stringify(record).toLowerCase();
    expect(blob).not.toMatch(/customer engagement|decision support|retention and lifecycle/);
    expect(record.identity_source).toBe('evidence');
    expect(record.understanding.facets.worldView.value?.category).toMatch(/embroidery|machinery/i);
  });

  it('with no grounded evidence, interpretive identity fields abstain (never fabricated)', () => {
    const { record, abstained } = produceShadowCanonical(
      { facts: { company_id: 'bare', name: 'Bare Co', website_url: 'bare.example' }, extraction: null },
      ASOF,
    );
    expect(abstained).toEqual(expect.arrayContaining(['category', 'business_model', 'provider_type', 'solution_domains']));
    expect(record.understanding.facets.worldView.value?.category ?? null).toBeNull();
  });
});
