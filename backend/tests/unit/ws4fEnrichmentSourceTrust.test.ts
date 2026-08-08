/**
 * WS-4F — the enrichment vendors must be NAMED in the company source-trust policy.
 *
 * WHY THIS SUITE EXISTS. `toFirmographicInputs` attributes each field to the provider that won it
 * (`system: field.provider`), so vendor evidence reaches fusion under an id like `clearbit`. But
 * `fuseEvidence` resolves an unlisted system to a 0.5 fallback (`weights[system] ?? 0.5`), and
 * `COMPANY_SOURCE_WEIGHTS` named only `crunchbase`. Five of the six vendors were therefore fused
 * identically: Clearbit — documented as "a stronger claim than Apollo's" — and Apollo — documented
 * as "self-reported: a materially weaker claim" — both landed on 0.35 for headcount, so a real
 * disagreement was settled by the evidence-id tie-break instead of by trust.
 *
 * Nothing here asserts a specific constant beyond the ORDERING that the adapters themselves document.
 * Pinning the numbers would make the policy unrevisable; pinning the ordering is what protects the
 * property that actually matters.
 */

import { fuseEvidence } from '../../services/intelligence/canonical';
import { ingestCompanyEvidence } from '../../services/companyIntelligence/evidence/adapters';
import { COMPANY_SOURCE_WEIGHTS } from '../../services/companyIntelligence/evidence/buildFromEvidence';
import { VENDOR_PROVIDERS } from '../../services/companyIntelligence/providers/adapters';

const ASOF = '2026-08-08T00:00:00.000Z';

/** Fused weight the policy actually grants one system for one label. */
function fusedWeight(system: string, field: Record<string, string>, label: string): number {
  const raw = ingestCompanyEvidence({
    firmographics: [{ companyId: 'c', observedAt: ASOF, system, ...field }],
  });
  const fused = fuseEvidence(raw, { sourceWeights: COMPANY_SOURCE_WEIGHTS });
  const hit = fused.fused.find((e) => e.label === label);
  if (!hit) throw new Error(`no fused evidence for ${label}`);
  return hit.weight ?? 0;
}

const headcount = (system: string) => fusedWeight(system, { headcount: '100' }, 'headcount');
const technologies = (system: string) => fusedWeight(system, { technologies: 'React' }, 'technologies');

describe('WS-4F enrichment source trust', () => {
  it('every registered vendor is named in the policy — none may fall to the default', () => {
    const unnamed = VENDOR_PROVIDERS
      .map((p) => p.id)
      .filter((id) => !Object.prototype.hasOwnProperty.call(COMPANY_SOURCE_WEIGHTS, id));

    // A vendor missing here is not a cosmetic omission: its evidence is silently fused at 0.5,
    // which is how a carefully-rated adapter becomes indistinguishable from an unrated one.
    expect(unnamed).toEqual([]);
  });

  it('a vendor claim is weighted differently from an unknown system', () => {
    // 0.5 is the fallback in fuseEvidence. If a named vendor still produced the fallback weight,
    // the policy entry would exist but not be reaching fusion.
    const unknown = headcount('some-unregistered-vendor');
    expect(headcount('clearbit')).not.toBe(unknown);
    expect(headcount('builtwith')).not.toBe(unknown);
  });

  it('preserves the calibration the adapters document: Clearbit outranks Apollo', () => {
    expect(headcount('clearbit')).toBeGreaterThan(headcount('apollo'));
  });

  it('rates OBSERVED technology above every self-asserted source', () => {
    // BuiltWith reads the live site; the others repeat what the company says about itself.
    expect(technologies('builtwith')).toBeGreaterThan(technologies('clearbit'));
    expect(technologies('builtwith')).toBeGreaterThan(technologies('apollo'));
    expect(technologies('builtwith')).toBeGreaterThan(technologies('hunter'));
  });

  it('ranks the full vendor set in the documented order', () => {
    const order = ['builtwith', 'clearbit', 'peopledatalabs', 'apollo', 'hunter'].map(headcount);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]).toBeGreaterThanOrEqual(order[i]);
  });

  it('leaves crunchbase — the one vendor already in the policy — unchanged', () => {
    expect(COMPANY_SOURCE_WEIGHTS.crunchbase).toBe(0.65);
  });

  it('keeps a user-provided profile fact above every vendor claim on a contested label', () => {
    // `industry` is the only label where a vendor and the profile compete. A vendor overtaking a
    // fact the customer typed in would be a regression, not an enrichment.
    const raw = ingestCompanyEvidence({
      profile: { companyId: 'c', observedAt: ASOF, industry: 'Healthcare SaaS' },
      ai: { companyId: 'c', observedAt: ASOF, industry: 'Software' },
      firmographics: [{ companyId: 'c', observedAt: ASOF, system: 'clearbit', industry: 'Information Technology' }],
    });
    const fused = fuseEvidence(raw, { sourceWeights: COMPANY_SOURCE_WEIGHTS });
    const ranked = fused.fused
      .filter((e) => e.label === 'industry')
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

    expect(ranked[0].source.system).toBe('company_profile');
    // …and a vendor still beats an LLM's guess, which is the point of enriching at all.
    expect(ranked[1].source.system).toBe('clearbit');
    expect(ranked[2].source.system).toBe('ai_extraction');
  });

  it('is deterministic — identical evidence fuses to identical weights', () => {
    const build = () => ingestCompanyEvidence({
      firmographics: [
        { companyId: 'c', observedAt: ASOF, system: 'clearbit', headcount: '4200', technologies: 'React' },
        { companyId: 'c', observedAt: ASOF, system: 'apollo', headcount: '900' },
      ],
    });
    const a = fuseEvidence(build(), { sourceWeights: COMPANY_SOURCE_WEIGHTS });
    const b = fuseEvidence(build(), { sourceWeights: COMPANY_SOURCE_WEIGHTS });
    expect(JSON.stringify(a.fused)).toBe(JSON.stringify(b.fused));
  });
});
