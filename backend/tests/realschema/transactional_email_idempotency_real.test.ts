/**
 * Transactional email idempotency on REAL PostgreSQL (migration transactional_email_idempotency). Holds the SQL to
 * the same state machine as idempotency.ts's unit fake (transactionalEmailIdempotency.test.ts):
 *   reserve -> 'reserved' once; a second reserve -> duplicate (in flight / sent / uncertain);
 *   an expired 'sent' key is taken over; an 'uncertain' key only after its LONGER window, max(type TTL, 7 days)
 *   from when it became uncertain (e9 ruling) - and reserve / mark_uncertain report when that is (frees_at);
 *   a 'sending' reservation past the stale bound -> 'uncertain' (stale_marked_uncertain), not reopened in-window;
 *   confirm / release / mark_uncertain move ONLY a 'sending' row;
 *   transactional_email_resolve_uncertain: an operator's audited decision on an uncertain row only.
 * Single connection, every case rolled back. The two-connection race is in
 * transactional_email_idempotency_concurrency_real.
 */
import { db, inRollback } from './setup';

const H = 'a'.repeat(64);
async function reserve(key: string, ttl = 3600, stale = 900): Promise<{ outcome: string; message_id: string | null }> {
  const { rows } = await db.query(`SELECT outcome, message_id FROM public.transactional_email_reserve($1, 'team_invite', $2, $3, $4)`, [key, H, ttl, stale]);
  return rows[0];
}
/** frees_at, compared to the transaction's now() IN SQL (an instant, never a formatted string). */
async function reserveFrees(key: string, ttl = 3600): Promise<{ outcome: string; frees_null: boolean; frees_minus_now: string | null }> {
  const { rows } = await db.query(
    `SELECT outcome, frees_at IS NULL AS frees_null, (frees_at - now())::text AS frees_minus_now
       FROM public.transactional_email_reserve($1, 'team_invite', $2, $3, 900)`, [key, H, ttl]);
  return rows[0];
}
const resolve = (key: string, resolution: string, actor: string) => call('transactional_email_resolve_uncertain', [key, resolution, actor]);
const audit = async (key: string) => (await db.query(
  `SELECT prior_state, resolution, actor, resolved_at = now() AS at_now FROM public.transactional_email_resolutions WHERE idempotency_key = $1 ORDER BY resolved_at`, [key])).rows;
