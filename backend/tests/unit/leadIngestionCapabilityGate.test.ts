/**
 * The lead-ingestion capability gate.
 *
 * Two things are proven here, and neither is provable from the route tests:
 *
 *   1. the flag's PARSING — `ENABLE_LEAD_INGESTION`, following the repository's
 *      existing enablement convention (`isCreatorRenderingEnabled` et al):
 *      trimmed, lower-cased, `'1'` or `'true'`, everything else disabled;
 *   2. that when the flag is off, `ingestLeadBatch` performs NO DATABASE WRITE.
 *      The routes mock the orchestrator, so only this suite can show that the
 *      service-level gate stops the chain before its first write — the reason
 *      the gate exists at two levels rather than one.
 *
 * EVERY write dependency of the chain is doubled so a call to ANY of them is a
 * detectable failure of the gate, not merely an unasserted side effect. That
 * list has to grow whenever the chain does: WS-1's prospect resolver is the
 * most recent addition, and it writes `canonical_users` and `canonical_leads`.
 */

const writes: string[] = [];

// Tenant-scoped ingestion gate: this suite exercises orchestration, not the
// gate, so the tenant flag is doubled ON. The gate's own behaviour — including
// every DENY path — is proven in piTenantScopedIngestionGate.test.ts.
jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => {
    writes.push('identity');                       // the FIRST write of the chain
    return { unifiedPersonId: 'person-1', matchedBy: 'email', created: true };
  }),
  normalizeEmail: (v: string) => (v ?? '').trim().toLowerCase() || null,
  normalizePhone: (v: string) => (v ?? '').trim() || null,
}));

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => {
    writes.push('account');
    return { accountId: null, outcome: 'insufficient_evidence' };
  }),
  attachPersonToAccount: jest.fn(async () => {
    writes.push('attach');
    return { attached: true, reason: 'ok' };
  }),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => {
    writes.push('provenance');
    return {
      sourceRecordId: 'sr-1', outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [],
    };
  }),
}));

jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => {
    writes.push('prospect');
    return {
      organizationId: 'org', prospectId: 'prospect-1', subjectId: 'subject-1',
      outcome: 'created', externalLeadKey: 'EXT-1', reason: 'created',
    };
  }),
}));

jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => {
    writes.push('duplicates');
    return { detected: [], parked: 0, alreadyOpen: 0 };
  }),
}));

import {
  ingestLeadBatch,
  ingestNormalizedRecord,
  isLeadIngestionEnabled,
} from '../../services/leadIngestion/orchestrator';
import {
  __resetLeadSourceRegistry,
  registerLeadSourceAdapter,
} from '../../services/leadIngestion/registry';
import type { AdapterResult, LeadSourceAdapter } from '../../services/leadIngestion/contracts';
import {
  ALL_CAPABILITIES,
  CAPABILITY_HIERARCHY,
  PROSPECT_INGEST,
} from '../../../shared/contracts/security';
import { ROLE_CAPABILITIES, expandWithHierarchy } from '../../security/capabilityRegistry';

const FLAG = 'ENABLE_LEAD_INGESTION';
const ORG = '00000000-0000-4000-8000-0000000000aa';

/** A FAKE source. No provider adapter exists and none is introduced here. */
const fakeAdapter: LeadSourceAdapter = {
  source: 'gate_test_source',
  label: 'Gate Test Source',
  capabilities: ['person_discovery'],
  translate: (raw: Record<string, unknown>, organizationId: string): AdapterResult => ({
    raw,
    normalized: {
      organizationId,
      source: 'gate_test_source',
      entityType: 'person',
      externalId: String(raw.id ?? 'EXT-1'),
      person: { email: (raw.email as string) ?? null, phone: null, fullName: null, externalKeys: null },
      account: null,
      observedAt: null,
    },
  }),
};

const record = (): AdapterResult => fakeAdapter.translate({ id: 'EXT-1', email: 'a@x.test' }, ORG);

// The ambient environment is snapshotted and restored, so this suite can neither
// be contaminated by an ambient value nor leak one into any other suite.
let flagBefore: string | undefined;
beforeAll(() => { flagBefore = process.env[FLAG]; });
afterAll(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

beforeEach(() => {
  delete process.env[FLAG];          // every case states its own flag value
  writes.length = 0;
  __resetLeadSourceRegistry();
  registerLeadSourceAdapter(fakeAdapter);
  jest.clearAllMocks();
});

describe('prospect.ingest — the capability that governs the write surface', () => {
  it('is a member of the canonical vocabulary', () => {
    expect(PROSPECT_INGEST).toBe('prospect.ingest');
    expect(ALL_CAPABILITIES).toContain(PROSPECT_INGEST);
  });

  it('is granted to COMPANY_ADMIN and SUPER_ADMIN', () => {
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).toContain(PROSPECT_INGEST);
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain(PROSPECT_INGEST);
  });

  it('is granted to NO other role — VIEW_ONLY above all cannot write the identity spine', () => {
    const denied = ['VIEW_ONLY', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'CONTENT_ARCHITECT'] as const;
    for (const role of denied) {
      expect(ROLE_CAPABILITIES[role]).not.toContain(PROSPECT_INGEST);
    }
    // Stated positively too, so a new role added later cannot quietly inherit it.
    const holders = (Object.keys(ROLE_CAPABILITIES) as Array<keyof typeof ROLE_CAPABILITIES>)
      .filter((r) => ROLE_CAPABILITIES[r].includes(PROSPECT_INGEST))
      .sort();
    expect(holders).toEqual(['COMPANY_ADMIN', 'SUPER_ADMIN']);
  });

  it('has no hierarchy relationship in EITHER direction — it implies nothing and nothing implies it', () => {
    for (const { parent, child } of CAPABILITY_HIERARCHY) {
      expect(parent).not.toBe(PROSPECT_INGEST);
      expect(child).not.toBe(PROSPECT_INGEST);
    }
  });

  it('holding it does not expand into any other capability', () => {
    // The guarantee the hierarchy check above exists to protect: a principal
    // granted ingestion authority gains ingestion authority and nothing else.
    const expanded = expandWithHierarchy([PROSPECT_INGEST]);
    expect([...expanded]).toEqual([PROSPECT_INGEST]);
  });
});

