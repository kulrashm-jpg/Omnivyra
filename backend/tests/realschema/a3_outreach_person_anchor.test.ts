/**
 * A3 — the outreach person anchor, against real PostgreSQL.
 *
 * The properties this migration turns on cannot be observed through a mock:
 *
 *   - that `company_id` is genuinely `uuid` across the family, so the composite
 *     key is even expressible;
 *   - that `ON DELETE SET NULL (person_id)` nulls ONLY the person leg — a bare
 *     SET NULL would try to wipe a NOT NULL tenant column and the delete would
 *     fail outright;
 *   - that MATCH SIMPLE really does let an unanchored task through;
 *   - that a cross-tenant anchor is REFUSED by the database rather than by a
 *     pre-check that races;
 *   - that the retype did not quietly take `outreach_tasks_identity_unique`
 *     (WS-3's idempotency anchor) or the append-only triggers with it.
 *
 * Every one of those is a claim about PostgreSQL's behaviour, so it is asserted
 * against PostgreSQL.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract as
 * its siblings and has not been run.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, constraintDef } from './setup';

/** The whole nine-table family the retype had to cover. */
const FAMILY = [
  'outreach_tasks', 'outreach_approvals', 'outreach_attempts',
  'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions',
  'outreach_governance_config', 'outreach_internal_work_items',
  'outreach_suppressions',
];

const INSERT_TASK = `INSERT INTO public.outreach_tasks
  (company_id, lead_id, plan_task_id, person_id, channel, status,
   planner_version, translation_version, governance_version,
   execution_runtime_version, materialized_at)
  VALUES ($1,$2,$3,$4,'email','approved','p','t','g','r', now())`;

const insertTask = (org: string, lead: string, planTask: string, person: string | null) =>
  attempt(INSERT_TASK, [org, lead, planTask, person]);

async function insertTaskReturning(org: string, lead: string, planTask: string, person: string | null): Promise<string> {
  const { rows } = await db.query(`${INSERT_TASK} RETURNING id`, [org, lead, planTask, person]);
  return rows[0].id;
}

// ───────────────────────────────────────────────────────────────────────────
// Contract 12 — the retype
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — company_id is uuid across the whole outreach family', () => {
  it.each(FAMILY)('%s.company_id is uuid NOT NULL', async (table) => {
    const { rows } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t, attnotnull
         FROM pg_attribute
        WHERE attrelid = ('public.' || $1)::regclass AND attname = 'company_id'`, [table]);
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe('uuid');
    expect(rows[0].attnotnull).toBe(true);
  });

  it('the text-shaped blank CHECKs are gone — a uuid column cannot be blank', async () => {
    // They referenced btrim(company_id); leaving them would have made the
    // retype itself fail with 42883.
    for (const name of [
      'outreach_tasks_company_not_blank',
      'outreach_governance_config_company_not_blank',
      'outreach_internal_work_items_company_not_blank',
    ]) {
      expect(await constraintDef(name)).toBeNull();
    }
  });

  it('lead_id is deliberately STILL text, and still guarded against blanks', async () => {
    const { rows } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
        WHERE attrelid='public.outreach_tasks'::regclass AND attname='lead_id'`);
    expect(rows[0].t).toBe('text');
    expect(await constraintDef('outreach_tasks_lead_not_blank')).toContain('btrim');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract 12 — the anchor
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — the composite person foreign key', () => {
  it('outreach_tasks.person_id exists, is uuid, and is nullable', async () => {
    const { rows } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t, attnotnull FROM pg_attribute
        WHERE attrelid='public.outreach_tasks'::regclass AND attname='person_id'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe('uuid');
    expect(rows[0].attnotnull).toBe(false);
  });

  it('is a tenant-safe composite with the RIGHT delete action', async () => {
    const def = await constraintDef('outreach_tasks_person_tenant_fk');
    expect(def).not.toBeNull();
    expect(def).toContain('FOREIGN KEY (person_id, company_id)');
    expect(def).toContain('REFERENCES unified_persons(id, company_id)');
    // The column-list form. A bare `SET NULL` would also null company_id.
    expect(def).toMatch(/ON DELETE SET NULL \(person_id\)/);
    expect(def).not.toMatch(/CASCADE|RESTRICT/);
  });

  it('nulls ONLY the person leg — confirmed from the catalog, not the text', async () => {
    const { rows } = await db.query(`
      SELECT con.confdeltype,
             (SELECT array_agg(a.attname ORDER BY a.attname)
                FROM pg_attribute a
               WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.confdelsetcols)) setcols
        FROM pg_constraint con
       WHERE con.conname = 'outreach_tasks_person_tenant_fk'`);
    expect(rows[0].confdeltype).toBe('n');          // 'n' = SET NULL
    expect(rows[0].setcols).toEqual(['person_id']);
  });
});

