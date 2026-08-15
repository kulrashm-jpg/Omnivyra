/**
 * LI-4D — the provider-neutral ingestion foundation.
 *
 * The property under test is not "does a record get stored" — it is that EVERY
 * source takes the same route, and that no layer can be skipped. So the suite
 * registers a fake adapter (never a real provider) and asserts what the
 * orchestrator does with it: which collaborators it calls, in which order, what
 * it refuses, and what it reports when one step fails after another succeeded.
 */

const calls: string[] = [];

let resolveResult: { unifiedPersonId: string; matchedBy: string; created: boolean } = {
  unifiedPersonId: 'person-1', matchedBy: 'email', created: false,
};
let resolveThrows: Error | null = null;
let ingestThrows: Error | null = null;
let dupThrows: Error | null = null;
let accountResolution: { accountId: string | null; outcome: string } = { accountId: null, outcome: 'insufficient_evidence' };
let accountThrows: Error | null = null;
let dupResult = { detected: [] as unknown[], parked: 0, alreadyOpen: 0 };

const ingested: Array<Record<string, unknown>> = [];
const resolveCalls: Array<Record<string, unknown>> = [];
const dupCalls: Array<Record<string, unknown>> = [];
const attachCalls: Array<unknown[]> = [];

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: Record<string, unknown>) => {
    calls.push('provenance');
    if (ingestThrows) throw ingestThrows;
    ingested.push(input);
    return {
      sourceRecordId: 'sr-1', outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: ['full_name'], canonicalWithheld: [],
    };
  }),
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async (input: Record<string, unknown>) => {
    calls.push('identity');
    if (resolveThrows) throw resolveThrows;
    resolveCalls.push(input);
    return resolveResult;
  }),
  normalizeEmail: (v: string) => (v ?? '').trim().toLowerCase() || null,
  normalizePhone: (v: string) => (v ?? '').trim() || null,
}));

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => {
    calls.push('account');
    if (accountThrows) throw accountThrows;
    return accountResolution;
  }),
  attachPersonToAccount: jest.fn(async (...args: unknown[]) => {
    attachCalls.push(args);
    return { attached: true, reason: 'ok' };
  }),
}));

jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async (input: Record<string, unknown>) => {
    calls.push('duplicates');
    if (dupThrows) throw dupThrows;
    dupCalls.push(input);
    return dupResult;
  }),
}));

import { ingestLeadBatch, ingestNormalizedRecord, MAX_BATCH_SIZE } from '../../services/leadIngestion/orchestrator';
import {
  registerLeadSourceAdapter,
  getLeadSourceAdapter,
  listLeadSources,
  sourceSupports,
  hasLeadSourceAdapter,
  UnsupportedSourceError,
  AdapterRegistrationError,
  __resetLeadSourceRegistry,
} from '../../services/leadIngestion/registry';
import {
  validateNormalizedRecord,
  SOURCE_CAPABILITIES,
  type AdapterResult,
  type LeadSourceAdapter,
  type NormalizedIngestionRecord,
} from '../../services/leadIngestion/contracts';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

