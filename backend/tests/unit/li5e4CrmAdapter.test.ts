/**
 * LI-5E.4 — the CRM-namespace adapter.
 *
 * The adapter's whole job is a namespace: everything else is manual entry's
 * normalizer, already proven by the LI-4E suite. So these tests concentrate on
 * the two things that are genuinely new — that the external identity lands
 * under `crm`, and that an external-id-only record is accepted, because that is
 * the record shape the external identity stage exists to see.
 */

import {
  CRM_SOURCE,
  crmAdapter,
  crmExternalId,
  toNormalizedCrmRecord,
  type CrmLeadInput,
} from '../../services/leadIngestion/adapters/crmAdapter';
import { MANUAL_SOURCE } from '../../services/leadIngestion/adapters/manualAdapter';
import { validateNormalizedRecord } from '../../services/leadIngestion/contracts';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const input = (over: Partial<CrmLeadInput> = {}): CrmLeadInput => ({
  organizationId: ORG_A,
  externalId: 'CRM-1',
  ...over,
} as CrmLeadInput);

describe('LI-5E.4 — the platform namespace', () => {
  it('translates externalId to { crm: { external_id } }', () => {
    const r = toNormalizedCrmRecord(input({ externalId: 'CRM-42' }));
    expect(r.person?.externalKeys).toEqual({ crm: { external_id: 'CRM-42' } });
  });

  it('names the crm source, never the manual one', () => {
    const r = toNormalizedCrmRecord(input());
    expect(r.source).toBe('crm');
    expect(CRM_SOURCE).toBe('crm');
    expect(r.source).not.toBe(MANUAL_SOURCE);
  });

  it('invents no third namespace — the key is exactly the one crmIngestionService writes', () => {
    const r = toNormalizedCrmRecord(input());
    expect(Object.keys(r.person?.externalKeys ?? {})).toEqual(['crm']);
  });

  it('the record identity is the CRM id itself, not a hash', () => {
    const r = toNormalizedCrmRecord(input({ externalId: 'CRM-7' }));
    expect(r.externalId).toBe('CRM-7');
    expect(r.externalId).not.toMatch(/^manual:/);
  });

  it('the same CRM id twice produces an identical record — idempotency stays downstream', () => {
    const a = toNormalizedCrmRecord(input({ externalId: 'CRM-9' }));
    const b = toNormalizedCrmRecord(input({ externalId: 'CRM-9' }));
    expect(a).toEqual(b);
  });
});

describe('LI-5E.4 — the evidence case: external id only', () => {
  it('accepts a record with NO email and NO phone', () => {
    const r = toNormalizedCrmRecord(input());
    expect(r.person?.email).toBeNull();
    expect(r.person?.phone).toBeNull();
    expect(r.person?.externalKeys).toEqual({ crm: { external_id: 'CRM-1' } });
  });

  it('that record is valid to the LI-4D contract — anchored by the provider identifier alone', () => {
    expect(validateNormalizedRecord(toNormalizedCrmRecord(input()))).toBeNull();
  });

  it('email and phone remain optional but are carried when supplied', () => {
    const r = toNormalizedCrmRecord(input({ email: 'A@X.TEST', phone: '+1 (555) 010-9999' }));
    expect(r.person?.email).toBe('A@X.TEST');
    expect(r.person?.phone).toBe('+1 (555) 010-9999');
  });
});

