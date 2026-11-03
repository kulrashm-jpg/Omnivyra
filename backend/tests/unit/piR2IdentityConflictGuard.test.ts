/**
 * PI-FIX (round 2) — the opt-in identity conflict guard on `resolveUnifiedPerson`.
 *
 * Agent G's C3: a CSV row reusing reference `1` with a DIFFERENT email matched
 * the first person through `external_keys`, its email was dropped (fill-only-
 * when-null) and its name became a live claim on the wrong person. C1/C2: a
 * second, differently-named human on `info@` folded into the first.
 *
 * The guard refuses those matches BEFORE any write. It is opt-in, so every
 * caller that does not pass `conflictGuard` (CRM, lead intelligence, provider
 * adapters) keeps exactly the behaviour it had — pinned below too.
 */

type Row = Record<string, unknown>;

const people: Row[] = [];
let seq = 0;
const inserts: Row[] = [];
const updates: Array<{ payload: Row; filters: Array<[string, unknown]> }> = [];
let nextInsertError: { code?: string; message?: string; details?: string } | null = null;
let appearsAfterConflict: Row[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;
    const matches = (r: Row) =>
      filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      contains.every(([k, v]) => {
        const have = (r[k] ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>)
          .every(([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
      });
    const visible = () => (table === 'unified_persons' ? people : []);

    b.select = () => c();
    b.order = () => c();
    b.limit = () => c();
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.in = () => c();
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    b.maybeSingle = async () => ({ data: visible().filter(matches)[0] ?? null, error: null });
    (b as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: visible().filter(matches), error: null });

    b.insert = (row: Row) => {
      inserts.push(row);
      const done = async () => {
        if (nextInsertError) {
          const err = nextInsertError;
          nextInsertError = null;
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

    b.update = (payload: Row) => {
      const rec = { payload, filters: [] as Array<[string, unknown]> };
      updates.push(rec);
      const u: Record<string, unknown> = {};
      u.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return u; };
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

import {
  IdentityConflictError,
  isRoleLikeEmail,
  resolveUnifiedPerson,
} from '../../services/identityResolutionService';

const ORG = 'org-r2';

const alice = (over: Row = {}): Row => ({
  id: 'alice', company_id: ORG, primary_email: 'alice@one.test', primary_phone: null,
  external_keys: { csv: { external_id: '1' } }, full_name: 'Alice Able', ...over,
});

const personUpdates = () => updates.filter((u) => u.filters.some(([k, v]) => k === 'id' && v === 'alice'));

beforeEach(() => {
  people.length = 0;
  inserts.length = 0;
  updates.length = 0;
  seq = 0;
  nextInsertError = null;
  appearsAfterConflict = [];
  jest.clearAllMocks();
});

describe('without conflictGuard — every existing caller is unchanged', () => {
  it('an external-key match with a different email still attaches and drops the email (pre-existing behaviour)', async () => {
    people.push(alice());
    const r = await resolveUnifiedPerson({
      companyId: ORG, email: 'bob@two.test', externalKeys: { csv: { external_id: '1' } },
    });
    expect(r).toEqual({ unifiedPersonId: 'alice', matchedBy: 'external_keys', created: false });
    expect(personUpdates().every((u) => !('primary_email' in u.payload))).toBe(true);
  });

  it('a role mailbox with a different name still attaches', async () => {
    people.push(alice({ primary_email: 'info@acme.test' }));
    const r = await resolveUnifiedPerson({ companyId: ORG, email: 'info@acme.test' });
    expect(r.unifiedPersonId).toBe('alice');
  });
});

describe('with conflictGuard — C3: an operator reference cannot override a contradicting contact point', () => {
  it('REFUSES an external-key match whose email differs, and writes nothing', async () => {
    people.push(alice());
    const err = await resolveUnifiedPerson({
      companyId: ORG, email: 'bob@two.test', externalKeys: { csv: { external_id: '1' } },
      conflictGuard: { fullName: 'Bob Baker' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityConflictError);
    expect(err).toMatchObject({ reason: 'external_key_contact_mismatch', conflictingPersonId: 'alice', matchedBy: 'external_keys' });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    // ids and the reason only — the conflicting email/name never reach the message
    expect(String(err.message)).not.toMatch(/bob|alice@|Baker/i);
  });

  it('REFUSES an external-key match whose phone differs', async () => {
    people.push(alice({ primary_email: null, primary_phone: '+14155550100' }));
    await expect(resolveUnifiedPerson({
      companyId: ORG, phone: '+14155550199', externalKeys: { csv: { external_id: '1' } }, conflictGuard: {},
    })).rejects.toMatchObject({ reason: 'external_key_contact_mismatch' });
  });

  it('attaches when the row carries no contact point (absence is not a contradiction)', async () => {
    people.push(alice());
    const r = await resolveUnifiedPerson({
      companyId: ORG, externalKeys: { csv: { external_id: '1' } }, conflictGuard: { fullName: 'Someone Else' },
    });
    expect(r.unifiedPersonId).toBe('alice');
  });

  it('attaches and FILLS when the matched person has no email yet', async () => {
    people.push(alice({ primary_email: null }));
    const r = await resolveUnifiedPerson({
      companyId: ORG, email: 'alice@one.test', externalKeys: { csv: { external_id: '1' } }, conflictGuard: {},
    });
    expect(r.unifiedPersonId).toBe('alice');
    expect(personUpdates().some((u) => u.payload.primary_email === 'alice@one.test')).toBe(true);
  });

  it('an EMAIL match is never an external-key conflict (email still wins first)', async () => {
    people.push(alice());
    const r = await resolveUnifiedPerson({
      companyId: ORG, email: 'alice@one.test', externalKeys: { csv: { external_id: '9' } }, conflictGuard: {},
    });
    expect(r).toMatchObject({ unifiedPersonId: 'alice', matchedBy: 'email' });
  });

  it('the race-recovery path applies the same guard', async () => {
    nextInsertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_unified_persons_company_email_unique"',
    };
    appearsAfterConflict = [alice({ primary_email: 'info@acme.test' })];
    await expect(resolveUnifiedPerson({
      companyId: ORG, email: 'info@acme.test', conflictGuard: { fullName: 'Bob Baker' },
    })).rejects.toMatchObject({ reason: 'role_address_name_mismatch', conflictingPersonId: 'alice' });
    expect(updates).toHaveLength(0);
  });
});

describe('with conflictGuard — C1/C2: a shared role mailbox does not fold a second named person in', () => {
  it('REFUSES info@ arriving with a different name', async () => {
    people.push(alice({ primary_email: 'info@acme.test', external_keys: {} }));
    await expect(resolveUnifiedPerson({
      companyId: ORG, email: 'INFO@acme.test', conflictGuard: { fullName: 'Bob Baker' },
    })).rejects.toMatchObject({ reason: 'role_address_name_mismatch', matchedBy: 'email' });
    expect(updates).toHaveLength(0);
  });

  it('accepts the same name modulo case and spacing', async () => {
    people.push(alice({ primary_email: 'info@acme.test', external_keys: {} }));
    const r = await resolveUnifiedPerson({
      companyId: ORG, email: 'info@acme.test', conflictGuard: { fullName: '  alice   ABLE ' },
    });
    expect(r.unifiedPersonId).toBe('alice');
  });

  it('accepts when either side has no name', async () => {
    people.push(alice({ primary_email: 'sales@acme.test', full_name: null, external_keys: {} }));
    expect((await resolveUnifiedPerson({
      companyId: ORG, email: 'sales@acme.test', conflictGuard: { fullName: 'Bob Baker' },
    })).unifiedPersonId).toBe('alice');
    expect((await resolveUnifiedPerson({
      companyId: ORG, email: 'sales@acme.test', conflictGuard: { fullName: null },
    })).unifiedPersonId).toBe('alice');
  });

  it('a PERSONAL address with a different name is not refused (name changes are not a policy this guard decides)', async () => {
    people.push(alice({ external_keys: {} }));
    const r = await resolveUnifiedPerson({
      companyId: ORG, email: 'alice@one.test', conflictGuard: { fullName: 'Alice Able-Baker' },
    });
    expect(r.unifiedPersonId).toBe('alice');
  });
});

describe('isRoleLikeEmail — detection only', () => {
  it.each([
    ['info@acme.test', true], ['Sales@Acme.test', true], ['support+eu@acme.test', true],
    ['no-reply@acme.test', true], ['alice@acme.test', false], ['information@acme.test', false],
    ['', false], [null, false], ['not-an-email', false],
  ])('%s -> %s', (email, expected) => {
    expect(isRoleLikeEmail(email as string | null)).toBe(expected);
  });
});
