/**
 * A6-10 option B (20270113000000) — outreach_bridge_handoffs.person_id is
 * ON DELETE SET NULL, guarded so that only the FK action for an already-deleted
 * person can clear it. Against real PostgreSQL.
 *
 * Not production evidence: a disposable database built from the committed
 * baseline plus replayed migrations of this tree.
 *
 * Fixture: execution-chain parents are inserted in replica mode (the 036/037
 * substrate's own guards are not under test here); the handoffs and legacy
 * outreach_tasks are created through the REAL bridge_execution_task with
 * triggers and FKs on.
 */
import { randomUUID } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newLead } from './setup';

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

/** As service_role (PostgREST's server-key role), keeping the effect; returns 'ok' or SQLSTATE. */
async function asServiceRole(sql: string, params: unknown[] = [], keep = false): Promise<string> {
  await db.query('SAVEPOINT sr');
  try {
    await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', true)`);
    await db.query('SET LOCAL ROLE service_role');
    await db.query(sql, params);
    await db.query('RESET ROLE');
    await db.query(keep ? 'RELEASE SAVEPOINT sr' : 'ROLLBACK TO SAVEPOINT sr');
    return 'ok';
  } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT sr');
    return e.code ?? 'unknown';
  }
}

/** Grant service_role what the Supabase default privileges grant it, inside the test transaction. */
async function grantServiceRole(): Promise<void> {
  for (const t of ['unified_persons', 'outreach_bridge_handoffs', 'outreach_tasks', 'leads', 'canonical_leads',
    'identity_claims', 'contact_governance_records', 'execution_tasks']) {
    await db.query(`GRANT ALL ON public.${t} TO service_role`);
  }
}

/** Execution-chain parents + one prepared task per run, for subject (kind, id). Returns the task ids. */
async function chain(org: string, kind: 'lead' | 'prospect', subject: string, runs: number): Promise<string[]> {
  const tasks: string[] = [];
  await db.query('SET LOCAL session_replication_role = replica');
  const wf = randomUUID(); const ver = randomUUID();
  await db.query('INSERT INTO public.workflows (id, organization_id, name) VALUES ($1,$2,$3)', [wf, org, `wf ${wf.slice(0, 6)}`]);
  await db.query('INSERT INTO public.workflow_versions (id, organization_id, workflow_id, version) VALUES ($1,$2,$3,1)', [ver, org, wf]);
  for (let i = 0; i < runs; i++) {
    const camp = randomUUID(); const inst = randomUUID(); const plan = randomUUID(); const step = randomUUID(); const task = randomUUID();
    await db.query('INSERT INTO public.prospect_campaigns (id, organization_id, name) VALUES ($1,$2,$3)', [camp, org, `camp ${i}`]);
    await db.query(`INSERT INTO public.execution_instances (id, organization_id, campaign_id, workflow_id, workflow_version_id, subject_kind, subject_id, lifecycle_state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`, [inst, org, camp, wf, ver, kind, subject]);
    await db.query(`INSERT INTO public.execution_plans (id, organization_id, execution_instance_id, workflow_version_id, definition_snapshot, step_count)
      VALUES ($1,$2,$3,$4,'{}'::jsonb,1)`, [plan, org, inst, ver]);
    await db.query(`INSERT INTO public.execution_plan_steps (id, organization_id, plan_id, step_key, step_order, channel, delay_after_previous_hours)
      VALUES ($1,$2,$3,'s1',1,'email',0)`, [step, org, plan]);
    await db.query(`INSERT INTO public.execution_tasks (id, organization_id, execution_instance_id, plan_step_id, subject_kind, subject_id, channel, action,
      delay_after_previous_hours, requires_approval, state) VALUES ($1,$2,$3,$4,$5,$6,'email','send_email',0,true,'prepared')`,
    [task, org, inst, step, kind, subject]);
    tasks.push(task);
  }
  await db.query('SET LOCAL session_replication_role = origin');
  return tasks;
}

const BRIDGE = `SELECT public.bridge_execution_task($1,$2,$3,'human',true,'authored','wf-bridge-1.0.0','t','g','r') id`;

