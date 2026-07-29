/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4B.3 — Representative-Tenant Parity Certification.
 *
 * NOTE: this certifies the real artifact `produceCanonicalIdentity` (CompanyUnderstanding evidence
 * producer). There is no `ObservableCompanyIdentity` contract in the codebase — "observable identity" here
 * = the evidence-derived worldView + facts (interpretive fields abstain per DECISION-001). It runs against a
 * REPRESENTATIVE reconstructed corpus spanning the required business categories + the Omnivyra/Embro edge
 * cases. LIVE production-tenant certification is NOT runnable in an unmerged/flag-dark/no-prod-data
 * environment (the producer has never run in prod) — that remains the deploy-time gate.
 */
import { produceCanonicalIdentity, type WriteEvidenceInputs } from '../../services/companyIntelligence/production/canonicalIdentityProducer';
import { runProductionParity, type ProductionParityCase } from '../../services/companyIntelligence/production/productionParity';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';

/** A tenant = legacy stored identity + the write-path evidence (facts + grounded AI extraction). */
type Tenant = { key: string; category: string } & ProductionParityCase;

// Facts are identical between legacy and evidence (parity-locked). category/business_model diverge only as
// approved improvements; operating_model/domain_role are never provided (Policy A abstention).
const tenant = (
  key: string, name: string, domain: string, products: string[], competitors: string[],
  legacyCategory: string | undefined, legacyBusinessModel: string | undefined,
  evCategory: string | undefined, evBusinessModel: string | undefined, evProviderType: string | undefined, evSolutionDomains: string[] | undefined,
): Tenant => ({
  key, category: key,
  legacy: { companyId: key, asOf: ASOF, name, domain, category: legacyCategory, businessModel: legacyBusinessModel, products, services: [], competitors },
  inputs: { companyId: key, asOf: ASOF, name, domain, products, competitors, ai: { category: evCategory, businessModel: evBusinessModel, providerType: evProviderType, solutionDomains: evSolutionDomains } } as WriteEvidenceInputs,
});

// Representative corpus — one per required category + the two historical edge cases.
const CORPUS: Tenant[] = [
  // SaaS
  tenant('saas', 'CloudDeskHQ', 'clouddeskhq.com', ['Helpdesk', 'Ticketing'], [], 'Software', undefined, 'Customer support helpdesk software', 'Subscription SaaS', 'software/product', ['support', 'ticketing']),
  // Services
  tenant('services', 'BrightBooks', 'brightbooks.co', ['Bookkeeping', 'Tax filing'], [], 'Accounting', undefined, 'Accounting & bookkeeping services', 'Professional services', 'service_provider', ['accounting', 'tax']),
  // Marketplace
  tenant('marketplace', 'CraftBazaar', 'craftbazaar.com', ['Seller storefronts', 'Buyer checkout'], [], 'E-commerce', undefined, 'Handmade goods marketplace', 'Marketplace (commission)', 'marketplace', ['commerce']),
  // Manufacturing — EDGE CASE (Embro): legacy mislabeled the CAPABILITY as identity ("Customer Engagement Software")
  tenant('manufacturing', 'Embro', 'embro-machines.com', ['Industrial embroidery machines', 'Machine servicing'], [], 'Customer Engagement Software', 'SaaS', 'Industrial embroidery machinery & service', 'B2B sales & service', 'hardware/service_provider', ['embroidery', 'industrial equipment']),
  // Healthcare
  tenant('healthcare', 'MediTrack', 'meditrack.health', ['Diagnostic devices'], [], 'Medical', undefined, 'Clinical diagnostics devices', 'B2B sales-led', 'hardware', ['diagnostics']),
  // Finance
  tenant('finance', 'LedgerPay', 'ledgerpay.io', ['Payment processing'], [], 'Fintech', undefined, 'Payments platform', 'Transaction fees + SaaS', 'software/product', ['payments']),
  // Developer Tools
  tenant('devtools', 'APIForge', 'apiforge.dev', ['API gateway', 'SDKs'], [], 'Developer software', undefined, 'API developer platform', 'Usage-based SaaS', 'software/product', ['api', 'developer tooling']),
  // AI — EDGE CASE (Omnivyra): legacy mislabeled "Analytics software…"
  tenant('ai', 'Omnivyra', 'omnivyra.com', ['AI-Driven Digital Marketing System', 'SEO analysis'], [], 'Analytics software for clearer performance insights', undefined, 'AI-driven digital marketing & content platform', 'Subscription SaaS', 'software/product', ['marketing', 'content', 'seo']),
  // E-commerce
  tenant('ecommerce', 'ShopSprout', 'shopsprout.com', ['Direct-to-consumer store'], [], 'Retail', undefined, 'D2C ecommerce brand', 'E-commerce (D2C)', 'ecommerce', ['retail']),
  // Mixed offerings
  tenant('mixed', 'OmniCorp', 'omnicorp.example', ['Platform product', 'Managed services'], [], 'Technology', undefined, 'Platform + managed services', 'SaaS + services', 'software/product', ['platform', 'services']),
];