describe('A3 — anchor behaviour against real data', () => {
  it('a person_id NULL task stays legal — MATCH SIMPLE', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro', null)).toBe('ok');
    });
  });

  it('anchoring to a person in the SAME tenant is accepted', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro', person)).toBe('ok');
    });
  });

  it('a CROSS-TENANT person_id is REFUSED by the database', async () => {
    await inRollback(async () => {
      await seedTenants();
      const personB = await newPerson(ORG_B);
      // 23503 — foreign_key_violation. The tenant leg of the composite makes
      // this unrepresentable; no application pre-check is involved.
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro', personB)).toBe('23503');
    });
  });

  it('a person_id naming nobody at all is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro',
        '00000000-0000-4000-8000-0000000000ff')).toBe('23503');
    });
  });

  it('deleting the person NULLS the anchor and LEAVES the task, its tenant and its lead intact', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', person);

      await db.query('DELETE FROM public.unified_persons WHERE id = $1', [person]);

      const { rows } = await db.query(
        'SELECT person_id, company_id, lead_id, plan_task_id FROM public.outreach_tasks WHERE id = $1', [taskId]);
      // The audit record survives a person erasure — the whole reason this is
      // SET NULL rather than CASCADE.
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBeNull();
      expect(rows[0].company_id).toBe(ORG_A);       // the tenant was NOT nulled
      expect(rows[0].lead_id).toBe('lead-1');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// What the retype must NOT have broken
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — WS-3 invariants survived the retype', () => {
  it('outreach_tasks_identity_unique still spans (company_id, lead_id, plan_task_id)', async () => {
    const def = await constraintDef('outreach_tasks_identity_unique');
    expect(def).toBe('UNIQUE (company_id, lead_id, plan_task_id)');
  });

  it('...and still enforces idempotency on a real duplicate', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro', null)).toBe('ok');
      await db.query(INSERT_TASK, [ORG_A, 'lead-1', 'task-1-intro', null]);
      // 23505 — unique_violation. A regenerated plan cannot re-send finished work.
      expect(await insertTask(ORG_A, 'lead-1', 'task-1-intro', null)).toBe('23505');
    });
  });

  it('the append-only triggers still REJECT update and delete', async () => {
    await inRollback(async () => {
      await seedTenants();
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', null);
      await db.query(
        `INSERT INTO public.outreach_decisions (company_id, task_id, gate, decision, decided_at)
         VALUES ($1, $2, 'suppression', 'allowed', now())`, [ORG_A, taskId]);

      // 23001 — `restrict_violation`, the ERRCODE ws3_reject_mutation raises.
      //
      // NOTE for whoever runs this first: every WS-3 UNIT test doubles this as
      // `2F004`. That is wrong — 2F004 is `reading_sql_data_not_permitted`,
      // while `USING ERRCODE = 'restrict_violation'` is class 23. Nothing in
      // production branches on the code, so the mistake is inert, but this is
      // the first assertion made against real PostgreSQL and it uses the code
      // PostgreSQL actually returns.
      expect(await attempt(
        `UPDATE public.outreach_decisions SET reason = 'rewritten' WHERE task_id = $1`, [taskId])).toBe('23001');
      expect(await attempt(
        `DELETE FROM public.outreach_decisions WHERE task_id = $1`, [taskId])).toBe('23001');
    });
  });

  it('the task provenance trigger still refuses an identity rewrite, and still permits person_id', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', null);

      // Identity and provenance remain immutable...
      expect(await attempt(
        `UPDATE public.outreach_tasks SET lead_id = 'lead-2' WHERE id = $1`, [taskId])).toBe('23001');

      // ...but the anchor is deliberately NOT part of that contract: a task may
      // legitimately be anchored after materialisation.
      expect(await attempt(
        `UPDATE public.outreach_tasks SET person_id = $2 WHERE id = $1`, [taskId, person])).toBe('ok');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract 13 — the recorded degradation
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — outreach_decisions records the identity it was evaluated against', () => {
  it('has the three identity columns, all nullable', async () => {
    const { rows } = await db.query(
      `SELECT attname, format_type(atttypid, atttypmod) t, attnotnull
         FROM pg_attribute
        WHERE attrelid='public.outreach_decisions'::regclass
          AND attname IN ('person_id','identity_anchor','identity_degraded')
        ORDER BY attname`);
    expect(rows.map((r: any) => [r.attname, r.t, r.attnotnull])).toEqual([
      ['identity_anchor', 'text', false],
      ['identity_degraded', 'boolean', false],
      ['person_id', 'uuid', false],
    ]);
  });

  it('carries NO foreign key on person_id — an audit row must outlive the person', async () => {
    // A referential action would fire ws3_reject_mutation and make the person
    // undeletable, which is exactly the trap this design avoids.
    const { rows } = await db.query(`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_class s ON s.oid = con.conrelid
      JOIN pg_class t ON t.oid = con.confrelid
      WHERE con.contype='f' AND s.relname='outreach_decisions' AND t.relname='unified_persons'`);
    expect(rows).toHaveLength(0);
  });

  it('refuses an identity_anchor outside the closed vocabulary', async () => {
    await inRollback(async () => {
      await seedTenants();
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', null);
      const ins = (anchor: string, degraded: boolean | null) => attempt(
        `INSERT INTO public.outreach_decisions
           (company_id, task_id, gate, decision, decided_at, identity_anchor, identity_degraded)
         VALUES ($1,$2,'suppression','allowed', now(), $3, $4)`, [ORG_A, taskId, anchor, degraded]);

      for (const good of ['explicit', 'task', 'lead', 'none']) {
        expect(await ins(good, good === 'none')).toBe('ok');
      }
      // 23514 — check_violation.
      expect(await ins('guessed', false)).toBe('23514');
    });
  });

  it('refuses an incoherent pair — degraded must mean exactly "no anchor"', async () => {
    await inRollback(async () => {
      await seedTenants();
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', null);
      const ins = (anchor: string, degraded: boolean) => attempt(
        `INSERT INTO public.outreach_decisions
           (company_id, task_id, gate, decision, decided_at, identity_anchor, identity_degraded)
         VALUES ($1,$2,'suppression','allowed', now(), $3, $4)`, [ORG_A, taskId, anchor, degraded]);

      expect(await ins('lead', true)).toBe('23514');   // resolved but claims degraded
      expect(await ins('none', false)).toBe('23514');  // unresolved but claims not
    });
  });

  it('a pre-A3 decision may leave all three null — absence of information, not a claim', async () => {
    await inRollback(async () => {
      await seedTenants();
      const taskId = await insertTaskReturning(ORG_A, 'lead-1', 'task-1-intro', null);
      expect(await attempt(
        `INSERT INTO public.outreach_decisions (company_id, task_id, gate, decision, decided_at)
         VALUES ($1,$2,'suppression','allowed', now())`, [ORG_A, taskId])).toBe('ok');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Convergence — nothing was dropped
// ───────────────────────────────────────────────────────────────────────────

describe('A3 — neither legacy suppression table was dropped', () => {
  it.each(['suppression_entries', 'outreach_suppressions'])('%s still exists', async (table) => {
    const { rows } = await db.query(`SELECT to_regclass('public.' || $1) r`, [table]);
    expect(rows[0].r).not.toBeNull();
  });

  it('contact_governance_records is present and is the canonical store', async () => {
    const { rows } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND attname='organization_id'`);
    expect(rows[0].t).toBe('uuid');
  });
});
