/**
 * P2C — a person record's nested employer facts reach `prospect_accounts`.
 *
 * Before this, a person record could carry `industry`, `annualRevenue` and the
 * rest, and every one was silently dropped: `ingestSourceRecord` is
 * single-entity, so the person pass had nowhere to put them.
 *
 * The fix is a SECOND pass through the SAME boundary, and the tests that matter
 * most are the ones proving it stayed a second pass and not a second writer —
 * and that it stays quiet when the source said nothing about the employer.
 */

const ingested: Array<Record<string, unknown>> = [];
let ingestThrows: Error | null = null;
let accountResolution: { accountId: string | null; outcome: string } = { accountId: 'account-1', outcome: 'created' };

// Tenant-scoped ingestion gate: this suite exercises orchestration, not the
// gate, so the tenant flag is doubled ON. The gate's own behaviour — including
// every DENY path — is proven in piTenantScopedIngestionGate.test.ts.
jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: Record<string, unknown>) => {
    if (ingestThrows) throw ingestThrows;
    ingested.push(input);
    return {
      sourceRecordId: `sr-${ingested.length}`, outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [],
    };
  }),
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'person-1', matchedBy: 'email', created: false })),
}));

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => accountResolution),
  attachPersonToAccount: jest.fn(async () => undefined),
}));

jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => ({
    organizationId: 'org', prospectId: 'prospect-1', subjectId: 'subject-1',
    outcome: 'created', externalLeadKey: 'K1', reason: 'created',
  })),
}));

jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';
import type { AdapterResult, NormalizedAccount } from '../../services/leadIngestion/contracts';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const personRecord = (account: NormalizedAccount | null): AdapterResult => ({
  raw: { any: 'payload' },
  normalized: {
    organizationId: ORG,
    source: 'manual',
    entityType: 'person',
    externalId: 'PERSON-1',
    person: { email: 'a@x.test', externalKeys: { manual: { external_id: 'PERSON-1' } } },
    account,
  },
});

const accountPass = () => ingested.find((i) => i.entityType === 'account');
const personPass = () => ingested.find((i) => i.entityType === 'person');

// The ingestion capability gate is default-OFF. This suite drives the REAL
// per-record path, so it states the enabled contract explicitly and restores
// the ambient value afterwards.
const INGESTION_FLAG = 'ENABLE_LEAD_INGESTION';
let ingestionFlagBefore: string | undefined;
beforeAll(() => { ingestionFlagBefore = process.env[INGESTION_FLAG]; });
afterAll(() => {
  if (ingestionFlagBefore === undefined) delete process.env[INGESTION_FLAG];
  else process.env[INGESTION_FLAG] = ingestionFlagBefore;
});

beforeEach(() => {
  process.env[INGESTION_FLAG] = 'true';
  ingested.length = 0;
  ingestThrows = null;
  accountResolution = { accountId: 'account-1', outcome: 'created' };
});

describe('P2C — employer facts now reach the account', () => {
  it('makes a SECOND boundary pass for the employer', async () => {
    const out = await ingestNormalizedRecord(personRecord({
      domain: 'acme.example', industry: 'SaaS', annualRevenue: 12_500_000,
    }));
    expect(out.ok).toBe(true);
    expect(ingested).toHaveLength(2);
    expect(personPass()?.entityType).toBe('person');
    expect(accountPass()?.entityType).toBe('account');
  });

  it('carries every P2A firmographic through', async () => {
    await ingestNormalizedRecord(personRecord({
      domain: 'acme.example',
      annualRevenue: 12_500_000, revenueBand: '$10M-$50M', foundedYear: 2015,
      technologies: ['postgres'], fundingStage: 'Series B', lastFundingAt: '2026-01-01T00:00:00Z',
    }));
    expect(accountPass()?.accountAttributes).toMatchObject({
      annualRevenue: 12_500_000, revenueBand: '$10M-$50M', foundedYear: 2015,
      technologies: ['postgres'], fundingStage: 'Series B', lastFundingAt: '2026-01-01T00:00:00Z',
    });
  });

  it('carries the LI-1 firmographics too — one mapping serves both', async () => {
    await ingestNormalizedRecord(personRecord({
      domain: 'acme.example', industry: 'SaaS', employeeCount: 250,
      employeeBand: '201-500', countryCode: 'GB', region: 'London', city: 'London',
    }));
    expect(accountPass()?.accountAttributes).toMatchObject({
      industry: 'SaaS', employeeCount: 250, employeeBand: '201-500', countryCode: 'GB',
    });
  });

  it('targets the resolved account and NOT the person', async () => {
    await ingestNormalizedRecord(personRecord({ domain: 'acme.example', industry: 'SaaS' }));
    expect(accountPass()).toMatchObject({ accountId: 'account-1', personId: null });
  });

  it('uses the employer’s own provider id when the source gave one', async () => {
    await ingestNormalizedRecord(personRecord({
      externalId: 'ACC-9', domain: 'acme.example', industry: 'SaaS',
    }));
    expect(accountPass()?.sourceRecordId).toBe('ACC-9');
  });

  it('falls back to the person record that asserted it, so the claim stays traceable', async () => {
    await ingestNormalizedRecord(personRecord({ domain: 'acme.example', industry: 'SaaS' }));
    expect(accountPass()?.sourceRecordId).toBe('PERSON-1');
  });

  it('preserves tenant, provider, observedAt and run id on the employer pass', async () => {
    const rec = personRecord({ domain: 'acme.example', industry: 'SaaS' });
    rec.normalized.observedAt = '2026-01-01T00:00:00.000Z';
    await ingestNormalizedRecord(rec, { ingestionRunId: 'run-7' });
    expect(accountPass()).toMatchObject({
      organizationId: ORG, provider: 'manual',
      observedAt: '2026-01-01T00:00:00.000Z', ingestionRunId: 'run-7',
    });
  });
});