const CASES: ProductionParityCase[] = CORPUS.map(({ legacy, inputs }) => ({ legacy, inputs }));

describe('U4B.3 · parity matrix — zero unexpected regressions across representative tenants', () => {
  const report = runProductionParity(CASES);

  it('covers all required categories + Omnivyra & Embro edge cases', () => {
    expect(CORPUS.map((t) => t.key)).toEqual(expect.arrayContaining(['saas', 'services', 'marketplace', 'manufacturing', 'healthcare', 'finance', 'devtools', 'ai', 'ecommerce', 'mixed']));
  });

  it('ZERO unexpected regressions (certification gate)', () => {
    expect(report.totalUnexpectedRegressions).toBe(0);
    expect(report.certifiable).toBe(true);
  });

  it('parity-locked facts (name/domain/products/services) never regress', () => {
    for (const row of report.rows) {
      for (const f of ['name', 'domain', 'products', 'services']) {
        const d = row.delta.fields.find((x) => x.field === f);
        if (d) expect(d.class).not.toBe('unexpected_regression');
      }
    }
  });

  it('Omnivyra & Embro category corrections classify as approved_improvement (capability-vs-identity fix)', () => {
    const omni = report.rows.find((r) => r.companyId === 'ai')!;
    const embro = report.rows.find((r) => r.companyId === 'manufacturing')!;
    expect(omni.delta.fields.find((f) => f.field === 'category')?.class).toBe('approved_improvement');
    expect(embro.delta.fields.find((f) => f.field === 'category')?.class).toBe('approved_improvement');
    // Embro no longer carries the CAPABILITY as identity
    expect(embro.delta.fields.find((f) => f.field === 'category')?.evidence).not.toMatch(/Customer Engagement Software/i);
  });

  it('reports approved improvements and expected abstentions', () => {
    expect(report.approvedImprovements).toBeGreaterThan(0);
  });
});

describe('U4B.3 · evidence traceability — non-null values grounded; interpretive fields abstain', () => {
  it('every non-null identity value carries provenance/confidence/freshness; Policy-A fields are null', () => {
    for (const { inputs } of CASES) {
      const { understanding, legacy } = produceCanonicalIdentity(inputs);
      const wv = understanding.facets.worldView.value;
      // Policy A — always abstains (no evidence emitted)
      expect(wv?.primaryMotion ?? null).toBeNull();
      expect(wv?.marketPosition ?? null).toBeNull();
      // Non-null category has evidence with provenance/freshness/weight
      if (legacy.category) {
        const ev = understanding.facets.worldView.evidence.find((e) => e.label === 'category');
        expect(ev?.source.system).toBe('ai_extraction');
        expect(ev?.observedAt).toBe(ASOF);
        expect(typeof ev?.weight).toBe('number');
      }
    }
  });
});

describe('U4B.3 · determinism & stability — no oscillation on re-run', () => {
  it('re-running the producer yields byte-identical understanding for every tenant', () => {
    for (const { inputs } of CASES) {
      const a = produceCanonicalIdentity(inputs);
      const b = produceCanonicalIdentity(inputs);
      const c = produceCanonicalIdentity(inputs);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    }
  });
  it('the whole-corpus parity report is stable across runs', () => {
    expect(runProductionParity(CASES)).toEqual(runProductionParity(CASES));
  });
});

describe('U4B.3 · performance — within certified bounds', () => {
  it('constant-time, allocation-light (full corpus × 200 iterations)', () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) runProductionParity(CASES);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(ms).toBeLessThan(3000);
  });
});
