/**
 * P1-1 — `resolveUnifiedPerson` self-heals when it loses a create race.
 *
 * LI-4E found that two concurrent callers creating the same brand-new person
 * left one of them with a raw `23505`. The unique index had already done the
 * important job — exactly one person existed, never two — but the loser got an
 * error instead of the winner.
 *
 * These tests cover the recovery AND, just as importantly, everything that must
 * NOT recover: `unified_persons` has four unique arbiters, and only two of them
 * describe a person's identity.
 */

type Row = Record<string, unknown>;

const people: Row[] = [];
let seq = 0;
const inserts: Row[] = [];
/** Injected outcome for the next insert; `null` means "let it succeed". */
let nextInsertError: { code?: string; message?: string; details?: string } | null = null;
/** Rows that appear only AFTER the insert fails — the racing winner. */
let appearsAfterConflict: Row[] = [];
let selectError: { message?: string } | null = null;
const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]> };
    queries.push(rec);
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;

    const matches = (r: Row) =>
      rec.filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      contains.every(([k, v]) => {
        const have = (r[k] ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>)
          .every(([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
      });

    b.select = () => c();
    b.order = () => c();
    b.limit = () => c();
    b.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    b.maybeSingle = async () => {
      if (selectError) return { data: null, error: selectError };
      return { data: people.filter(matches)[0] ?? null, error: null };
    };

    b.insert = (row: Row) => {
      inserts.push(row);
      const done = async () => {
        if (nextInsertError) {
          const err = nextInsertError;
          nextInsertError = null;
          // The racing winner becomes visible exactly when the conflict is raised.
          people.push(...appearsAfterConflict);
          appearsAfterConflict = [];
          return { data: null, error: err };
        }
        const created: Row = { id: `person-${++seq}`, external_keys: {}, ...row };
        people.push(created);
        return { data: { id: created.id }, error: null };
      };
      return { select: () => ({ single: done, maybeSingle: done }), single: done };
    };

    b.update = () => {
      const u: Record<string, unknown> = {};
      u.eq = () => u;
      u.select = async () => ({ data: [], error: null });
      (u as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: [], error: null });
      return u;
    };
    return b;
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}), { virtual: true });

import { resolveUnifiedPerson } from '../../services/identityResolutionService';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const winner = (over: Row = {}): Row => ({
  id: 'winner-1', company_id: ORG_A, primary_email: 'race@example.test',
  primary_phone: null, external_keys: {}, ...over,
});

const conflict = (index: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${index}"`,
  details: 'Key (company_id, primary_email)=(...) already exists.',
});

beforeEach(() => {
  people.length = 0;
  inserts.length = 0;
  queries.length = 0;
  seq = 0;
  nextInsertError = null;
  appearsAfterConflict = [];
  selectError = null;
  jest.clearAllMocks();
});

describe('P1-1 — the race is now self-healing', () => {
  it('an EMAIL conflict re-resolves and returns the winner', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [winner()];

    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' });
    expect(r).toEqual({ unifiedPersonId: 'winner-1', matchedBy: 'email', created: false });
    expect(people).toHaveLength(1);                 // exactly one person, never two
  });

  it('a PHONE conflict re-resolves and returns the winner', async () => {
    nextInsertError = conflict('idx_unified_persons_company_phone_unique');
    appearsAfterConflict = [winner({ primary_email: null, primary_phone: '+15550100000' })];

    const r = await resolveUnifiedPerson({ companyId: ORG_A, phone: '+15550100000' });
    expect(r).toEqual({ unifiedPersonId: 'winner-1', matchedBy: 'phone', created: false });
    expect(people).toHaveLength(1);
  });

  it('the INSERT is attempted exactly once — it is never retried', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [winner()];

    await resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' });
    expect(inserts).toHaveLength(1);
  });

  it('the loser reports created:false, so a caller cannot mistake it for a new person', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [winner()];

    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' });
    expect(r.created).toBe(false);
  });

  it('recovery re-runs the SAME deterministic order — email before phone', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [
      winner({ id: 'by-phone', primary_email: null, primary_phone: '+15550100000' }),
      winner({ id: 'by-email' }),
    ];

    const r = await resolveUnifiedPerson({
      companyId: ORG_A, email: 'race@example.test', phone: '+15550100000',
    });
    expect(r.unifiedPersonId).toBe('by-email');     // email wins, as it always does
    expect(r.matchedBy).toBe('email');
  });

  it('a pre-existing person is still matched without any insert at all', async () => {
    people.push(winner());
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' });
    expect(r).toEqual({ unifiedPersonId: 'winner-1', matchedBy: 'email', created: false });
    expect(inserts).toHaveLength(0);
  });

  it('an uncontested create still reports created:true', async () => {
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'fresh@example.test' });
    expect(r.created).toBe(true);
    expect(r.matchedBy).toBe('created');
  });
});

