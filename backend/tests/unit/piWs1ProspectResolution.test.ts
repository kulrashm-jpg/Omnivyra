/**
 * WS-1 (FR-03) — canonical Prospect resolution.
 *
 * The gap this closes: `leadIngestion/**` produced a person, an account and
 * provenance, and no Prospect. So BR-01 could not be satisfied by intake — the
 * canonical record C-2 froze was never created by the PI path.
 *
 * These tests pin the properties that make it safe to run on real intake:
 * no fabricated identity key, idempotency by database constraint rather than by
 * a read-then-write race, tenant isolation on every statement, and no second
 * scoring or journey authority smuggled into the identity layer.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  insertErrors: {} as Record<string, { code: string; message: string } | undefined>,
  /** Rows that only become VISIBLE after the Nth select on that table, so a
   *  genuine lost race can be modelled: invisible on the first read, present by
   *  the time the loser re-resolves. */
  appearAfterSelects: {} as Record<string, { count: number; rows: Row[] } | undefined>,
  selectCounts: {} as Record<string, number>,
  selectErrors: {} as Record<string, { code: string; message: string } | undefined>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row): boolean =>
      st.filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val;
        if (kind === 'is') return (r[col] ?? null) === val;
        return true;
      });

    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });

      if (st.op === 'insert') {
        const err = db.insertErrors[table];
        if (err) return { data: null, error: err };
        const created = { id: `${table}-${db.nextId++}`, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit, error: null };
      }
      const sErr = db.selectErrors[table];
      if (sErr) return { data: null, error: sErr };
      db.selectCounts[table] = (db.selectCounts[table] ?? 0) + 1;
      const late = db.appearAfterSelects[table];
      if (late && db.selectCounts[table] > late.count) {
        for (const r of late.rows) if (!rows().includes(r)) rows().push(r);
      }
      return { data: rows().filter(match), error: null };
    };

    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return api; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return api; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => {
        const d = r.data;
        return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: r.error };
      }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

import {
  resolveProspectShadow,
  resolveOrCreateProspect,
  attachPersonToProspect,
  PROSPECT_RESOLUTION_VERSION,
  WS1_SOURCE,
} from '../../services/prospectIdentity/prospectResolution';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const PERSON = '00000000-0000-4000-8000-0000000000p1';

const q = (table: string, op: string) => db.queries.filter((x) => x.table === table && x.op === op);
const tenantFiltered = (table: string, op: string) =>
  q(table, op).every((x) => x.filters.some(([k, c]) => k === 'eq' && c === 'company_id'));

beforeEach(() => {
  db.tables = {};
  db.insertErrors = {};
  db.selectErrors = {};
  db.queries = [];
  db.nextId = 1;
  db.appearAfterSelects = {};
  db.selectCounts = {};
});

describe('WS-1 — no identity key means no prospect', () => {
  it('refuses to create without an external_lead_key, and says why', async () => {
    const r = await resolveOrCreateProspect(ORG_A, { source: 'csv', email: 'a@b.test' });
    expect(r.outcome).toBe('insufficient_evidence');
    expect(r.prospectId).toBeNull();
    expect(r.reason).toMatch(/synthesised key would mint a new prospect/);
    expect(q('canonical_leads', 'insert')).toHaveLength(0);
    expect(q('canonical_users', 'insert')).toHaveLength(0);
  });

  it('treats a blank key as no key', async () => {
    const r = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: '   ' });
    expect(r.outcome).toBe('insufficient_evidence');
  });

  it('refuses an empty source — the column CHECK would reject it anyway', async () => {
    const r = await resolveOrCreateProspect(ORG_A, { source: '  ', externalLeadKey: 'K1' });
    expect(r.prospectId).toBeNull();
    expect(r.reason).toMatch(/source is required/);
    expect(q('canonical_leads', 'insert')).toHaveLength(0);
  });

  it('requires a tenant', async () => {
    await expect(resolveProspectShadow('', { source: 'csv', externalLeadKey: 'K1' })).rejects.toThrow(/organizationId is required/);
  });
});

