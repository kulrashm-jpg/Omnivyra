/**
 * A3V — a provider's answer now survives the last step.
 *
 * The defect this file closes was invisible by construction: PI named an
 * attribute `employee_count`, LI-2's ingestion contract read `employeeCount`,
 * and the record normalised to nulls. Nothing threw, nothing logged, and every
 * existing test passed because every existing test mocked the ingest. A
 * provider's answer was accepted, carried the whole way, and discarded.
 *
 * So these tests deliberately do NOT assert a snake→camel utility. They drive
 * the REAL seam — `toAttributeBags` into LI-2's own `toAccountAttributes` /
 * `toPersonAttributes` and its assertion mapping — and assert the value comes
 * out the far end. A test of the transformer alone would have passed against
 * the broken code too.
 *
 * SECRETS: none required. No credential, real or synthetic, is used here.
 */

import {
  toAttributeBags,
  ACCOUNT_ATTRIBUTE_TO_LI2,
  PERSON_ATTRIBUTE_TO_LI2,
  makePersistObservation,
} from '../../services/enrichment/providers/persistence';
import {
  toAccountAttributes, toPersonAttributes,
  type AccountAttributes, type PersonAttributes,
} from '../../services/prospectIdentity/attributes';
import { mapClearbitPayload } from '../../services/enrichment/providers/adapters/clearbit';
import {
  getSource, resolveConnectionState, listSourceStatus,
} from '../../services/enrichment/providers/sources';
import type { ProviderField } from '../../services/enrichment/providers/contract';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const accountField = (attribute: string, value: unknown): ProviderField => ({
  attribute, subject: 'account', value, observedAt: null, confidence: null, providerInferred: false,
});
const personField = (attribute: string, value: unknown): ProviderField => ({
  attribute, subject: 'person', value, observedAt: null, confidence: null, providerInferred: false,
});

/** The real seam: provider fields → bags → LI-2's own normaliser. */
const throughLi2Account = (fields: ProviderField[]) =>
  toAccountAttributes(toAttributeBags(fields).accountAttributes as AccountAttributes);
