/**
 * Transactional email idempotency on REAL PostgreSQL (migration transactional_email_idempotency). Holds the SQL to
 * the same state machine as idempotency.ts's unit fake (transactionalEmailIdempotency.test.ts):
 *   reserve -> 'reserved' once; a second reserve -> duplicate (in flight / sent / uncertain);
 *   an expired 'sent' key is taken over; an 'uncertain' key NEVER is;
 *   a 'sending' reservation past the stale bound -> 'uncertain' (stale_marked_uncertain), never reopened;
 *   confirm / release / mark_uncertain move ONLY a 'sending' row.
 * Single connection, every case rolled back. The two-connection race is in
 * transactional_email_idempotency_concurrency_real.
 */
import { db, inRollback } from './setup';

const H = 'a'.repeat(64);
async function reserve(key: string, ttl = 3600, stale = 900): Promise<{ outcome: string; message_id: string | null }> {
  const { rows } = await db.query(`SELECT * FROM public.transactional_email_reserve($1, 'team_invite', $2, $3, $4)`, [key, H, ttl, stale]);
  return rows[0];
}
const call = async (fn: string, args: unknown[]): Promise<boolean> =>
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

it('an UNCERTAIN send is never reserved again - not even long after its window', async () => {
  await inRollback(async () => {
    await reserve('k3');
    expect(await call('transactional_email_mark_uncertain', ['k3', 'socket hang up'])).toBe(true);
    expect((await reserve('k3')).outcome).toBe('duplicate_uncertain');
    await age('k3', `expires_at = now() - interval '400 days', created_at = now() - interval '401 days'`);
    expect((await reserve('k3')).outcome).toBe('duplicate_uncertain');
    expect((await stateOf('k3')).state).toBe('uncertain');
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
    expect((await reserve('k5', 3600, 900)).outcome).toBe('stale_marked_uncertain');
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
    expect(await call('transactional_email_mark_uncertain', ['k6', 'x'])).toBe(false);
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
