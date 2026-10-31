/**
 * SEC A2 — opportunity trigger-function hardening against real PostgreSQL.
 *
 * Migration exercised: 20270111000001_pi_opportunity_trigger_fn_hardening.sql
 * (REVOKE ALL FROM PUBLIC, anon, authenticated on the three opportunity
 * trigger functions; search_path pinned on trg_opp_lifecycle_block_mutation),
 * on top of 20260520 (lifecycle append-only) and 20270109000003 (snooze guard,
 * append-only dispositions).
 *
 * A green run concerns a disposable database built from the committed baseline
 * plus replayed migrations. It is NOT evidence about production.
 *
 * ROLES. The replay does not reproduce Supabase's table default privileges, so
 * each test grants service_role what production gives it on public tables
 * (arwdDxtm, coordinator evidence #15) INSIDE the rolled-back transaction, then
 * acts as service_role with SET LOCAL ROLE. Nothing persists.
 */

import { db, inRollback, seedTenants, ORG_A } from './setup';

const FNS = [
  'trg_opp_disposition_block_mutation',
  'trg_opp_disposition_snooze_guard',
  'trg_opp_lifecycle_block_mutation',
] as const;

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const rnd = () => Math.random().toString(36).slice(2, 10);

/** Run sql; return 'ok' or `${sqlstate}|${constraint}|${message}`. Savepoint keeps the txn usable. */
async function outcome(sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT a2');
  try {
    await q(sql, params);
    await q('RELEASE SAVEPOINT a2');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT a2');
    return `${e.code}|${e.constraint ?? ''}|${e.message}`;
  }
}

async function feed(org: string): Promise<string> {
  const { rows: s } = await q(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1,'listening',$2,'reddit',now(),'sec-a2') RETURNING id`, [org, `a2-${rnd()}`]);
  const { rows } = await q(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform)
     VALUES ($1,$2,'buying_intent','sec-a2','reddit') RETURNING id`, [org, s[0].id]);
  return rows[0].id;
}

/** One live item (detected, one disposition) and one archived item. Superuser fixtures. */
async function fixtures(): Promise<{ live: string; archived: string }> {
  await seedTenants();
  const live = await feed(ORG_A);
  const archived = await feed(ORG_A);
  for (const item of [live, archived]) {
    await q(`INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, is_initial)
             VALUES ($1,$2,'detected',TRUE)`, [ORG_A, item]);
  }
  await q(`INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, previous_state, transitioned_at)
           VALUES ($1,$2,'archived','detected', now() + interval '1 second')`, [ORG_A, archived]);
  await q(`INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition)
           VALUES ($1,$2,'qualified')`, [ORG_A, live]);
  // Production table privileges for service_role (Supabase default, evidence #15).
  await q('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role');
  return { live, archived };
}

/** The refusals every write path relies on, exercised as service_role. */
async function assertGuardsHold(live: string, archived: string): Promise<void> {
  await q('SET LOCAL ROLE service_role');
  try {
    expect(await outcome(`UPDATE public.opportunity_lifecycle_states SET reasoning = 'x' WHERE opportunity_feed_item_id = $1`, [live]))
      .toMatch(/^P0001\|\|opportunity_lifecycle_states is append-only$/);
    expect(await outcome(`DELETE FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`, [live]))
      .toMatch(/^P0001\|\|opportunity_lifecycle_states is append-only$/);
    expect(await outcome(`UPDATE public.opportunity_dispositions SET disposition = 'dismissed' WHERE opportunity_feed_item_id = $1`, [live]))
      .toMatch(/^42501\|\|opportunity_dispositions is append-only \(UPDATE refused\)$/);
    expect(await outcome(`DELETE FROM public.opportunity_dispositions WHERE opportunity_feed_item_id = $1`, [live]))
      .toMatch(/^42501\|\|opportunity_dispositions is append-only \(DELETE refused\)$/);
    expect(await outcome(
      `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until)
       VALUES ($1,$2,'revisit_later', now() + interval '1 day')`, [ORG_A, archived]))
      .toMatch(/^23514\|opp_disposition_snooze_not_terminal\|opp_disposition_snooze_not_terminal: /);
    // Still admitted: a snooze on a live opportunity, and appending lifecycle history.
    expect(await outcome(
      `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until)
       VALUES ($1,$2,'revisit_later', now() + interval '1 day')`, [ORG_A, live])).toBe('ok');
    expect(await outcome(
      `INSERT INTO public.opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, state, previous_state, transitioned_at)
       VALUES ($1,$2,'triaged','detected', now() + interval '2 seconds')`, [ORG_A, live])).toBe('ok');
    // And nothing was mutated by the refused statements.
    const { rows } = await q(
      // pg_catalog.texteq, not `=`: one test plants a hostile `=` on the session path.
      `SELECT count(*) FILTER (WHERE pg_catalog.texteq(reasoning, 'x'))::int AS touched,
              count(*)::int AS n
         FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`, [live]);
    expect(rows[0]).toEqual({ touched: 0, n: 2 });
  } finally {
    await q('RESET ROLE');
  }
}

