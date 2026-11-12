/**
 * 20270217000003 - the COMMITTING case (83's harness rule: pass 2, own clients).
 * Two writers race on ONE event: one marks it processed, the other failed. The
 * guarded writer serialises them on the state row (FOR UPDATE): exactly one
 * transition applies, the other returns applied:false with the winner's state -
 * never a lost update, never a terminal 'processed' overwritten by 'failed'.
 */
import { Client } from 'pg';

const url = process.env.W6_DB_URL as string;
let admin: Client;
let eventId: string;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  const f = (await admin.query(`SELECT to_regprocedure('public.advance_payment_provider_event_state_guarded(uuid,text,text)') AS f`)).rows[0].f;
  if (!f) throw new Error('20270217000003 is NOT installed - refusing to pass vacuously');
  eventId = (await admin.query(
    `INSERT INTO public.payment_provider_events (provider, provider_event_id, event_type)
     VALUES ('stripe', 'evt_race_' || gen_random_uuid()::text, 'test.race') RETURNING id`)).rows[0].id;
});

it('processed vs failed on ONE event: exactly one applies; the loser sees the winner; processed is never overwritten', async () => {
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    const r1 = (await c1.query(`SELECT public.advance_payment_provider_event_state_guarded($1, 'processed', NULL) AS r`, [eventId])).rows[0].r;
    await c2.query('BEGIN');
    const p2 = c2.query(`SELECT public.advance_payment_provider_event_state_guarded($1, 'failed', 'late failure') AS r`, [eventId]);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query('COMMIT');
    const r2 = (await p2).rows[0].r;
    await c2.query('COMMIT');
    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(false);           // processed is TERMINAL: the late failure is refused
    expect(r2.current).toBe('processed');     // ...and it reports the winner's state
    const s = (await admin.query(`SELECT processing_status AS s FROM public.payment_provider_event_state WHERE provider_event_pk = $1`, [eventId])).rows[0].s;
    expect(s).toBe('processed');
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
});

afterAll(async () => {
  // The ledger is append-only (DELETE raises): the event row stays, like every real
  // event. Its state row is removable (the side table is UPDATEable / deletable).
  await admin.query(`DELETE FROM public.payment_provider_event_state WHERE provider_event_pk = $1`, [eventId]).catch(() => undefined);
  await admin.end();
});
