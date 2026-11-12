/**
 * report_settings unit 1 — REAL-POSTGRES proof of public.merge_report_settings_keys, COMMITTING part:
 * the merge semantics on the real company_profiles and the interleaved concurrent writers (each call
 * commits, as behind PostgREST, after `SET LOCAL ROLE <role>`). A *_concurrency_real suite: the
 * harness runs it in the SECOND pass, after every non-committing suite, so its committed rows cannot
 * perturb another suite mid-run (83's rule). It works on its own seeded company rows, re-seeded before
 * each case and deleted after all of them with its own client.
 *
 * The non-committing cases (catalog, the migration itself) are in report_settings_key_merge.test.ts.
 *
 *     npm run test:realschema -- report_settings_key_merge_concurrency_real
 */
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const CO = 'rsmerge-conc-00000000-0000-4000-8000-0000000052a1';
const CO_LEGACY = 'rsmerge-conc-00000000-0000-4000-8000-0000000052a2';
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
  if (!fn?.f) throw new Error('merge_report_settings_keys (20270217000000) is not installed in this database');
  // baseline.sql carries no privileges; model the hosted default for the table under test so the
  // FUNCTION's grants, not a missing table grant, decide the outcomes below.
  await db.query('GRANT SELECT, UPDATE ON public.company_profiles TO service_role');
});

beforeEach(async () => {
  await seedProfile(CO, '{"brand_voice":{"tone":"warm"},"user_report_pref":42,"orchestration_tasks":[1]}');
});

// Cleanup uses its OWN client: setup.ts registers its afterAll (which ends the shared `db`) when it is
// imported, before this file's hooks, and same-level afterAll hooks run in registration order. So `db`
// is already closed here (CI-80: "Client was closed and is not queryable").
afterAll(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`DELETE FROM public.company_profiles WHERE company_id = ANY($1::text[])`, [[CO, CO_LEGACY]]);
  } finally {
    await c.end();
  }
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

  it('CONTROL: the same interleaving through a SELF-JOIN base LOSES a sub-field (why the base must be cp)', async () => {
    // A session-local copy of the merge whose base comes from a join, the "tidy-up" the migration
    // comment forbids. EvalPlanQual re-fetches only the target row, so the joined base stays stale and
    // the first writer's sub-field is silently lost. This proves the test above can fail.
    const JOINFN = `CREATE FUNCTION pg_temp.join_merge(p_company_id text, p_patch jsonb, p_nested text[]) RETURNS void LANGUAGE sql AS $f$
      UPDATE public.company_profiles cp
         SET report_settings = b.base || (SELECT jsonb_object_agg(e.key, CASE WHEN e.key = ANY (p_nested) THEN COALESCE(b.base -> e.key, '{}'::jsonb) || e.value ELSE e.value END) FROM jsonb_each(p_patch) e)
        FROM (SELECT c2.company_id, COALESCE(c2.report_settings, '{}'::jsonb) AS base FROM public.company_profiles c2 WHERE c2.company_id = p_company_id) b
       WHERE cp.company_id = p_company_id AND b.company_id = cp.company_id $f$`;
    await merge('service_role', CO, { market_pulse: { keep: 1 } });
    const c1 = new Client({ connectionString: url }); const c2 = new Client({ connectionString: url });
    await c1.connect(); await c2.connect();
    try {
      await c1.query(JOINFN); await c2.query(JOINFN);
      await c1.query('BEGIN'); await c2.query('BEGIN');
      await c1.query(`SELECT pg_temp.join_merge($1, '{"market_pulse":{"competitor_details":["refine"]}}'::jsonb, ARRAY['market_pulse'])`, [CO]);
      const second = c2.query(`SELECT pg_temp.join_merge($1, '{"market_pulse":{"exclusions":["ui"]}}'::jsonb, ARRAY['market_pulse'])`, [CO]);
      await new Promise((r) => setTimeout(r, 250));
      await c1.query('COMMIT');
      await second;
      await c2.query('COMMIT');
    } finally {
      await c1.end(); await c2.end();
    }
    const mp = (await stored(CO)).rs.market_pulse;
    expect(mp.exclusions).toEqual(['ui']);
    expect(mp).not.toHaveProperty('competitor_details'); // LOST
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

/** Two committing writers, interleaved: `first` holds the row lock while `second` waits on it. */
async function interleave(first: (c: Client) => Promise<unknown>, second: (c: Client) => Promise<unknown>, role: string | null = 'service_role') {
  const c1 = new Client({ connectionString: url }); const c2 = new Client({ connectionString: url });
  await c1.connect(); await c2.connect();
  try {
    await c1.query('BEGIN'); await c2.query('BEGIN');
    if (role) { await c1.query(`SET LOCAL ROLE ${role}`); await c2.query(`SET LOCAL ROLE ${role}`); }
    await first(c1);
    const waiting = second(c2);
    await new Promise((r) => setTimeout(r, 250));
    await c1.query('COMMIT');
    await waiting;
    await c2.query('COMMIT');
  } finally {
    await c1.end(); await c2.end();
  }
}

const MERGE_SQL = 'SELECT public.merge_report_settings_keys($1, $2::jsonb, NULL, $3::text[], $4::text[])';

describe('sandbox parity: input refusals', () => {
  it('an empty patch and an array patch are refused (22023); a NULL company is refused (22004)', async () => {
    expect(await merge('service_role', CO, {})).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, [1] as unknown)).toMatchObject({ ok: false, code: '22023' });
    expect(await as('service_role', `SELECT public.merge_report_settings_keys(NULL, '{"bootstrap":1}'::jsonb)`)).toMatchObject({ ok: false, code: '22004' });
  });

  it('list errors are refused (22023): a NULL element, a non-allowed key, a key in both lists, a nested key not in the patch, a non-object nested value', async () => {
    expect(await as('service_role', `SELECT public.merge_report_settings_keys($1, '{"bootstrap":1}'::jsonb, NULL, ARRAY[NULL]::text[])`, [CO])).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { bootstrap: 1 }, null, ['not_a_key'])).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { market_pulse: { a: 1 } }, null, ['market_pulse'], ['market_pulse'])).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { bootstrap: 1 }, null, null, ['market_pulse'])).toMatchObject({ ok: false, code: '22023' });
    expect(await merge('service_role', CO, { market_pulse: 'x' as unknown }, null, null, ['market_pulse'])).toMatchObject({ ok: false, code: '22023' });
    expect((await stored(CO)).rs).toEqual({ brand_voice: { tone: 'warm' }, user_report_pref: 42, orchestration_tasks: [1] });
  });

  it('profile keys are allow-listed (a profile_ui key merges)', async () => {
    expect(await merge('service_role', CO, { company_facts: { team_size: 9 } }, null, null, ['company_facts'])).toMatchObject({ ok: true, rows: [{ n: 1 }] });
    expect((await stored(CO)).rs.company_facts).toEqual({ team_size: 9 });
  });
});

