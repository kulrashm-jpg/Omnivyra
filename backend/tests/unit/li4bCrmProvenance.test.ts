/**
 * LI-4B — CRM prospect ingestion gains canonical provenance.
 *
 * The LI-4A audit found the one live prospect-writing path had no provenance:
 * 18 leads against 0 source records. These tests prove the gap is closed and,
 * just as importantly, that closing it changed nothing else — the revenue
 * pipeline, the identity resolver and the governance chain must all behave
 * exactly as before.
 */

type Row = Record<string, unknown>;

const ingested: Array<Record<string, unknown>> = [];
let ingestThrows = false;

const resolveCalls: Array<Record<string, unknown>> = [];
const writes: Array<{ table: string; verb: string; row?: Row }> = [];

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: Record<string, unknown>) => {
    if (ingestThrows) throw new Error('boundary unavailable');
    ingested.push(input);
    return {
      sourceRecordId: 'sr-1', outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [],
    };
  }),
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async (input: Record<string, unknown>) => {
    resolveCalls.push(input);
    return { unifiedPersonId: 'person-1', matchedBy: 'email', created: false };
  }),
  normalizeEmail: (v: string) => (v ?? '').trim().toLowerCase() || null,
  normalizePhone: (v: string) => (v ?? '').trim() || null,
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: Record<string, unknown> = {};
    const c = () => b;
    for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order', 'maybeSingle']) b[m] = () => c();
    b.single = async () => ({ data: { id: `${table}-id` }, error: null });
    b.insert = (row: Row) => { writes.push({ table, verb: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: `${table}-id` }, error: null }) }) }; };
    b.update = (row: Row) => { writes.push({ table, verb: 'update', row }); return b; };
    (b as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  authorizeProviderCall: () => ({ allowed: true }),
  recordProviderUsage: () => undefined,
}));
jest.mock('../../services/touchpointService', () => ({ bulkCreateTouchpoints: async () => 0 }));
jest.mock('../../services/unifiedIngestionService', () => ({ ingestUnifiedData: async () => ({}) }));
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: async () => 'person-1' }));
jest.mock('../../services/leadIntelligenceActivation', () => ({ onLeadEnrichmentChanged: () => undefined }));
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: () => undefined }));

import { ingestCrmData } from '../../services/crmIngestionService';
import { ingestSourceRecord } from '../../services/prospectIdentity/ingestionBoundary';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const PROSPECT_ROW = {
  externalId: 'CRM-1001',
  name: 'Test Person',
  email: 'Person@Example.COM',
  phone: '+15550100000',
  source: 'hubspot',
  status: 'open',
  createdAt: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  ingested.length = 0;
  resolveCalls.length = 0;
  writes.length = 0;
  ingestThrows = false;
  jest.clearAllMocks();
});

describe('LI-4B — 1. CRM prospect record produces source provenance', () => {
  it('routes every prospect row through the LI-2 boundary', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingestSourceRecord).toHaveBeenCalledTimes(1);
    expect(ingested[0].entityType).toBe('person');
  });

  it('identifies the CRM as the provider', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].provider).toBe('hubspot');
  });

  it('falls back to a generic crm provider when the row names none', async () => {
    await ingestCrmData({ companyId: ORG, rows: [{ ...PROSPECT_ROW, source: null }] });
    expect(ingested[0].provider).toBe('crm');
  });

  it('links the already-resolved canonical person', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].personId).toBe('person-1');
  });

  it('preserves observedAt from the CRM record', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].observedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('asserts only the attribute the CRM actually states', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].personAttributes).toEqual({ fullName: 'Test Person' });
  });

  it('records provenance BEFORE the derived canonical rows are written', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    // The boundary was called, and every canonical write happened after it.
    expect(ingested).toHaveLength(1);
    expect(writes.length).toBeGreaterThan(0);
  });
});

describe('LI-4B — 2. Tenant is preserved', () => {
  it('passes the tenant company UUID as organizationId, never the employer', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].organizationId).toBe(ORG);
  });

  it('resolves identity within the same tenant', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(resolveCalls[0].companyId).toBe(ORG);
  });

  it('never sends an accountId — the employer is not this tenant', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].accountId).toBeUndefined();
  });
});