const call = async (fn: string, args: unknown[]): Promise<boolean | null> =>
  (await db.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS ok`, args)).rows[0].ok;
const stateOf = async (key: string) => (await db.query(`SELECT state, provider_message_id FROM public.transactional_email_sends WHERE idempotency_key = $1`, [key])).rows[0] ?? null;
const age = (key: string, sql: string) => db.query(`UPDATE public.transactional_email_sends SET ${sql} WHERE idempotency_key = $1`, [key]);

it('reserve once; a second reserve while sending is in flight; after confirm it is a duplicate SENT with the message id', async () => {
  await inRollback(async () => {
    expect(await reserve('k1')).toEqual({ outcome: 'reserved', message_id: null });
    expect(await reserve('k1')).toEqual({ outcome: 'duplicate_inflight', message_id: null });
    expect(await call('transactional_email_confirm', ['k1', 'mid-1'])).toBe(true);
    expect(await reserve('k1')).toEqual({ outcome: 'duplicate_sent', message_id: 'mid-1' });
  });
});

it('a DEFINITE failure releases the reservation: the next reserve reserves again (retryable)', async () => {
  await inRollback(async () => {
    await reserve('k2');
    expect(await call('transactional_email_release', ['k2'])).toBe(true);
    expect(await stateOf('k2')).toBeNull();
    expect((await reserve('k2')).outcome).toBe('reserved');
  });
});

it('reserve answers exactly (outcome, message_id, frees_at)', async () => {
  const { rows: r } = await db.query(`SELECT pg_get_function_result('public.transactional_email_reserve(text, text, text, integer, integer)'::regprocedure) AS res`);
  expect(r[0].res).toBe('TABLE(outcome text, message_id text, frees_at timestamp with time zone)');
});

it('an UNCERTAIN send: within max(type TTL, 7 days) never reserved again; the answer says when it frees; after it, reserved', async () => {
  await inRollback(async () => {
    await reserve('k3'); // team_invite TTL 1h: the 7-day floor rules
    const { rows } = await db.query(`SELECT (public.transactional_email_mark_uncertain('k3', 'socket hang up') - now())::text AS d`);
    expect(rows[0].d).toBe('7 days');
    expect(await reserveFrees('k3')).toEqual({ outcome: 'duplicate_uncertain', frees_null: false, frees_minus_now: '7 days' });
    await age('k3', `expires_at = now() + interval '1 second'`);  // one second before it frees
    expect((await reserve('k3')).outcome).toBe('duplicate_uncertain');
    expect((await stateOf('k3')).state).toBe('uncertain');
    await age('k3', `expires_at = now()`);                        // the window is over
    expect(await reserve('k3')).toEqual({ outcome: 'reserved', message_id: null });
    expect((await stateOf('k3')).state).toBe('sending');
  });
});

it('a type TTL LONGER than 7 days is kept as the uncertain window (greatest, never shortened)', async () => {
  await inRollback(async () => {
    await reserve('k3b', 30 * 86400);
    const { rows } = await db.query(`SELECT (public.transactional_email_mark_uncertain('k3b', 'timeout') - now())::text AS d`);
    expect(rows[0].d).toBe('30 days');
  });
});

it('mark_uncertain on a row that is not sending moves nothing and answers NULL', async () => {
  await inRollback(async () => {
    const { rows } = await db.query(`SELECT public.transactional_email_mark_uncertain('nope', 'x') IS NULL AS n`);
    expect(rows[0].n).toBe(true);
  });
});

it("non-uncertain answers carry no frees_at", async () => {
  await inRollback(async () => {
    expect(await reserveFrees('k3c')).toEqual({ outcome: 'reserved', frees_null: true, frees_minus_now: null });
    expect(await reserveFrees('k3c')).toEqual({ outcome: 'duplicate_inflight', frees_null: true, frees_minus_now: null });
    await call('transactional_email_confirm', ['k3c', 'm']);
    expect(await reserveFrees('k3c')).toEqual({ outcome: 'duplicate_sent', frees_null: true, frees_minus_now: null });
  });
});

it("resolve 'not_delivered': audited (actor + time), the key RELEASED - the next reserve sends", async () => {
  await inRollback(async () => {
    await reserve('r1');
    await call('transactional_email_mark_uncertain', ['r1', 'timeout']);
    expect(await resolve('r1', 'not_delivered', '  ops@omnivyra.com  ')).toBe(true);
    expect(await audit('r1')).toEqual([{ prior_state: 'uncertain', resolution: 'not_delivered', actor: 'ops@omnivyra.com', at_now: true }]);
    expect(await stateOf('r1')).toBeNull();
    expect((await reserve('r1')).outcome).toBe('reserved');
  });
});

it("resolve 'delivered': audited, the row becomes SENT - a duplicate success from then on", async () => {
  await inRollback(async () => {
    await reserve('r2');
    await call('transactional_email_mark_uncertain', ['r2', 'timeout']);
    expect(await resolve('r2', 'delivered', 'ops')).toBe(true);
    expect(await audit('r2')).toEqual([{ prior_state: 'uncertain', resolution: 'delivered', actor: 'ops', at_now: true }]);
    expect((await stateOf('r2')).state).toBe('sent');
    expect(await reserve('r2')).toEqual({ outcome: 'duplicate_sent', message_id: null });
  });
});

it('resolve touches ONLY an uncertain row: sending / sent / absent -> false, nothing changed, nothing audited', async () => {
  await inRollback(async () => {
    await reserve('r3');                                   // sending
    expect(await resolve('r3', 'not_delivered', 'ops')).toBe(false);
    expect((await stateOf('r3')).state).toBe('sending');
    await call('transactional_email_confirm', ['r3', 'mid']); // sent
    expect(await resolve('r3', 'not_delivered', 'ops')).toBe(false);
    expect(await stateOf('r3')).toEqual({ state: 'sent', provider_message_id: 'mid' });
    expect(await resolve('absent', 'delivered', 'ops')).toBe(false);
    // a second resolution of an already-resolved key is refused too
    await reserve('r4');
    await call('transactional_email_mark_uncertain', ['r4', 'x']);
    expect(await resolve('r4', 'delivered', 'ops')).toBe(true);
    expect(await resolve('r4', 'not_delivered', 'ops2')).toBe(false);
    expect((await stateOf('r4')).state).toBe('sent');
    expect((await audit('r3')).length + (await audit('absent')).length).toBe(0);
    expect((await audit('r4')).length).toBe(1);
  });
});

it('resolve refuses invalid arguments (22023) and records nothing', async () => {
  await inRollback(async () => {
    await reserve('r5');
    await call('transactional_email_mark_uncertain', ['r5', 'x']);
    for (const [res, actor] of [['maybe', 'ops'], [null, 'ops'], ['delivered', '   '], ['delivered', null], ['delivered', 'a'.repeat(201)]]) {
      await db.query('SAVEPOINT b');
      await expect(db.query(`SELECT public.transactional_email_resolve_uncertain('r5', $1, $2)`, [res, actor])).rejects.toMatchObject({ code: '22023' });
      await db.query('ROLLBACK TO SAVEPOINT b');
    }
    expect((await stateOf('r5')).state).toBe('uncertain');
    expect(await audit('r5')).toEqual([]);
  });
});

it('an EXPIRED sent key is taken over (its window is over); an unexpired one is not', async () => {
  await inRollback(async () => {
    await reserve('k4');
    await call('transactional_email_confirm', ['k4', 'mid-old']);
    expect((await reserve('k4')).outcome).toBe('duplicate_sent');
    await age('k4', `expires_at = now() - interval '1 second'`);
    expect(await reserve('k4')).toEqual({ outcome: 'reserved', message_id: null });
    expect((await stateOf('k4')).state).toBe('sending');
  });
});

it('a STALE sending reservation (a crash mid-send) becomes uncertain, and is never reopened', async () => {
  await inRollback(async () => {
    await reserve('k5');
    await age('k5', `created_at = now() - interval '16 minutes'`);
    // the crash path gets the same uncertain window, and says when it frees
    expect(await reserveFrees('k5')).toEqual({ outcome: 'stale_marked_uncertain', frees_null: false, frees_minus_now: '7 days' });
    expect((await db.query(`SELECT (expires_at - now())::text AS d FROM public.transactional_email_sends WHERE idempotency_key = 'k5'`)).rows[0].d).toBe('7 days');
    expect((await stateOf('k5')).state).toBe('uncertain');
    expect((await reserve('k5')).outcome).toBe('duplicate_uncertain');
    // A very late confirm of the crashed send moves nothing: uncertain stays uncertain.
    expect(await call('transactional_email_confirm', ['k5', 'mid-late'])).toBe(false);
    expect((await stateOf('k5')).state).toBe('uncertain');
  });
});

it('confirm / release / mark_uncertain move ONLY a sending row (a sent row is never released or made uncertain)', async () => {
  await inRollback(async () => {
    await reserve('k6');
    await call('transactional_email_confirm', ['k6', 'mid']);
    expect(await call('transactional_email_release', ['k6'])).toBe(false);
    expect(await call('transactional_email_mark_uncertain', ['k6', 'x'])).toBeNull(); // returns frees_at; NULL = nothing moved
    expect(await call('transactional_email_confirm', ['k6', 'other'])).toBe(false);
    expect(await stateOf('k6')).toEqual({ state: 'sent', provider_message_id: 'mid' });
  });
});

it('invalid arguments are refused (22023), and a malformed recipient hash by the table CHECK', async () => {
  await inRollback(async () => {
    await db.query('SAVEPOINT a');
    await expect(db.query(`SELECT * FROM public.transactional_email_reserve('k', 't', $1, 10, 900)`, [H])).rejects.toMatchObject({ code: '22023' });
    await db.query('ROLLBACK TO SAVEPOINT a');
    await expect(db.query(`SELECT * FROM public.transactional_email_reserve('k', 't', 'not-a-hash', 3600, 900)`)).rejects.toMatchObject({ code: '23514' });
  });
});

it('grants: anon / authenticated hold nothing on the table and cannot EXECUTE; service_role can', async () => {
  const { rows } = await db.query(`SELECT
      has_table_privilege('anon', 'public.transactional_email_sends', 'SELECT') AS anon_sel,
      has_table_privilege('authenticated', 'public.transactional_email_sends', 'INSERT') AS auth_ins,
      has_function_privilege('anon', 'public.transactional_email_reserve(text, text, text, integer, integer)', 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', 'public.transactional_email_release(text)', 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', 'public.transactional_email_reserve(text, text, text, integer, integer)', 'EXECUTE') AS sr_exec`);
  expect(rows[0]).toEqual({ anon_sel: false, auth_ins: false, anon_exec: false, auth_exec: false, sr_exec: true });
});

it('grants: resolve is service_role-only; the audit is APPEND-ONLY (service_role SELECT+INSERT, no UPDATE/DELETE), closed to anon/authenticated', async () => {
  const R = 'public.transactional_email_resolutions';
  const F = 'public.transactional_email_resolve_uncertain(text, text, text)';
  const { rows } = await db.query(`SELECT
      has_function_privilege('anon', $2, 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', $2, 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', $2, 'EXECUTE') AS sr_exec,
      has_table_privilege('service_role', $1, 'SELECT') AS sr_sel,
      has_table_privilege('service_role', $1, 'INSERT') AS sr_ins,
      has_table_privilege('service_role', $1, 'UPDATE') AS sr_upd,
      has_table_privilege('service_role', $1, 'DELETE') AS sr_del,
      has_table_privilege('anon', $1, 'SELECT') AS anon_sel,
      has_table_privilege('authenticated', $1, 'SELECT') AS auth_sel,
      has_table_privilege('authenticated', $1, 'INSERT') AS auth_ins,
      (SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass) AS rls`, [R, F]);
  expect(rows[0]).toEqual({
    anon_exec: false, auth_exec: false, sr_exec: true,
    sr_sel: true, sr_ins: true, sr_upd: false, sr_del: false,
    anon_sel: false, auth_sel: false, auth_ins: false, rls: true,
  });
});
