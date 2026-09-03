/**
 * PI-P1-W02 — the CSV / spreadsheet adapter.
 *
 * The adapter's whole job is a namespace and a provenance identity: everything
 * else is manual entry's normalizer, already proven by the LI-4E suite. So
 * these tests concentrate on what is genuinely new — that the source is `csv`,
 * that a synthesised digest stays OUT of `externalKeys` (it is provenance, not
 * an external identity anyone issued), that re-uploading the same row is
 * idempotent, and that a row with nothing to identify it is refused rather than
 * given a fabricated identity.
 */

import {
  CSV_SOURCE,
  csvAdapter,
  csvExternalId,
  toNormalizedCsvRecord,
  type CsvLeadInput,
} from '../../services/leadIngestion/adapters/csvAdapter';
import { MANUAL_SOURCE, ManualInputError } from '../../services/leadIngestion/adapters/manualAdapter';
import { CRM_SOURCE } from '../../services/leadIngestion/adapters/crmAdapter';
import { validateNormalizedRecord } from '../../services/leadIngestion/contracts';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const input = (over: Partial<CsvLeadInput> = {}): CsvLeadInput => ({
  organizationId: ORG_A,
  email: 'dana@example.com',
  ...over,
} as CsvLeadInput);

describe('PI-P1-W02 — the csv namespace', () => {
  it('names the csv source, never the manual one it borrows from', () => {
    const r = toNormalizedCsvRecord(input());
    expect(r.source).toBe(CSV_SOURCE);
    expect(r.source).not.toBe(MANUAL_SOURCE);
    expect(r.source).not.toBe(CRM_SOURCE);
  });

  it('produces a record valid to the LI-4D contract', () => {
    expect(() => validateNormalizedRecord(toNormalizedCsvRecord(input()))).not.toThrow();
  });

  it('entityType is person', () => {
    expect(toNormalizedCsvRecord(input()).entityType).toBe('person');
  });

  it('the adapter declares only capabilities it implements', () => {
    expect(csvAdapter.source).toBe(CSV_SOURCE);
    expect([...csvAdapter.capabilities].sort()).toEqual(['account_discovery', 'person_discovery']);
    // It cannot reach a network, so it must claim none of these.
    for (const forbidden of ['single_record_fetch', 'bulk_fetch', 'search', 'enrichment']) {
      expect(csvAdapter.capabilities).not.toContain(forbidden);
    }
  });
});

describe('PI-P1-W02 — a synthesised digest is provenance, never an external identity', () => {
  it('a row with no reference gets a csv-prefixed provenance id', () => {
    const r = toNormalizedCsvRecord(input());
    expect(r.externalId.startsWith(`${CSV_SOURCE}:`)).toBe(true);
  });

  it('never stamps the manual prefix onto a csv row', () => {
    expect(toNormalizedCsvRecord(input()).externalId.startsWith('manual:')).toBe(false);
  });

  it('that digest is NOT published as an external key — nobody issued it', () => {
    const r = toNormalizedCsvRecord(input());
    expect(r.person?.externalKeys ?? null).toBeNull();
  });

  it('an operator-supplied row id IS an external identity, under csv', () => {
    const r = toNormalizedCsvRecord(input({ referenceId: 'ROW-42' }));
    expect(r.externalId).toBe('ROW-42');
    expect(r.person?.externalKeys).toEqual({ [CSV_SOURCE]: { external_id: 'ROW-42' } });
  });

  it('the external key is never left in the manual namespace it was borrowed through', () => {
    const keys = toNormalizedCsvRecord(input({ referenceId: 'ROW-42' })).person?.externalKeys ?? {};
    expect(Object.keys(keys)).toEqual([CSV_SOURCE]);
    expect(keys).not.toHaveProperty(MANUAL_SOURCE);
  });
});

describe('PI-P1-W02 — re-uploading the same file is idempotent', () => {
  it('the same row twice produces an identical provenance id', () => {
    expect(csvExternalId(input())).toBe(csvExternalId(input()));
  });

  it('the digest is derived from identity signals, so a changed job title does not fork the row', () => {
    expect(csvExternalId(input({ jobTitle: 'Head of Ops' })))
      .toBe(csvExternalId(input({ jobTitle: 'Director of Ops' })));
  });

  it('a different person in the same tenant gets a different id', () => {
    expect(csvExternalId(input())).not.toBe(csvExternalId(input({ email: 'sam@example.com' })));
  });

  it('the same person in a DIFFERENT tenant gets a different id — the digest is tenant-scoped', () => {
    expect(csvExternalId(input())).not.toBe(csvExternalId(input({ organizationId: ORG_B })));
  });
});