const throughLi2Person = (fields: ProviderField[]) =>
  toPersonAttributes(toAttributeBags(fields).personAttributes as PersonAttributes);

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — account attributes survive the LI-2 boundary', () => {
  it('employee_count reaches LI-2 and normalises to a number', () => {
    expect(throughLi2Account([accountField('employee_count', 240)]).employeeCount).toBe(240);
  });

  it('a provider’s STRING headcount still normalises — the value is untouched in transit', () => {
    expect(throughLi2Account([accountField('employee_count', '240')]).employeeCount).toBe(240);
  });

  it('employee_band reaches LI-2 and survives the closed vocabulary', () => {
    expect(throughLi2Account([accountField('employee_band', '51-200')]).employeeBand).toBe('51-200');
  });

  it('founded_year reaches LI-2', () => {
    expect(throughLi2Account([accountField('founded_year', 2011)]).foundedYear).toBe(2011);
  });

  it('country_code reaches LI-2 and is upper-cased by the boundary', () => {
    expect(throughLi2Account([accountField('country_code', 'gb')]).countryCode).toBe('GB');
  });

  it('technologies reaches LI-2 as an array and becomes the JSON text jsonb needs', () => {
    expect(throughLi2Account([accountField('technologies', ['react', 'segment'])]).technologies)
      .toBe('["react","segment"]');
  });

  it('all five arrive together from one observation', () => {
    const normalized = throughLi2Account([
      accountField('employee_count', 240),
      accountField('employee_band', '51-200'),
      accountField('founded_year', 2011),
      accountField('country_code', 'US'),
      accountField('technologies', ['react']),
    ]);
    expect(normalized.employeeCount).toBe(240);
    expect(normalized.employeeBand).toBe('51-200');
    expect(normalized.foundedYear).toBe(2011);
    expect(normalized.countryCode).toBe('US');
    expect(normalized.technologies).toBe('["react"]');
  });

  it('the boundary still REJECTS what it should — translation did not weaken it', () => {
    const normalized = throughLi2Account([
      accountField('employee_band', 'Mid-Market'),   // outside the closed vocabulary
      accountField('country_code', 'United Kingdom'), // not alpha-2
      accountField('founded_year', 1500),             // outside the plausible range
    ]);
    expect(normalized.employeeBand).toBeNull();
    expect(normalized.countryCode).toBeNull();
    expect(normalized.foundedYear).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — person attributes survive the same boundary', () => {
  it('job_title reaches LI-2', () => {
    expect(throughLi2Person([personField('job_title', 'Head of Growth')]).jobTitle).toBe('Head of Growth');
  });

  it('the rest of the person vocabulary arrives too', () => {
    const normalized = throughLi2Person([
      personField('full_name', 'Ada Lovelace'),
      personField('department', 'Engineering'),
      personField('seniority', 'director'),
      personField('country_code', 'gb'),
      personField('city', 'London'),
    ]);
    expect(normalized.fullName).toBe('Ada Lovelace');
    expect(normalized.department).toBe('Engineering');
    expect(normalized.seniority).toBe('director');
    expect(normalized.countryCode).toBe('GB');
    expect(normalized.city).toBe('London');
  });

  it('an out-of-vocabulary seniority is still refused by the boundary', () => {
    expect(throughLi2Person([personField('seniority', 'Chief Vibes Officer')]).seniority).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — the end-to-end path, from a Clearbit payload', () => {
  it('a synthetic Clearbit response reaches LI-2 as canonical account attributes', () => {
    const fields = mapClearbitPayload(
      {
        metrics: { employees: 240, employeesRange: '51-200' },
        foundedYear: 2011,
        geo: { country: 'US' },
        tech: ['react', 'segment'],
      },
      ['employee_count', 'employee_band', 'founded_year', 'country_code', 'technologies'],
    );

    const normalized = toAccountAttributes(
      toAttributeBags(fields).accountAttributes as AccountAttributes);

    expect(normalized.employeeCount).toBe(240);
    expect(normalized.employeeBand).toBe('51-200');
    expect(normalized.foundedYear).toBe(2011);
    expect(normalized.countryCode).toBe('US');
    expect(normalized.technologies).toBe('["react","segment"]');
  });

  it('THE REGRESSION: this is exactly what silently produced nulls before A3V', () => {
    const fields = mapClearbitPayload({ metrics: { employees: 240 }, foundedYear: 2011 }, ['employee_count', 'founded_year']);
    const normalized = toAccountAttributes(
      toAttributeBags(fields).accountAttributes as AccountAttributes);
    expect(normalized.employeeCount).not.toBeNull();
    expect(normalized.foundedYear).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — an unsupported attribute cannot slip into the contract', () => {
  it('an unknown attribute is reported as unmapped, not passed through', () => {
    const bags = toAttributeBags([accountField('mrr', 42_000)]);
    expect(bags.accountAttributes).toEqual({});
    expect(bags.unmapped).toEqual(['mrr']);
  });

  it('an attribute LI-2 normalises but cannot assert is excluded on purpose', () => {
    // `market` is normalised by `toAccountAttributes` but absent from
    // `pendingFromAccount`, so it would vanish anyway. Mapping it would
    // re-create the very silence A3V removes.
    const bags = toAttributeBags([accountField('market', 'SMB')]);
    expect(bags.accountAttributes).toEqual({});
    expect(bags.unmapped).toEqual(['market']);
  });

  it('a person attribute cannot arrive on the account path', () => {
    const bags = toAttributeBags([accountField('job_title', 'Head of Growth')]);
    expect(bags.accountAttributes).toEqual({});
    expect(bags.unmapped).toEqual(['job_title']);
  });

  it('every mapped key is one LI-2 actually reads', () => {
    // Proven against LI-2's own normaliser rather than a copied list: a key it
    // does not read comes back undefined.
    for (const li2Key of Object.values(ACCOUNT_ATTRIBUTE_TO_LI2)) {
      expect(Object.keys(toAccountAttributes({}))).toContain(li2Key);
    }
    for (const li2Key of Object.values(PERSON_ATTRIBUTE_TO_LI2)) {
      expect(Object.keys(toPersonAttributes({}))).toContain(li2Key);
    }
  });

  it('empty and null values are dropped before translation, as before', () => {
    const bags = toAttributeBags([
      accountField('employee_count', null),
      accountField('country_code', ''),
      accountField('founded_year', undefined),
    ]);
    expect(bags.accountAttributes).toEqual({});
    expect(bags.unmapped).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — status never infers a tenant’s readiness from a global key', () => {
  const ENV = 'CLEARBIT_API_KEY';
  afterEach(() => { delete process.env[ENV]; });

  it('a global CLEARBIT_API_KEY does NOT make Clearbit connected for a tenant', () => {
    process.env[ENV] = 'synthetic-global-key-that-must-never-be-used';
    const clearbit = getSource('clearbit')!;

    // An adapter IS registered as of A3U, so the `!hasAdapter` short circuit no
    // longer hides this branch — which is exactly why the env default had to go.
    const state = resolveConnectionState(clearbit, true, /* tenant credential */ false);
    expect(state.state).toBe('credential_missing');
    expect(state.reason).toMatch(/this tenant/);
    expect(state.state).not.toBe('connected');
  });

  it('and the listing agrees — nothing is usable on the strength of the environment', () => {
    process.env[ENV] = 'synthetic-global-key-that-must-never-be-used';
    const statuses = listSourceStatus(() => true, () => false);
    const clearbit = statuses.find((s) => s.id === 'clearbit');
    expect(clearbit?.connectionState).toBe('credential_missing');
    expect(clearbit?.usable).toBe(false);
  });

  it('`connected` requires the TENANT’s credential, and says so', () => {
    const state = resolveConnectionState(getSource('clearbit')!, true, true);
    expect(state.state).toBe('connected');
    expect(state.reason).toMatch(/this tenant has configured a credential/);
  });

  it('the module can no longer read a global credential at all', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/enrichment/providers/sources.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('hasCredential');
    expect(src).not.toContain('process.env');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3V — provenance and tenancy are untouched by the translation', () => {
  it('the ingestion record still carries provider, tenant, entity and run identity', async () => {
    let captured: Record<string, unknown> | null = null;
    const persist = makePersistObservation((async (record: unknown) => {
      captured = record as Record<string, unknown>;
      return {
        sourceRecordId: 'src-1', outcome: 'created', assertionsRecorded: 1,
        assertionsAlreadyPresent: 0, canonicalApplied: ['employee_count'], canonicalWithheld: [],
      };
    }) as never);

    await persist({
      organizationId: ORG,
      providerId: 'clearbit',
      subject: 'account',
      entityId: 'account-1',
      fields: [accountField('employee_count', 240)],
      rawPayload: { metrics: { employees: 240 } },
      payloadHash: null,
      observedAt: '2026-09-05T00:00:00.000Z',
      correlationId: 'run-1',
    });

    expect(captured).toMatchObject({
      organizationId: ORG,
      provider: 'clearbit',
      entityType: 'account',
      accountId: 'account-1',
      personId: null,
      observedAt: '2026-09-05T00:00:00.000Z',
      ingestionRunId: 'run-1',
      // the translated bag, and the raw payload untouched beside it
      accountAttributes: { employeeCount: 240 },
      rawPayload: { metrics: { employees: 240 } },
    });
  });

  it('confidence stays the provider’s — absent stays absent, never invented', async () => {
    let captured: Record<string, unknown> | null = null;
    const persist = makePersistObservation((async (r: unknown) => {
      captured = r as Record<string, unknown>;
      return { sourceRecordId: 's', outcome: 'created', assertionsRecorded: 0, assertionsAlreadyPresent: 0, canonicalApplied: [], canonicalWithheld: [] };
    }) as never);

    await persist({
      organizationId: ORG, providerId: 'clearbit', subject: 'account', entityId: 'a1',
      fields: [accountField('employee_count', 240)],
      rawPayload: {}, payloadHash: null, observedAt: null, correlationId: 'run-2',
    });
    expect(captured!.confidence).toBeNull();
  });

  it('a provider-stated confidence is carried through unchanged', async () => {
    let captured: Record<string, unknown> | null = null;
    const persist = makePersistObservation((async (r: unknown) => {
      captured = r as Record<string, unknown>;
      return { sourceRecordId: 's', outcome: 'created', assertionsRecorded: 0, assertionsAlreadyPresent: 0, canonicalApplied: [], canonicalWithheld: [] };
    }) as never);

    await persist({
      organizationId: ORG, providerId: 'clearbit', subject: 'account', entityId: 'a1',
      fields: [{ ...accountField('employee_count', 240), confidence: 0.9 }],
      rawPayload: {}, payloadHash: null, observedAt: null, correlationId: 'run-3',
    });
    expect(captured!.confidence).toBe(0.9);
  });
});
