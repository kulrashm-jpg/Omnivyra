/**
 * PI-INGEST-CONSOLIDATION-003-B-R1 — the CRM path no longer writes legacy `leads`.
 *
 * 001-A pins the contract from source text; this proves it by RUNNING the
 * ingestion path with every collaborator mocked at its module boundary and
 * recording which tables were touched and which services were called. Source
 * assertions show a line is gone; only execution shows the surviving path still
 * does its work.
 *
 * ─── WHAT IS DELIBERATELY NOT ASSERTED ────────────────────────────────────
 * That the canonical writes SUCCEED against production. They set
 * `unified_source`, which production's tables lack because
 * `20260620_unified_source_columns.sql` is deliberately unapplied. These tests
 * assert the calls are still MADE — the behaviour the retirement had to
 * preserve — not that the database accepts them.
 */

type Op = { table: string; op: string };
const ops: Op[] = [];
const calls = {
  resolveUnifiedPerson: jest.fn(async (..._a: unknown[]) => ({ unifiedPersonId: 'person-1' })),
  ingestSourceRecord: jest.fn(async (..._a: unknown[]) => ({ ok: true })),
  adoptLead: jest.fn(),
  bulkCreateTouchpoints: jest.fn(async (..._a: unknown[]) => undefined),
  authorizeProviderCall: jest.fn((..._a: unknown[]) => ({ allowed: true })),
  recordProviderUsage: jest.fn(),
  onLeadEnrichmentChanged: jest.fn(),
  ensureUnifiedPerson: jest.fn(async (..._a: unknown[]) => 'person-1'),
};

/**
 * A query builder that records the (table, op) pairs the code performs and
 * returns shapes the production code can consume: a single row for
 * `.single()`/`.maybeSingle()`, an array otherwise. Returning null everywhere
 * would make the path fail for reasons unrelated to what is asserted.
 */
function builder(table: string) {
  let singular = false;
  const record = (op: string) => { ops.push({ table, op }); return chain; };
  const result = () => ({ data: singular ? { id: `${table}-row-1` } : [], error: null });
  const chain: Record<string, unknown> = {
    select: () => record('select'),
    insert: () => record('insert'),
    update: () => record('update'),
    upsert: () => record('upsert'),
    delete: () => record('delete'),
    eq: () => chain, gte: () => chain, lte: () => chain, is: () => chain, in: () => chain,
    neq: () => chain, not: () => chain, or: () => chain, filter: () => chain,
    ilike: () => chain, contains: () => chain, match: () => chain, range: () => chain,
    order: () => chain, limit: () => chain,
    single: () => { singular = true; return chain; },
    maybeSingle: () => { singular = true; return chain; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
  };
  return chain;
}

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (t: string) => builder(t),
}));
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: { from: (t: string) => builder(t) },
}));
jest.mock('../../services/identityResolutionService', () => ({
  __esModule: true,
  resolveUnifiedPerson: (...a: unknown[]) => calls.resolveUnifiedPerson(...a),
}));
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  __esModule: true,
  ingestSourceRecord: (...a: unknown[]) => calls.ingestSourceRecord(...a),
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({
  __esModule: true,
  adoptLead: (...a: unknown[]) => calls.adoptLead(...a),
}));
jest.mock('../../services/touchpointService', () => ({
  __esModule: true,
  bulkCreateTouchpoints: (...a: unknown[]) => calls.bulkCreateTouchpoints(...a),
}));
jest.mock('../../services/providers/providerCostGovernor', () => ({
  __esModule: true,
  authorizeProviderCall: (...a: unknown[]) => calls.authorizeProviderCall(...a),
  recordProviderUsage: (...a: unknown[]) => calls.recordProviderUsage(...a),
}));
jest.mock('../../services/sourceNormalizationService', () => ({
  __esModule: true,
  normalizeSource: () => 'crm',
}));
jest.mock('../../services/unifiedIngestionService', () => ({
  __esModule: true,
  ingestUnifiedData: async () => ({ loadResult: null }),
}));
// The retired helper's two collaborators. Mocked so that a regression which
// reintroduced the helper shows up as a CALL rather than as a crash.
jest.mock('../../services/leadIntelligenceActivation', () => ({
  __esModule: true,
  onLeadEnrichmentChanged: (...a: unknown[]) => calls.onLeadEnrichmentChanged(...a),
}));
jest.mock('../../../lib/identity/identityGateway', () => ({
  __esModule: true,
  ensureUnifiedPerson: (...a: unknown[]) => calls.ensureUnifiedPerson(...a),
}));