describe('PI-P1-W02 — identity is never fabricated', () => {
  it('a row with no email, phone or reference is refused', () => {
    expect(() => toNormalizedCsvRecord({ organizationId: ORG_A, fullName: 'Dana Scully' } as CsvLeadInput))
      .toThrow(ManualInputError);
  });

  it('a name alone is not an identity', () => {
    expect(() => toNormalizedCsvRecord({
      organizationId: ORG_A, firstName: 'Dana', lastName: 'Scully',
    } as CsvLeadInput)).toThrow(/email, a phone or a reference/);
  });

  it('a malformed email fails deterministically and names the field', () => {
    try {
      toNormalizedCsvRecord(input({ email: 'a@@b' }));
      throw new Error('expected a rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(ManualInputError);
      expect((e as ManualInputError).field).toBe('email');
    }
  });

  it('borrows the shared rules rather than restating them — a bad country code is refused', () => {
    expect(() => toNormalizedCsvRecord(input({ countryCode: 'Ireland' }))).toThrow(ManualInputError);
  });

  it('still enforces the shared metadata rules — a content-bearing key is refused', () => {
    expect(() => toNormalizedCsvRecord(input({ metadata: { transcript: 'x' } }))).toThrow(ManualInputError);
  });
});

describe('PI-P1-W02 — supported fields survive translation', () => {
  it('carries names, title, employer and location through the existing rules', () => {
    const r = toNormalizedCsvRecord(input({
      firstName: 'Dana', lastName: 'Scully', jobTitle: 'Director', department: 'Ops',
      companyName: 'Acme Corp', companyDomain: 'acme.com', countryCode: 'ie', city: 'Dublin',
    }));
    expect(r.person?.fullName).toBe('Dana Scully');
    expect(r.person?.jobTitle).toBe('Director');
    expect(r.person?.countryCode).toBe('IE');
    expect(r.account?.name).toBe('Acme Corp');
    expect(r.account?.domain).toBe('acme.com');
  });

  it('a row naming no employer produces no account — a column is not a company', () => {
    expect(toNormalizedCsvRecord(input()).account ?? null).toBeNull();
  });

  it('unknown spreadsheet columns are dropped, never promoted to fields', () => {
    const r = toNormalizedCsvRecord({
      ...input(), favouriteColour: 'blue', 'Lead Score': 88,
    } as unknown as CsvLeadInput);
    expect(r.person).not.toHaveProperty('favouriteColour');
    expect(r.person).not.toHaveProperty('Lead Score');
    expect(r.account ?? null).toBeNull();
  });
});

describe('PI-P1-W02 — the tenant', () => {
  it('is preserved from the input', () => {
    expect(toNormalizedCsvRecord(input()).organizationId).toBe(ORG_A);
  });

  it('the batch tenant overrides whatever the row claims', () => {
    const { normalized } = csvAdapter.translate({ email: 'dana@example.com', organizationId: ORG_B }, ORG_A);
    expect(normalized.organizationId).toBe(ORG_A);
  });

  it('translate returns the raw row alongside the normalized one', () => {
    const raw = { email: 'dana@example.com' };
    expect(csvAdapter.translate(raw, ORG_A).raw).toBe(raw);
  });
});

describe('PI-P1-W02 — translate performs no I/O', () => {
  it('is synchronous — it cannot await a database, a fetch or a credential', () => {
    const out = csvAdapter.translate({ email: 'dana@example.com' }, ORG_A);
    expect(out).not.toBeInstanceOf(Promise);
    expect(typeof (out as unknown as { then?: unknown }).then).toBe('undefined');
  });

  it('the module imports nothing that can reach a network or a database', () => {
    const fs = require('node:fs') as typeof import('fs');
    const path = require('node:path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/leadIngestion/adapters/csvAdapter.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['ownedDbTable', 'supabase', 'fetch(', 'axios', 'process.env']) {
      expect(code).not.toContain(forbidden);
    }
  });
});
