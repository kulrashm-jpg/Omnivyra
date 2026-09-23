/**
 * PI/WS-F — erasing a person without losing a suppression.
 *
 * Two latent defects sit on one code path: deleting a `unified_persons` row.
 * `contact_governance_person_tenant_fk` is `ON DELETE SET NULL (person_id)`
 * (D-3), and a referential action is an UPDATE that the table's CHECKs and its
 * partial unique index both see.
 *
 *   DEFECT-008  a PERSON-ONLY record ends up anchored to nothing and violates
 *               `contact_governance_has_anchor` — 23514, delete aborts.
 *   DEFECT-010  a BOTH-anchored record's `uq_contact_governance_identity` key is
 *               `coalesce(person_id::text, target_normalized)` = its PERSON, and
 *               the SET NULL changes that key to its TARGET. If a live
 *               target-anchored record already holds it — 23505, delete aborts.
 *
 * ─── WHAT THIS SUITE IS, AND IS NOT ───────────────────────────────────────
 * It is NOT a substitute for the real-schema proof. The definitive evidence
 * lives in `backend/tests/realschema/pi_wsf_person_erasure.test.ts`, which runs
 * these same cases against live PostgreSQL constraints and has NOT been run —
 * there is no Postgres and no Docker daemon in this environment.
 *
 * What this suite does is model the two mechanisms EXACTLY as the migration
 * declares them — the anchor CHECK, the partial unique index, and the SET NULL
 * update the foreign key performs — so that:
 *   (a) both defects REPRODUCE here, which is what makes them more than an
 *       argument from reading SQL, and
 *   (b) the real writer, the real reader, the real evaluator and the real
 *       erasure path are then shown to resolve them against that same model.
 *
 * The double is deliberately strict: if `personErasure.ts` were wrong, these
 * tests would raise the same SQLSTATE the database would.
 */

type Row = Record<string, unknown>;

/** Stands in for `effective_from DEFAULT now()`; fixed so evaluation is deterministic. */
const WRITTEN_AT = '2026-01-01T00:00:00.000Z';
const NOW = '2026-08-14T12:00:00.000Z';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PERSON_A = 'person-a';
const PERSON_B = 'person-b';

/** A PostgreSQL error, as the pg/PostgREST layer surfaces one. */
class PgError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

let governance: Row[] = [];
let claims: Row[] = [];
let persons: Row[] = [];
let nextId = 1;

/**
 * `contact_governance_has_anchor`.
 *
 * `admitsRevoked` is the ONE bit that migration 20261027000000 flips. Both
 * settings are exercised, so the tests show precisely what the schema change
 * buys and what it does not.
 */
let anchorCheckAdmitsRevoked = true;

function assertAnchorCheck(r: Row): void {
  const hasPerson = r.person_id != null;
  const target = typeof r.target_normalized === 'string' ? r.target_normalized.trim() : '';
  const revoked = r.revoked_at != null;
  if (hasPerson || target.length > 0) return;
  if (anchorCheckAdmitsRevoked && revoked) return;
  throw new PgError('23514', 'new row violates check constraint "contact_governance_has_anchor"');
}

/** `uq_contact_governance_identity`, including its `WHERE revoked_at IS NULL` predicate. */
const identityKey = (r: Row) =>
  `${r.organization_id}\u0000${r.channel}\u0000${r.governance_type}\u0000${r.person_id ?? r.target_normalized}`;

function assertIdentityIndex(candidate: Row, universe: Row[]): void {
  if (candidate.revoked_at != null) return;              // partial: not in the index
  const key = identityKey(candidate);
  for (const other of universe) {
    if (other === candidate) continue;
    if (other.revoked_at != null) continue;
    if (identityKey(other) === key) {
      throw new PgError('23505', 'duplicate key value violates unique constraint "uq_contact_governance_identity"');
    }
  }
}