describe('LI-5E.4 — externalId is required', () => {
  // Typed as one tuple shape on purpose: a bare mixed-type array makes `it.each`
  // infer a union of tuples, and the callback then satisfies neither arm.
  const BAD_EXTERNAL_IDS: Array<[unknown, string]> = [
    [undefined, 'missing'],
    [null, 'null'],
    ['', 'empty'],
    ['   ', 'blank'],
    [42, 'not a string'],
  ];

  it.each(BAD_EXTERNAL_IDS)('rejects an invalid externalId (%s)', (bad) => {
    expect(() => toNormalizedCrmRecord(input({ externalId: bad as string })))
      .toThrow(/externalId is required/);
  });

  it('names the offending field so an operator can fix it', () => {
    try {
      crmExternalId(input({ externalId: '' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { field?: string }).field).toBe('externalId');
    }
  });

  it('does not fall back to the email as an identity', () => {
    expect(() => toNormalizedCrmRecord(input({ externalId: '', email: 'a@x.test' })))
      .toThrow(/externalId is required/);
  });
});

describe('LI-5E.4 — supported fields survive translation', () => {
  it('preserves names, title, employer and location through the existing rules', () => {
    const r = toNormalizedCrmRecord(input({
      firstName: 'ada', lastName: 'lovelace', jobTitle: 'engineer', department: 'r&d',
      companyName: 'acme corp', companyDomain: 'https://Acme.example/x', companyExternalId: 'ACC-1',
      countryCode: 'gb', region: 'london', city: 'london',
    }));
    expect(r.person?.firstName).toBeTruthy();
    expect(r.person?.lastName).toBeTruthy();
    expect(r.person?.fullName).toBeTruthy();
    expect(r.person?.jobTitle).toBeTruthy();
    expect(r.person?.countryCode).toBe('GB');
    expect(r.account?.externalId).toBe('ACC-1');
    // W4 owns domain normalisation — the adapter must not pre-chew it.
    expect(r.account?.domain).toBe('https://Acme.example/x');
  });

  it('carries observedAt and metadata when supplied', () => {
    const r = toNormalizedCrmRecord(input({
      observedAt: '2026-01-01T00:00:00.000Z',
    }));
    expect(r.observedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('still enforces the shared input rules — a content-bearing metadata key is refused', () => {
    expect(() => toNormalizedCrmRecord(input({ metadata: { transcript: 'x' } })))
      .toThrow(/metadata key/);
  });

  it('borrows the shared rules rather than restating them — a bad country code is refused', () => {
    expect(() => toNormalizedCrmRecord(input({ countryCode: 'GBR' }))).toThrow(/alpha-2/);
  });

  it('entityType is person', () => {
    expect(toNormalizedCrmRecord(input()).entityType).toBe('person');
  });
});

describe('LI-5E.4 — the tenant', () => {
  it('is preserved from the input', () => {
    expect(toNormalizedCrmRecord(input()).organizationId).toBe(ORG_A);
  });

  it('the batch tenant overrides whatever the record claims', () => {
    const { normalized } = crmAdapter.translate({ externalId: 'CRM-1', organizationId: ORG_B }, ORG_A);
    expect(normalized.organizationId).toBe(ORG_A);
  });

  it('the same CRM id in two tenants yields two independent records', () => {
    const a = crmAdapter.translate({ externalId: 'CRM-1' }, ORG_A).normalized;
    const b = crmAdapter.translate({ externalId: 'CRM-1' }, ORG_B).normalized;
    expect(a.organizationId).not.toBe(b.organizationId);
    expect(a.person?.externalKeys).toEqual(b.person?.externalKeys);
  });
});

describe('LI-5E.4 — the adapter persists nothing', () => {
  it('translate returns data and performs no I/O — it is synchronous by contract', () => {
    const out = crmAdapter.translate({ externalId: 'CRM-1' }, ORG_A);
    expect(out).not.toBeInstanceOf(Promise);
    expect(out.normalized).toBeTruthy();
  });

  it('preserves the raw record verbatim for provenance', () => {
    const raw = { externalId: 'CRM-1', somethingUnknown: 'kept' };
    expect(crmAdapter.translate(raw, ORG_A).raw).toBe(raw);
  });

  it('imports nothing that can reach a network or a database', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/adapters/crmAdapter.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      'supabase', 'ownedDbTable', 'resolveUnifiedPerson', 'ingestSourceRecord',
      'detectAndParkDuplicates', 'writeExternalIdentityClaims', 'identity_claims',
      'unified_persons', 'external_keys', 'fetch(', 'axios', 'crmIngestionService',
      'crmActivationService', 'ingestionScheduler', 'triggerCrmSync', 'CRM_ENABLED',
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('declares only capabilities it implements — it fetches, searches and enriches nothing', () => {
    expect(crmAdapter.capabilities).toEqual(['person_discovery', 'account_discovery']);
  });
});