/** A FAKE source. Never a real provider — LI-4D ships no provider adapter. */
const fakeAdapter = (over: Partial<LeadSourceAdapter> = {}): LeadSourceAdapter => ({
  source: 'test_source',
  label: 'Test Source',
  capabilities: ['person_discovery', 'bulk_fetch'],
  translate: (raw: Record<string, unknown>, organizationId: string): AdapterResult => ({
    raw,
    normalized: {
      organizationId,
      source: 'test_source',
      entityType: 'person',
      externalId: String(raw.id ?? 'EXT-1'),
      person: {
        email: (raw.email as string) ?? null,
        phone: (raw.phone as string) ?? null,
        fullName: (raw.name as string) ?? null,
        externalKeys: raw.id ? { test_source: { external_id: String(raw.id) } } : null,
      },
      account: raw.domain ? { domain: String(raw.domain), name: (raw.company as string) ?? null } : null,
      observedAt: (raw.seen as string) ?? null,
    },
  }),
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({ id: 'EXT-1', email: 'a@x.test', name: 'A Person', ...over });

beforeEach(() => {
  __resetLeadSourceRegistry();
  calls.length = 0;
  ingested.length = 0;
  resolveCalls.length = 0;
  dupCalls.length = 0;
  attachCalls.length = 0;
  resolveResult = { unifiedPersonId: 'person-1', matchedBy: 'email', created: false };
  resolveThrows = null;
  ingestThrows = null;
  dupThrows = null;
  accountThrows = null;
  accountResolution = { accountId: null, outcome: 'insufficient_evidence' };
  dupResult = { detected: [], parked: 0, alreadyOpen: 0 };
  jest.clearAllMocks();
});

describe('LI-4D — 1. adapter contract', () => {
  it('registers an adapter and reports it', () => {
    registerLeadSourceAdapter(fakeAdapter());
    expect(hasLeadSourceAdapter('test_source')).toBe(true);
    expect(listLeadSources()).toEqual([
      { source: 'test_source', label: 'Test Source', capabilities: ['person_discovery', 'bulk_fetch'] },
    ]);
  });

  it('ships EMPTY — no provider is registered by importing the module', () => {
    __resetLeadSourceRegistry();
    expect(listLeadSources()).toEqual([]);
    for (const p of ['apollo', 'linkedin', 'rapidapi', 'crm', 'csv', 'manual']) {
      expect(hasLeadSourceAdapter(p)).toBe(false);
    }
  });

  it('refuses a duplicate registration rather than replacing silently', () => {
    registerLeadSourceAdapter(fakeAdapter());
    expect(() => registerLeadSourceAdapter(fakeAdapter())).toThrow(AdapterRegistrationError);
  });

  it('refuses an adapter with no translate, no key, or no capabilities', () => {
    expect(() => registerLeadSourceAdapter({ source: 'x', label: 'x', capabilities: ['search'] } as never))
      .toThrow(/must implement translate/);
    expect(() => registerLeadSourceAdapter(fakeAdapter({ source: '  ' }))).toThrow(/non-empty source key/);
    expect(() => registerLeadSourceAdapter(fakeAdapter({ capabilities: [] }))).toThrow(/declares no capabilities/);
  });
});

describe('LI-4D — 2. normalized record validation', () => {
  const base: NormalizedIngestionRecord = {
    organizationId: ORG_A, source: 'test_source', entityType: 'person',
    externalId: 'EXT-1', person: { email: 'a@x.test' },
  };

  it('accepts a well-formed person record', () => {
    expect(validateNormalizedRecord(base)).toBeNull();
  });

  it('requires a tenant, a source and an external id', () => {
    expect(validateNormalizedRecord({ ...base, organizationId: '' })).toMatch(/organizationId is required/);
    expect(validateNormalizedRecord({ ...base, source: '' })).toMatch(/source is required/);
    expect(validateNormalizedRecord({ ...base, externalId: '' })).toMatch(/externalId is required/);
  });

  it('refuses a person with no identifier at all', () => {
    expect(validateNormalizedRecord({ ...base, person: { fullName: 'Only A Name' } }))
      .toMatch(/needs an email, a phone or a provider identifier/);
  });

  it('accepts a person anchored by phone or by provider identifier alone', () => {
    expect(validateNormalizedRecord({ ...base, person: { phone: '+15550100000' } })).toBeNull();
    expect(validateNormalizedRecord({ ...base, person: { externalKeys: { test_source: { external_id: 'X' } } } })).toBeNull();
  });

  it('refuses an account with no anchor, and accepts one with a domain', () => {
    expect(validateNormalizedRecord({ ...base, entityType: 'account', person: null, account: { name: 'ACME' } }))
      .toMatch(/needs a provider identifier, a domain or a website/);
    expect(validateNormalizedRecord({ ...base, entityType: 'account', person: null, account: { domain: 'acme.test' } })).toBeNull();
  });

  it('refuses an out-of-range confidence and an unparseable observedAt', () => {
    expect(validateNormalizedRecord({ ...base, confidence: 1.5 })).toMatch(/confidence must be between 0 and 1/);
    expect(validateNormalizedRecord({ ...base, observedAt: 'not-a-date' })).toMatch(/not a parseable timestamp/);
  });
});

describe('LI-4D — 3. provider-neutral orchestration', () => {
  it('the orchestrator contains NO provider-specific branch', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const provider of ['apollo', 'linkedin', 'rapidapi', 'hubspot', 'salesforce', 'xlsx']) {
      expect(code.toLowerCase()).not.toContain(provider);
    }
  });

  it('runs the chain in the required order', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row({ domain: 'acme.test' })] });
    expect(calls).toEqual(['identity', 'account', 'provenance', 'duplicates']);
  });

  it('an unsupported source fails the batch before anything is written', async () => {
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'nope', records: [row(), row()] });
    expect(r.succeeded).toBe(0);
    expect(r.failed).toBe(2);
    expect(r.outcomes.every((o) => o.rejection === 'unsupported_source')).toBe(true);
    expect(calls).toEqual([]);                       // nothing was called at all
  });

  it('getLeadSourceAdapter throws a typed error for an unknown source', () => {
    expect(() => getLeadSourceAdapter('ghost')).toThrow(UnsupportedSourceError);
  });
});