describe('WS-1 — creation and idempotency', () => {
  it('creates a prospect and a subject, stamping provenance on both', async () => {
    const r = await resolveOrCreateProspect(ORG_A, {
      source: 'csv', externalLeadKey: 'K1', personId: PERSON, email: 'a@b.test', fullName: 'Ada',
    }, '2026-09-01T00:00:00.000Z');

    expect(r.outcome).toBe('created');
    expect(r.prospectId).toBeTruthy();
    expect(r.subjectId).toBeTruthy();

    const lead = q('canonical_leads', 'insert')[0].payload as Row;
    expect(lead.company_id).toBe(ORG_A);
    expect(lead.external_lead_key).toBe('K1');
    expect(lead.unified_person_id).toBe(PERSON);
    expect(lead.user_id).toBe(r.subjectId);
    expect((lead.lead_metadata as Row).prospectResolutionVersion).toBe(PROSPECT_RESOLUTION_VERSION);
    expect((lead.lead_metadata as Row).createdBy).toBe(WS1_SOURCE);
    expect((lead.lead_metadata as Row).observedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('a replay resolves to the SAME prospect instead of creating a second', async () => {
    const first = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    const again = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(again.outcome).toBe('matched');
    expect(again.prospectId).toBe(first.prospectId);
    expect(q('canonical_leads', 'insert')).toHaveLength(1);
  });

  it('on a concurrent 23505 it RE-RESOLVES rather than retrying blindly', async () => {
    // The winner is NOT visible on the first shadow read — otherwise the match
    // short-circuits and the 23505 branch is never reached, which is exactly
    // what the first version of this test got wrong.
    db.appearAfterSelects.canonical_leads = {
      count: 1, rows: [{ id: 'winner', company_id: ORG_A, external_lead_key: 'K1' }],
    };
    db.insertErrors.canonical_leads = { code: '23505', message: 'duplicate key' };

    const r = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(r.prospectId).toBe('winner');
    expect(r.outcome).toBe('matched');
    expect(r.reason).toMatch(/created concurrently by another worker/);
    // It attempted the insert — proving the race path ran, not the match path.
    expect(q('canonical_leads', 'insert')).toHaveLength(1);
  });

  it('surfaces a non-unique insert failure instead of swallowing it', async () => {
    db.insertErrors.canonical_leads = { code: '23502', message: 'null value violates not-null' };
    await expect(resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' }))
      .rejects.toThrow(/canonical_leads insert failed/);
  });

  it('reuses an existing subject on a 23505 rather than minting a second', async () => {
    db.tables.canonical_users = [{ id: 'subject-1', company_id: ORG_A, external_user_key: 'K1' }];
    db.insertErrors.canonical_users = { code: '23505', message: 'duplicate key' };

    const r = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(r.subjectId).toBe('subject-1');
    expect(r.outcome).toBe('created');
  });
});

describe('WS-1 — the subject records unknown AS unknown', () => {
  it("marks a contactable record 'known' and a bare one 'anonymous'", async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1', email: 'a@b.test' });
    expect((q('canonical_users', 'insert')[0].payload as Row).user_type).toBe('known');

    db.queries = [];
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K2' });
    expect((q('canonical_users', 'insert')[0].payload as Row).user_type).toBe('anonymous');
  });

  it("never fabricates tracking evidence — device is the honest 'unknown' sentinel", async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    const subject = q('canonical_users', 'insert')[0].payload as Row;
    expect(subject.device).toBe('unknown');
    expect(subject.session_id).toBeUndefined();
    expect(subject.geo).toBeUndefined();
  });

  it('does NOT copy canonical person attributes onto the subject — LI-2 owns those', async () => {
    await resolveOrCreateProspect(ORG_A, {
      source: 'csv', externalLeadKey: 'K1', email: 'a@b.test', phone: '+441234567890', fullName: 'Ada',
    });
    const subject = q('canonical_users', 'insert')[0].payload as Row;
    // The values were READ (user_type is 'known') but not STORED: a second copy
    // of a canonical attribute is a second unarbitrated truth.
    expect(subject.user_type).toBe('known');
    expect(subject).not.toHaveProperty('email');
    expect(subject).not.toHaveProperty('phone');
    expect(subject).not.toHaveProperty('full_name');
  });
});

describe('WS-1 — it owns identity only', () => {
  it('writes NO qualification_score — scoring is WS-6', async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(q('canonical_leads', 'insert')[0].payload).not.toHaveProperty('qualification_score');
  });

  it('writes NO lifecycle state of its own — the journey is derived (FR-15)', async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect((q('canonical_leads', 'insert')[0].payload as Row).lead_status).toBeNull();
  });

  it('resolves no person — it consumes an already-resolved id', async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1', personId: PERSON });
    expect(q('unified_persons', 'insert')).toHaveLength(0);
    expect(q('unified_persons', 'select')).toHaveLength(0);
  });

  it('touches no account table', async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(db.queries.filter((x) => x.table === 'prospect_accounts')).toHaveLength(0);
  });
});

