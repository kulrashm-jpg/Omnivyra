/**
 * R3: the pre-import duplicate probe and the review list. BLOCK or PARK, NEVER MERGE.
 *
 * PI review criteria pinned here: email rule stated (F3); E.164-only phones and
 * empty-never-equals-empty (12); a null/204 answer is unknown, never "no
 * duplicate" (13); NEGATIVE CONTROLS for distinct people who merely co-occur (14);
 * role/shared contact points PARK, never block (10); idempotency (15); no path
 * to a merge (9, by source scan); probe_unknown visible per record (F4).
 */

import * as fs from 'fs';
import * as path from 'path';
import { e164, isRoleAddress, probeRecord, type Lookup, type ProbePorts } from '../../services/prospectImportReview/probe';
import { toLookup } from '../../services/prospectImportReview/repository';
import type { NormalizedIngestionRecord } from '../../services/leadIngestion/contracts';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const rec = (person: Record<string, unknown>, source = 'apollo'): NormalizedIngestionRecord => ({
  organizationId: ORG, source, entityType: 'person', externalId: String(person.id ?? 'x'),
  person: {
    externalKeys: person.id ? { [source]: { external_id: person.id } } : null,
    ...person,
  } as NormalizedIngestionRecord['person'],
});

type Db = { byKey?: Lookup; byEmail?: Lookup; byPhone?: Lookup; byName?: Lookup };
const none: Lookup = { ok: true, persons: [] };
function ports(db: Db = {}) {
  const calls: string[] = [];
  const p: ProbePorts = {
    async byExternalKey(_o, s, id) { calls.push(`key:${s}:${id}`); return db.byKey ?? none; },
    async byEmail(_o, e) { calls.push(`email:${e}`); return db.byEmail ?? none; },
    async byPhone(_o, ph) { calls.push(`phone:${ph}`); return db.byPhone ?? none; },
    async byNameToken(_o, t) { calls.push(`name:${t}`); return db.byName ?? none; },
  };
  return { p, calls };
}
const persons = (...rows: Array<[string, string | null]>): Lookup => ({ ok: true, persons: rows.map(([id, fullName]) => ({ id, fullName })) });

describe('verdicts', () => {
  it('a known provider id is already_imported (skip)', async () => {
    const { p } = ports({ byKey: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'ap-1', fullName: 'Jane Doe' }), p))
      .toEqual({ kind: 'skip', reason: 'already_imported', matchedPersonId: 'p1' });
  });

  it('a personal email match is a duplicate: BLOCKED (skip), never merged', async () => {
    const { p, calls } = ports({ byEmail: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'ap-1', email: ' John.Smith@X.com ', fullName: 'John Smith' }), p))
      .toEqual({ kind: 'skip', reason: 'email_match', matchedPersonId: 'p1' });
    // F3, stated: the WHOLE address is case-folded (W1's normalizeEmail); no dot/plus stripping.
    expect(calls).toContain('email:john.smith@x.com');
  });

  it('a role address match PARKS (role_contact), it never blocks', async () => {
    const { p } = ports({ byEmail: persons(['p1', 'Info Desk'], ['p2', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'ap-1', email: 'info@acme.com', fullName: 'John Smith' }), p))
      .toEqual({ kind: 'hold', reason: 'role_contact', matchedPersonIds: ['p1', 'p2'] });
    expect(isRoleAddress('sales@acme.com')).toBe(true);
    expect(isRoleAddress('customer.service@acme.com')).toBe(true);
    expect(isRoleAddress('jane.doe@acme.com')).toBe(false);
  });

  it('an E.164 phone match with agreeing names BLOCKS; with different names it PARKS (shared_phone)', async () => {
    const same = ports({ byPhone: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'a', phone: '+44 20 7946 0000', fullName: 'Jane Doe' }), same.p))
      .toEqual({ kind: 'skip', reason: 'phone_match', matchedPersonId: 'p1' });
    const diff = ports({ byPhone: persons(['p1', 'Reception Desk']) });
    expect(await probeRecord(rec({ id: 'a', phone: '+44 20 7946 0000', fullName: 'Jane Doe' }), diff.p))
      .toEqual({ kind: 'hold', reason: 'shared_phone', matchedPersonIds: ['p1'] });
  });

  it('a non-E.164 phone is NOT compared at all', async () => {
    const { p, calls } = ports({ byPhone: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'a', phone: '020 7946 0000', fullName: 'Nobody Here' }), p)).toEqual({ kind: 'import' });
    expect(calls.some((c) => c.startsWith('phone:'))).toBe(false);
    expect(e164('020 7946 0000')).toBeNull();
    expect(e164('+44 (20) 7946-0000')).toBe('+442079460000');
    expect(e164('+12')).toBeNull();
  });

  it('a first + last name match PARKS (name_match), with every agreeing person', async () => {
    const { p, calls } = ports({ byName: persons(['p1', 'Jane Doe'], ['p2', 'Jane Q. Doe'], ['p3', 'John Doe']) });
    expect(await probeRecord(rec({ id: 'a', firstName: 'Jane', lastName: 'Doe' }), p))
      .toEqual({ kind: 'hold', reason: 'name_match', matchedPersonIds: ['p1', 'p2'] });
    expect(calls).toContain('name:doe');
  });

  it('no evidence of anyone: import', async () => {
    const { p } = ports();
    expect(await probeRecord(rec({ id: 'a', fullName: 'Jane Doe', email: 'jane@new.com' }), p)).toEqual({ kind: 'import' });
  });
});

