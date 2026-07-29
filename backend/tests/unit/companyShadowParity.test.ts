/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U0 — Shadow Parity.
 *
 * Runs the canonical Company Understanding in shadow over a representative corpus (Omnivyra reconstructed
 * from production + archetypes) and asserts: (1) adoption is byte-safe — canonical faithfully round-trips
 * the legacy profile (parity 1.0), (2) the harness is deterministic and mutates nothing, (3) the Omnivyra
 * fixture confirms the canonical currently ADOPTS the legacy value (the U1 gate finding). Zero production
 * impact: pure harness, no flag flip, no request path.
 */
import { runCompanyShadowParity } from '../../services/companyIntelligence/shadowParityHarness';
import type { CompanyProfileInput } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';

// Omnivyra — reconstructed from the production company-profile screenshots (the failing case, fixture #1).
const OMNIVYRA: CompanyProfileInput = {
  companyId: 'omnivyra',
  asOf: ASOF,
  name: 'Omnivyra',
  domain: 'omnivyra.com',
  category: 'Analytics software for clearer performance insights', // legacy (wrong) value, verbatim
  industry: 'Marketing Technology, Data & Analytics, Communication',
  products: [
    'AI-Driven Digital Marketing System',
    'SEO and website health analysis',
    'Campaign planning and execution',
    'Content performance tracking',
  ],
  services: [],
  competitors: [], // the empty-competitors symptom
};

// Archetype corpus (parity must hold across company shapes).
const CORPUS: CompanyProfileInput[] = [
  OMNIVYRA,
  { companyId: 'bi-co', asOf: ASOF, name: 'InsightGrid', domain: 'insightgrid.com', category: 'Business intelligence dashboards', businessModel: 'subscription', products: ['BI dashboards', 'reporting'], services: [], competitors: ['Tableau', 'Looker'] },
  { companyId: 'agency', asOf: ASOF, name: 'BrightReach', domain: 'brightreach.com', category: 'Digital marketing agency', businessModel: 'services', products: [], services: ['SEO', 'paid media', 'content'], competitors: ['WebFX'] },
  { companyId: 'saas', asOf: ASOF, name: 'FlowDesk', domain: 'flowdesk.com', category: 'Customer support platform', businessModel: 'subscription', products: ['helpdesk', 'inbox'], services: [], competitors: ['Zendesk', 'Intercom'] },
  { companyId: 'services', asOf: ASOF, name: 'Ledgerly', domain: 'ledgerly.com', category: 'Accounting services', businessModel: 'services', products: [], services: ['bookkeeping', 'tax'], competitors: [] },
];

describe('U0 · shadow parity — adoption is byte-safe (canonical round-trips legacy)', () => {
  it('overall + per-field parity is 1.0 across the corpus', () => {
    const report = runCompanyShadowParity(CORPUS);
    expect(report.overallParity).toBe(1);
    expect(report.fullMatch).toBe(CORPUS.length);
    expect(report.withDivergence).toBe(0);
    for (const f of report.perField) expect(f.rate).toBe(1);
    // the 7 compared fields are all present in the aggregation
    expect(report.perField.map((f) => f.field).sort()).toEqual(['business_model', 'category', 'competitors', 'domain', 'name', 'products', 'services']);
  });

  it('Omnivyra: canonical ADOPTS the legacy category verbatim (no divergence at U0 — the U1 gate)', () => {
    const report = runCompanyShadowParity([OMNIVYRA]);
    const omni = report.companies.find((c) => c.companyId === 'omnivyra')!;
    expect(omni.parity).toBe(1); // canonical == legacy: category stays "Analytics software…" (adopted, not corrected)
    expect(omni.divergences).toEqual([]); // the semantic fix requires raw evidence (U1), not shadow parity (U0)
  });

  it('is deterministic and does not mutate the input corpus', () => {
    const snapshot = JSON.stringify(CORPUS);
    const r1 = runCompanyShadowParity(CORPUS);
    const r2 = runCompanyShadowParity(CORPUS);
    expect(r2).toEqual(r1);
    expect(JSON.stringify(CORPUS)).toBe(snapshot); // input not mutated
  });
});