describe('WS-1 — tenant isolation', () => {
  it('filters EVERY statement by company_id', async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'K1' });
    expect(tenantFiltered('canonical_leads', 'select')).toBe(true);
    // Inserts carry the tenant in the payload rather than a filter.
    expect((q('canonical_leads', 'insert')[0].payload as Row).company_id).toBe(ORG_A);
    expect((q('canonical_users', 'insert')[0].payload as Row).company_id).toBe(ORG_A);
  });

  it("never resolves another tenant's prospect on the same source key", async () => {
    await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'SHARED' });
    const b = await resolveProspectShadow(ORG_B, { source: 'csv', externalLeadKey: 'SHARED' });
    expect(b.prospectId).toBeNull();
    expect(b.outcome).toBe('insufficient_evidence');
  });

  it('creates a SEPARATE prospect for the same source key in another tenant', async () => {
    const a = await resolveOrCreateProspect(ORG_A, { source: 'csv', externalLeadKey: 'SHARED' });
    const b = await resolveOrCreateProspect(ORG_B, { source: 'csv', externalLeadKey: 'SHARED' });
    expect(a.prospectId).not.toBe(b.prospectId);
    expect(q('canonical_leads', 'insert')).toHaveLength(2);
  });

  it('surfaces an unreadable table instead of treating it as "no prospect"', async () => {
    db.selectErrors.canonical_leads = { code: '08006', message: 'connection failure' };
    await expect(resolveProspectShadow(ORG_A, { source: 'csv', externalLeadKey: 'K1' }))
      .rejects.toThrow(/canonical_leads lookup failed/);
  });
});

describe('WS-1 — attaching a person later', () => {
  it('attaches within the tenant and only when unanchored', async () => {
    db.tables.canonical_leads = [{ id: 'L1', company_id: ORG_A, unified_person_id: null }];
    const r = await attachPersonToProspect(ORG_A, 'L1', PERSON);
    expect(r.attached).toBe(true);
    expect(db.tables.canonical_leads[0].unified_person_id).toBe(PERSON);
  });

  it('refuses to re-anchor a prospect that already has a person', async () => {
    db.tables.canonical_leads = [{ id: 'L1', company_id: ORG_A, unified_person_id: 'someone-else' }];
    const r = await attachPersonToProspect(ORG_A, 'L1', PERSON);
    expect(r.attached).toBe(false);
    expect(db.tables.canonical_leads[0].unified_person_id).toBe('someone-else');
  });

  it('cannot reach a prospect in another tenant', async () => {
    db.tables.canonical_leads = [{ id: 'L1', company_id: ORG_B, unified_person_id: null }];
    const r = await attachPersonToProspect(ORG_A, 'L1', PERSON);
    expect(r.attached).toBe(false);
    expect(db.tables.canonical_leads[0].unified_person_id).toBeNull();
  });

  it('requires all three identifiers', async () => {
    expect((await attachPersonToProspect('', 'L1', PERSON)).attached).toBe(false);
    expect((await attachPersonToProspect(ORG_A, '', PERSON)).attached).toBe(false);
    expect((await attachPersonToProspect(ORG_A, 'L1', '')).attached).toBe(false);
  });
});