describe('isLeadIngestionEnabled — parsing follows the existing enablement convention', () => {
  it('absent → disabled (the default is OFF, not ON)', () => {
    delete process.env[FLAG];
    expect(isLeadIngestionEnabled()).toBe(false);
  });

  it.each(['', '   ', 'false', '0', 'no', 'off', 'yes', 'on', 'enabled', 'TRUE!', '2'])(
    'unrecognised value %p → disabled, so a misconfiguration cannot open the write surface',
    (v) => {
      process.env[FLAG] = v;
      expect(isLeadIngestionEnabled()).toBe(false);
    },
  );

  it.each(['true', '1', 'TRUE', 'True', ' true ', '\t1\n', ' TRUE '])(
    'accepted value %p → enabled (trimmed, case-insensitive)',
    (v) => {
      process.env[FLAG] = v;
      expect(isLeadIngestionEnabled()).toBe(true);
    },
  );

  it('is re-read per call, so flipping the variable takes effect without a restart', () => {
    process.env[FLAG] = 'true';
    expect(isLeadIngestionEnabled()).toBe(true);
    process.env[FLAG] = 'false';
    expect(isLeadIngestionEnabled()).toBe(false);
  });

  it('deliberately rejects the wider truthy set some other repo helpers accept', () => {
    // `rollout.ts` treats yes/on as truthy. This gate does not, because the
    // enablement convention it follows is the creator one: '1' | 'true' only.
    for (const v of ['yes', 'on']) {
      process.env[FLAG] = v;
      expect(isLeadIngestionEnabled()).toBe(false);
    }
  });
});

describe('the service-level gate stops the chain BEFORE its first write', () => {
  it('ingestLeadBatch: disabled → not one write dependency is touched', async () => {
    delete process.env[FLAG];
    const result = await ingestLeadBatch({
      organizationId: ORG,
      source: fakeAdapter.source,
      records: [{ id: 'EXT-1', email: 'a@x.test' }],
    });
    expect(writes).toEqual([]);                    // identity is the first write — never reached
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
  });

  it('ingestLeadBatch: every record in a batch is refused, and the batch still REPORTS', async () => {
    delete process.env[FLAG];
    const result = await ingestLeadBatch({
      organizationId: ORG,
      source: fakeAdapter.source,
      records: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    });
    expect(writes).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.failed).toBe(3);
    // Reported, never thrown: a caller still receives one outcome per record.
    expect(result.outcomes.map((o) => o.rejection)).toEqual(
      ['ingestion_disabled', 'ingestion_disabled', 'ingestion_disabled'],
    );
  });

  it('ingestNormalizedRecord: the single-record surface is gated too, not just the batch', async () => {
    // This function is exported for callers who drive one record without a
    // batch. Guarding only ingestLeadBatch would have left it open.
    delete process.env[FLAG];
    const outcome = await ingestNormalizedRecord(record());
    expect(writes).toEqual([]);
    expect(outcome).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
  });

  it('the gate outranks validation — a disabled call is refused as disabled, not as invalid', async () => {
    delete process.env[FLAG];
    const broken = { raw: {}, normalized: { organizationId: '', source: '', entityType: 'person' } };
    const outcome = await ingestNormalizedRecord(broken as unknown as AdapterResult);
    expect(outcome.rejection).toBe('ingestion_disabled');
    expect(writes).toEqual([]);
  });
});

describe('enabled: the gate is a passthrough and existing behaviour is unchanged', () => {
  it('the full chain runs in its established order', async () => {
    process.env[FLAG] = 'true';
    const result = await ingestLeadBatch({
      organizationId: ORG,
      source: fakeAdapter.source,
      records: [{ id: 'EXT-1', email: 'a@x.test' }],
    });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(writes).toEqual(['identity', 'prospect', 'provenance', 'duplicates']);
  });

  it("'1' enables the chain exactly as 'true' does", async () => {
    process.env[FLAG] = '1';
    const outcome = await ingestNormalizedRecord(record());
    expect(outcome.ok).toBe(true);
    expect(writes).toContain('identity');
  });

  it('a mid-batch flip stops the NEXT record and leaves the earlier one reported', async () => {
    // The gate is evaluated per record, so the boundary it guards is between
    // records — never between the writes of one record.
    process.env[FLAG] = 'true';
    const first = await ingestNormalizedRecord(record());
    expect(first.ok).toBe(true);

    process.env[FLAG] = 'false';
    const second = await ingestNormalizedRecord(record());
    expect(second).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });

    // Only the first record's writes happened; the second added none.
    expect(writes).toEqual(['identity', 'prospect', 'provenance', 'duplicates']);
  });
});