describe('LI-4D — 4. LI-2 provenance', () => {
  it('every successful record produces exactly one source record through LI-2', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.succeeded).toBe(1);
    expect(ingested).toHaveLength(1);
    expect(r.outcomes[0].sourceRecordId).toBe('sr-1');
    expect(r.outcomes[0].provenanceOutcome).toBe('created');
  });

  it('hands LI-2 the raw provider record, not the normalized one', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row({ quirk: 'provider-only' })] });
    expect((ingested[0].rawPayload as Record<string, unknown>).quirk).toBe('provider-only');
  });

  it('carries provider, external id, tenant and observedAt into provenance', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source',
      records: [row({ seen: '2026-08-01T00:00:00.000Z' })],
    });
    expect(ingested[0].provider).toBe('test_source');
    expect(ingested[0].sourceRecordId).toBe('EXT-1');
    expect(ingested[0].organizationId).toBe(ORG_A);
    expect(ingested[0].observedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('reports what LI-2 applied and withheld — a withheld attribute is a finding', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.outcomes[0].canonicalApplied).toEqual(['full_name']);
    expect(r.outcomes[0].canonicalWithheld).toEqual([]);
  });

  it('creates no second provenance mechanism', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    expect(src).not.toMatch(/source_records/);
    expect(src).not.toMatch(/source_assertions/);
    expect(src).not.toMatch(/ownedDbTable/);
  });
});

describe('LI-4D — 5. identity reuse', () => {
  it('resolves through W1 and never creates a second resolver', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0].companyId).toBe(ORG_A);
    expect(resolveCalls[0].email).toBe('a@x.test');
  });

  it('passes the resolved person to provenance, so evidence is linked on arrival', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(ingested[0].personId).toBe('person-1');
  });

  it('forwards provider identifiers as a hard identity signal', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(resolveCalls[0].externalKeys).toEqual({ test_source: { external_id: 'EXT-1' } });
  });

  it('an account-entity record resolves no person', async () => {
    registerLeadSourceAdapter(fakeAdapter({
      translate: (raw, organizationId) => ({
        raw,
        normalized: {
          organizationId, source: 'test_source', entityType: 'account',
          externalId: 'ACC-1', account: { domain: 'acme.test' },
        },
      }),
    }));
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [{}] });
    expect(r.succeeded).toBe(1);
    expect(resolveCalls).toHaveLength(0);
    expect(r.outcomes[0].personId).toBeNull();
  });
});

describe('LI-4D — 6. duplicate parking', () => {
  it('wires LI-4C detection with the person and the originating evidence', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    dupResult = { detected: [{}], parked: 1, alreadyOpen: 0 };
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(dupCalls[0]).toMatchObject({
      organizationId: ORG_A, personId: 'person-1', sourceRecordId: 'sr-1', email: 'a@x.test',
    });
    expect(r.outcomes[0].duplicatesParked).toBe(1);
  });

  it('reports an already-open pair without treating it as new', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    dupResult = { detected: [{}], parked: 0, alreadyOpen: 1 };
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.outcomes[0].duplicatesParked).toBe(0);
    expect(r.outcomes[0].duplicatesAlreadyOpen).toBe(1);
  });

  it('never merges — the orchestrator has no merge vocabulary at all', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/merged_into_id/);
    expect(code).not.toMatch(/'merged'/);
  });
});

