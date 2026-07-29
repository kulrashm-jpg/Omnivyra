/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U-1 — Projection Certification.
 *
 * Locks LAW 3: every canonical projection is PURE, DETERMINISTIC, STATELESS, and VERSIONED, and NEVER
 * infers / classifies / runs regex classification / calls AI / reads raw evidence. Certifies the two
 * projection functions on the canonical Company Understanding capability — `projectCompany` and the legacy
 * compat projection `toLegacyFields` — plus a static source-scan guard so a future edit cannot smuggle
 * inference into a projection.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  companyFromProfile,
  buildCompanyUnderstanding,
  projectCompany,
  toLegacyFields,
} from '../../services/companyIntelligence';
import type { CompanyProfileInput, CompanyUnderstanding } from '../../services/companyIntelligence';

const ASOF = '2026-07-28T00:00:00.000Z';

const profile = (over: Partial<CompanyProfileInput> = {}): CompanyProfileInput => ({
  companyId: 'C1',
  asOf: ASOF,
  name: 'Acme',
  domain: 'acme.com',
  category: 'SaaS',
  businessModel: 'subscription',
  products: ['Widget', 'Gadget'],
  services: [],
  competitors: ['RivalCo'],
  ...over,
});

const build = (p: CompanyProfileInput = profile()): CompanyUnderstanding => {
  const a = companyFromProfile(p);
  return buildCompanyUnderstanding({ key: { companyId: p.companyId }, builtAt: ASOF, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
};

describe('U-1 · projectCompany — pure / deterministic / versioned / no mutation', () => {
  it('is idempotent, versioned, and does not mutate the understanding', () => {
    const u = build();
    const before = JSON.stringify(u);
    const p1 = projectCompany(u, ASOF);
    const p2 = projectCompany(u, ASOF);
    expect(p2).toEqual(p1); // idempotent / pure
    expect(p1.version).toBe(u.version); // versioned (carries the understanding version)
    expect(p1.projectedAt).toBe(ASOF); // deterministic timestamp is passed in, never generated
    expect(JSON.stringify(u)).toBe(before); // input not mutated
  });
  it('is deterministic across independent builds of the same profile+asOf', () => {
    expect(projectCompany(build(), ASOF)).toEqual(projectCompany(build(), ASOF));
  });
});

describe('U-1 · toLegacyFields — pure / deterministic / honest empty-state', () => {
  it('is idempotent and does not mutate the understanding', () => {
    const u = build();
    const before = JSON.stringify(u);
    expect(toLegacyFields(u)).toEqual(toLegacyFields(u));
    expect(JSON.stringify(u)).toBe(before);
  });
  it('reads decided facet values (no re-derivation)', () => {
    const legacy = toLegacyFields(build());
    expect(legacy.name).toBe('Acme');
    expect(legacy.products).toEqual(['Widget', 'Gadget']);
    expect(legacy.competitors).toEqual(['RivalCo']);
  });
  it('abstains (no fabrication) when the profile carries no identity evidence', () => {
    const legacy = toLegacyFields(build(profile({ name: undefined, domain: undefined, category: undefined, businessModel: undefined, products: [], services: [], competitors: [] })));
    expect(legacy.name).toBeNull();
    expect(legacy.domain).toBeNull();
    expect(legacy.category).toBeNull();
    expect(legacy.products).toEqual([]);
    expect(legacy.competitors).toEqual([]);
  });
});

describe('U-1 · LAW-3 source guard — projections contain no inference / AI / regex-classify / clock / raw-evidence', () => {
  const projectionFiles = ['projection.ts', 'persistence.ts'];
  const forbidden: [string, RegExp][] = [
    ['wall-clock (Date.now/new Date)', /Date\.now|new Date\(/],
    ['randomness (Math.random)', /Math\.random/],
    ['AI gateway / LLM call', /aiGateway|runCompletion|runCompletionWithOperation|openai|anthropic/i],
    ['regex classification', /new RegExp|\.exec\(|\.test\(/],
    ['raw-evidence / network read', /\bcrawl\b|fetch\(|safeFetch|readEvidence|getWebsiteSnapshot/],
  ];
  it.each(projectionFiles)('%s performs no forbidden projection operation', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'companyIntelligence', file), 'utf8');
    for (const [label, pattern] of forbidden) {
      expect([label, pattern.test(src)]).toEqual([label, false]);
    }
  });
});