/**
 * The DELETE on `unified_persons`, with the referential actions the schema
 * declares:
 *   contact_governance_person_tenant_fk   SET NULL (person_id)   [LI-3B]
 *   identity_claims_person_tenant_fk      CASCADE                [W4]
 *
 * Constraints are evaluated on the SET NULL update, exactly as PostgreSQL does.
 * The whole statement is atomic: a violation leaves the person in place.
 */
function deletePerson(companyId: string, id: string): Row[] {
  const victim = persons.find((p) => p.id === id && p.company_id === companyId);
  if (!victim) return [];

  const touched = governance.filter((g) => g.person_id === id);
  const proposed = touched.map((g) => ({ ...g, person_id: null }));

  // Validate the post-update world before committing any of it.
  const after = governance.map((g) => {
    const i = touched.indexOf(g);
    return i === -1 ? g : proposed[i];
  });
  for (const p of proposed) {
    assertAnchorCheck(p);
    assertIdentityIndex(p, after);
  }

  for (let i = 0; i < touched.length; i += 1) touched[i].person_id = null;
  claims = claims.filter((c) => c.person_id !== id);
  persons = persons.filter((p) => p !== victim);
  return [{ id }];
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (name: string) => {
    const tableOf = (): Row[] =>
      name === 'contact_governance_records' ? governance
        : name === 'identity_claims' ? claims
          : name === 'unified_persons' ? persons : [];

    const filters: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const matches = (r: Row) =>
      filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      && ins.every(([c, vs]) => vs.includes(r[c] as never));

    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = () => chain();
    builder.limit = () => chain();
    builder.eq = (c: string, v: unknown) => { filters.push([c, v]); return chain(); };
    builder.is = (c: string, v: unknown) => { filters.push([c, v]); return chain(); };
    builder.in = (c: string, vs: unknown[]) => { ins.push([c, vs]); return chain(); };

    builder.insert = (row: Row) => ({
      select: () => ({
        single: async () => {
          if (name !== 'contact_governance_records') return { data: { id: 'x' }, error: null };
          const created: Row = {
            id: `g${nextId++}`,
            person_id: null,
            target_normalized: null,
            revoked_at: null,
            revoked_reason: null,
            effective_until: null,
            effective_from: WRITTEN_AT,
            ...row,
          };
          try {
            assertAnchorCheck(created);
            assertIdentityIndex(created, governance);
          } catch (e) {
            const pg = e as PgError;
            return { error: { code: pg.code, message: pg.message } };
          }
          governance.push(created);
          return { data: { id: created.id }, error: null };
        },
      }),
    });

    builder.update = (patch: Row) => {
      const uf: Array<[string, unknown]> = [];
      const u: Record<string, unknown> = {};
      u.eq = (c: string, v: unknown) => { uf.push([c, v]); return u; };
      u.is = (c: string, v: unknown) => { uf.push([c, v]); return u; };
      u.select = async () => {
        const hit = tableOf().filter((r) => uf.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)));
        for (const r of hit) {
          const next = { ...r, ...patch };
          try {
            if (name === 'contact_governance_records') {
              assertAnchorCheck(next);
              assertIdentityIndex(next, tableOf().map((x) => (x === r ? next : x)));
            }
          } catch (e) {
            const pg = e as PgError;
            return { data: null, error: { code: pg.code, message: pg.message } };
          }
          Object.assign(r, patch);
        }
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      };
      return u;
    };

    builder.delete = () => {
      const df: Array<[string, unknown]> = [];
      const d: Record<string, unknown> = {};
      d.eq = (c: string, v: unknown) => { df.push([c, v]); return d; };
      d.select = async () => {
        if (name !== 'unified_persons') return { data: [], error: null };
        const by = Object.fromEntries(df) as { company_id?: string; id?: string };
        try {
          return { data: deletePerson(String(by.company_id), String(by.id)), error: null };
        } catch (e) {
          const pg = e as PgError;
          return { data: null, error: { code: pg.code, message: pg.message } };
        }
      };
      return d;
    };

    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: tableOf().filter(matches), error: null });

    return builder;
  },
}));