async function bridgedProspectPerson(org: string, runs: number): Promise<{ p: string; prospect: string; handoffs: string[]; tasks: string[] }> {
  const p = await newPerson(org);
  const prospect = await newLead(org, { personId: p });
  const tasks = await chain(org, 'prospect', prospect, runs);
  const handoffs: string[] = [];
  for (const t of tasks) handoffs.push((await one(BRIDGE, [org, t, p])).id);
  return { p, prospect, handoffs, tasks };
}

const snapWithoutPerson = async (ids: string[]) => (await db.query(
  `SELECT id, to_jsonb(h) - 'person_id' j, person_id FROM public.outreach_bridge_handoffs h WHERE id = ANY($1) ORDER BY id`, [ids])).rows;

describe('A6-10 option B — schema', () => {
  it('person_id nullable, FK ON DELETE SET NULL, guard still SECURITY INVOKER and enabled', async () => {
    expect((await one(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public'
      AND table_name='outreach_bridge_handoffs' AND column_name='person_id'`)).is_nullable).toBe('YES');
    expect((await one(`SELECT confdeltype FROM pg_constraint WHERE conname='outreach_bridge_handoffs_person_fk'`)).confdeltype).toBe('n');
    const g = await one(`SELECT p.prosecdef, t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgname='trg_outreach_bridge_handoffs_guard'`);
    expect(g).toEqual({ prosecdef: false, tgenabled: 'O' });
  });
});

describe('A6-10 option B — erasing a bridged person', () => {
  it('MULTIPLE handoffs: the delete (as service_role) keeps all of them, person_id NULL, every other column identical', async () => {
    await inRollback(async () => {
      await seedTenants();
      await grantServiceRole();
      const s = await bridgedProspectPerson(ORG_A, 3);
      const before = await snapWithoutPerson(s.handoffs);
      expect(before.every((r: any) => r.person_id === s.p)).toBe(true);
      expect(await asServiceRole('DELETE FROM public.unified_persons WHERE id=$1 AND company_id=$2', [s.p, ORG_A], true)).toBe('ok');
      const after = await snapWithoutPerson(s.handoffs);
      expect(after).toHaveLength(3);
      expect(after.every((r: any) => r.person_id === null)).toBe(true);
      expect(after.map((r: any) => r.j)).toEqual(before.map((r: any) => r.j));
      // the legacy tasks survive the same way (house rule, 20261011000000)
      expect(await count(`SELECT count(*) n FROM public.outreach_tasks t JOIN public.outreach_bridge_handoffs h ON h.outreach_task_id=t.id
        WHERE h.id = ANY($1) AND t.person_id IS NULL`, [s.handoffs])).toBe(3);
    });
  });

  it('TENANT ISOLATION: tenant B\'s handoffs are byte-identical after tenant A\'s erasure; A cannot delete B\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      await grantServiceRole();
      const a = await bridgedProspectPerson(ORG_A, 2);
      const b = await bridgedProspectPerson(ORG_B, 2);
      const beforeB = (await db.query(`SELECT to_jsonb(h) j FROM public.outreach_bridge_handoffs h WHERE organization_id=$1 ORDER BY id`, [ORG_B])).rows;
      // tenant-first delete scoped to A cannot reach B's person
      await asServiceRole('DELETE FROM public.unified_persons WHERE id=$1 AND company_id=$2', [b.p, ORG_A], true);
      expect(await count('SELECT count(*) n FROM public.unified_persons WHERE id=$1', [b.p])).toBe(1);
      await asServiceRole('DELETE FROM public.unified_persons WHERE id=$1 AND company_id=$2', [a.p, ORG_A], true);
      const afterB = (await db.query(`SELECT to_jsonb(h) j FROM public.outreach_bridge_handoffs h WHERE organization_id=$1 ORDER BY id`, [ORG_B])).rows;
      expect(afterB).toEqual(beforeB);
      // a handoff can still never cross tenants (existing guard)
      expect(await attempt(BRIDGE, [ORG_B, a.tasks[0], b.p])).not.toBe('ok');
    });
  });

  it('IDEMPOTENT RETRIES: re-bridging a bridged task is refused before and after erasure; a repeated delete is a no-op', async () => {
    await inRollback(async () => {
      await seedTenants();
      await grantServiceRole();
      const s = await bridgedProspectPerson(ORG_A, 1);
      expect(await attempt(BRIDGE, [ORG_A, s.tasks[0], s.p])).toBe('23505');
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [s.p]);
      const r2 = await db.query('DELETE FROM public.unified_persons WHERE id=$1', [s.p]);
      expect(r2.rowCount).toBe(0);
      const other = await newPerson(ORG_A);
      expect(await attempt(BRIDGE, [ORG_A, s.tasks[0], other])).toBe('23505');
      expect(await count('SELECT count(*) n FROM public.outreach_bridge_handoffs WHERE execution_task_id=$1', [s.tasks[0]])).toBe(1);
    });
  });

  it('LIVE-PERSON PROTECTION: nobody can clear person_id of a live person, or change any other column', async () => {
    await inRollback(async () => {
      await seedTenants();
      await grantServiceRole();
      const s = await bridgedProspectPerson(ORG_A, 1);
      const h = s.handoffs[0];
      expect(await attempt('UPDATE public.outreach_bridge_handoffs SET person_id=NULL WHERE id=$1', [h])).not.toBe('ok');
      expect(await asServiceRole('UPDATE public.outreach_bridge_handoffs SET person_id=NULL WHERE id=$1', [h])).not.toBe('ok');
      const other = await newPerson(ORG_A);
      expect(await attempt('UPDATE public.outreach_bridge_handoffs SET person_id=$2 WHERE id=$1', [h, other])).not.toBe('ok');
      expect(await attempt(`UPDATE public.outreach_bridge_handoffs SET policy_source='legacy_default' WHERE id=$1`, [h])).not.toBe('ok');
      // nested (trigger depth > 1) but the person is ALIVE: still refused
      await db.query(`CREATE FUNCTION pg_temp.nested_clear() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE public.outreach_bridge_handoffs SET person_id=NULL WHERE person_id=NEW.id; RETURN NEW; END $$`);
      await db.query(`CREATE TRIGGER zz_nested AFTER UPDATE ON public.unified_persons FOR EACH ROW EXECUTE FUNCTION pg_temp.nested_clear()`);
      expect(await attempt('UPDATE public.unified_persons SET updated_at=now() WHERE id=$1', [s.p])).not.toBe('ok');
      await db.query('DROP TRIGGER zz_nested ON public.unified_persons');
      expect((await one('SELECT person_id FROM public.outreach_bridge_handoffs WHERE id=$1', [h])).person_id).toBe(s.p);
      // INSERT still requires a person (guard) and the bridge still refuses a NULL person
      const t2 = (await chain(ORG_A, 'prospect', s.prospect, 1))[0];
      expect(await attempt(BRIDGE, [ORG_A, t2, null])).toBe('P0001');
      // once erased, the row is immutable again (NULL -> person refused)
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [s.p]);
      expect(await attempt('UPDATE public.outreach_bridge_handoffs SET person_id=$2 WHERE id=$1', [h, other])).not.toBe('ok');
    });
  });

  it('a LEAD-kind bridged person on this base is still blocked by leads.unified_person_id NOT NULL (fixed on main by privacy/erasure-remediation)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const lead = (await one(`INSERT INTO public.leads (company_id, name, email, unified_person_id) VALUES ($1,'L','l@example.test',$2) RETURNING id`, [ORG_A, p])).id;
      const tasks = await chain(ORG_A, 'lead', lead, 1);
      await one(BRIDGE, [ORG_A, tasks[0], p]);
      const nn = await one(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='unified_person_id'`);
      if (nn.is_nullable === 'NO') {
        expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('23502');
      } else {
        // after the rebase onto privacy/erasure-remediation the plain delete is refused by leads_person_or_erased
        expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('23514');
      }
    });
  });
});