describe('P1-1 — only an IDENTITY conflict may recover', () => {
  it('a PRIMARY KEY collision stays a failure — a uuid collision is not a lost race', async () => {
    nextInsertError = conflict('unified_persons_pkey');
    appearsAfterConflict = [winner()];

    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/Failed to create unified person/);
  });

  it('the (id, company_id) uniqueness index also stays a failure', async () => {
    nextInsertError = conflict('uq_unified_persons_id_company');
    appearsAfterConflict = [winner()];

    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/Failed to create unified person/);
  });

  it('an unrelated table\'s unique violation stays a failure', async () => {
    nextInsertError = conflict('uq_identity_claims_tenant_identity');
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/Failed to create unified person/);
  });

  it('a bare 23505 with no recognisable index stays a failure', async () => {
    nextInsertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/Failed to create unified person/);
  });

  it('a FOREIGN KEY violation stays a failure', async () => {
    nextInsertError = { code: '23503', message: 'violates foreign key constraint' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/violates foreign key constraint/);
  });

  it('a CHECK violation stays a failure', async () => {
    nextInsertError = { code: '23514', message: 'violates check constraint "unified_persons_email_not_blank"' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/violates check constraint/);
  });

  it('a connection failure stays a failure', async () => {
    nextInsertError = { code: '08006', message: 'connection failure' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/connection failure/);
  });

  it('an authorization failure stays a failure', async () => {
    nextInsertError = { code: '42501', message: 'permission denied for table unified_persons' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/permission denied/);
  });

  it('an identity conflict whose winner is invisible fails loudly rather than looping', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [];                      // nothing to find

    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/identity conflict reported but no matching person is visible/);
  });

  it('a read failure during recovery is reported, not swallowed', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    selectError = { message: 'connection reset' };
    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/Failed to resolve unified person by email/);
  });

  it('malformed input is still refused before any insert', async () => {
    await expect(resolveUnifiedPerson({ companyId: '  ', email: 'a@x.test' }))
      .rejects.toThrow(/companyId is required/);
    expect(inserts).toHaveLength(0);
  });
});

describe('P1-1 — tenant safety of the recovery path', () => {
  it('recovery re-resolves within the ORIGINAL tenant', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    appearsAfterConflict = [winner()];

    await resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' });

    // Every person lookup after the conflict named tenant A.
    const lookups = queries.filter((q) => q.table === 'unified_persons' && q.filters.length);
    for (const q of lookups) {
      expect(q.filters[0][0]).toBe('company_id');
      expect(q.filters[0][1]).toBe(ORG_A);
    }
  });

  it('a conflict in Tenant A never resolves onto Tenant B\'s person', async () => {
    nextInsertError = conflict('idx_unified_persons_company_email_unique');
    // Same email, but the only visible row belongs to another tenant.
    appearsAfterConflict = [winner({ id: 'tenant-b-person', company_id: ORG_B })];

    await expect(resolveUnifiedPerson({ companyId: ORG_A, email: 'race@example.test' }))
      .rejects.toThrow(/no matching person is visible/);
  });

  it('the same identity in two tenants stays two independent persons', async () => {
    const a = await resolveUnifiedPerson({ companyId: ORG_A, email: 'shared@example.test' });
    const b = await resolveUnifiedPerson({ companyId: ORG_B, email: 'shared@example.test' });

    expect(a.unifiedPersonId).not.toBe(b.unifiedPersonId);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(people).toHaveLength(2);
  });
});

describe('P1-1 — idempotency', () => {
  it('the same identity sequentially yields the same person', async () => {
    const a = await resolveUnifiedPerson({ companyId: ORG_A, email: 'same@example.test' });
    const b = await resolveUnifiedPerson({ companyId: ORG_A, email: 'same@example.test' });
    expect(a.unifiedPersonId).toBe(b.unifiedPersonId);
    expect(b.created).toBe(false);
    expect(people).toHaveLength(1);
  });

  it('the same external reference sequentially yields the same person', async () => {
    const keys = { manual: { external_id: 'OP-1' } };
    const a = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: keys });
    const b = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: keys });
    expect(a.unifiedPersonId).toBe(b.unifiedPersonId);
    expect(b.matchedBy).toBe('external_keys');
    expect(people).toHaveLength(1);
  });

  it('the matching ORDER is unchanged — email still beats phone and external keys', async () => {
    people.push(winner({ id: 'by-email' }));
    people.push(winner({ id: 'by-phone', primary_email: null, primary_phone: '+15550100000' }));

    const r = await resolveUnifiedPerson({
      companyId: ORG_A, email: 'race@example.test', phone: '+15550100000',
      externalKeys: { manual: { external_id: 'X' } },
    });
    expect(r.matchedBy).toBe('email');
    expect(r.unifiedPersonId).toBe('by-email');
  });
});

describe('P1-1 — the fix introduced nothing it was told not to', () => {
  it('no sleep, no blind retry loop, and no SELECT-before-INSERT', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/identityResolutionService.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Scope to the RECOVERY path: the file legitimately loops elsewhere
    // (cleanExternalKeys iterates its input), and a whole-file scan would read
    // that pre-existing loop as a retry loop.
    const recovery = code.slice(code.indexOf('isIdentityUniquenessConflict(error)'));
    expect(recovery).not.toMatch(/setTimeout|sleep|delay\(/);
    expect(recovery).not.toMatch(/for\s*\(|while\s*\(/);      // no retry loop
    expect(recovery).not.toMatch(/maxAttempts|attempts\s*\+\+/);
    expect(recovery).not.toMatch(/\.insert\(/);               // the INSERT is never re-attempted
  });

  it('catches the identity indexes by name rather than any 23505', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/identityResolutionService.ts'), 'utf8');
    expect(src).toContain('idx_unified_persons_company_email_unique');
    expect(src).toContain('idx_unified_persons_company_phone_unique');
  });
});