import {
  erasePerson, planPersonErasure, contactClaimTypesForChannel, PersonErasureError,
} from '../../services/prospectIdentity/personErasure';
import { recordContactGovernance, revokeContactGovernance } from '../../services/prospectIdentity/contactGovernanceWriter';
import { loadGovernanceRecords } from '../../services/prospectIdentity/contactGovernanceRepository';
import { mayContact } from '../../services/prospectIdentity/contactGovernance';

beforeEach(() => {
  governance = [];
  claims = [];
  persons = [
    { id: PERSON_A, company_id: ORG_A },
    { id: PERSON_B, company_id: ORG_B },
  ];
  nextId = 1;
  anchorCheckAdmitsRevoked = true;
});

const seedPerson = (org: string, id: string) => { persons.push({ id, company_id: org }); };

const seedClaim = (org: string, person: string, claimType: string, value: string, revoked = false) => {
  claims.push({
    id: `c${nextId++}`, organization_id: org, person_id: person,
    claim_type: claimType, normalized_value: value,
    revoked_at: revoked ? '2026-02-01T00:00:00.000Z' : null,
  });
};

/** The real reader + the real evaluator, as the send path uses them. */
async function decide(org: string, channel: string, opts: { target?: string; personId?: string } = {}) {
  const loaded = await loadGovernanceRecords({
    organizationId: org, channel, target: opts.target ?? null, personId: opts.personId ?? null,
  });
  expect(loaded.ok).toBe(true);
  return mayContact({
    organizationId: org, channel, now: NOW,
    personId: opts.personId ?? null, targetNormalized: opts.target ?? null,
    records: loaded.records,
  });
}

/** A bare DELETE, with no erasure procedure — the path both defects live on. */
async function rawDelete(org: string, personId: string): Promise<string> {
  try {
    deletePerson(org, personId);
    return 'ok';
  } catch (e) {
    return (e as PgError).code;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The defects, reproduced.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — DEFECT-008: a person-only record makes the person undeletable', () => {
  it('a bare delete aborts with 23514 when the only anchor is the person', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('23514');
    expect(persons.some((p) => p.id === PERSON_A)).toBe(true);   // the delete was refused whole
  });

  it('REVOKING the record does not help — the CHECK is not predicated on revoked_at', async () => {
    // This is the correction to the obvious fix. A revoked person-only record is
    // as fatal as a live one, because the SET NULL still lands on it.
    anchorCheckAdmitsRevoked = false;                             // pre-migration schema
    const r = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    await revokeContactGovernance({ organizationId: ORG_A, id: r.id, reason: 'withdrawn' });
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('23514');
  });

  it('and revoked history cannot be repaired by any procedure — only by the schema', async () => {
    // A record revoked BEFORE the erasure is untouchable: ADR §16 permits
    // setting revoked_at/revoked_reason and nothing else, so no erasure path may
    // write a target onto it. 20261027000000 is what makes this row survivable.
    anchorCheckAdmitsRevoked = false;
    const r = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await revokeContactGovernance({ organizationId: ORG_A, id: r.id, reason: 'resubscribed' });
    seedClaim(ORG_A, PERSON_A, 'email', 'reachable@x.test');

    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW }))
      .rejects.toThrow(/23514|check constraint/i);

    anchorCheckAdmitsRevoked = true;                              // with the migration
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    expect(res.deleted).toBe(true);
    expect(res.plan.actions).toEqual([expect.objectContaining({ disposition: 'history_retained' })]);
    // History intact: revoked, never deleted, and still carrying its own reason.
    expect(governance).toHaveLength(1);
    expect(governance[0].revoked_reason).toBe('resubscribed');
  });
});

