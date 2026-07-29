/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4.6 — Evidence Expansion (DECISION-001).
 *
 * Certifies business_model / provider_type / solution_domains are EVIDENCE-derived (Policy B) from grounded
 * AI extraction, while operating_model / domain_role honestly ABSTAIN (Policy A). No heuristics/keyword
 * ladders. Types: Evidence Extraction · Adapter · Resolution · Abstention · Grounding · Provenance ·
 * Confidence · Regression · Performance.
 */
import { aiExtractionEvidence, buildCompanyUnderstandingFromEvidence, type EvidenceSources } from '../../services/companyIntelligence/evidence';
import { produceCanonicalIdentity, writeInputsFromProfileAndExtraction } from '../../services/companyIntelligence/production/canonicalIdentityProducer';

const ASOF = '2026-07-28T00:00:00.000Z';

describe('U4.6 · evidence extraction + adapter (Policy B fields emit EvidenceRefs)', () => {
  it('aiExtractionEvidence emits business_model / provider_type / solution_domains as ai_generated evidence', () => {
    const evs = aiExtractionEvidence({ companyId: 'c', observedAt: ASOF, businessModel: 'Subscription SaaS', providerType: 'software/product', solutionDomains: ['marketing', 'content'] });
    const by = Object.fromEntries(evs.map((e) => [e.label, e]));
    for (const label of ['business_model', 'provider_type', 'solution_domains']) {
      expect(by[label]).toBeDefined();
      expect(by[label].source.system).toBe('ai_extraction'); // provenance
      expect(by[label].kind).toBe('ai_generated');
      expect(by[label].observedAt).toBe(ASOF);               // freshness
      expect(typeof by[label].weight).toBe('number');        // confidence weight
    }
    expect(by['business_model'].value).toBe('Subscription SaaS');
  });
});

describe('U4.6 · evidence resolution (into canonical worldView, no special-case logic)', () => {
  it('resolves business_model / provider_type / solution_domains from evidence', () => {
    const sources: EvidenceSources = { ai: { companyId: 'c', observedAt: ASOF, category: 'X', businessModel: 'Subscription SaaS', providerType: 'software/product', solutionDomains: ['marketing', 'content'] } };
    const wv = buildCompanyUnderstandingFromEvidence(sources, ASOF).facets.worldView.value;
    expect(wv?.businessModel).toBe('Subscription SaaS');
    expect(wv?.providerType).toBe('software/product');
    expect(wv?.solutionDomains).toEqual(['marketing', 'content']);
  });
});

describe('U4.6 · abstention — Policy A fields and unevidenced Policy B', () => {
  it('operating_model / domain_role ABSTAIN (Policy A); Policy B abstains when unevidenced', () => {
    const sources: EvidenceSources = { ai: { companyId: 'c', observedAt: ASOF, category: 'X' } }; // no interpretive evidence
    const wv = buildCompanyUnderstandingFromEvidence(sources, ASOF).facets.worldView.value;
    expect(wv?.primaryMotion ?? null).toBeNull();     // operating_model — abstain (no evidence work)
    expect(wv?.marketPosition ?? null).toBeNull();    // domain_role — abstain
    expect(wv?.businessModel ?? null).toBeNull();     // Policy B, unevidenced → abstain (never fabricate)
    expect(wv?.providerType ?? null).toBeNull();
    expect(wv?.solutionDomains ?? null).toBeNull();
  });
});

describe('U4.6 · grounding — quote-or-abstain (only website/user-sourced extraction accepted)', () => {
  it('grounded (website) values flow; inferred/missing abstain', () => {
    const inputs = writeInputsFromProfileAndExtraction(
      { company_id: 'c', name: 'X', website_url: 'x.com' },
      {
        business_model: { value: 'Subscription', source: 'website', confidence: 'High' },
        provider_type: { value: 'agency', source: 'inferred', confidence: 'Low' },   // NOT grounded → abstain
        solution_domains: { value: ['a', 'b'], source: 'website', confidence: 'Medium' },
      } as never,
      ASOF,
    );
    expect(inputs.ai?.businessModel).toBe('Subscription');   // grounded
    expect(inputs.ai?.providerType).toBeUndefined();          // inferred ⇒ abstain
    expect(inputs.ai?.solutionDomains).toEqual(['a', 'b']);   // grounded
  });
  it('missing-source extraction abstains (never fabricated)', () => {
    const inputs = writeInputsFromProfileAndExtraction(
      { company_id: 'c', name: 'X' },
      { business_model: { value: 'Guessed', source: 'missing', confidence: 'Low' } } as never,
      ASOF,
    );
    expect(inputs.ai?.businessModel).toBeUndefined();
  });
});

describe('U4.6 · producer end-to-end + regression', () => {
  it('produceCanonicalIdentity surfaces grounded Policy B fields; Policy A abstains', () => {
    const inputs = writeInputsFromProfileAndExtraction(
      { company_id: 'omnivyra', name: 'Omnivyra', website_url: 'omnivyra.com', products_services_list: ['AI marketing system'] },
      {
        category: { value: 'AI-driven digital marketing & content platform', source: 'website', confidence: 'High' },
        business_model: { value: 'Subscription SaaS', source: 'website', confidence: 'High' },
        provider_type: { value: 'software/product', source: 'website', confidence: 'High' },
        solution_domains: { value: ['marketing', 'content', 'seo'], source: 'website', confidence: 'High' },
      } as never,
      ASOF,
    );
    const { understanding, legacy } = produceCanonicalIdentity(inputs);
    const wv = understanding.facets.worldView.value;
    expect(legacy.category).toBe('AI-driven digital marketing & content platform');
    expect(legacy.business_model).toBe('Subscription SaaS'); // now evidence-derived (was abstaining in U4.5)
    expect(wv?.providerType).toBe('software/product');
    expect(wv?.solutionDomains).toEqual(['marketing', 'content', 'seo']);
    expect(wv?.primaryMotion ?? null).toBeNull();  // operating_model still abstains (Policy A)
    expect(wv?.marketPosition ?? null).toBeNull(); // domain_role still abstains (Policy A)
  });
  it('is deterministic and fast (1000 runs)', () => {
    const inputs = writeInputsFromProfileAndExtraction({ company_id: 'c', name: 'X' }, { business_model: { value: 'SaaS', source: 'website' } } as never, ASOF);
    expect(produceCanonicalIdentity(inputs)).toEqual(produceCanonicalIdentity(inputs));
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) produceCanonicalIdentity(inputs);
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(3000);
  });
});