describe('LI-4D — 7. tenant isolation', () => {
  it('the batch tenant is authoritative — an adapter naming another tenant is refused', async () => {
    registerLeadSourceAdapter(fakeAdapter({
      translate: (raw) => ({
        raw,
        normalized: {
          organizationId: ORG_B,                    // wrong tenant
          source: 'test_source', entityType: 'person', externalId: 'EXT-1',
          person: { email: 'a@x.test' },
        },
      }),
    }));
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.succeeded).toBe(0);
    expect(r.outcomes[0].rejection).toBe('validation_failed');
    expect(r.outcomes[0].error).toMatch(/returned tenant/);
    expect(calls).toEqual([]);                       // refused BEFORE any write
  });

  it('an adapter returning a different source is refused', async () => {
    registerLeadSourceAdapter(fakeAdapter({
      translate: (raw, organizationId) => ({
        raw,
        normalized: {
          organizationId, source: 'other_source', entityType: 'person',
          externalId: 'EXT-1', person: { email: 'a@x.test' },
        },
      }),
    }));
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.outcomes[0].rejection).toBe('validation_failed');
    expect(r.outcomes[0].error).toMatch(/returned source/);
  });

  it('the same tenant flows unchanged into identity, provenance and dedupe', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row({ domain: 'acme.test' })] });
    expect(resolveCalls[0].companyId).toBe(ORG_A);
    expect(ingested[0].organizationId).toBe(ORG_A);
    expect(dupCalls[0].organizationId).toBe(ORG_A);
  });

  it('refuses a tenant-less batch outright', async () => {
    await expect(ingestLeadBatch({ organizationId: '', source: 'test_source', records: [] }))
      .rejects.toThrow(/organizationId is required/);
  });
});

describe('LI-4D — 8/9. idempotency', () => {
  it('the same source + external id yields the same provenance identity', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(ingested[0].sourceRecordId).toBe(ingested[1].sourceRecordId);
    expect(ingested[0].provider).toBe(ingested[1].provider);
    expect(ingested[0].organizationId).toBe(ingested[1].organizationId);
  });

  it('the same person from two different sources resolves to ONE canonical person', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    registerLeadSourceAdapter(fakeAdapter({
      source: 'other_source', label: 'Other',
      translate: (raw, organizationId) => ({
        raw,
        normalized: {
          organizationId, source: 'other_source', entityType: 'person',
          externalId: 'OTHER-1', person: { email: 'a@x.test' },
        },
      }),
    }));
    const a = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    const b = await ingestLeadBatch({ organizationId: ORG_A, source: 'other_source', records: [{}] });
    expect(a.outcomes[0].personId).toBe(b.outcomes[0].personId);
    // Two distinct source records, one person — evidence coexists.
    expect(ingested[0].sourceRecordId).not.toBe(ingested[1].sourceRecordId);
  });

  it('the orchestrator never SELECTs before inserting — dedupe is the boundary\'s constraint', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    expect(src).not.toMatch(/\.select\(/);
    expect(src).not.toMatch(/\.insert\(/);
  });
});

describe('LI-4D — 10. account boundary', () => {
  it('resolves the EMPLOYER and attaches the person to it', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    accountResolution = { accountId: 'acct-1', outcome: 'created' };
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source', records: [row({ domain: 'acme.test', company: 'ACME' })],
    });
    expect(r.outcomes[0].accountId).toBe('acct-1');
    expect(attachCalls[0]).toEqual([ORG_A, 'person-1', 'acct-1']);
  });

  it('an AMBIGUOUS employer is not silently picked', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    accountResolution = { accountId: 'acct-9', outcome: 'ambiguous' };
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source', records: [row({ domain: 'acme.test' })],
    });
    expect(r.outcomes[0].accountId).toBeNull();
    expect(attachCalls).toHaveLength(0);
  });

  it('a record with no employer evidence resolves no account and still succeeds', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.succeeded).toBe(1);
    expect(r.outcomes[0].accountId).toBeNull();
    expect(calls).not.toContain('account');
  });

  it('creates no new account model — it reuses W4', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    expect(src).toMatch(/resolveOrCreateAccount/);
    expect(src).not.toMatch(/prospect_accounts/);
  });
});

