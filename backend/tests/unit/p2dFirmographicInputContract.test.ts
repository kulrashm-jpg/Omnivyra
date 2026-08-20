/**
 * P2D — an operator-supplied record can now carry employer firmographics.
 *
 * The path was built by P2A/P2B/P2C but nothing fed it: the released adapters
 * populated the nested account with identity only, so the firmographic surface
 * was dormant. This closes that, and the tests concentrate on the two ways it
 * could go wrong — inventing an employer that does not exist, and normalising
 * twice.
 */

import {
  toNormalizedManualRecord,
  manualAdapter,
  type ManualLeadInput,
} from '../../services/leadIngestion/adapters/manualAdapter';
import {
  toNormalizedCrmRecord,
  crmAdapter,
  type CrmLeadInput,
} from '../../services/leadIngestion/adapters/crmAdapter';
import { toAccountAttributes } from '../../services/prospectIdentity/attributes';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const base: ManualLeadInput = { organizationId: ORG, referenceId: 'OP-1' };

const FIRMOGRAPHICS = {
  industry: 'Industrial Manufacturing',
  employeeCount: 250,
  employeeBand: '201-500',
  annualRevenue: 125_000_000,
  revenueBand: '$100M-$250M',
  foundedYear: 1985,
  technologies: ['sap', 'salesforce'],
  fundingStage: 'Private',
  lastFundingAt: '2026-01-01T00:00:00Z',
  companyCountryCode: 'US',
  companyRegion: 'Texas',
  companyCity: 'Fort Worth',
};

describe('P2D — manual input carries firmographics', () => {
  it('maps all twelve onto the canonical nested account', () => {
    const r = toNormalizedManualRecord({ ...base, companyDomain: 'acme.example', ...FIRMOGRAPHICS });
    expect(r.account).toMatchObject({
      industry: 'Industrial Manufacturing',
      employeeCount: 250,
      employeeBand: '201-500',
      annualRevenue: 125_000_000,
      revenueBand: '$100M-$250M',
      foundedYear: 1985,
      technologies: ['sap', 'salesforce'],
      fundingStage: 'Private',
      lastFundingAt: '2026-01-01T00:00:00Z',
      countryCode: 'US',
      region: 'Texas',
      city: 'Fort Worth',
    });
  });

  it('keeps the EMPLOYER geography separate from the PERSON geography', () => {
    // The person's countryCode/region/city already existed; reusing those names
    // for the employer would silently overwrite one with the other.
    const r = toNormalizedManualRecord({
      ...base, companyDomain: 'acme.example',
      countryCode: 'GB', region: 'London', city: 'London',
      companyCountryCode: 'US', companyRegion: 'Texas', companyCity: 'Fort Worth',
    });
    expect(r.person?.countryCode).toBe('GB');
    expect(r.person?.city).toBe('London');
    expect(r.account?.countryCode).toBe('US');
    expect(r.account?.city).toBe('Fort Worth');
  });

  it('a record with NO firmographics behaves exactly as before', () => {
    const r = toNormalizedManualRecord({ ...base, companyName: 'Acme', companyDomain: 'acme.example' });
    expect(r.account).toEqual({
      externalId: null, name: 'Acme', domain: 'acme.example',
      industry: null, employeeCount: null, employeeBand: null,
      countryCode: null, region: null, city: null,
      annualRevenue: null, revenueBand: null, foundedYear: null,
      technologies: null, fundingStage: null, lastFundingAt: null,
    });
  });

  it('a record with no employer at all still has no account', () => {
    expect(toNormalizedManualRecord({ ...base }).account).toBeNull();
  });

  it('firmographics ALONE do not invent an employer', () => {
    // A revenue figure attached to no identifiable company is a fact about
    // nobody, and W4 could not resolve it even if it were recorded.
    const r = toNormalizedManualRecord({ ...base, annualRevenue: 125_000_000, industry: 'SaaS' });
    expect(r.account).toBeNull();
  });

  it('any one identity field is still enough to open the employer', () => {
    for (const key of ['companyName', 'companyDomain', 'companyExternalId'] as const) {
      const r = toNormalizedManualRecord({ ...base, [key]: 'x', industry: 'SaaS' });
      expect(r.account?.industry).toBe('SaaS');
    }
  });

  it('the identity requirement is unchanged — firmographics do not satisfy it', () => {
    expect(() => toNormalizedManualRecord({ organizationId: ORG, ...FIRMOGRAPHICS } as ManualLeadInput))
      .toThrow(/needs an email, a phone or a reference id/);
  });

  it('adds no email or phone requirement', () => {
    const r = toNormalizedManualRecord({ ...base, companyDomain: 'acme.example', industry: 'SaaS' });
    expect(r.person?.email).toBeNull();
    expect(r.person?.phone).toBeNull();
  });
});

