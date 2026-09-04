/**
 * LI-3D — the governance writer's invariants, against real PostgreSQL.
 *
 * The writer's correctness rests on properties only a real database can
 * demonstrate: that a partial unique index makes a duplicate instruction
 * collide with `23505` rather than duplicating, that a composite foreign key
 * refuses another tenant's person with `23503`, that a transition between two
 * governance types leaves both rows standing, and that deleting a person
 * preserves the instruction. Every one of those is a database behaviour, so
 * every one of them is tested here rather than against a mock.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const INS = `INSERT INTO public.contact_governance_records
  (organization_id, person_id, target_normalized, channel, governance_type, source, effective_until)
  VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;

const insert = async (
  org: string, person: string | null, target: string | null,
  channel: string, type: string, source = 'li3d-test', until: string | null = null,
): Promise<string> => (await db.query(INS, [org, person, target, channel, type, source, until])).rows[0].id;

const tryInsert = (
  org: string, person: string | null, target: string | null,
  channel: string, type: string, source = 'li3d-test', until: string | null = null,
) => attempt(
  `INSERT INTO public.contact_governance_records
     (organization_id, person_id, target_normalized, channel, governance_type, source, effective_until)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [org, person, target, channel, type, source, until],
);

const live = async (org: string): Promise<number> => Number(
  (await db.query(
    'SELECT count(*)::int n FROM public.contact_governance_records WHERE organization_id=$1 AND revoked_at IS NULL',
    [org],
  )).rows[0].n,
);

beforeAll(seedTenants);

describe('LI-3D — idempotency is by database constraint', () => {
  it('a repeated identical instruction collides with 23505, never duplicates', async () => {
    await inRollback(async () => {
      await insert(ORG_A, null, 'dup@li3d.test', 'email', 'unsubscribe');
      const code = await tryInsert(ORG_A, null, 'dup@li3d.test', 'email', 'unsubscribe');
      expect(code).toBe('23505');
      expect(await live(ORG_A)).toBe(1);
    });
  });

  it('ON CONFLICT cannot infer the partial index — 42P10, which is why the writer catches 23505', async () => {
    await inRollback(async () => {
      await insert(ORG_A, null, 'onconf@li3d.test', 'email', 'unsubscribe');
      const code = await attempt(
        `INSERT INTO public.contact_governance_records
           (organization_id, person_id, target_normalized, channel, governance_type, source)
         VALUES ($1,NULL,$2,'email','unsubscribe','li3d-test')
         ON CONFLICT (organization_id, channel, governance_type, coalesce(person_id::text, target_normalized))
         DO NOTHING`,
        [ORG_A, 'onconf@li3d.test'],
      );
      expect(code).toBe('42P10');
    });
  });

  it('a revoked record frees the canonical key, so re-recording is expressible', async () => {
    await inRollback(async () => {
      const id = await insert(ORG_A, null, 'again@li3d.test', 'email', 'unsubscribe');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='resubscribed' WHERE id=$1`,
        [id],
      );
      // A durable insert, not `attempt()` — that rolls back to a savepoint, so a
      // row created through it can never be counted afterwards.
      const reId = await insert(ORG_A, null, 'again@li3d.test', 'email', 'unsubscribe');
      expect(reId).not.toBe(id);
      expect(await live(ORG_A)).toBe(1);   // the revoked one no longer counts
    });
  });
});

describe('LI-3D — concurrency', () => {
  it('two concurrent identical instructions yield exactly one durable record', async () => {
    const { Client } = await import('pg');
    const url = process.env.W6_DB_URL as string;
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const sql = `INSERT INTO public.contact_governance_records
        (organization_id, person_id, target_normalized, channel, governance_type, source)
        VALUES ($1,NULL,$2,'email','unsubscribe','li3d-conc')`;
      const params = [ORG_A, 'race@li3d.test'];

      await c1.query(sql, params);

      let settled = false;
      const pending = c2.query(sql, params)
        .then((r) => { settled = true; return r; })
        .catch((e) => { settled = true; return e; });

      await new Promise((r) => setTimeout(r, 400));
      // The second writer must BLOCK on the unique index, not proceed.
      expect(settled).toBe(false);

      await c1.query('COMMIT');
      const result = await pending as { code?: string };
      // Exactly one wins; the loser sees 23505 and the writer re-resolves it.
      expect(result?.code).toBe('23505');
      await c2.query('ROLLBACK').catch(() => {});

      const { rows } = await c1.query(
        `SELECT count(*)::int n FROM public.contact_governance_records WHERE target_normalized=$1`,
        ['race@li3d.test'],
      );
      expect(Number(rows[0].n)).toBe(1);
      await c1.query('DELETE FROM public.contact_governance_records WHERE target_normalized=$1', ['race@li3d.test']);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});

describe('LI-3D — tenant isolation is enforced by the database', () => {
  it('a person from Tenant A cannot be attached to a Tenant B record — 23503', async () => {
    await inRollback(async () => {
      const personA = await newPerson(ORG_A);
      const code = await tryInsert(ORG_B, personA, null, '*', 'dnc_permanent');
      expect(code).toBe('23503');
    });
  });

  it('the same target in two tenants produces two independent records', async () => {
    await inRollback(async () => {
      await insert(ORG_A, null, 'shared@li3d.test', 'email', 'unsubscribe');
      // Durable on both sides: the point is that TWO rows coexist, which a
      // savepoint-rolled-back `attempt()` could never demonstrate.
      await insert(ORG_B, null, 'shared@li3d.test', 'email', 'unsubscribe');
      expect(await live(ORG_A)).toBe(1);
      expect(await live(ORG_B)).toBe(1);
    });
  });

  it('the same person id cannot be shared across tenants — identity is tenant-scoped', async () => {
    await inRollback(async () => {
      const personA = await newPerson(ORG_A);
      await insert(ORG_A, personA, null, '*', 'dnc_permanent');
      // Tenant B referencing A's person is refused by the composite FK.
      expect(await tryInsert(ORG_B, personA, null, '*', 'dnc_permanent')).toBe('23503');
    });
  });
});

describe('LI-3D — transitions are new records, never mutations', () => {
  it('deferred -> dnc_permanent leaves BOTH rows standing', async () => {
    await inRollback(async () => {
      const person = await newPerson(ORG_A);
      const deferredId = await insert(ORG_A, person, null, '*', 'deferred', 'li3d-test', '2027-01-01T00:00:00Z');
      const dncId = await insert(ORG_A, person, null, '*', 'dnc_permanent');
      expect(deferredId).not.toBe(dncId);

      const { rows } = await db.query(
        `SELECT governance_type, effective_until FROM public.contact_governance_records
          WHERE organization_id=$1 AND person_id=$2 AND revoked_at IS NULL ORDER BY governance_type`,
        [ORG_A, person],
      );
      expect(rows.map((r: { governance_type: string }) => r.governance_type)).toEqual(['deferred', 'dnc_permanent']);
      // The original deferment is intact — history was not rewritten.
      expect(rows[0].effective_until).not.toBeNull();
    });
  });

  it('re-deferring to a new date collides, forcing revoke-then-insert (ADR §13)', async () => {
    await inRollback(async () => {
      const person = await newPerson(ORG_A);
      await insert(ORG_A, person, null, '*', 'deferred', 'li3d-test', '2027-01-01T00:00:00Z');
      const code = await tryInsert(ORG_A, person, null, '*', 'deferred', 'li3d-test', '2027-06-01T00:00:00Z');
      expect(code).toBe('23505');
    });
  });

  it('revocation preserves every other field — append-only', async () => {
    await inRollback(async () => {
      const id = await insert(ORG_A, null, 'revoke@li3d.test', 'email', 'unsubscribe', 'webhook:ses');
      const before = (await db.query(
        'SELECT organization_id, target_normalized, governance_type, source, effective_from FROM public.contact_governance_records WHERE id=$1',
        [id],
      )).rows[0];

      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='operator error' WHERE id=$1`,
        [id],
      );

      const after = (await db.query(
        'SELECT organization_id, target_normalized, governance_type, source, effective_from, revoked_reason FROM public.contact_governance_records WHERE id=$1',
        [id],
      )).rows[0];

      expect(after.organization_id).toBe(before.organization_id);
      expect(after.target_normalized).toBe(before.target_normalized);
      expect(after.governance_type).toBe(before.governance_type);
      expect(after.source).toBe(before.source);
      expect(String(after.effective_from)).toBe(String(before.effective_from));
      expect(after.revoked_reason).toBe('operator error');
    });
  });

  it('a revocation without a reason is refused', async () => {
    await inRollback(async () => {
      const id = await insert(ORG_A, null, 'noreason@li3d.test', 'email', 'unsubscribe');
      const code = await attempt(
        'UPDATE public.contact_governance_records SET revoked_at=now() WHERE id=$1', [id],
      );
      expect(code).toBe('23514');
    });
  });
});

describe('LI-3D — a DNC outlives the person (D-3)', () => {
  it('deleting the person nulls person_id and preserves tenant, target and provenance', async () => {
    await inRollback(async () => {
      const person = await newPerson(ORG_A);
      const id = await insert(ORG_A, person, 'survivor@li3d.test', 'email', 'unsubscribe', 'webhook:ses');

      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [person]);

      const { rows } = await db.query(
        `SELECT organization_id, person_id, target_normalized, governance_type, source
           FROM public.contact_governance_records WHERE id=$1`, [id],
      );
      expect(rows).toHaveLength(1);                       // the instruction survived
      expect(rows[0].person_id).toBeNull();               // only the link was nulled
      expect(rows[0].organization_id).toBe(ORG_A);        // tenant preserved
      expect(rows[0].target_normalized).toBe('survivor@li3d.test');
      expect(rows[0].governance_type).toBe('unsubscribe');
      expect(rows[0].source).toBe('webhook:ses');
    });
  });
});

describe('LI-3D — the person anchor Path B resolves through', () => {
  it('leads carries a canonical person link, so no second identity relationship is needed', async () => {
    const { rows } = await db.query(`
      SELECT count(*)::int n FROM pg_attribute
       WHERE attrelid='public.leads'::regclass AND attname='unified_person_id' AND NOT attisdropped`);
    expect(Number(rows[0].n)).toBe(1);
  });

  it('the vocabulary remains the ADR nine — no type was invented', async () => {
    const { rows } = await db.query(`
      SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='contact_governance_type_valid'`);
    for (const t of ['dnc_permanent', 'dnc_channel', 'unsubscribe', 'consent_withdrawn',
      'invalid_contact', 'bounce_hard', 'complaint', 'deferred', 'campaign_exclusion']) {
      expect(rows[0].d).toContain(t);
    }
    // Nine and only nine.
    expect((rows[0].d.match(/'/g) ?? []).length / 2).toBe(9);
  });
});