describe('LI-4D — 11/12. error, retry and partial batch semantics', () => {
  it('a normalization failure fails ONLY that record', async () => {
    let n = 0;
    registerLeadSourceAdapter(fakeAdapter({
      translate: (raw, organizationId) => {
        n += 1;
        if (n === 2) throw new Error('provider record malformed');
        return fakeAdapter().translate(raw, organizationId);
      },
    }));
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source', records: [row(), row({ id: 'EXT-2' }), row({ id: 'EXT-3' })],
    });
    expect(r.total).toBe(3);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.outcomes[1].rejection).toBe('normalization_failed');
  });

  it('an identity failure is reported, never silently swallowed', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    resolveThrows = new Error('identity store unreachable');
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'identity_failed' });
    expect(r.outcomes[0].error).toMatch(/identity store unreachable/);
    expect(ingested).toHaveLength(0);                // nothing was persisted
  });

  it('a provenance failure fails the record', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    ingestThrows = new Error('evidence store unreachable');
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'provenance_failed' });
  });

  it('an account failure fails the record rather than proceeding without an employer', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    accountThrows = new Error('account store unreachable');
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source', records: [row({ domain: 'acme.test' })],
    });
    expect(r.outcomes[0]).toMatchObject({ ok: false, rejection: 'account_resolution_failed' });
  });

  it('a duplicate-detection failure reports partial work rather than claiming success', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    dupThrows = new Error('detector unreachable');
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    const o = r.outcomes[0];
    expect(o.ok).toBe(false);                         // NOT reported as complete
    expect(o.rejection).toBe('duplicate_detection_failed');
    expect(o.sourceRecordId).toBe('sr-1');            // but what did land is reported
    expect(o.personId).toBe('person-1');
  });

  it('a batch is never all-or-nothing — every record has its own outcome', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'test_source', records: [row(), row({ id: 'EXT-2' })],
    });
    expect(r.outcomes).toHaveLength(2);
    expect(r.succeeded + r.failed).toBe(r.total);
  });

  it('retrying a failed record after the fault clears succeeds, with no leftover state', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    ingestThrows = new Error('transient');
    const first = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(first.failed).toBe(1);

    ingestThrows = null;
    const second = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [row()] });
    expect(second.succeeded).toBe(1);
    expect(second.outcomes[0].sourceRecordId).toBe('sr-1');
  });
});

describe('LI-4D — 13/14. bulk limits and capabilities', () => {
  it('refuses a batch larger than the cap', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const many = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => row({ id: `E${i}` }));
    await expect(ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: many }))
      .rejects.toThrow(/exceeds the 1000 limit/);
  });

  it('an empty batch is a valid no-op', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const r = await ingestLeadBatch({ organizationId: ORG_A, source: 'test_source', records: [] });
    expect(r).toMatchObject({ total: 0, succeeded: 0, failed: 0 });
  });

  it('a capability outside the known set is refused at registration', () => {
    expect(() => registerLeadSourceAdapter(fakeAdapter({ capabilities: ['telepathy'] as never })))
      .toThrow(/unknown capability/);
  });

  it('reports only capabilities an adapter actually declares', () => {
    registerLeadSourceAdapter(fakeAdapter());
    expect(sourceSupports('test_source', 'person_discovery')).toBe(true);
    expect(sourceSupports('test_source', 'enrichment')).toBe(false);
    expect(sourceSupports('ghost', 'search')).toBe(false);
    expect(SOURCE_CAPABILITIES).toContain('person_discovery');
  });
});

describe('LI-4D — 15. no bypass is possible', () => {
  it('a single record takes the same route as a batch', async () => {
    registerLeadSourceAdapter(fakeAdapter());
    const translated = fakeAdapter().translate(row(), ORG_A);
    const o = await ingestNormalizedRecord(translated);
    expect(o.ok).toBe(true);
    expect(calls).toEqual(['identity', 'provenance', 'duplicates']);
  });

  it('the ingestion modules perform no outreach, governance or transport', () => {
    const fs = require('fs');
    const path = require('path');
    const forbidden = /(mayContact|contactGovernance|leadOutreachExecution|sendgrid|twilio|whatsapp|nodemailer|resend|smtp|axios|fetch\()/i;
    for (const f of ['contracts.ts', 'registry.ts', 'orchestrator.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../../services/leadIngestion/', f), 'utf8');
      const imports = src.split('\n').filter((l: string) => l.trim().startsWith('import'));
      for (const line of imports) expect(line).not.toMatch(forbidden);
    }
  });

  it('an adapter cannot reach the database — the contract gives it no way to', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/contracts.ts'), 'utf8');
    expect(src).not.toMatch(/ownedDbTable/);
    expect(src).not.toMatch(/supabase/);
    // translate() is synchronous by contract: it cannot await I/O.
    expect(src).toMatch(/translate\(raw: Record<string, unknown>, organizationId: string\): AdapterResult;/);
  });
});
