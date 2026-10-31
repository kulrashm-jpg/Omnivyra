/**
 * OWNER-SELECTABLE (20270112000005) — outreach_decisions.person_id is nulled
 * inside the erasure transaction; outreach_decisions stays append-only for
 * everything else. Disposable database only. Drop this file with its migration.
 */
import { randomUUID } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

async function decision(org: string, person: string): Promise<string> {
  const task = (await one(`INSERT INTO public.outreach_tasks (company_id, lead_id, plan_task_id, person_id, planner_version,
      translation_version, governance_version, execution_runtime_version, materialized_at)
    VALUES ($1,$2,$3,$4,'p','t','g','r',now()) RETURNING id`, [org, randomUUID(), randomUUID(), person])).id;
  return (await one(`INSERT INTO public.outreach_decisions (company_id, task_id, gate, decision, decided_at, person_id, identity_anchor, identity_degraded)
    VALUES ($1,$2,'suppression','denied',now(),$3,'task',false) RETURNING id`, [org, task, person])).id;
}

async function erase(org: string, person: string): Promise<any> {
  const r = (await one(`SELECT public.pi_person_erasure_open($1,$2,'dsar','test') r`, [org, person])).r;
  for (const step of ['governance_reanchored', 'governance_revoked', 'evidence_links_cleared']) {
    await db.query('SELECT public.pi_person_erasure_mark($1,$2,$3,$4,0,NULL)', [org, r.request_id, r.lease_token, step]);
  }
  return (await one('SELECT public.pi_person_erasure_finalize($1,$2,$3) r', [org, r.request_id, r.lease_token])).r;
}

describe('outreach_decisions person reference — owner-selectable nulling at erasure', () => {
  it('J1 ER-1: ws3_reject_mutation keeps the SEC-B search_path pin (pg_catalog, public) and stays SECURITY INVOKER', async () => {
    const f = await one(`SELECT proconfig, prosecdef FROM pg_proc WHERE oid = 'public.ws3_reject_mutation()'::regprocedure`);
    expect(f.proconfig).toEqual(['search_path=pg_catalog, public']);
    expect(f.prosecdef).toBe(false);
  });

  it('the erased person\'s decisions lose person_id only; everything else identical; others untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const other = await newPerson(ORG_A);
      const pb = await newPerson(ORG_B);
      const d1 = await decision(ORG_A, p);
      const d2 = await decision(ORG_A, p);
      const dOther = await decision(ORG_A, other);
      const dB = await decision(ORG_B, pb);
      const snap = async (id: string) => (await one('SELECT to_jsonb(d) j FROM public.outreach_decisions d WHERE id=$1', [id])).j;
      const [s1, sO, sB] = [await snap(d1), await snap(dOther), await snap(dB)];
      const r = await erase(ORG_A, p);
      expect(r.finalize_counts).toMatchObject({ outreach_decision_person_ref: 'null', outreach_decisions_unlinked: 2 });
      const a1 = await snap(d1);
      expect(a1.person_id).toBeNull();
      const { person_id: _a, ...restAfter } = a1; const { person_id: _b, ...restBefore } = s1;
      expect(restAfter).toEqual(restBefore);
      expect((await snap(d2)).person_id).toBeNull();
      expect(await snap(dOther)).toEqual(sO);
      expect(await snap(dB)).toEqual(sB);
    });
  });

  it('append-only is unchanged for every other write: superuser and service_role, update and delete', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const d = await decision(ORG_A, p);
      expect(await attempt('UPDATE public.outreach_decisions SET person_id=NULL WHERE id=$1', [d])).toBe('23001');
      expect(await attempt(`UPDATE public.outreach_decisions SET reason='x' WHERE id=$1`, [d])).toBe('23001');
      expect(await attempt('DELETE FROM public.outreach_decisions WHERE id=$1', [d])).toBe('23001');
      await db.query('GRANT ALL ON public.outreach_decisions TO service_role');
      await db.query('SAVEPOINT sr');
      await db.query('SET LOCAL ROLE service_role');
      let code = 'ok';
      try { await db.query('UPDATE public.outreach_decisions SET person_id=NULL WHERE id=$1', [d]); } catch (e: any) { code = e.code; }
      await db.query('ROLLBACK TO SAVEPOINT sr');
      expect(code).toBe('23001');
      // authorized for the person, but bundled with another change: refused
      await db.query(`SELECT public.pi_erasure_authorize('outreach_decisions',$1,$2)`, [ORG_A, p]);
      expect(await attempt(`UPDATE public.outreach_decisions SET person_id=NULL, reason='x' WHERE id=$1`, [d])).toBe('23001');
      expect(await attempt('DELETE FROM public.outreach_decisions WHERE id=$1', [d])).toBe('23001');
    });
  });
});