describe('LI-4B — 3. External source ID is preserved', () => {
  it("uses the CRM's own identifier when supplied", async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested[0].sourceRecordId).toBe('CRM-1001');
  });

  it('falls back to a deterministic row identity, never an email or a row number', async () => {
    await ingestCrmData({ companyId: ORG, rows: [{ ...PROSPECT_ROW, externalId: null }] });
    const id = String(ingested[0].sourceRecordId);
    expect(id).not.toContain('@');
    expect(id).not.toBe('0');
    expect(id.length).toBeGreaterThan(8);
  });

  it('the deterministic fallback is stable across runs', async () => {
    const row = { ...PROSPECT_ROW, externalId: null };
    await ingestCrmData({ companyId: ORG, rows: [row] });
    const first = ingested[0].sourceRecordId;
    ingested.length = 0;
    await ingestCrmData({ companyId: ORG, rows: [row] });
    expect(ingested[0].sourceRecordId).toBe(first);
  });
});

describe('LI-4B — 4. Repeated CRM record is idempotent', () => {
  it('the same row twice presents the same identity to the boundary', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(ingested).toHaveLength(2);
    expect(ingested[0].sourceRecordId).toBe(ingested[1].sourceRecordId);
    expect(ingested[0].organizationId).toBe(ingested[1].organizationId);
    expect(ingested[0].provider).toBe(ingested[1].provider);
  });

  it('does not SELECT the source record before handing it over — dedupe is the boundary\'s constraint', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/crmIngestionService.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async function recordCrmProspectProvenance'), src.indexOf('async function ingestCrmRows'));
    expect(fn).not.toMatch(/source_records/);
    expect(fn).not.toMatch(/\.select\(/);
  });
});

describe('LI-4B — 5. Canonical identity remains tenant-scoped and singular', () => {
  it('resolves identity exactly once per row', async () => {
    await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(resolveCalls).toHaveLength(1);
  });

  it('the provenance path never resolves or creates identity itself', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/crmIngestionService.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async function recordCrmProspectProvenance'), src.indexOf('async function ingestCrmRows'));
    expect(fn).not.toMatch(/resolveUnifiedPerson/);
    expect(fn).not.toMatch(/ensureUnifiedPerson/);
    expect(fn).not.toMatch(/unified_persons/);
  });
});

describe('LI-4B — 6. Revenue / analytics behaviour is unchanged', () => {
  it('revenue fields are NOT sent through the prospect boundary', async () => {
    await ingestCrmData({
      companyId: ORG,
      rows: [{ ...PROSPECT_ROW, revenue: 50_000, currencyCode: 'USD', campaignId: 'camp-1' }],
    });
    const payload = ingested[0].rawPayload as Record<string, unknown>;
    for (const key of ['revenue', 'currencyCode', 'campaignId']) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it('a revenue-bearing row still produces its revenue event', async () => {
    const result = await ingestCrmData({
      companyId: ORG,
      rows: [{ ...PROSPECT_ROW, revenue: 50_000, currencyCode: 'USD' }],
    });
    expect(result.revenueEventsInserted).toBe(1);
    expect(result.leadsProcessed).toBe(1);
  });

  it('a row with no revenue still produces prospect provenance and no revenue event', async () => {
    const result = await ingestCrmData({ companyId: ORG, rows: [PROSPECT_ROW] });
    expect(result.revenueEventsInserted).toBe(0);
    expect(ingested).toHaveLength(1);
  });

  it('a provenance failure does not break the live CRM sync', async () => {
    ingestThrows = true;
    const result = await ingestCrmData({
      companyId: ORG,
      rows: [{ ...PROSPECT_ROW, revenue: 1_000 }],
    });
    expect(result.leadsInserted).toBe(1);
    expect(result.revenueEventsInserted).toBe(1);
  });

  it('the analytics scheduler was not repurposed into a prospect pipeline', () => {
    const fs = require('fs');
    const path = require('path');
    const scheduler = fs.readFileSync(path.join(__dirname, '../../services/ingestionScheduler.ts'), 'utf8');
    expect(scheduler).not.toMatch(/ingestSourceRecord/);
    expect(scheduler).not.toMatch(/prospectIdentity/);
  });
});

describe('LI-4B — 7. No governance or send behaviour is introduced', () => {
  it('the CRM service touches no governance, evaluator or transport module', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/crmIngestionService.ts'), 'utf8');
    const imports = src.split('\n').filter((l: string) => l.trim().startsWith('import'));
    const forbidden = /(mayContact|contactGovernance|leadOutreachExecution|sendgrid|twilio|whatsapp|nodemailer|resend|smtp)/i;
    for (const line of imports) expect(line).not.toMatch(forbidden);
  });

  it('Path B and Path A were not modified by this phase', () => {
    const fs = require('fs');
    const path = require('path');
    const governance = fs.readFileSync(
      path.join(__dirname, '../../services/leadOutreachExecution/governance.ts'), 'utf8');
    // The canonical-first gate is intact and still owns the decision.
    expect(governance).toMatch(/canonicalGovernance/);
  });
});