describe('PI/WS-F — DEFECT-010: a both-anchored record can collide on the way out', () => {
  it('a bare delete aborts with 23505 when a live target record already holds the post-delete key', async () => {
    // Verifies the orchestrator's reasoning: the key is coalesce(person_id,
    // target), so it CHANGES from the person to the target when the person goes.
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'shared@x.test', source: 'webhook:ses',
    });
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, target: 'shared@x.test', source: 'manual',
    });
    expect(governance).toHaveLength(2);                           // both were insertable: different keys
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('23505');
    expect(persons.some((p) => p.id === PERSON_A)).toBe(true);
  });

  it('the same two records on DIFFERENT targets do not collide — the trap needs an equal key', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'other@x.test', source: 'webhook:ses',
    });
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, target: 'mine@x.test', source: 'manual',
    });
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('ok');
  });

  it('a REVOKED both-anchored record is already safe — the index is partial', async () => {
    const r = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, target: 'shared@x.test', source: 'manual',
    });
    await revokeContactGovernance({ organizationId: ORG_A, id: r.id, reason: 'superseded' });
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'shared@x.test', source: 'webhook:ses',
    });
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('ok');
  });

  it('a target-only record is untouched by the delete — MATCH SIMPLE never fires', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'stranger@x.test', source: 'webhook:ses',
    });
    expect(await rawDelete(ORG_A, PERSON_A)).toBe('ok');
    expect(governance[0].target_normalized).toBe('stranger@x.test');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. CAPABILITY A — never contact this human at any address.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — CAPABILITY A: person-scoped suppression, before and after erasure', () => {
  it('BEFORE erasure a person-only DNC blocks at an address nobody ever recorded', async () => {
    // The LI-3E contract, restated. This is the capability the whole design is
    // required to preserve; it is not being narrowed.
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    expect((await decide(ORG_A, 'email', { personId: PERSON_A, target: 'anything@example.com' })).decision)
      .toBe('blocked');
  });

  it('AFTER erasure the instruction still blocks every address the platform knew', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'work@x.test');
    seedClaim(ORG_A, PERSON_A, 'email', 'home@x.test');
    seedClaim(ORG_A, PERSON_A, 'phone', '+15550100001');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });

    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    expect(res.deleted).toBe(true);
    expect(res.suppressionsLostToErasure).toEqual([]);

    expect((await decide(ORG_A, 'email', { target: 'work@x.test' })).decision).toBe('blocked');
    expect((await decide(ORG_A, 'email', { target: 'home@x.test' })).decision).toBe('blocked');
    expect((await decide(ORG_A, 'phone', { target: '+15550100001' })).decision).toBe('blocked');
    for (const t of ['work@x.test', 'home@x.test', '+15550100001']) {
      const hit = governance.find((g) => g.target_normalized === t && g.revoked_at == null);
      expect(hit).toBeDefined();
      expect(hit!.governance_type).toBe('dnc_permanent');
      expect(hit!.person_id).toBeNull();
    }
  });

  it('a re-import of the same address is still blocked — the re-import hole stays closed', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'returning@x.test');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });

    // A brand-new person with the same address: resolution is deterministic on
    // email, so this is exactly what a re-import produces.
    seedPerson(ORG_A, 'person-reimported');
    expect((await decide(ORG_A, 'email', { personId: 'person-reimported', target: 'returning@x.test' })).decision)
      .toBe('blocked');
  });

  it('the instruction keeps its original effective_from — erasure does not restart the clock', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'since@x.test');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual', effectiveFrom: '2025-05-05T00:00:00.000Z',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    const carried = governance.find((g) => g.target_normalized === 'since@x.test');
    expect(carried!.effective_from).toBe('2025-05-05T00:00:00.000Z');
  });

  it('an email-scoped record is never carried onto a phone number', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'only@x.test');
    seedClaim(ORG_A, PERSON_A, 'phone', '+15550100002');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_channel', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    expect(governance.filter((g) => g.revoked_at == null).map((g) => g.target_normalized)).toEqual(['only@x.test']);
    expect((await decide(ORG_A, 'phone', { target: '+15550100002' })).decision).toBe('allowed');
  });

  it('a revoked claim is not an address the platform believes in, so nothing is carried onto it', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'live@x.test');
    seedClaim(ORG_A, PERSON_A, 'email', 'retired@x.test', true);
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    expect((await decide(ORG_A, 'email', { target: 'live@x.test' })).decision).toBe('blocked');
    expect((await decide(ORG_A, 'email', { target: 'retired@x.test' })).decision).toBe('allowed');
  });

  it('what erasure CANNOT preserve is reported, never silently dropped', async () => {
    // A person with no contact points: there is no address the instruction could
    // still name, and after erasure there is no person either.
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });

    expect(res.deleted).toBe(true);
    expect(res.suppressionsLostToErasure).toHaveLength(1);
    expect(res.suppressionsLostToErasure[0]).toMatchObject({
      disposition: 'unenforceable', governanceType: 'dnc_permanent', channel: '*',
    });
    // The record itself survives — revoked, with a reason that says what happened.
    expect(governance).toHaveLength(1);
    expect(governance[0].revoked_at).toBe(NOW);
    expect(String(governance[0].revoked_reason)).toMatch(/not enforceable after erasure/);
  });

  it('governance is never deleted by erasure — only revoked', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'kept@x.test');
    const original = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    const kept = governance.find((g) => g.id === original.id);
    expect(kept).toBeDefined();
    expect(kept!.revoked_at).toBe(NOW);
    expect(kept!.governance_type).toBe('unsubscribe');
    expect(kept!.source).toBe('manual');                    // its provenance is unchanged
  });

  it('erasure leaves no residual identifier for the erased person', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'gone@x.test');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    const carried = governance.find((g) => g.source === 'person_erasure')!;
    expect(JSON.stringify(carried.evidence)).not.toContain(PERSON_A);
    expect(carried.person_id).toBeNull();
    expect(claims).toHaveLength(0);                         // identity_claims CASCADEd
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. CAPABILITY B — erasing a person is not structurally impossible.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — CAPABILITY B: every governance shape survives erasure', () => {
  const shapes: Array<[string, () => Promise<void>]> = [
    ['person-only, with contact points', async () => {
      seedClaim(ORG_A, PERSON_A, 'email', 'a@x.test');
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
        personId: PERSON_A, source: 'manual',
      });
    }],
    ['person-only, no contact points', async () => {
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
        personId: PERSON_A, source: 'manual',
      });
    }],
    ['both-anchored, key already held by a live target record (DEFECT-010)', async () => {
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
        target: 'clash@x.test', source: 'webhook:ses',
      });
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
        personId: PERSON_A, target: 'clash@x.test', source: 'manual',
      });
    }],
    ['both-anchored, no clash', async () => {
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
        personId: PERSON_A, target: 'free@x.test', source: 'manual',
      });
    }],
    ['already revoked, person-only', async () => {
      const r = await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
        personId: PERSON_A, source: 'manual',
      });
      await revokeContactGovernance({ organizationId: ORG_A, id: r.id, reason: 'resubscribed' });
    }],
    ['several records at once, mixed shapes', async () => {
      seedClaim(ORG_A, PERSON_A, 'email', 'multi@x.test');
      seedClaim(ORG_A, PERSON_A, 'phone', '+15550100003');
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
        personId: PERSON_A, source: 'manual',
      });
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'bounce_hard', channel: 'email',
        personId: PERSON_A, target: 'multi@x.test', source: 'webhook:ses',
      });
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: 'complaint', channel: 'email',
        target: 'multi@x.test', source: 'webhook:ses',
      });
    }],
    ['no governance at all', async () => { /* the trivial case must not regress */ }],
  ];

  for (const [name, seed] of shapes) {
    it(`erases a person whose governance is: ${name}`, async () => {
      await seed();
      const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
      expect(res.deleted).toBe(true);
      expect(persons.some((p) => p.id === PERSON_A)).toBe(false);
      // Nothing was destroyed to achieve it.
      for (const g of governance) expect(g.governance_type).toBeDefined();
    });
  }

  it('DEFECT-010: the surviving target record still blocks after the clash is resolved', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'clash@x.test', source: 'webhook:ses',
    });
    const both = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, target: 'clash@x.test', source: 'manual',
    });
    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });

    expect((await decide(ORG_A, 'email', { target: 'clash@x.test' })).decision).toBe('blocked');
    // Exactly one live record holds the key; the person-anchored one is revoked
    // history rather than a second live row.
    const live = governance.filter((g) => g.revoked_at == null && g.target_normalized === 'clash@x.test');
    expect(live).toHaveLength(1);
    expect(governance.find((g) => g.id === both.id)!.revoked_at).toBe(NOW);
  });

  it('a merge survivor is refused with a reason, not a raw SQLSTATE', async () => {
    // `unified_persons_merge_tenant_fk` is ON DELETE NO ACTION (LI-4C ADR §15).
    // Merging is disabled today, so this is a contract for when it is enabled.
    const table = jest.requireMock('../../db/writeOwner') as { ownedDbTable: (n: string) => unknown };
    const original = table.ownedDbTable;
    table.ownedDbTable = (n: string) => (n !== 'unified_persons' ? original(n) : {
      delete: () => ({ eq() { return this; }, select: async () => ({ data: null, error: { code: '23503', message: 'violates foreign key constraint "unified_persons_merge_tenant_fk"' } }) }),
    });
    try {
      await expect(erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW }))
        .rejects.toMatchObject({ code: 'merge_survivor' });
    } finally {
      table.ownedDbTable = original;
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The constraints WS-F must not break.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — tenant isolation, idempotency, fail-closed', () => {
  it('erasing a person in A never touches an identical record in B', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'same@x.test');
    seedClaim(ORG_B, PERSON_B, 'email', 'same@x.test');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    const bRecord = await recordContactGovernance({
      organizationId: ORG_B, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_B, source: 'manual',
    });

    await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });

    expect(governance.find((g) => g.id === bRecord.id)!.revoked_at).toBeNull();
    expect(persons.some((p) => p.id === PERSON_B)).toBe(true);
    expect((await decide(ORG_B, 'email', { personId: PERSON_B })).decision).toBe('blocked');
    // A's carried-forward record must not decide anything in B.
    expect((await decide(ORG_B, 'email', { target: 'same@x.test' })).decision).toBe('allowed');
  });

  it('tenant A cannot erase tenant B\'s person', async () => {
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_B, reason: 'dsar', now: NOW });
    expect(res.deleted).toBe(false);
    expect(persons.some((p) => p.id === PERSON_B)).toBe(true);
  });

  it('a second erasure of the same person is a no-op, not a failure', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'twice@x.test');
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    const first = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    const before = governance.length;
    const second = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });

    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(false);
    expect(governance).toHaveLength(before);                // no duplicate rows
    expect((await decide(ORG_A, 'email', { target: 'twice@x.test' })).decision).toBe('blocked');
  });

  it('a target record that already exists is reused, not duplicated', async () => {
    seedClaim(ORG_A, PERSON_A, 'email', 'dup@x.test');
    const existing = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'dup@x.test', source: 'webhook:ses',
    });
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    const res = await erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW });
    expect(res.reanchored).toEqual([
      expect.objectContaining({ target: 'dup@x.test', newRecordId: existing.id, outcome: 'already_present' }),
    ]);
  });

  it('the person is NOT deleted when carrying an instruction forward fails', async () => {
    // Fail closed: a half-erased person whose suppressions were revoked but whose
    // row survives is strictly worse than one that was never erased.
    seedClaim(ORG_A, PERSON_A, 'email', 'boom@x.test');
    const original = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      personId: PERSON_A, source: 'manual',
    });
    const table = jest.requireMock('../../db/writeOwner') as { ownedDbTable: (n: string) => unknown };
    const real = table.ownedDbTable;
    table.ownedDbTable = (n: string) => (n !== 'contact_governance_records' ? real(n) : (() => {
      const b = real(n) as Record<string, unknown>;
      b.insert = () => ({ select: () => ({ single: async () => ({ error: { code: '08006', message: 'connection terminated' } }) }) });
      return b;
    })());
    try {
      await expect(erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: 'dsar', now: NOW }))
        .rejects.toMatchObject({ code: 'reanchor_failed' });
    } finally {
      table.ownedDbTable = real;
    }

    expect(persons.some((p) => p.id === PERSON_A)).toBe(true);
    expect(governance.find((g) => g.id === original.id)!.revoked_at).toBeNull();
    expect((await decide(ORG_A, 'email', { personId: PERSON_A })).decision).toBe('blocked');
  });

  it('refuses a tenant-less, person-less or unexplained erasure', async () => {
    await expect(erasePerson({ organizationId: '', personId: PERSON_A, reason: 'r' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
    await expect(erasePerson({ organizationId: ORG_A, personId: '  ', reason: 'r' }))
      .rejects.toMatchObject({ code: 'person_required' });
    await expect(erasePerson({ organizationId: ORG_A, personId: PERSON_A, reason: '' }))
      .rejects.toMatchObject({ code: 'reason_required' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. The planner, in isolation. Pure — same discipline as `mayContact`.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — planPersonErasure is pure and total', () => {
  const rec = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'g1', organizationId: ORG_A, personId: PERSON_A, targetNormalized: null,
    channel: '*', governanceType: 'dnc_permanent', effectiveFrom: WRITTEN_AT,
    effectiveUntil: null, revokedAt: null, ...over,
  }) as never;

  it('maps a channel to the claim types it can actually govern', () => {
    expect(contactClaimTypesForChannel('email')).toEqual(['email']);
    expect(contactClaimTypesForChannel('phone')).toEqual(['phone']);
    expect(contactClaimTypesForChannel('whatsapp')).toEqual(['phone']);
    expect(contactClaimTypesForChannel('*')).toEqual(['email', 'phone']);
    expect(contactClaimTypesForChannel('future_transport')).toEqual(['email', 'phone']);
  });

  it('never re-anchors onto a domain or an external identifier', () => {
    const plan = planPersonErasure({
      organizationId: ORG_A, personId: PERSON_A, records: [rec()],
      contactPoints: [
        { claimType: 'domain' as never, normalizedValue: 'x.test' },
        { claimType: 'external_id' as never, normalizedValue: 'li:123' },
      ],
    });
    expect(plan.contactPoints).toEqual([]);
    expect(plan.actions[0].disposition).toBe('unenforceable');
  });

  it('ignores a record belonging to another tenant or another person', () => {
    const plan = planPersonErasure({
      organizationId: ORG_A, personId: PERSON_A,
      records: [rec({ id: 'other-org', organizationId: ORG_B }), rec({ id: 'other-person', personId: 'p-9' })],
      contactPoints: [{ claimType: 'email', normalizedValue: 'a@x.test' }],
    });
    expect(plan.actions).toEqual([]);
  });

  it('deduplicates a contact point claimed twice', () => {
    const plan = planPersonErasure({
      organizationId: ORG_A, personId: PERSON_A, records: [rec()],
      contactPoints: [
        { claimType: 'email', normalizedValue: 'dupe@x.test' },
        { claimType: 'email', normalizedValue: ' dupe@x.test ' },
      ],
    });
    expect(plan.actions[0].reanchorTargets).toEqual(['dupe@x.test']);
  });

  it('carries a both-anchored record onto its OWN target even when no claim names it', () => {
    const plan = planPersonErasure({
      organizationId: ORG_A, personId: PERSON_A,
      records: [rec({ channel: 'email', governanceType: 'unsubscribe', targetNormalized: 'unknown@x.test' })],
      contactPoints: [],
    });
    expect(plan.actions[0]).toMatchObject({ disposition: 'reanchored', reanchorTargets: ['unknown@x.test'] });
  });

  it('is deterministic — the same inputs produce the same plan', () => {
    const args = {
      organizationId: ORG_A, personId: PERSON_A, records: [rec()],
      contactPoints: [{ claimType: 'email' as const, normalizedValue: 'd@x.test' }],
    };
    expect(planPersonErasure(args)).toEqual(planPersonErasure(args));
  });

  it('refuses to plan without a tenant', () => {
    expect(() => planPersonErasure({ organizationId: '', personId: PERSON_A, records: [], contactPoints: [] }))
      .toThrow(PersonErasureError);
  });
});
