/**
 * Orchestration, owner #12 step 7(a): migration 20270129000004 pins `search_path = public, pg_temp` on
 * the three trigger guard functions, on REAL PostgreSQL after a full replay.
 *
 * Proven here:
 *   - each function carries exactly that one setting and stays SECURITY INVOKER;
 *   - each guard still refuses exactly what it refused before (bodies unchanged), also under a
 *     hostile session search_path;
 *   - NEGATIVE CONTROL: the same postcondition check RAISES for a function without the setting,
 *     so the migration's postcondition is not vacuous.
 */
import { db, inRollback, seedTenants, attempt, ORG_A } from './setup';
import { enableOutreach, enrol, humanStep, newProspect, newUser, one } from './helpers/journeyFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');

const GUARDS = [
  'public.execution_engine_requests_guard()',
  'public.prospect_campaigns_targeting_guard()',
  'public.prospect_campaign_targets_guard()',
];

/** The migration's postcondition, as a statement over any list of functions. */
const POSTCONDITION = (fns: string[]) => `DO $$
DECLARE f text; cfg text[]; secdef boolean;
BEGIN
  FOREACH f IN ARRAY ARRAY[${fns.map((x) => `'${x}'`).join(', ')}] LOOP
    SELECT p.proconfig, p.prosecdef INTO cfg, secdef FROM pg_proc p WHERE p.oid = f::regprocedure;
    IF cfg IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'postcondition: % has proconfig %', f, cfg;
    END IF;
    IF secdef THEN RAISE EXCEPTION 'postcondition: % must stay SECURITY INVOKER', f; END IF;
  END LOOP;
END $$;`;

/** A person with one WhatsApp journey (campaign, selected target, run, task). */
async function journey() {
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  const actor = await newUser();
  const { prospectId } = await newProspect(ORG_A, { phone: '+15551234567' });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: new Date().toISOString() });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('wa', 'whatsapp', { whatsapp: { template_name: 'hello_1' } })] });
  const run = await one('SELECT campaign_id FROM public.execution_instances WHERE id = $1', [instanceId]);
  const task = await one('SELECT id FROM public.execution_tasks WHERE organization_id = $1 AND execution_instance_id = $2', [ORG_A, instanceId]);
  return { campaignId: String(run.campaign_id), taskId: String(task.id) };
}

/** Attempt a statement; 'ok', or the SQLSTATE plus the guard's leading message word (so a guard is told from a CHECK). */
async function attemptWhy(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT w');
  try {
    await db.query(sql, params);
    await db.query('ROLLBACK TO SAVEPOINT w');
    return 'ok';
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT w');
    return `${err.code}:${String(err.message).split(/[: ]/)[0]}`;
  }
}

/** Each guard's refusals. Must be identical before and after the setting. */
async function guardRefusals(j: { campaignId: string; taskId: string }) {
  const req = String((await one(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state)
    VALUES ($1, $2, 'whatsapp', 'requested') RETURNING id`, [ORG_A, j.taskId])).id);
  await db.query(`UPDATE public.execution_engine_requests SET state = 'submitting' WHERE id = $1`, [req]);
  await db.query(`UPDATE public.execution_engine_requests SET state = 'uncertain', external_ref = 'b-1' WHERE id = $1`, [req]);
  return {
    settledMoves: await attemptWhy(`UPDATE public.execution_engine_requests SET state = 'failed' WHERE id = $1`, [req]),
    refRewritten: await attemptWhy(`UPDATE public.execution_engine_requests SET external_ref = 'b-2' WHERE id = $1`, [req]),
    identityMoves: await attemptWhy(`UPDATE public.execution_engine_requests SET engine = 'community' WHERE id = $1`, [req]),
    targetingLocked: await attemptWhy(`UPDATE public.prospect_campaigns SET min_icp_score = 0.5 WHERE id = $1`, [j.campaignId]),
    targetImmutable: await attemptWhy(`UPDATE public.prospect_campaign_targets SET selected_at = now() WHERE campaign_id = $1`, [j.campaignId]),
    unrelatedEditAllowed: await attemptWhy(`UPDATE public.prospect_campaigns SET name = name || ' (renamed)' WHERE id = $1`, [j.campaignId]),
  };
}
const EXPECTED = {
  settledMoves: '23514:execution_engine_requests', refRewritten: '23514:execution_engine_requests',
  identityMoves: '23514:execution_engine_requests', targetingLocked: '23514:campaign_targeting_locked',
  targetImmutable: '23514:prospect_campaign_targets', unrelatedEditAllowed: 'ok',
};

describe('20270129000004: guard functions pin their search_path', () => {
  it('each guard carries exactly search_path=public, pg_temp and stays SECURITY INVOKER (the migration postcondition holds)', async () => {
    for (const f of GUARDS) {
      const r = await one(`SELECT p.proconfig, p.prosecdef FROM pg_proc p WHERE p.oid = $1::regprocedure`, [f]);
      expect({ f, proconfig: r.proconfig, secdef: r.prosecdef }).toEqual({ f, proconfig: ['search_path=public, pg_temp'], secdef: false });
    }
    await expect(db.query(POSTCONDITION(GUARDS))).resolves.toBeDefined();
  });

  it('NEGATIVE CONTROL: the same postcondition RAISES for a function without the setting (not vacuous)', async () => {
    await inRollback(async () => {
      await db.query(`CREATE FUNCTION public.zz_search_path_negative_control() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$`);
      expect(await attempt(POSTCONDITION(['public.zz_search_path_negative_control()']))).toBe('P0001');
      expect(await attempt(POSTCONDITION([...GUARDS, 'public.zz_search_path_negative_control()']))).toBe('P0001');
      await db.query(`ALTER FUNCTION public.zz_search_path_negative_control() SET search_path = public, pg_temp`);
      expect(await attempt(POSTCONDITION(['public.zz_search_path_negative_control()']))).toBe('ok');
    });
  });

  it('each guard still refuses exactly what it refused before (bodies unchanged)', async () => {
    await inRollback(async () => {
      expect(await guardRefusals(await journey())).toEqual(EXPECTED);
    });
  });

  it('under a hostile session search_path the guards behave the same (the pinned setting wins)', async () => {
    await inRollback(async () => {
      const j = await journey();
      await db.query(`CREATE SCHEMA zz_hostile`);
      await db.query(`SET LOCAL search_path = zz_hostile, pg_catalog, public`);
      expect(await guardRefusals(j)).toEqual(EXPECTED);
    });
  });

  it('the rollback returns each function to no setting, and re-applying restores it', async () => {
    await inRollback(async () => {
      for (const f of GUARDS) await db.query(`ALTER FUNCTION ${f} RESET search_path`);
      expect(await attempt(POSTCONDITION(GUARDS))).toBe('P0001');
      for (const f of GUARDS) await db.query(`ALTER FUNCTION ${f} SET search_path = public, pg_temp`);
      expect(await attempt(POSTCONDITION(GUARDS))).toBe('ok');
    });
  });
});
