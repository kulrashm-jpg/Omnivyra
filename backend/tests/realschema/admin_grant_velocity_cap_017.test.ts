/**
 * Real-schema cover for 20270217000017 public.admin_grant_credits (M5; e1; e9-approved BLOCKING money). The guarantees
 * ARE Postgres behaviour - one transaction, a per-org advisory lock - so they are proven here on real rows:
 *   - TWO CONCURRENT grants at the boundary (2 of 3 used) from separate connections -> exactly one succeeds;
 *   - ledger and audit are one unit: a fault in the audit insert leaves NO ledger credit;
 *   - a replay of the same request key returns the same grant and credits the ledger once; the same key for a different
 *     amount is refused;
 *   - the cap refuses the 4th grant; the audited override passes it and is recorded on the audit row.
 * Synthetic org ids only (disposable replay DB; the suite refuses a non-loopback W6_DB_URL).
 */
import { Client } from 'pg';
import { db, inRollback } from './setup';

const URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(URL)) throw new Error('admin_grant_velocity_cap_017 refuses a non-loopback W6_DB_URL');

const ACTOR = '0eda0017-0000-4000-8000-0000000000a1';
const GRANT = `SELECT public.admin_grant_credits(p_org_id => $1, p_actor_user_id => $2, p_credits => $3, p_reason => 'm5 test',
  p_reason_type => 'goodwill', p_expires_at => NULL, p_client_key => $4, p_max_per_24h => 3, p_allow_over_limit => $5)`;

const q = (sql: string, params: unknown[] = []) => (params.length ? db.query(sql, params) : db.query(sql));
async function attempt(sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT m5');
  try { await q(sql, params); await q('RELEASE SAVEPOINT m5'); return 'ok'; }
  catch (e: any) { await q('ROLLBACK TO SAVEPOINT m5'); return String(e.message); }
}
const grant = (org: string, credits: number, key: string, over = false) => attempt(GRANT, [org, ACTOR, credits, key, over]);
const paidBalance = async (org: string) =>
  Number((await q('SELECT paid_balance FROM public.organization_credits WHERE organization_id = $1', [org])).rows[0]?.paid_balance ?? 0);
const audits = async (org: string) => (await q('SELECT credits_granted, metadata FROM public.credit_admin_grants WHERE organization_id = $1 ORDER BY created_at', [org])).rows;

describe('20270217000017 admin_grant_credits', () => {
  it('the 4th grant in 24h is refused; the audited override passes it and is recorded', async () => {
    await inRollback(async () => {
      const ORG = '0eda0017-0000-4000-8000-000000000001';
      for (const k of ['a', 'b', 'c']) expect(await grant(ORG, 10, k)).toBe('ok');
      expect(await grant(ORG, 10, 'd')).toMatch(/GRANT_LIMIT_EXCEEDED/);
      expect(await paidBalance(ORG)).toBe(30);
      expect(await grant(ORG, 10, 'e', true)).toBe('ok');
      const rows = await audits(ORG);
      expect(rows).toHaveLength(4);
      expect(rows[3].metadata).toMatchObject({ allow_over_limit: true, grants_in_last_24h_before: 3 });
    });
  });

  it('a replay of the same request key returns the same grant and credits ONCE; the same key for another amount is refused', async () => {
    await inRollback(async () => {
      const ORG = '0eda0017-0000-4000-8000-000000000002';
      expect(await grant(ORG, 25, 'same')).toBe('ok');
      expect(await grant(ORG, 25, 'same')).toBe('ok');
      expect(await paidBalance(ORG)).toBe(25);
      expect(await audits(ORG)).toHaveLength(1);
      expect(await grant(ORG, 99, 'same')).toMatch(/ADMIN_GRANT_KEY_REUSED/);
    });
  });

  it('ledger and audit are ONE unit: a fault in the audit insert leaves no ledger credit', async () => {
    await inRollback(async () => {
      const ORG = '0eda0017-0000-4000-8000-000000000003';
      await q(`CREATE FUNCTION pg_temp.m5_fault() RETURNS trigger LANGUAGE plpgsql AS $f$
                 BEGIN RAISE EXCEPTION 'M5_INJECTED_AUDIT_FAULT'; END $f$`);
      await q('CREATE TRIGGER m5_fault BEFORE INSERT ON public.credit_admin_grants FOR EACH ROW EXECUTE FUNCTION pg_temp.m5_fault()');
      expect(await grant(ORG, 40, 'faulty')).toMatch(/M5_INJECTED_AUDIT_FAULT/);
      expect(await paidBalance(ORG)).toBe(0);
      const { rows } = await q(`SELECT count(*)::int n FROM public.credit_transactions WHERE idempotency_key = $1`, [`admin_grant:${ORG}:faulty`]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('a missing request key, a non-positive amount and an invalid cap are refused', async () => {
    await inRollback(async () => {
      const ORG = '0eda0017-0000-4000-8000-000000000004';
      expect(await grant(ORG, 10, '')).toMatch(/ADMIN_GRANT_CLIENT_KEY_REQUIRED/);
      expect(await grant(ORG, 0, 'k')).toMatch(/ADMIN_GRANT_INVALID_CREDITS/);
      expect(await attempt(GRANT.replace('p_max_per_24h => 3', 'p_max_per_24h => 0'), [ORG, ACTOR, 10, 'k', false])).toMatch(/ADMIN_GRANT_INVALID_LIMIT/);
    });
  });

  it('client roles cannot execute it', async () => {
    const { rows } = await q(`SELECT has_function_privilege('anon', 'public.admin_grant_credits(uuid,uuid,integer,text,text,timestamptz,text,integer,boolean,jsonb)', 'EXECUTE') a,
      has_function_privilege('authenticated', 'public.admin_grant_credits(uuid,uuid,integer,text,text,timestamptz,text,integer,boolean,jsonb)', 'EXECUTE') b`);
    expect(rows[0]).toEqual({ a: false, b: false });
  });
});

describe('20270217000017 - concurrency at the boundary (separate connections, committed rows)', () => {
  const extra: Client[] = [];
  beforeAll(async () => { for (let i = 0; i < 2; i++) { const c = new Client({ connectionString: URL }); await c.connect(); extra.push(c); } });
  afterAll(async () => { await Promise.all(extra.map((c) => c.end())); });

  it('2 of 3 used: TWO concurrent grants with different keys -> exactly one succeeds', async () => {
    const ORG = `0eda0017-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}`;
    for (const k of ['p1', 'p2']) await db.query(GRANT, [ORG, ACTOR, 5, k, false]);
    const go = (c: Client, key: string) => c.query(GRANT, [ORG, ACTOR, 5, key, false]).then(() => 'ok', (e) => String(e.message));
    const out = await Promise.all([go(extra[0], 'race-A'), go(extra[1], 'race-B')]);
    expect(out.filter((o) => o === 'ok')).toHaveLength(1);
    expect(out.filter((o) => /GRANT_LIMIT_EXCEEDED/.test(o))).toHaveLength(1);
    const { rows } = await db.query('SELECT count(*)::int n FROM public.credit_admin_grants WHERE organization_id = $1', [ORG]);
    expect(rows[0].n).toBe(3);
  });
});