describe('NEGATIVE CONTROLS: distinct people who merely co-occur are not duplicates', () => {
  it('same company domain, different personal address: not a duplicate', async () => {
    // The email port answers by EXACT address; a colleague at the same domain is not returned.
    const { p, calls } = ports({ byEmail: none, byName: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'a', email: 'john.smith@acme.com', fullName: 'John Smith' }), p)).toEqual({ kind: 'import' });
    expect(calls).toContain('email:john.smith@acme.com');
  });

  it('adjacent names (same last name, different first) do not match', async () => {
    const { p } = ports({ byName: persons(['p1', 'John Doe'], ['p2', 'Jane Doer']) });
    expect(await probeRecord(rec({ id: 'a', fullName: 'Jane Doe' }), p)).toEqual({ kind: 'import' });
  });

  it('a shared switchboard number does not block two different people', async () => {
    const { p } = ports({ byPhone: persons(['p1', 'John Smith']) });
    const v = await probeRecord(rec({ id: 'a', phone: '+442079460000', fullName: 'Jane Doe' }), p);
    expect(v.kind).toBe('hold'); // parked for a human, never skipped
  });

  it('an obfuscated surname cannot produce a name match (free-tier Apollo)', async () => {
    const { p, calls } = ports({ byName: persons(['p1', 'Jane Doe']) });
    expect(await probeRecord(rec({ id: 'a', firstName: 'Jane', lastName: 'D.' }), p)).toEqual({ kind: 'import' });
    expect(calls).toContain('name:d');
  });
});

describe('empty never equals empty; a non-answer is unknown', () => {
  it('blank email, phone and name are never looked up', async () => {
    const { p, calls } = ports();
    expect(await probeRecord(rec({ email: '  ', phone: '', fullName: ' ' }), p)).toEqual({ kind: 'import' });
    expect(calls).toEqual([]);
  });

  it.each([
    ['external_key', { byKey: { ok: false } as Lookup }, { id: 'a' }],
    ['email', { byEmail: { ok: false } as Lookup }, { email: 'a@b.com' }],
    ['phone', { byPhone: { ok: false } as Lookup }, { phone: '+442079460000' }],
    ['name', { byName: { ok: false } as Lookup }, { fullName: 'Jane Doe' }],
  ] as Array<[string, Db, Record<string, unknown>]>)('an unanswerable %s probe is probe_unknown, not import', async (failed, db, person) => {
    const { p } = ports(db);
    expect(await probeRecord(rec(person), p)).toEqual({ kind: 'probe_unknown', failed });
  });

  it('toLookup: a null error with a 204 (or no array) is NOT an answer', () => {
    expect(toLookup({ data: null, error: null, status: 204 })).toEqual({ ok: false });
    expect(toLookup({ data: [], error: null, status: 204 })).toEqual({ ok: false });
    expect(toLookup({ data: undefined, error: null, status: 200 })).toEqual({ ok: false });
    expect(toLookup({ data: [], error: { message: 'x' }, status: 200 })).toEqual({ ok: false });
    expect(toLookup({ data: [], error: null, status: 200 })).toEqual({ ok: true, persons: [] });
    expect(toLookup({ data: [{ id: 'p1', full_name: 'Jane' }], error: null, status: 206 }))
      .toEqual({ ok: true, persons: [{ id: 'p1', fullName: 'Jane' }] });
  });
});

describe('idempotency and no merge path', () => {
  it('the same record probed twice gets the same verdict', async () => {
    const { p } = ports({ byName: persons(['p1', 'Jane Doe']) });
    const r = rec({ id: 'a', fullName: 'Jane Doe' });
    expect(await probeRecord(r, p)).toEqual(await probeRecord(r, p));
  });

  it('the probe and review modules cannot reach a merge or identity write (source scan, code only)', () => {
    const dir = path.join(__dirname, '../../services/prospectImportReview');
    for (const f of ['probe.ts', 'repository.ts']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['resolveUnifiedPerson', 'attachPerson', 'mergePersons', 'identity_claims',
        'persistClaims', "ownedDbTable('unified_persons').update", "ownedDbTable('unified_persons').insert",
        "ownedDbTable('unified_persons').delete", 'person_duplicate_candidates']) {
        expect(`${f}: ${src.includes(forbidden) ? forbidden : ''}`).toBe(`${f}: `);
      }
    }
  });
});
