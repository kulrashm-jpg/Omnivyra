/**
 * PI/WS-F — person erasure and contact governance, against real PostgreSQL.
 *
 * ############################################################################
 * #  NOT RUN.                                                                #
 * #                                                                          #
 * #  This file was AUTHORED but never EXECUTED. The environment WS-F worked   #
 * #  in has no local PostgreSQL and no Docker daemon, so                      #
 * #  scripts/ci/real-schema-ci.sh could not provision a database and          #
 * #  W6_DB_URL was never set. Every assertion below is a PREDICTION derived   #
 * #  from the migration DDL, not an observation.                             #
 * #                                                                          #
 * #  The equivalent cases DID run, and pass, against a strict in-memory model #
 * #  of the same CHECK, the same partial unique index and the same            #
 * #  ON DELETE SET NULL (person_id) update:                                   #
 * #      backend/tests/unit/piWsfPersonErasure.test.ts  — 38/38.             #
 * #  That is a model of PostgreSQL, not PostgreSQL. Run this suite before     #
 * #  treating DEFECT-008 or DEFECT-010 as proven or closed.                   #
 * ############################################################################
 *
 * The properties here cannot be mocked honestly:
 *   - that a referential action's UPDATE is evaluated against the table CHECKs;
 *   - that it is evaluated against a PARTIAL unique index whose key is
 *     `coalesce(person_id::text, target_normalized)` and therefore CHANGES when
 *     the person is nulled;
 *   - that the failure aborts the whole DELETE rather than skipping a row.
 *
 * Conventions follow li3_contact_governance.test.ts: every mutation runs inside
 * `inRollback`, and `attempt` returns 'ok' or the SQLSTATE.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, constraintDef } from './setup';

const INS = `INSERT INTO public.contact_governance_records
  (organization_id, person_id, target_normalized, channel, governance_type, source)
  VALUES ($1,$2,$3,$4,$5,'pi-wsf-test') RETURNING id`;

async function insert(org: string, person: string | null, target: string | null,
  channel: string, type: string): Promise<string> {
  const { rows } = await db.query(INS, [org, person, target, channel, type]);
  return rows[0].id;
}

/** `identity_claims.normalized_value` must be lowercase — identity_claims_value_is_normalized. */
async function claim(org: string, person: string, claimType: 'email' | 'phone', value: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.identity_claims (organization_id, person_id, claim_type, normalized_value, source)
     VALUES ($1,$2,$3,$4,'pi-wsf-test') RETURNING id`,
    [org, person, claimType, value.toLowerCase()],
  );
  return rows[0].id;
}

const deletePerson = (id: string) => attempt('DELETE FROM public.unified_persons WHERE id=$1', [id]);

/**
 * Delete a person and KEEP the deletion, so its effects can be asserted.
 *
 * `attempt()` is a SAVEPOINT that ROLLS BACK ON SUCCESS — it exists to capture
 * a SQLSTATE, not to mutate. Asserting post-delete state after `deletePerson`
 * therefore measures nothing: the row is still present, `person_id` was never
 * nulled and `identity_claims` never CASCADEd. Three tests here did exactly
 * that and passed vacuously until the suite was first executed for real.
 *
 * This stays inside the caller's `inRollback`, so nothing leaks between tests.
 */
const erasePerson = async (id: string): Promise<void> => {
  await db.query('DELETE FROM public.unified_persons WHERE id=$1', [id]);
};

const liveRows = async (org: string) => {
  const { rows } = await db.query(
    `SELECT id, person_id, target_normalized, channel, governance_type, revoked_at, revoked_reason
       FROM public.contact_governance_records WHERE organization_id=$1 ORDER BY created_at, id`, [org]);
  return rows as Array<Record<string, any>>;
};

// ───────────────────────────────────────────────────────────────────────────
// DEFECT-008 — the person-only shape aborts the delete.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — DEFECT-008: a LIVE person-only record makes the person undeletable', () => {
  it('the SET NULL leaves the row unanchored and the DELETE aborts with 23514', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, null, '*', 'dnc_permanent');

      expect(await deletePerson(p)).toBe('23514');

      const { rows } = await db.query('SELECT count(*)::int n FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0].n).toBe(1);                  // the whole DELETE was refused
    });
  });

  it('a BOTH-anchored record with no clash deletes cleanly — the shape is not the problem', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, 'survivor@x.test', 'email', 'unsubscribe');
      await erasePerson(p);

      const { rows } = await db.query(
        'SELECT person_id, target_normalized, organization_id FROM public.contact_governance_records WHERE id=$1', [id]);
      expect(rows[0].person_id).toBeNull();
      expect(rows[0].target_normalized).toBe('survivor@x.test');
      expect(rows[0].organization_id).toBe(ORG_A);
    });
  });

  it('revoking a person-only record does NOT make it deletable before 20261027000000', async () => {
    // The CHECK is not predicated on `revoked_at`, so the SET NULL still lands
    // on a revoked row. Restore the pre-migration constraint inside the
    // transaction to observe the original behaviour, then let ROLLBACK undo it.
    await inRollback(async () => {
      await seedTenants();
      await db.query('ALTER TABLE public.contact_governance_records DROP CONSTRAINT contact_governance_has_anchor');
      await db.query(`ALTER TABLE public.contact_governance_records
        ADD CONSTRAINT contact_governance_has_anchor
        CHECK (person_id IS NOT NULL
               OR (target_normalized IS NOT NULL AND length(btrim(target_normalized)) > 0))`);

      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, null, 'email', 'unsubscribe');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='resubscribed' WHERE id=$1`, [id]);

      expect(await deletePerson(p)).toBe('23514');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DEFECT-010 — the idempotency key changes identity mid-delete.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — DEFECT-010: coalesce() puts person_id first, so the key moves', () => {
  it('the index really is keyed on coalesce(person_id, target_normalized)', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_contact_governance_identity'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/COALESCE\(\(person_id\)::text, target_normalized\)/i);
    expect(rows[0].indexdef).toMatch(/WHERE \(revoked_at IS NULL\)/);
  });

  it('a person-anchored and a target-anchored record on the SAME target both insert', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, null, 'clash@x.test', 'email', 'unsubscribe');
      // Different keys today: one keys on the target, the other on the person.
      expect(await attempt(INS, [ORG_A, p, 'clash@x.test', 'email', 'unsubscribe'])).toBe('ok');
    });
  });

  it('...and deleting the person then collides: 23505 aborts the DELETE', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, null, 'clash@x.test', 'email', 'unsubscribe');
      await insert(ORG_A, p, 'clash@x.test', 'email', 'unsubscribe');

      expect(await deletePerson(p)).toBe('23505');
    });
  });

  it('a REVOKED person-anchored record does not collide — the index is partial', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const both = await insert(ORG_A, p, 'clash@x.test', 'email', 'unsubscribe');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='superseded' WHERE id=$1`, [both]);
      await insert(ORG_A, null, 'clash@x.test', 'email', 'unsubscribe');

      expect(await deletePerson(p)).toBe('ok');
    });
  });

  it('a DIFFERENT governance_type on the same target does not collide', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, null, 'clash@x.test', 'email', 'complaint');
      await insert(ORG_A, p, 'clash@x.test', 'email', 'unsubscribe');
      expect(await deletePerson(p)).toBe('ok');
    });
  });

  it('the same target in ANOTHER tenant does not collide — the key is tenant-scoped', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_B, null, 'clash@x.test', 'email', 'unsubscribe');
      await insert(ORG_A, p, 'clash@x.test', 'email', 'unsubscribe');
      expect(await deletePerson(p)).toBe('ok');
    });
  });

  it('two people sharing a target collide with EACH OTHER inside one cascade', async () => {
    // A tenant delete removes every person in one statement. Two person-anchored
    // records whose post-delete keys are equal collide even with no pre-existing
    // target record — the same defect, reached from the other direction.
    await inRollback(async () => {
      await seedTenants();
      const p1 = await newPerson(ORG_A);
      const p2 = await newPerson(ORG_A);
      await insert(ORG_A, p1, 'shared@x.test', 'email', 'unsubscribe');
      await insert(ORG_A, p2, 'shared@x.test', 'email', 'unsubscribe');

      expect(await attempt('DELETE FROM public.unified_persons WHERE id = ANY($1)', [[p1, p2]])).toBe('23505');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The migration.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — 20261027000000 scopes the anchor CHECK to live rows', () => {
  it('the CHECK admits a revoked row and still requires an anchor on a live one', async () => {
    const def = await constraintDef('contact_governance_has_anchor');
    expect(def).not.toBeNull();
    expect(def).toMatch(/revoked_at IS NOT NULL/);
    expect(def).toMatch(/person_id IS NOT NULL/);
    expect(def).toMatch(/target_normalized IS NOT NULL/);
  });

  it('a LIVE unanchored record is still refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(INS, [ORG_A, null, null, 'email', 'unsubscribe'])).toBe('23514');
    });
  });

  it('a revoked person-only record no longer blocks the delete', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, null, 'email', 'unsubscribe');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='resubscribed' WHERE id=$1`, [id]);

      await erasePerson(p);

      const { rows } = await db.query(
        'SELECT person_id, target_normalized, revoked_reason FROM public.contact_governance_records WHERE id=$1', [id]);
      expect(rows).toHaveLength(1);                   // history retained, not deleted
      expect(rows[0].person_id).toBeNull();
      expect(rows[0].target_normalized).toBeNull();
      expect(rows[0].revoked_reason).toBe('resubscribed');
    });
  });

  it('an unanchored row can never be live — it is invisible to every read path', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const id = await insert(ORG_A, p, null, 'email', 'unsubscribe');
      await db.query(
        `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='r' WHERE id=$1`, [id]);
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);

      // Un-revoking it would restore the live requirement, so the row cannot be
      // resurrected into an unmatchable live state.
      expect(await attempt(
        `UPDATE public.contact_governance_records SET revoked_at=NULL, revoked_reason=NULL WHERE id=$1`, [id],
      )).toBe('23514');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CAPABILITY A — never contact this human at any address.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — CAPABILITY A survives erasure', () => {
  it('the person-only shape is writable: the capability exists in the schema', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      expect(await attempt(INS, [ORG_A, p, null, '*', 'dnc_permanent'])).toBe('ok');
    });
  });

  it('the erasure sequence carries the instruction onto every known address', async () => {
    // The SQL the erasure procedure performs, in its order. It is written out
    // here rather than invoked so the suite tests the SCHEMA's tolerance of the
    // sequence, not the TypeScript that emits it.
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await claim(ORG_A, p, 'email', 'work@x.test');
      await claim(ORG_A, p, 'email', 'home@x.test');
      await claim(ORG_A, p, 'phone', '+15550100001');
      const original = await insert(ORG_A, p, null, '*', 'dnc_permanent');

      // 1. carry forward (INSERT, catch 23505 — never ON CONFLICT, 42P10)
      for (const t of ['work@x.test', 'home@x.test', '+15550100001']) {
        expect(await attempt(INS, [ORG_A, null, t, '*', 'dnc_permanent'])).toBe('ok');
        await db.query(INS, [ORG_A, null, t, '*', 'dnc_permanent']);
      }
      // 2. revoke the original
      await db.query(
        `UPDATE public.contact_governance_records
            SET revoked_at=now(), revoked_reason='person erased: dsar — re-anchored onto 3 target(s)'
          WHERE id=$1`, [original]);
      // 3. erase
      await erasePerson(p);

      const rows = await liveRows(ORG_A);
      expect(rows).toHaveLength(4);
      const live = rows.filter((r) => r.revoked_at === null);
      expect(live.map((r) => r.target_normalized).sort())
        .toEqual(['+15550100001', 'home@x.test', 'work@x.test']);
      for (const r of live) expect(r.person_id).toBeNull();
      expect(rows.find((r) => r.id === original)!.revoked_reason).toMatch(/person erased/);
      // identity_claims CASCADEd — no address is retained under the erased person.
      const { rows: c } = await db.query('SELECT count(*)::int n FROM public.identity_claims WHERE person_id=$1', [p]);
      expect(c[0].n).toBe(0);
    });
  });

  it('DEFECT-010 resolved: revoking the person-anchored row first lets the delete through', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const pre = await insert(ORG_A, null, 'clash@x.test', 'email', 'unsubscribe');
      const both = await insert(ORG_A, p, 'clash@x.test', 'email', 'unsubscribe');

      await db.query(
        `UPDATE public.contact_governance_records
            SET revoked_at=now(), revoked_reason='person erased: dsar — re-anchored onto 1 target(s)'
          WHERE id=$1`, [both]);
      expect(await deletePerson(p)).toBe('ok');

      const rows = await liveRows(ORG_A);
      expect(rows.filter((r) => r.revoked_at === null).map((r) => r.id)).toEqual([pre]);
      expect(rows).toHaveLength(2);                     // nothing was deleted
    });
  });

  it('a target carried forward still blocks a RE-IMPORTED person at the same address', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, null, 'returning@x.test', 'email', 'unsubscribe');
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);

      const reimported = await newPerson(ORG_A);
      await claim(ORG_A, reimported, 'email', 'returning@x.test');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.contact_governance_records
          WHERE organization_id=$1 AND target_normalized=$2 AND revoked_at IS NULL`,
        [ORG_A, 'returning@x.test']);
      expect(rows[0].n).toBe(1);
    });
  });

  it('erasure in tenant A leaves an identical record in tenant B untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      await insert(ORG_A, a, 'same@x.test', 'email', 'unsubscribe');
      const bRow = await insert(ORG_B, b, 'same@x.test', 'email', 'unsubscribe');

      expect(await deletePerson(a)).toBe('ok');

      const { rows } = await db.query(
        'SELECT person_id, organization_id FROM public.contact_governance_records WHERE id=$1', [bRow]);
      expect(rows[0].person_id).toBe(b);
      expect(rows[0].organization_id).toBe(ORG_B);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CAPABILITY B — erasure is possible for every shape.
// ───────────────────────────────────────────────────────────────────────────

describe('PI/WS-F — CAPABILITY B: every shape is erasable after the procedure', () => {
  const shapes: Array<[string, (org: string, p: string) => Promise<string[]>]> = [
    ['person-only', async (org, p) => [await insert(org, p, null, '*', 'dnc_permanent')]],
    ['both-anchored', async (org, p) => [await insert(org, p, 'b@x.test', 'email', 'unsubscribe')]],
    ['both-anchored with a live clash', async (org, p) => {
      await insert(org, null, 'c@x.test', 'email', 'unsubscribe');
      return [await insert(org, p, 'c@x.test', 'email', 'unsubscribe')];
    }],
    ['several records', async (org, p) => [
      await insert(org, p, null, '*', 'dnc_permanent'),
      await insert(org, p, 'm@x.test', 'email', 'bounce_hard'),
      await insert(org, p, '+15550100004', 'phone', 'dnc_channel'),
    ]],
  ];

  for (const [name, seed] of shapes) {
    it(`erases a person whose governance is: ${name}`, async () => {
      await inRollback(async () => {
        await seedTenants();
        const p = await newPerson(ORG_A);
        const before = (await liveRows(ORG_A)).length;
        const ids = await seed(ORG_A, p);

        // The procedure: carry forward, then revoke every person-anchored row.
        for (const id of ids) {
          const { rows } = await db.query(
            'SELECT channel, governance_type, target_normalized FROM public.contact_governance_records WHERE id=$1', [id]);
          const t = rows[0].target_normalized;
          if (t) {
            const { rowCount } = await db.query(
              `SELECT 1 FROM public.contact_governance_records
                WHERE organization_id=$1 AND channel=$2 AND governance_type=$3
                  AND target_normalized=$4 AND person_id IS NULL AND revoked_at IS NULL`,
              [ORG_A, rows[0].channel, rows[0].governance_type, t]);
            if (!rowCount) await db.query(INS, [ORG_A, null, t, rows[0].channel, rows[0].governance_type]);
          }
          await db.query(
            `UPDATE public.contact_governance_records SET revoked_at=now(), revoked_reason='person erased: dsar'
              WHERE id=$1`, [id]);
        }

        expect(await deletePerson(p)).toBe('ok');
        // Append-only: nothing was removed to make the delete succeed.
        expect((await liveRows(ORG_A)).length).toBeGreaterThanOrEqual(before + ids.length);
      });
    });
  }

  it('erasing a person leaves outreach history in place with its tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const { rows: t } = await db.query(
        // Eight columns on this table are NOT NULL with no default, and the
        // four *_version ones are the WS-3 provenance stamps that make a task
        // auditable. Supplying them all is the fixture being honest about the
        // table's real contract rather than discovering it one error at a time.
        // `lead_id` is `text` and NOT NULL: A3 records it is NOT proven to be a
        // lead id, which is why it is neither typed nor foreign-keyed, so a
        // synthetic value is correct here rather than a shortcut.
        `INSERT INTO public.outreach_tasks
           (company_id, lead_id, plan_task_id, planner_version,
            translation_version, governance_version, execution_runtime_version,
            materialized_at, person_id)
         VALUES ($1,$2,$3,'test','test','test','test',now(),$4) RETURNING id`,
        [ORG_A, 'wsf-erasure-fixture', 'wsf-plan-task-1', p]);

      await erasePerson(p);

      const { rows } = await db.query(
        'SELECT company_id, person_id FROM public.outreach_tasks WHERE id=$1', [t[0].id]);
      expect(rows).toHaveLength(1);                     // audit row survives (A3)
      expect(rows[0].person_id).toBeNull();
      expect(rows[0].company_id).toBe(ORG_A);
    });
  });

  it('a merge survivor is still refused — LI-4C ADR §15, and that is intended', async () => {
    await inRollback(async () => {
      await seedTenants();
      const survivor = await newPerson(ORG_A);
      const merged = await newPerson(ORG_A);
      await db.query(
        `UPDATE public.unified_persons SET status='merged', merged_into_id=$2 WHERE id=$1`, [merged, survivor]);

      // NO ACTION is checked at end of statement, so deleting the survivor alone
      // dangles the pointer and is refused.
      expect(await deletePerson(survivor)).toBe('23503');
      // Deleting both in one statement succeeds — which is why a TENANT delete
      // still works.
      expect(await attempt('DELETE FROM public.unified_persons WHERE id = ANY($1)', [[survivor, merged]])).toBe('ok');
    });
  });

  it('deleting a TENANT still works with person-only governance present', async () => {
    // The scenario RESTRICT would have broken (20261011000000:90-94). companies
    // CASCADEs into both unified_persons and contact_governance_records.
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, null, '*', 'dnc_permanent');
      expect(await attempt('DELETE FROM public.companies WHERE id=$1', [ORG_A])).toBe('ok');
    });
  });
});