describe('sandbox parity: stored-column shapes', () => {
  it('a SQL NULL column becomes the patch', async () => {
    await db.query('UPDATE public.company_profiles SET report_settings = NULL WHERE company_id = $1', [CO]);
    await merge('service_role', CO, { bootstrap: 'b' });
    expect((await stored(CO)).rs).toEqual({ bootstrap: 'b' });
  });

  it('a JSON null column becomes the patch', async () => {
    await seedProfile(CO, 'null');
    await merge('service_role', CO, { bootstrap: 'b' });
    expect((await stored(CO)).rs).toEqual({ bootstrap: 'b' });
  });

  it('nested: an absent stored key starts from {}', async () => {
    await merge('service_role', CO, { market_pulse: { exclusions: ['x'] } }, null, null, ['market_pulse']);
    expect((await stored(CO)).rs.market_pulse).toEqual({ exclusions: ['x'] });
  });
});

describe('sandbox parity: races and their controls', () => {
  it('if_absent under a concurrent replacer: the replacer WINS (decided on the locked row)', async () => {
    await interleave(
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ discovered_metadata: 'replacer' }), null, null]),
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ discovered_metadata: 'backfill' }), ['discovered_metadata'], null]),
    );
    expect((await stored(CO)).rs.discovered_metadata).toBe('replacer');
  });

  it('CONTROL: without if_absent the backfill OVERWRITES the replacer (why if_absent exists)', async () => {
    await interleave(
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ discovered_metadata: 'replacer' }), null, null]),
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ discovered_metadata: 'backfill' }), null, null]),
    );
    expect((await stored(CO)).rs.discovered_metadata).toBe('backfill');
  });

  it('CONTROL: without p_merge_nested the second writer REPLACES market_pulse (the first sub-field is lost)', async () => {
    await merge('service_role', CO, { market_pulse: { keep: 1 } });
    await interleave(
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ market_pulse: { competitor_details: ['refine'] } }), null, ['market_pulse']]),
      (c) => c.query(MERGE_SQL, [CO, JSON.stringify({ market_pulse: { exclusions: ['ui'] } }), null, null]),
    );
    expect((await stored(CO)).rs.market_pulse).toEqual({ exclusions: ['ui'] });
  });

  it('CONTROL: the LEGACY whole-column read-modify-write loses the other writer\'s key (the defect)', async () => {
    const before = (await stored(CO)).rs as Record<string, unknown>;
    await interleave(
      async (c) => {
        await c.query('SELECT report_settings FROM public.company_profiles WHERE company_id = $1 FOR UPDATE', [CO]);
        await c.query('UPDATE public.company_profiles SET report_settings = $2::jsonb WHERE company_id = $1', [CO, JSON.stringify({ ...before, agent_checkpoints: ['c1'] })]);
      },
      // The second writer read the column BEFORE the first committed (a stale copy), then writes it back whole.
      (c) => c.query('UPDATE public.company_profiles SET report_settings = $2::jsonb WHERE company_id = $1', [CO, JSON.stringify({ ...before, website_fingerprint: 'c2' })]),
      null,
    );
    const rs = (await stored(CO)).rs;
    expect(rs.website_fingerprint).toBe('c2');
    expect(rs).not.toHaveProperty('agent_checkpoints'); // LOST: the defect the RPC removes
  });
});