describe('P2C — it stays quiet when there is nothing to say', () => {
  it('makes NO employer pass when the record has no account', async () => {
    await ingestNormalizedRecord(personRecord(null));
    expect(ingested).toHaveLength(1);
    expect(accountPass()).toBeUndefined();
  });

  it('makes NO employer pass when the account carries identity only', async () => {
    // name/domain/websiteUrl/externalId RESOLVED the account — they are not
    // claims about it. Writing a source record asserting nothing is noise.
    await ingestNormalizedRecord(personRecord({
      externalId: 'ACC-9', name: 'Acme', domain: 'acme.example', websiteUrl: 'https://acme.example',
    }));
    expect(ingested).toHaveLength(1);
  });

  it('makes NO employer pass when the account did not resolve', async () => {
    accountResolution = { accountId: null, outcome: 'insufficient_evidence' };
    await ingestNormalizedRecord(personRecord({ domain: 'acme.example', industry: 'SaaS' }));
    expect(ingested).toHaveLength(1);
  });

  it('makes NO employer pass when the employer was ambiguous', async () => {
    // W4 refuses to pick between two accounts; P2C must not write to a guess.
    accountResolution = { accountId: 'account-1', outcome: 'ambiguous' };
    await ingestNormalizedRecord(personRecord({ domain: 'acme.example', industry: 'SaaS' }));
    expect(ingested).toHaveLength(1);
  });

  it('a single firmographic is enough to trigger it', async () => {
    await ingestNormalizedRecord(personRecord({ domain: 'acme.example', foundedYear: 2015 }));
    expect(ingested).toHaveLength(2);
  });
});

describe('P2C — an account-entity record is unaffected', () => {
  it('still makes exactly ONE pass', async () => {
    await ingestNormalizedRecord({
      raw: {},
      normalized: {
        organizationId: ORG, source: 'manual', entityType: 'account', externalId: 'ACC-1',
        account: { domain: 'acme.example', industry: 'SaaS', annualRevenue: 1 },
      },
    });
    expect(ingested).toHaveLength(1);
    expect(ingested[0].entityType).toBe('account');
    expect(ingested[0].accountAttributes).toMatchObject({ industry: 'SaaS', annualRevenue: 1 });
  });
});

describe('P2C — failure semantics match the employer rules already in force', () => {
  it('an employer provenance failure fails the record', async () => {
    // Consistent with account_resolution_failed: the platform already refuses to
    // report success for a record whose employer half did not complete.
    ingestThrows = new Error('boundary down');
    const out = await ingestNormalizedRecord(personRecord({ domain: 'acme.example', industry: 'SaaS' }));
    expect(out.ok).toBe(false);
    expect(out.rejection).toBe('provenance_failed');
  });
});

describe('P2C — no second writer was introduced', () => {
  const src = () => require('fs').readFileSync(
    require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the orchestrator performs no database write of its own', () => {
    for (const forbidden of ['ownedDbTable', 'supabase', '.insert(', '.update(', '.upsert(', 'prospect_accounts']) {
      expect(src()).not.toContain(forbidden);
    }
  });

  it('every employer write goes through the one boundary function', () => {
    const calls = (src().match(/ingestSourceRecord\(/g) ?? []).length;
    expect(calls).toBe(2);                 // person pass + employer pass
    expect(src()).toContain('ingestSourceRecord');
  });

  it('the attribute mapping exists exactly once', () => {
    // Two copies would drift, and a firmographic dropped on one path only is
    // precisely the divergence nothing else would catch.
    expect((src().match(/industry:\s*account\?\./g) ?? []).length).toBe(1);
  });

  it('still names no provider', () => {
    for (const p of ['apollo', 'zoominfo', 'crunchbase', 'linkedin', 'rapidapi', 'hubspot']) {
      expect(src().toLowerCase()).not.toContain(p);
    }
  });
});
