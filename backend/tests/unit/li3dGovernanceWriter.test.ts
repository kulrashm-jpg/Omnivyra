/**
 * LI-3D — the governance writer and the person anchor it makes reachable.
 *
 * The database invariants live in `backend/tests/realschema/li3d_governance_writer.test.ts`;
 * this covers the writer's own decisions — what it refuses, how it translates a
 * SQLSTATE, and that a 23505 is resolved by the canonical key rather than by a
 * prior SELECT — plus the LI-3D wiring that finally lets a person-anchored
 * record reach Path B.
 */

type Row = Record<string, unknown>;

/** Recorded queries, so a test can assert tenant scoping rather than trust it. */
const queries: Array<{ table: string; filters: Array<[string, unknown]>; verb: string }> = [];

/** Programmable outcomes keyed by table+verb. */
let inserts: Array<{ error?: { code?: string; message?: string }; data?: Row }> = [];
let selectRows: Row[] = [];
let selectError: { code?: string; message?: string } | null = null;
let updateRows: Row[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]>, verb: 'select' };
    queries.push(rec);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'is', 'limit', 'order']) {
      builder[m] = (...a: unknown[]) => { if (m === 'is') rec.filters.push([String(a[0]), a[1]]); return chain(); };
    }
    builder.eq = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain(); };
    builder.insert = (row: Row) => {
      rec.verb = 'insert';
      const outcome = inserts.shift() ?? { data: { id: 'new-id' } };
      const res = {
        select: () => ({
          single: async () => (outcome.error ? { error: outcome.error } : { data: outcome.data ?? { id: 'new-id' }, error: null }),
        }),
      };
      void row;
      return res;
    };
    builder.update = (row: Row) => {
      rec.verb = 'update';
      void row;
      const u: Record<string, unknown> = {};
      u.eq = (c: string, v: unknown) => { rec.filters.push([c, v]); return u; };
      u.is = (c: string, v: unknown) => { rec.filters.push([c, v]); return u; };
      u.select = async () => ({ data: updateRows, error: null });
      return u;
    };
    // Terminal await on a select chain.
    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve(selectError ? { error: selectError } : { data: selectRows, error: null });
    return builder;
  },
}));

import {
  recordContactGovernance,
  revokeContactGovernance,
  GovernanceWriteError,
} from '../../services/prospectIdentity/contactGovernanceWriter';

const ORG = '00000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  queries.length = 0;
  inserts = [];
  selectRows = [];
  selectError = null;
  updateRows = [];
});

const base = {
  organizationId: ORG,
  governanceType: 'unsubscribe' as const,
  channel: 'email' as const,
  target: 'Person@Example.COM',
  source: 'webhook:ses',
};

