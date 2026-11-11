/**
 * report_settings unit 1 — REAL-POSTGRES proof of public.merge_report_settings_keys
 * (supabase/migrations/20270116000000_report_settings_key_merge_rpc.sql, placeholder version),
 * on the replayed real schema (company_profiles.company_id is TEXT there).
 *
 *     npm run test:realschema -- report_settings_key_merge
 *
 * Nothing is applied by this suite: it tests the installed function. Each call runs in its own
 * transaction after `SET LOCAL ROLE <role>`, as behind PostgREST.
 */
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const CO = 'rsmerge-co-00000000-0000-4000-8000-0000000051a1';
const CO_LEGACY = 'rsmerge-co-00000000-0000-4000-8000-0000000051a2';
const FN = 'public.merge_report_settings_keys(text, jsonb, timestamptz, text[], text[])';

type Outcome = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string };

async function as(role: string | null, sql: string, params: unknown[] = []): Promise<Outcome> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    try {
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return { ok: true, rows: r.rows };
    } catch (e) {
      await c.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code ?? '?', message: err.message ?? '' };
    }
  } finally {
    await c.end();
  }
}

const merge = (role: string, company: string, patch: unknown, at: string | null = null, ifAbsent: string[] | null = null, nested: string[] | null = null) =>
  as(role, `SELECT public.merge_report_settings_keys($1, $2::jsonb, $3, $4::text[], $5::text[]) AS n`, [company, JSON.stringify(patch), at, ifAbsent, nested]);
const stored = async (company: string) =>
  (await db.query(`SELECT report_settings AS rs, updated_at FROM public.company_profiles WHERE company_id = $1`, [company])).rows[0];

/** Inserts a minimal company_profiles row with whatever NOT NULL columns the replayed schema has. */
async function seedProfile(company: string, rs: string) {
  await db.query(`DELETE FROM public.company_profiles WHERE company_id = $1`, [company]);
  await db.query(
    `INSERT INTO public.company_profiles (company_id, name, report_settings, updated_at)
     VALUES ($1, 'rsmerge', $2::jsonb, '2026-01-01T00:00:00Z')`, [company, rs]);
}

beforeAll(async () => {
  const fn = (await db.query(`SELECT to_regprocedure($1) AS f`, [FN])).rows[0];
  if (!fn?.f) throw new Error('merge_report_settings_keys (20270116000000) is not installed in this database');
  // baseline.sql carries no privileges; model the hosted default for the table under test so the
  // FUNCTION's grants, not a missing table grant, decide the outcomes below.
  await db.query('GRANT SELECT, UPDATE ON public.company_profiles TO service_role');
});

beforeEach(async () => {
  await seedProfile(CO, '{"brand_voice":{"tone":"warm"},"user_report_pref":42,"orchestration_tasks":[1]}');
});

afterAll(async () => {
  await db.query(`DELETE FROM public.company_profiles WHERE company_id = ANY($1::text[])`, [[CO, CO_LEGACY]]);
});

