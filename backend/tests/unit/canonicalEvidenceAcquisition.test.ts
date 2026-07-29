/**
 * PRODUCTION-IDENTITY-IMPLEMENTATION-006 · Phase C.5 — Grounded Evidence Acquisition Isolation cert.
 *
 * Certifies that acquireGroundedEvidence: (a) produces ShadowEvidence with NO writes/persistence,
 * (b) is deterministic given identical inputs, (c) is LOOP-FREE — the polluted stored identity
 * (industry/category/entity_archetype/industry_review) never reaches the archetype, the extraction prompt,
 * or the returned facts, (d) feeds runCanonicalShadowJob directly, (e) handles missing website.
 */
import {
  acquireGroundedEvidence,
  toLoopFreeProfile,
  type AcquisitionDeps,
} from '../../services/companyIntelligence/production/canonicalEvidenceAcquisition';
import { runCanonicalShadowJob, type ShadowPersistDeps } from '../../services/companyIntelligence/production/canonicalShadowJob';

const CRAWL_SUMMARIES = [
  { label: 'home', url: 'https://www.embrosales.in/', summary: 'Embro Sales & Service — advanced embroidery machines, industrial sewing machines, installation & technical support.' },
  { label: 'products', url: 'https://www.embrosales.in/products', summary: 'SWF embroidery machines, Sunstar industrial sewing systems, genuine spare parts.' },
];
const MODEL_JSON = JSON.stringify({
  company_name: { value: 'Embro Sales & Service', source: 'website' },
  industry_list: { values: ['Manufacturing'], source: 'website' },
  category_list: { values: ['Industrial embroidery & sewing machinery'], source: 'website' },
  products_services: { value: 'embroidery machines; sewing machines', source: 'website' },
  business_model: { value: 'B2B sales & service', source: 'website' },
  provider_type: { value: 'hardware & service provider', source: 'website' },
  solution_domains: { values: ['embroidery', 'industrial equipment'], source: 'website' },
});

// A stored profile whose DERIVED identity is polluted (the Embro incident).
const embroProfile = (industry: string, category: string): any => ({
  company_id: 'embro', name: 'Embro Sales & Service', website_url: 'https://www.embrosales.in/',
  products_services: 'Advanced embroidery machines, Industrial sewing machines',
  products_services_list: ['Advanced embroidery machines', 'Industrial sewing machines'],
  competitors: null, competitors_list: [],
  industry, category, social_profiles: [],
  report_settings: {
    entity_archetype: { primary_archetype: 'HYBRID_ENTITY', source: 'heuristic' },
    industry_review: { user_industry: industry, conflict: false },
    market_pulse: { keep: true },
  },
});

function deps(profile: any, capture?: { prompts: Array<{ system: string; user: string }> }): AcquisitionDeps {
  return {
    loadProfile: async () => profile,
    crawl: async () => CRAWL_SUMMARIES,
    cleanEvidence: async (_id, s) => s, // identity cleaner for determinism
    runModel: async ({ system, user }) => { capture?.prompts.push({ system, user }); return MODEL_JSON; },
  };
}

describe('Phase C.5 · determinism (identical inputs ⇒ identical ShadowEvidence)', () => {
  it('two runs produce byte-identical evidence', async () => {
    const p = embroProfile('Customer Engagement, Decision Support', 'Customer engagement software for retention and lifecycle growth');
    const a = await acquireGroundedEvidence('embro', deps(p));
    const b = await acquireGroundedEvidence('embro', deps(p));
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
    expect(a.evidence).not.toBeNull();
  });
});

describe('Phase C.5 · loop-free (polluted stored identity never reaches archetype / prompt / facts)', () => {
  it('the extraction prompt is invariant to the stored industry/category and contains no pollution tokens', async () => {
    const capPolluted = { prompts: [] as Array<{ system: string; user: string }> };
    const capClean = { prompts: [] as Array<{ system: string; user: string }> };
    await acquireGroundedEvidence('embro', deps(embroProfile('Customer Engagement, Decision Support', 'Customer engagement software for retention and lifecycle growth'), capPolluted));
    await acquireGroundedEvidence('embro', deps(embroProfile('Manufacturing', 'Embroidery machinery'), capClean));
    // Same prompt regardless of the (polluted vs different) stored identity ⇒ identity does not influence extraction.
    expect(JSON.stringify(capPolluted.prompts)).toBe(JSON.stringify(capClean.prompts));
    // And the prompt never carries the pollution tokens.
    const blob = JSON.stringify(capPolluted.prompts).toLowerCase();
    expect(blob).not.toMatch(/customer engagement|decision support|retention and lifecycle/);
  });

  it('returned facts carry NO industry/category (loop-free facts)', async () => {
    const p = embroProfile('Customer Engagement, Decision Support', 'Customer engagement software for retention and lifecycle growth');
    const { evidence } = await acquireGroundedEvidence('embro', deps(p));
    const factsBlob = JSON.stringify(evidence!.facts).toLowerCase();
    expect(factsBlob).not.toMatch(/customer engagement|decision support/);
    expect((evidence!.facts as Record<string, unknown>).industry ?? null).toBeNull();
    expect((evidence!.facts as Record<string, unknown>).category ?? null).toBeNull();
  });

  it('toLoopFreeProfile strips derived identity but keeps observable facts', () => {
    const lf: any = toLoopFreeProfile(embroProfile('X', 'Y'));
    expect(lf.industry).toBe('');
    expect(lf.category).toBe('');
    expect(lf.report_settings.entity_archetype).toBeUndefined();
    expect(lf.report_settings.industry_review).toBeUndefined();
    expect(lf.report_settings.market_pulse).toEqual({ keep: true }); // observable siblings preserved
    expect(lf.name).toBe('Embro Sales & Service');
  });
});

describe('Phase C.5 · integration + failure handling', () => {
  it('acquired evidence feeds runCanonicalShadowJob and yields a clean canonical', async () => {
    const p = embroProfile('Customer Engagement, Decision Support', 'Customer engagement software for retention and lifecycle growth');
    const { evidence } = await acquireGroundedEvidence('embro', deps(p));
    let stored: Record<string, unknown> | null = { market_pulse: { keep: true } };
    const persist: ShadowPersistDeps = {
      readReportSettings: async () => stored,
      writeReportSettings: async (_id, rs) => { stored = rs; },
    };
    const res = await runCanonicalShadowJob('embro', '2026-07-29T00:00:00.000Z', evidence!, persist);
    expect(res.wrote).toBe(true);
    expect((stored as Record<string, unknown>).canonical_understanding).toBeDefined();
    expect((stored as Record<string, unknown>).market_pulse).toEqual({ keep: true }); // isolation preserved
    expect(JSON.stringify(stored).toLowerCase()).not.toMatch(/customer engagement|decision support/);
  });

  it('no website ⇒ evidence null + NO_WEBSITE (no crash, no writes)', async () => {
    const p = { company_id: 'x', name: 'X', website_url: null };
    const { evidence, observability } = await acquireGroundedEvidence('x', { ...deps(p), loadProfile: async () => p as any });
    expect(evidence).toBeNull();
    expect(observability.validationFailures).toContain('NO_WEBSITE');
  });
});