describe('catalog end state', () => {
  it('all three are SECURITY INVOKER trigger functions pinned to search_path = pg_catalog, public', async () => {
    const { rows } = await q(
      `SELECT proname, prosecdef, proconfig, prorettype = 'trigger'::regtype AS is_trigger
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) AND pronargs = 0
        ORDER BY proname`, [FNS]);
    expect(rows).toEqual(FNS.map((proname) => ({
      proname, prosecdef: false, proconfig: ['search_path=pg_catalog, public'], is_trigger: true,
    })));
  });

  // service_role/postgres EXECUTE is deliberately NOT asserted: in production they
  // keep it (Supabase default privileges), in this replay nobody grants it, and
  // firing a trigger never checks it (proved below).
  it('PUBLIC, anon and authenticated hold no EXECUTE', async () => {
    const { rows } = await q(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0)                             AS public_grant
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) AND p.pronargs = 0
        ORDER BY p.proname`, [FNS]);
    expect(rows).toEqual(FNS.map((proname) => ({
      proname, anon: false, authenticated: false, public_grant: false,
    })));
  });

  it('the five opportunity triggers still use these functions and are enabled', async () => {
    const { rows } = await q(
      `SELECT c.relname, t.tgname, p.proname, t.tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND p.proname = ANY($1)
        ORDER BY c.relname, t.tgname`, [FNS]);
    expect(rows).toEqual([
      { relname: 'opportunity_dispositions', tgname: 'opp_disposition_block_delete', proname: 'trg_opp_disposition_block_mutation', tgenabled: 'O' },
      { relname: 'opportunity_dispositions', tgname: 'opp_disposition_block_update', proname: 'trg_opp_disposition_block_mutation', tgenabled: 'O' },
      { relname: 'opportunity_dispositions', tgname: 'opp_disposition_snooze_guard', proname: 'trg_opp_disposition_snooze_guard', tgenabled: 'O' },
      { relname: 'opportunity_lifecycle_states', tgname: 'opp_lifecycle_block_delete', proname: 'trg_opp_lifecycle_block_mutation', tgenabled: 'O' },
      { relname: 'opportunity_lifecycle_states', tgname: 'opp_lifecycle_block_update', proname: 'trg_opp_lifecycle_block_mutation', tgenabled: 'O' },
    ]);
  });
});

describe('direct invocation', () => {
  it.each(FNS)('anon and authenticated are refused EXECUTE on %s (42501)', async (fn) => {
    await inRollback(async () => {
      for (const role of ['anon', 'authenticated']) {
        await q(`SET LOCAL ROLE ${role}`);
        expect(await outcome(`SELECT public.${fn}()`)).toMatch(/^42501\|\|permission denied for function /);
        await q('RESET ROLE');
      }
    });
  });

  it.each(FNS)('even holding EXECUTE (test superuser), %s cannot be called outside a trigger (0A000)', async (fn) => {
    await inRollback(async () => {
      expect(await outcome(`SELECT public.${fn}()`)).toBe('0A000||trigger functions can only be called as triggers');
    });
  });
});

describe('the guards still fire for service_role', () => {
  it('append-only lifecycle + dispositions and the snooze-terminal guard refuse as before', async () => {
    await inRollback(async () => {
      const { live, archived } = await fixtures();
      await assertGuardsHold(live, archived);
    });
  });

  it('EXECUTE is not checked when a trigger fires: the guards hold with EXECUTE revoked from every role', async () => {
    await inRollback(async () => {
      const { live, archived } = await fixtures();
      for (const fn of FNS) {
        await q(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated, service_role`);
      }
      const { rows } = await q(
        `SELECT bool_or(has_function_privilege('service_role', oid, 'EXECUTE')) AS any_exec
           FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [FNS]);
      expect(rows[0].any_exec).toBe(false);
      await assertGuardsHold(live, archived);
    });
  });

  it('a hostile session search_path cannot redirect the lifecycle guard (pinned)', async () => {
    await inRollback(async () => {
      const { live, archived } = await fixtures();
      // An operator that makes TG_OP = 'UPDATE' false would turn the refusal into
      // a silent RETURN NULL if the function resolved `=` via the caller's path.
      await q('CREATE SCHEMA sec_a2_hostile');
      await q(`CREATE FUNCTION sec_a2_hostile.never(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`);
      await q('CREATE OPERATOR sec_a2_hostile.= (LEFTARG = text, RIGHTARG = text, FUNCTION = sec_a2_hostile.never)');
      await q('GRANT USAGE ON SCHEMA sec_a2_hostile TO service_role');
      await q(`SET LOCAL search_path = sec_a2_hostile, pg_catalog, public`);
      await assertGuardsHold(live, archived);
    });
  });
});