describe('P2D — the CRM adapter converges on the same contract', () => {
  const crmBase: CrmLeadInput = { organizationId: ORG, externalId: 'CRM-1' } as CrmLeadInput;

  it('accepts the identical firmographic surface', () => {
    const r = toNormalizedCrmRecord({ ...crmBase, companyDomain: 'acme.example', ...FIRMOGRAPHICS });
    expect(r.account).toMatchObject({
      industry: 'Industrial Manufacturing', annualRevenue: 125_000_000,
      technologies: ['sap', 'salesforce'], countryCode: 'US', city: 'Fort Worth',
    });
  });

  it('produces the SAME account shape as manual — one canonical structure', () => {
    const manual = toNormalizedManualRecord({ ...base, companyDomain: 'acme.example', ...FIRMOGRAPHICS });
    const crm = toNormalizedCrmRecord({ ...crmBase, companyDomain: 'acme.example', ...FIRMOGRAPHICS });
    expect(Object.keys(crm.account ?? {}).sort()).toEqual(Object.keys(manual.account ?? {}).sort());
    expect(crm.account).toEqual(manual.account);
  });

  it('still emits the crm namespace, not manual', () => {
    const r = toNormalizedCrmRecord({ ...crmBase, companyDomain: 'acme.example', industry: 'SaaS' });
    expect(r.source).toBe('crm');
    expect(r.person?.externalKeys).toEqual({ crm: { external_id: 'CRM-1' } });
  });
});

describe('P2D — provider forms pass through for LI-2 to normalise', () => {
  it('a numeric string survives translation unchanged', () => {
    const r = toNormalizedManualRecord({
      ...base, companyDomain: 'acme.example',
      employeeCount: '250', annualRevenue: '125000000', foundedYear: '1985',
    });
    expect(r.account?.employeeCount).toBe('250');
    expect(r.account?.annualRevenue).toBe('125000000');
    expect(r.account?.foundedYear).toBe('1985');
  });

  it('a JSON technologies string survives translation unchanged', () => {
    const r = toNormalizedManualRecord({
      ...base, companyDomain: 'acme.example', technologies: '["sap"]',
    });
    expect(r.account?.technologies).toBe('["sap"]');
  });

  it('and LI-2 then normalises every one of those forms correctly', () => {
    // The adapter deliberately does NOT normalise. This proves the handoff:
    // whatever it passes through, `toAccountAttributes` resolves.
    const r = toNormalizedManualRecord({
      ...base, companyDomain: 'acme.example',
      employeeCount: '250', annualRevenue: '125000000', foundedYear: '1985',
      technologies: '["sap","sap"]', lastFundingAt: '2026-01-01T05:30:00+05:30',
      companyCountryCode: 'us',
    });
    const attrs = toAccountAttributes(r.account ?? {});
    expect(attrs.employeeCount).toBe(250);
    expect(attrs.annualRevenue).toBe(125_000_000);
    expect(attrs.foundedYear).toBe(1985);
    expect(attrs.technologies).toBe('["sap"]');
    expect(attrs.lastFundingAt).toBe('2026-01-01T00:00:00.000Z');
    expect(attrs.countryCode).toBe('US');
  });

  it('an unusable firmographic is dropped downstream, not at the adapter', () => {
    const r = toNormalizedManualRecord({
      ...base, companyDomain: 'acme.example', annualRevenue: -5, foundedYear: 1700,
    });
    expect(r.account?.annualRevenue).toBe(-5);          // carried verbatim
    const attrs = toAccountAttributes(r.account ?? {});
    expect(attrs.annualRevenue).toBeNull();             // refused by the one rule
    expect(attrs.foundedYear).toBeNull();
  });
});

describe('P2D — the adapters stayed pure', () => {
  const src = (name: string) => require('fs')
    .readFileSync(require('path').join(__dirname, `../../services/leadIngestion/adapters/${name}`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each([['manualAdapter.ts'], ['crmAdapter.ts']])('%s performs no persistence or identity resolution', (file) => {
    // `.update(` is deliberately NOT in this list: `createHash(...).update(...)`
    // is the sha256 digest for the deterministic external id, and matching it
    // would be a false positive rather than a finding. Database access is
    // covered precisely by the client and payload forms below.
    for (const forbidden of [
      'ownedDbTable', 'supabase', '.insert(', '.upsert(', '.update({',
      'resolveUnifiedPerson', 'ingestSourceRecord', 'prospect_accounts',
      'unified_persons', 'fetch(', 'axios',
    ]) {
      expect(src(file)).not.toContain(forbidden);
    }
  });

  it.each([['manualAdapter.ts'], ['crmAdapter.ts']])('%s duplicates no firmographic normalisation', (file) => {
    // LI-2 owns these rules. A second spelling here is exactly the drift the
    // repository argues against elsewhere.
    //
    // Two exclusions, both pre-existing VALIDATION the adapter legitimately
    // owns rather than normalisation it is usurping: `JSON.stringify` measures
    // metadata size, and `Date.parse` checks that `observedAt` is a real
    // timestamp. Neither touches a firmographic.
    for (const forbidden of [
      'normalizeAnnualRevenue', 'normalizeFoundedYear', 'normalizeTechnologies', 'normalizeInstant',
      'toISOString', 'Number(',
    ]) {
      expect(src(file)).not.toContain(forbidden);
    }
  });

  it('translate is still synchronous, so it structurally cannot await I/O', () => {
    expect(manualAdapter.translate({ referenceId: 'x' }, ORG)).not.toBeInstanceOf(Promise);
    expect(crmAdapter.translate({ externalId: 'x' }, ORG)).not.toBeInstanceOf(Promise);
  });

  it('neither adapter names a provider it does not implement', () => {
    for (const file of ['manualAdapter.ts', 'crmAdapter.ts']) {
      for (const p of ['apollo', 'zoominfo', 'crunchbase', 'rapidapi', 'salesnav']) {
        expect(src(file).toLowerCase()).not.toContain(p);
      }
    }
  });
});