describe('catalog state', () => {
  it('SECURITY INVOKER, search_path pinned, EXECUTE for service_role only', async () => {
    const r = (await db.query(
      `SELECT prosecdef, proconfig, proacl IS NULL AS default_acl,
              has_function_privilege('anon', oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_x,
              has_function_privilege('service_role', oid, 'EXECUTE') AS svc_x,
              EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) AS public_x
         FROM pg_proc WHERE oid = to_regprocedure($1)`, [FN])).rows[0];
    expect(r).toMatchObject({ prosecdef: false, default_acl: false, anon_x: false, auth_x: false, svc_x: true, public_x: false });
    expect(r.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
  });
  it('exactly one function of that name (no second, differently-granted entry point)', async () => {
    const r = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'merge_report_settings_keys'`)).rows[0];
    expect(r.n).toBe(1);
  });
});

describe('merge semantics on the real company_profiles', () => {
  it('replaces only the named key; siblings intact; updated_at untouched without p_updated_at', async () => {
    const r = await merge('service_role', CO, { website_fingerprint: { hash: 'h' } });
    expect(r).toMatchObject({ ok: true, rows: [{ n: 1 }] });
    const s = await stored(CO);
    expect(s.rs).toMatchObject({ brand_voice: { tone: 'warm' }, user_report_pref: 42, orchestration_tasks: [1], website_fingerprint: { hash: 'h' } });
    expect(new Date(s.updated_at).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('an array key is REPLACED, and updated_at is set when given', async () => {
    await merge('service_role', CO, { orchestration_tasks: [2, 3] }, '2026-11-12T00:00:00Z');
    const s = await stored(CO);
    expect(s.rs.orchestration_tasks).toEqual([2, 3]);
    expect(new Date(s.updated_at).toISOString()).toBe('2026-11-12T00:00:00.000Z');
  });
  it('a user-facing key is refused (22023) and a mixed patch writes NOTHING', async () => {
    expect(await merge('service_role', CO, { brand_voice: 'x' })).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { bootstrap: 1, brand_voice: 'x' })).toMatchObject({ ok: false, code: '22023' });
    expect((await stored(CO)).rs).not.toHaveProperty('bootstrap');
  });
  it('a non-object stored column is refused (22023) and left as it was', async () => {
    await seedProfile(CO_LEGACY, '["legacy"]');
    expect(await merge('service_role', CO_LEGACY, { bootstrap: 1 })).toMatchObject({ ok: false, code: '22023' });
    expect((await stored(CO_LEGACY)).rs).toEqual(['legacy']);
  });
  it('no row -> 0 rows (the caller reports "not written")', async () => {
    expect(await merge('service_role', 'rsmerge-absent', { bootstrap: 1 })).toMatchObject({ ok: true, rows: [{ n: 0 }] });
  });
  it('p_if_absent: a present key is kept, an absent one written, in the same call', async () => {
    await merge('service_role', CO, { discovered_metadata: 'fresh' });
    expect(await merge('service_role', CO, { discovered_metadata: 'stale', bootstrap: 'm' }, null, ['discovered_metadata']))
      .toMatchObject({ ok: true, rows: [{ n: 1 }] });
    expect((await stored(CO)).rs).toMatchObject({ discovered_metadata: 'fresh', bootstrap: 'm', brand_voice: { tone: 'warm' } });
  });
  it('p_if_absent names must be allow-listed keys of the patch (22023)', async () => {
    expect(await merge('service_role', CO, { bootstrap: 1 }, null, ['discovered_metadata'])).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { bootstrap: 1 }, null, ['brand_voice'])).toMatchObject({ ok: false, code: '22023' });
  });
  it('p_merge_nested: only the patched sub-fields change; a stored non-object is refused', async () => {
    await merge('service_role', CO, { market_pulse: { business_model: 'b2b', competitor_details: [1] } });
    expect(await merge('service_role', CO, { market_pulse: { exclusions: ['x'] } }, null, null, ['market_pulse']))
      .toMatchObject({ ok: true, rows: [{ n: 1 }] });
    expect((await stored(CO)).rs.market_pulse).toEqual({ business_model: 'b2b', competitor_details: [1], exclusions: ['x'] });
    await merge('service_role', CO, { market_pulse: 'legacy' as unknown });
    expect(await merge('service_role', CO, { market_pulse: { a: 1 } }, null, null, ['market_pulse'])).toMatchObject({ ok: false, code: '22023' });
    expect((await stored(CO)).rs.market_pulse).toBe('legacy');
  });
  it('anon and authenticated cannot call it (42501)', async () => {
    expect(await merge('anon', CO, { bootstrap: 1 })).toMatchObject({ ok: false, code: '42501' });
    expect(await merge('authenticated', CO, { bootstrap: 1 })).toMatchObject({ ok: false, code: '42501' });
  });
});

describe('concurrency', () => {
  it('two NESTED writers of different market_pulse sub-fields, interleaved: both sub-fields survive', async () => {
    await merge('service_role', CO, { market_pulse: { keep: 1 } });
    const c1 = new Client({ connectionString: url }); const c2 = new Client({ connectionString: url });
    await c1.connect(); await c2.connect();
    try {
      await c1.query('BEGIN'); await c1.query('SET LOCAL ROLE service_role');
      await c2.query('BEGIN'); await c2.query('SET LOCAL ROLE service_role');
      await c1.query(`SELECT public.merge_report_settings_keys($1, '{"market_pulse":{"competitor_details":["refine"]}}'::jsonb, NULL, NULL, ARRAY['market_pulse'])`, [CO]);
      const second = c2.query(`SELECT public.merge_report_settings_keys($1, '{"market_pulse":{"exclusions":["ui"]}}'::jsonb, NULL, NULL, ARRAY['market_pulse'])`, [CO]);
      await new Promise((r) => setTimeout(r, 250));
      await c1.query('COMMIT');
      await second;
      await c2.query('COMMIT');
    } finally {
      await c1.end(); await c2.end();
    }
    expect((await stored(CO)).rs.market_pulse).toEqual({ keep: 1, competitor_details: ['refine'], exclusions: ['ui'] });
  });

  it('two writers of DIFFERENT keys, interleaved on the same row: both keys survive', async () => {
    const c1 = new Client({ connectionString: url }); const c2 = new Client({ connectionString: url });
    await c1.connect(); await c2.connect();
    try {
      await c1.query('BEGIN'); await c1.query('SET LOCAL ROLE service_role');
      await c2.query('BEGIN'); await c2.query('SET LOCAL ROLE service_role');
      await c1.query(`SELECT public.merge_report_settings_keys($1, '{"agent_checkpoints":["c1"]}'::jsonb)`, [CO]);
      const second = c2.query(`SELECT public.merge_report_settings_keys($1, '{"website_fingerprint":"c2"}'::jsonb)`, [CO]);
      await new Promise((r) => setTimeout(r, 250)); // c2 is now waiting on c1's row lock
      await c1.query('COMMIT');
      await second;
      await c2.query('COMMIT');
    } finally {
      await c1.end(); await c2.end();
    }
    expect((await stored(CO)).rs).toMatchObject({ brand_voice: { tone: 'warm' }, agent_checkpoints: ['c1'], website_fingerprint: 'c2' });
  });
});