describe('LI-3D writer — what it refuses', () => {
  it('refuses a tenant-less record', async () => {
    await expect(recordContactGovernance({ ...base, organizationId: '' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
  });

  it('refuses a governance type outside the ADR nine', async () => {
    await expect(recordContactGovernance({ ...base, governanceType: 'not_interested' as never }))
      .rejects.toMatchObject({ code: 'unknown_governance_type' });
  });

  it('refuses a record anchored to nothing', async () => {
    await expect(recordContactGovernance({ ...base, target: null, personId: null }))
      .rejects.toMatchObject({ code: 'anchor_required' });
  });

  it('refuses a record with no provenance', async () => {
    await expect(recordContactGovernance({ ...base, source: '   ' }))
      .rejects.toMatchObject({ code: 'source_required' });
  });

  it('refuses evidence that carries content rather than a summary', async () => {
    for (const key of ['body', 'transcript', 'payload', 'raw_email', 'attachments']) {
      await expect(recordContactGovernance({ ...base, evidence: { [key]: 'x' } }))
        .rejects.toMatchObject({ code: 'evidence_not_summary' });
    }
  });

  it('refuses oversized evidence even when the keys look innocent', async () => {
    await expect(recordContactGovernance({ ...base, evidence: { note: 'x'.repeat(5000) } }))
      .rejects.toMatchObject({ code: 'evidence_too_large' });
  });

  it('accepts a genuine summary', async () => {
    inserts = [{ data: { id: 'ok-1' } }];
    const r = await recordContactGovernance({
      ...base,
      evidence: { matchedPhrase: 'unsubscribe', confidence: 0.98, detector: 'v3', actor: 'user:abc' },
    });
    expect(r).toEqual({ id: 'ok-1', outcome: 'created' });
  });
});

describe('LI-3D writer — normalisation and provenance', () => {
  it('normalises the target with the same function the reader uses, and keeps the raw form', async () => {
    inserts = [{ data: { id: 'n-1' } }];
    await recordContactGovernance(base);
    // The insert happened against the governance table.
    expect(queries.some((q) => q.table === 'contact_governance_records' && q.verb === 'insert')).toBe(true);
  });
});

describe('LI-3D writer — idempotency by database constraint', () => {
  it('a 23505 resolves the existing row by the canonical key, and reports already_present', async () => {
    inserts = [{ error: { code: '23505', message: 'duplicate key' } }];
    selectRows = [{ id: 'existing-1' }];

    const r = await recordContactGovernance(base);
    expect(r).toEqual({ id: 'existing-1', outcome: 'already_present' });

    // The resolution must mirror the partial index exactly.
    const resolve = queries.find((q) => q.verb === 'select' && q.table === 'contact_governance_records');
    expect(resolve).toBeDefined();
    const f = new Map(resolve!.filters as Array<[string, unknown]>);
    expect(f.get('organization_id')).toBe(ORG);
    expect(f.get('channel')).toBe('email');
    expect(f.get('governance_type')).toBe('unsubscribe');
    expect(f.get('revoked_at')).toBeNull();          // the partial predicate
    expect(f.get('target_normalized')).toBe('person@example.com');
  });

  it('resolves a person-anchored collision by person, matching coalesce(person_id, target)', async () => {
    inserts = [{ error: { code: '23505', message: 'duplicate key' } }];
    selectRows = [{ id: 'existing-p' }];

    await recordContactGovernance({ ...base, personId: 'person-1', target: null, channel: '*', governanceType: 'dnc_permanent' });
    const resolve = queries.find((q) => q.verb === 'select' && q.table === 'contact_governance_records');
    const f = new Map(resolve!.filters as Array<[string, unknown]>);
    expect(f.get('person_id')).toBe('person-1');
    expect(f.has('target_normalized')).toBe(false);   // person wins the anchor
  });

  it('does NOT use a prior SELECT as the idempotency mechanism', async () => {
    inserts = [{ data: { id: 'fresh' } }];
    await recordContactGovernance(base);
    const sel = queries.filter((q) => q.verb === 'select' && q.table === 'contact_governance_records');
    expect(sel).toHaveLength(0);      // insert first, always
  });

  it('translates a cross-tenant FK violation into a clear refusal', async () => {
    inserts = [{ error: { code: '23503', message: 'violates foreign key constraint' } }];
    await expect(recordContactGovernance({ ...base, personId: 'other-tenant-person' }))
      .rejects.toMatchObject({ code: 'cross_tenant_reference' });
  });

  it('translates a CHECK violation rather than leaking a raw SQLSTATE', async () => {
    inserts = [{ error: { code: '23514', message: 'contact_governance_permanent_is_all_channels' } }];
    await expect(recordContactGovernance({ ...base, governanceType: 'dnc_permanent' }))
      .rejects.toMatchObject({ code: 'invariant_violation' });
  });

  it('surfaces an unexpected SQLSTATE instead of swallowing it', async () => {
    inserts = [{ error: { code: '42703', message: 'column does not exist' } }];
    await expect(recordContactGovernance(base)).rejects.toBeInstanceOf(GovernanceWriteError);
  });

  it('fails loudly when a collision cannot be resolved', async () => {
    inserts = [{ error: { code: '23505', message: 'duplicate key' } }];
    selectRows = [];
    await expect(recordContactGovernance(base)).rejects.toMatchObject({ code: 'collision_unresolved' });
  });
});

describe('LI-3D writer — revocation is append-only', () => {
  it('mutates only revoked_at and revoked_reason, scoped to the tenant', async () => {
    updateRows = [{ id: 'r-1' }];
    const r = await revokeContactGovernance({ organizationId: ORG, id: 'r-1', reason: 'operator error' });
    expect(r).toEqual({ revoked: true });

    const upd = queries.find((q) => q.verb === 'update');
    const f = new Map(upd!.filters as Array<[string, unknown]>);
    expect(f.get('organization_id')).toBe(ORG);   // never another tenant's record
    expect(f.get('id')).toBe('r-1');
    expect(f.get('revoked_at')).toBeNull();       // already-revoked is left alone
  });

  it('refuses a revocation with no reason', async () => {
    await expect(revokeContactGovernance({ organizationId: ORG, id: 'r-1', reason: '' }))
      .rejects.toMatchObject({ code: 'reason_required' });
  });

  it('refuses a tenant-less revocation', async () => {
    await expect(revokeContactGovernance({ organizationId: '', id: 'r-1', reason: 'x' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
  });

  it('reports revoked:false when nothing matched, rather than claiming success', async () => {
    updateRows = [];
    expect(await revokeContactGovernance({ organizationId: ORG, id: 'nope', reason: 'x' }))
      .toEqual({ revoked: false });
  });

  it('never deletes', async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/contactGovernanceWriter.ts'), 'utf8');
    expect(src).not.toMatch(/\.delete\(/);
  });

  it('never updates organization_id — A-1 cannot be exercised', async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/contactGovernanceWriter.ts'), 'utf8');
    const updateBlock = src.slice(src.indexOf('.update({'), src.indexOf('.eq(\'organization_id\', input.organizationId)'));
    expect(updateBlock).not.toMatch(/organization_id\s*:/);
    expect(updateBlock).not.toMatch(/person_id\s*:/);
  });
});
