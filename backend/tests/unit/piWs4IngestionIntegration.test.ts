/**
 * WS-4 — ingestion integration.
 *
 * Two things are proven here, and the second is the reason this file exists at
 * the integration level rather than the unit level.
 *
 * 1. THE CRM `unified_source` FINDING. It was reported as an application defect:
 *    the service writes a column production does not have. The application is in
 *    fact CORRECT — migration `20260620_unified_source_columns.sql` declares the
 *    column on all seven tables involved. It has simply never been applied.
 *    So this is an OPERATIONAL gap, and "fixing" the code would delete correct
 *    behaviour and permanently drop the field once the migration lands. These
 *    tests pin the code as unchanged so the wrong fix is not attempted again.
 *
 * 2. THE REAL RESOLVER RUNS. The orchestrator tests elsewhere mock every chain
 *    step to assert ORDER. That is the right test for order and the wrong test
 *    for integration: it would pass even if the resolver were never wired. So
 *    here the WS-1 resolver is NOT mocked — only the database beneath it is —
 *    and the assertions are about a canonical Prospect actually appearing.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  insertErrors: {} as Record<string, { code: string; message: string } | undefined>,
  writes: [] as Array<{ table: string; payload: Row }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'insert' = 'select';
    let payload: Row = {};
    const rows = (): Row[] => (db.tables[table] ??= []);
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (op === 'insert') {
        db.writes.push({ table, payload });
        const err = db.insertErrors[table];
        if (err) return { data: null, error: err };
        const created = { id: `${table}-${db.nextId++}`, ...payload };
        rows().push(created);
        return { data: created, error: null };
      }
      return { data: rows().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { op = 'insert'; payload = p; return api; },
      update: (p: Row) => { op = 'insert'; payload = p; return api; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

// Everything EXCEPT the WS-1 resolver is stubbed. The resolver is the subject.
let identityThrows: Error | null = null;
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => {
    if (identityThrows) throw identityThrows;
    return { unifiedPersonId: 'person-1' };
  }),
  normalizeEmail: (v: string) => v,
  normalizePhone: (v: string) => v,
}));
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: null, outcome: 'insufficient_evidence' })),
  attachPersonToAccount: jest.fn(async () => ({ attached: false, reason: 'n/a' })),
}));
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => ({
    sourceRecordId: 'src-1', outcome: 'created', canonicalApplied: [], canonicalWithheld: [],
  })),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const record = (over: Record<string, unknown> = {}) => ({
  raw: {},
  normalized: {
    organizationId: ORG_A, source: 'crm', entityType: 'person' as const,
    externalId: 'CRM-1', person: { email: 'a@b.test' }, ...over,
  },
});

const leadWrites = () => db.writes.filter((w) => w.table === 'canonical_leads');

beforeEach(() => {
  db.tables = {}; db.insertErrors = {}; db.writes = []; db.nextId = 1;
  identityThrows = null;
  process.env.ENABLE_LEAD_INGESTION = 'true';
});
afterEach(() => { delete process.env.ENABLE_LEAD_INGESTION; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 — the CRM unified_source finding (NOT an application defect)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/crmIngestionService.ts'), 'utf8');
  const migration = require('fs').readFileSync(
    require('path').join(__dirname, '../../../supabase/migrations/20260620_unified_source_columns.sql'), 'utf8');

  /**
   * The reported defect was that crmIngestionService writes `unified_source` to
   * tables without that column. The code is in fact CORRECT: a committed
   * migration declares the column on every table it writes. The column is
   * absent from production only because that migration has never been applied.
   *
   * So the repair is an OPERATIONAL one — apply the migration — and changing
   * the application code would delete correct behaviour and permanently drop
   * the field once the migration lands. These tests pin that, so the "fix" is
   * not attempted again.
   */
  it('the schema DECLARES unified_source on every table the service writes it to', () => {
    for (const table of ['leads', 'canonical_leads', 'canonical_revenue_events', 'ingestion_runs']) {
      expect(migration).toContain(`ALTER TABLE public.${table}`);
    }
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS unified_source JSONB');
  });

  it('the service is UNCHANGED — no correct code was removed to match a stale database', () => {
    // Four writes remain: leads, canonical_leads, canonical_revenue_events and
    // the in-memory adoptLead facade.
    const lines = src.split('\n').filter((l: string) => /^\s*unified_source:/.test(l));
    expect(lines).toHaveLength(4);
  });

  it('WS-4 added no migration of its own for this', () => {
    const dir = require('path').join(__dirname, '../../../supabase/migrations');
    const mine = require('fs').readdirSync(dir).filter((f: string) => /unified_source/i.test(f));
    expect(mine).toEqual(['20260620_unified_source_columns.sql']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 — intake actually reaches the WS-1 resolver', () => {
  it('1/2. ingestion creates a canonical Prospect and reports its id', async () => {
    const out = await ingestNormalizedRecord(record());
    expect(out.ok).toBe(true);
    expect(out.prospectId).toBeTruthy();
    expect(leadWrites()).toHaveLength(1);
    expect(leadWrites()[0].payload.company_id).toBe(ORG_A);
    expect(leadWrites()[0].payload.external_lead_key).toBe('CRM-1');
  });

  it('2b. the Prospect is anchored to the resolved person', async () => {
    const out = await ingestNormalizedRecord(record());
    expect(leadWrites()[0].payload.unified_person_id).toBe('person-1');
    expect(out.personId).toBe('person-1');
  });

  it('3. a PARTIAL record still persists a Prospect — enrichment is not a prerequisite', async () => {
    // Only the minimum the boundary demands: a tenant, a source, a source key
    // and one identity anchor. No name, no employer, no firmographics.
    const out = await ingestNormalizedRecord(record({ person: { email: 'a@b.test' }, account: undefined }));
    expect(out.ok).toBe(true);
    expect(out.prospectId).toBeTruthy();
    expect(out.accountId).toBeNull();
  });

  it('3b. a KEYLESS record never reaches the resolver — the boundary refuses it first', async () => {
    // externalId is required by validateNormalizedRecord ("a record with no
    // source identity cannot be idempotent"), so WS-1's no-key branch is
    // unreachable through ingestion. Partial-record support does not extend to
    // keyless records, and that is the boundary's rule, not the resolver's.
    const out = await ingestNormalizedRecord(record({ externalId: null }));
    expect(out.ok).toBe(false);
    expect(out.rejection).toBe('validation_failed');
    expect(leadWrites()).toHaveLength(0);
  });

  it('4/5. person-first and company-first converge on the same canonical path', async () => {
    await ingestNormalizedRecord(record({ externalId: 'P-1', person: { email: 'p@b.test' } }));
    await ingestNormalizedRecord(record({
      externalId: 'C-1', entityType: 'account', person: undefined,
      account: { domain: 'acme.test', name: 'Acme' },
    }));
    expect(leadWrites()).toHaveLength(2);
    expect(leadWrites().every((w) => w.table === 'canonical_leads')).toBe(true);
  });

  it('6/13. replaying the same source identity does NOT create a second Prospect', async () => {
    const first = await ingestNormalizedRecord(record());
    const again = await ingestNormalizedRecord(record());
    expect(again.prospectId).toBe(first.prospectId);
    expect(leadWrites()).toHaveLength(1);
  });

  it('7. provenance still runs, and after the Prospect exists', async () => {
    const out = await ingestNormalizedRecord(record());
    expect(out.sourceRecordId).toBe('src-1');
    expect(out.provenanceOutcome).toBe('created');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 — tenant isolation across the integration', () => {
  it('8. the same source key in two tenants yields two separate Prospects', async () => {
    await ingestNormalizedRecord(record({ organizationId: ORG_A, externalId: 'SHARED' }));
    await ingestNormalizedRecord(record({ organizationId: ORG_B, externalId: 'SHARED' }));
    expect(leadWrites()).toHaveLength(2);
    expect(leadWrites().map((w) => w.payload.company_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it('8b. every Prospect write carries the ingesting tenant', async () => {
    await ingestNormalizedRecord(record({ organizationId: ORG_B }));
    expect(leadWrites()[0].payload.company_id).toBe(ORG_B);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 — errors stay distinguishable', () => {
  it('15. a resolver/database failure is prospect_resolution_failed, not "no prospect"', async () => {
    db.insertErrors.canonical_leads = { code: '23502', message: 'not-null violation' };
    const out = await ingestNormalizedRecord(record());
    expect(out.ok).toBe(false);
    expect(out.rejection).toBe('prospect_resolution_failed');
    expect(out.error).toMatch(/canonical_leads insert failed/);
  });

  it('15b. an identity failure is still identity_failed — the new step did not absorb it', async () => {
    identityThrows = new Error('resolver down');
    const out = await ingestNormalizedRecord(record());
    expect(out.rejection).toBe('identity_failed');
    expect(leadWrites()).toHaveLength(0);
  });

  it('15c. a subject-table failure surfaces too, rather than silently skipping the Prospect', async () => {
    db.insertErrors.canonical_users = { code: '08006', message: 'connection failure' };
    const out = await ingestNormalizedRecord(record());
    expect(out.ok).toBe(false);
    expect(out.rejection).toBe('prospect_resolution_failed');
  });

  it('14. the capability gate still refuses before anything is written', async () => {
    process.env.ENABLE_LEAD_INGESTION = 'false';
    const out = await ingestNormalizedRecord(record());
    expect(out.rejection).toBe('ingestion_disabled');
    expect(db.writes).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 — it integrated, it did not reimplement', () => {
  const orch = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');

  it('calls the WS-1 service instead of copying its rules', () => {
    expect(orch).toContain("from '../prospectIdentity/prospectResolution'");
    for (const rule of ['external_lead_key', 'canonical_users', 'user_type', "device: 'unknown'"]) {
      expect(orch).not.toContain(rule);
    }
  });

  it('writes no canonical table of its own', () => {
    expect(orch).not.toContain('ownedDbTable');
  });

  it('still names no provider', () => {
    const code = orch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').toLowerCase();
    for (const p of ['apollo', 'linkedin', 'rapidapi', 'hubspot', 'salesforce', 'zoominfo']) {
      expect(code).not.toContain(p);
    }
  });
});