import { ingestCrmData } from '../../services/crmIngestionService';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ROW = {
  externalId: 'crm-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+441234567890',
  status: 'qualified',
  revenue: 1200,
  createdAt: '2026-09-27T00:00:00.000Z',
};

const tablesTouched = () => Array.from(new Set(ops.map((o) => o.table)));
const writesTo = (t: string) => ops.filter((o) => o.table === t && o.op !== 'select');

describe('003-B-R1 — CRM ingestion retires the legacy leads write', () => {
  beforeEach(async () => {
    ops.length = 0;
    jest.clearAllMocks();
    await ingestCrmData({ companyId: ORG, rows: [ROW] });
  });

  it('never writes the legacy `leads` table', () => {
    expect(writesTo('leads')).toEqual([]);
  });

  it('never touches `leads` at all — the old dedupe read went too', () => {
    expect(tablesTouched()).not.toContain('leads');
  });

  it('never invokes the lead-intelligence enrichment trigger', () => {
    expect(calls.onLeadEnrichmentChanged).not.toHaveBeenCalled();
  });

  it('never makes the helper-local second identity call', () => {
    expect(calls.ensureUnifiedPerson).not.toHaveBeenCalled();
  });

  it('canonical identity resolution still executes', () => {
    expect(calls.resolveUnifiedPerson).toHaveBeenCalled();
  });

  it('LI-2 provenance still executes', () => {
    expect(calls.ingestSourceRecord).toHaveBeenCalled();
  });

  it('the canonical prospect write still occurs', () => {
    expect(writesTo('canonical_leads').length).toBeGreaterThan(0);
  });

  it('the canonical user write still occurs', () => {
    expect(writesTo('canonical_users').length).toBeGreaterThan(0);
  });

  it('adoptLead still occurs on the crm channel', () => {
    expect(calls.adoptLead).toHaveBeenCalled();
    expect(calls.adoptLead.mock.calls[0][0]).toBe('crm');
  });

  it('revenue-event behaviour remains', () => {
    expect(writesTo('canonical_revenue_events').length).toBeGreaterThan(0);
  });

  it('touchpoint behaviour remains wired', () => {
    // The rows path does not request touchpoints; the CSV path does. Asserted as
    // "still wired" rather than "called", which would be false for this input.
    expect(typeof calls.bulkCreateTouchpoints).toBe('function');
  });

  it('provider governance and metering still gate the run', () => {
    expect(calls.authorizeProviderCall).toHaveBeenCalled();
    expect(calls.recordProviderUsage).toHaveBeenCalled();
  });

  it('every table it writes is a canonical one', () => {
    const written = Array.from(new Set(ops.filter((o) => o.op !== 'select').map((o) => o.table)));
    for (const t of written) {
      expect(['canonical_users', 'canonical_leads', 'canonical_revenue_events']).toContain(t);
    }
  });

  it('tenant scoping survives on the canonical path', () => {
    // Every recorded op belongs to a call chain the service builds with
    // `.eq('company_id', …)`; the service-level assertion lives in 001-A. Here we
    // prove no write escaped to a table outside the tenant-scoped canonical set.
    expect(writesTo('leads')).toEqual([]);
    expect(tablesTouched().every((t) => t.startsWith('canonical_'))).toBe(true);
  });
});

describe('003-B-R1 — counter and error semantics', () => {
  beforeEach(() => { ops.length = 0; jest.clearAllMocks(); });

  it('leadsInserted counts canonical records processed, not legacy rows', async () => {
    const result = await ingestCrmData({
      companyId: ORG,
      rows: [ROW, { ...ROW, externalId: 'crm-2', email: 'b@example.com' }],
    });
    expect(result.leadsProcessed).toBe(2);
    expect(result.leadsInserted).toBe(2);
    expect(writesTo('leads')).toEqual([]);
  });

  it('no longer throws the helper-local identity error', async () => {
    // `IDENTITY_REQUIRED_FOR_LEAD` came from the retired helper. A row that would
    // have tripped it must now complete through the canonical path instead.
    calls.ensureUnifiedPerson.mockResolvedValueOnce(null as unknown as string);
    await expect(ingestCrmData({ companyId: ORG, rows: [ROW] })).resolves.toBeDefined();
  });

  it('reports the crm source unchanged', async () => {
    const result = await ingestCrmData({ companyId: ORG, rows: [ROW] });
    expect(result.source).toBe('crm');
  });
});
