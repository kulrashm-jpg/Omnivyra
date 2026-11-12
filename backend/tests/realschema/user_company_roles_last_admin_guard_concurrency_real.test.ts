/**
 * 20270217000012 last-admin guard - the COMMITTING case (83's harness rule:
 * committing cases live ONLY in *_concurrency_real.test.ts, which the harness runs
 * in a SECOND pass after every rolled-back suite, so committed rows cannot perturb
 * other suites). Uses its OWN clients for setup / race / cleanup (setup's shared db
 * is closed before a suite's afterAll).
 *
 * 05: the advisory lock is LOAD-BEARING. Without it, two transactions each demoting
 * one of two admins can both pass their commit-time checks before either commits.
 * Session 1 fires its check EARLY (SET CONSTRAINTS ALL IMMEDIATE) and holds its
 * transaction open; session 2's demotion must BLOCK on the lock, then be refused.
 */
import { Client } from 'pg';

const url = process.env.W6_DB_URL as string;
const CO_RACE = '00000000-0000-4000-8000-0000000012c9';
const A1 = '00000000-0000-4000-8000-0000000012d1';
const A2 = '00000000-0000-4000-8000-0000000012d2';

let admin: Client;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  const fn = (await admin.query(`SELECT to_regprocedure('public.company_admin_last_active_check()') AS f`)).rows[0].f;
  if (!fn) throw new Error('20270217000012 is NOT installed - refusing to pass vacuously');
  for (const [id, email] of [[A1, 'lag-race-a1@example.test'], [A2, 'lag-race-a2@example.test']]) {
    await admin.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'lag-race') ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
});

async function setupRace() {
  await admin.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'last-admin race') ON CONFLICT (id) DO NOTHING`, [CO_RACE]);
  await admin.query(`UPDATE public.companies SET status = 'active', deleted_at = NULL WHERE id = $1`, [CO_RACE]);
  await admin.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status)
                     VALUES ($1, $3, 'COMPANY_ADMIN', 'active'), ($2, $3, 'COMPANY_ADMIN', 'active')`, [A1, A2, CO_RACE]);
}
async function teardownRace() {
  // disable first: the guard exempts an inactive company, so the cleanup is not refused
  await admin.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO_RACE]);
  await admin.query(`DELETE FROM public.user_company_roles WHERE company_id = $1`, [CO_RACE]);
  await admin.query(`DELETE FROM public.companies WHERE id = $1`, [CO_RACE]);
}

it('two sessions each demote a DIFFERENT admin: the second BLOCKS, then is refused; exactly one admin remains', async () => {
  await setupRace();
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    await c1.query(`UPDATE public.user_company_roles SET role = 'VIEW_ONLY' WHERE user_id = $1 AND company_id = $2`, [A1, CO_RACE]);
    await c1.query('SET CONSTRAINTS ALL IMMEDIATE'); // c1's check passes now (A2 still admin): the widened window
    // c2's PID BEFORE its UPDATE is issued (pg queues queries per client, so asking after
    // would wait behind the blocked UPDATE).
    const c2pid = (await c2.query('SELECT pg_backend_pid() AS p')).rows[0]?.p;
    await c2.query('BEGIN');
    let settled = false;
    const pending = c2.query(`UPDATE public.user_company_roles SET role = 'VIEW_ONLY' WHERE user_id = $1 AND company_id = $2`, [A2, CO_RACE])
      .then(() => c2.query('COMMIT'))
      .then(() => ({ ok: true as const }), (e: any) => ({ ok: false as const, message: String(e.message) }))
      .finally(() => { settled = true; });
    // OBSERVE, not infer (05): poll pg_locks from a third connection until c2's backend is
    // waiting on a NON-granted advisory lock (bounded wait; a lock-less mutant never waits).
    let waitingOnAdvisory = false;
    for (let i = 0; i < 50 && !waitingOnAdvisory && !settled; i += 1) {
      const w = await admin.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`, [c2pid]);
      waitingOnAdvisory = (w.rowCount ?? 0) > 0;
      if (!waitingOnAdvisory) await new Promise((r) => setTimeout(r, 50));
    }
    const blocked = !settled;
    await c1.query('COMMIT');
    const o2 = await pending;
    await c2.query('ROLLBACK').catch(() => undefined);
    expect(waitingOnAdvisory).toBe(true); // c2 observed WAITING on the advisory lock (pg_locks)
    expect(blocked).toBe(true); // the BEFORE ROW advisory lock held c2 until c1 ended
    expect(o2.ok).toBe(false);
    expect((o2 as { message: string }).message).toMatch(/LAST_COMPANY_ADMIN/);
    const n = (await admin.query(`SELECT count(*)::int AS n FROM public.user_company_roles
                                    WHERE company_id = $1 AND role = 'COMPANY_ADMIN' AND status = 'active'`, [CO_RACE])).rows[0].n;
    expect(n).toBe(1);
  } finally {
    await Promise.all([c1.end(), c2.end()]);
    await teardownRace();
  }
});

afterAll(async () => {
  await admin.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[A1, A2]]).catch(() => undefined);
  await admin.end();
});
