/**
 * Closure-015Q — REAL-POSTGRES proof of the corrected rbac_config CONTRACT step
 * (supabase/deferred/rbac_config_contract_legacy_insert.sql, deferred — not a migration).
 * DESTRUCTIVE: truncates public.rbac_config, creates and drops roles, re-applies the step and its
 * rollback. Run on a DISPOSABLE database only, after 20261210000001..4 are installed:
 *
 *     npm run test:realschema -- closure015q
 *
 * beforeAll applies the deferred contract step unless C15N_NO_APPLY=1 (then it tests whatever contract
 * state is INSTALLED — used by the SQL mutation runner). Privileges are asserted as EFFECTIVE privileges
 * (has_*_privilege: inheritance, PUBLIC, column grants), and every runtime operation runs under
 * `SET LOCAL ROLE service_role` — the role PostgREST switches to for the server key.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
// C15Q_CONTRACT_FILE lets the SQL mutation runner substitute a mutated copy of the step.
const CONTRACT = process.env.C15Q_CONTRACT_FILE
  || path.resolve(__dirname, '../../../supabase/deferred/rbac_config_contract_legacy_insert.sql');
const ROLLBACK = process.env.C15Q_ROLLBACK_FILE
  || path.resolve(__dirname, '../../../supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql');
const ACTOR = '00000000-0000-4000-8000-000000c15a01';
const APP_ROLES = ['service_role', 'authenticated', 'anon', 'authenticator'] as const;
const TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
const ROLES_JSON = JSON.stringify(['SUPER_ADMIN', 'COMPANY_ADMIN']);
const PERMS_JSON = JSON.stringify({ VIEW_DASHBOARD: ['COMPANY_ADMIN'] });

type Outcome = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string; detail: string };

/** Runs `sql` in its own transaction as `role` (null = the owner session); commits on success unless
 *  commit=false (probes that must never persist, even in a control / mutant run). */
async function as(role: string | null, sql: string, params: unknown[] = [], commit = true): Promise<Outcome> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
      await c.query('BEGIN');
      if (role) await c.query(`SET LOCAL ROLE ${role}`);
      try {
        const r = await c.query(sql, params);
        await c.query(commit ? 'COMMIT' : 'ROLLBACK');
        return { ok: true, rows: r.rows };
      } catch (e) {
        await c.query('ROLLBACK');
        const err = e as { code?: string; message?: string; detail?: string };
        return { ok: false, code: err.code ?? '?', message: err.message ?? '', detail: err.detail ?? '' };
      }
  } finally {
    await c.end();
  }
}

/** Applies a whole SQL file (it carries its own BEGIN/COMMIT) on the shared owner session. */
async function applyFile(file: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await db.query(fs.readFileSync(file, 'utf8'));
    return { ok: true };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    return { ok: false, message: (e as { message?: string }).message ?? '' };
  }
}

const seq = async () => (await db.query(`SELECT pg_get_serial_sequence('public.rbac_config', 'version') AS s`)).rows[0].s as string;
const tablePrivs = async (role: string) =>
  (await db.query(`SELECT p FROM unnest($2::text[]) p WHERE has_table_privilege($1, 'public.rbac_config', p) ORDER BY p`, [role, [...TABLE_PRIVS]])).rows.map((r) => r.p as string);
const seqPrivs = async (role: string) =>
  (await db.query(`SELECT p FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) p WHERE has_sequence_privilege($1, $2, p) ORDER BY p`, [role, await seq()])).rows.map((r) => r.p as string);
const save = (role: string, expected: number | null) =>
  as(role, `SELECT version, updated_at FROM public.save_rbac_config($1::jsonb, $2::jsonb, $3::uuid, $4::bigint)`, [ROLES_JSON, PERMS_JSON, ACTOR, expected]);
/** Narrowing helpers (no casts): fail the test with the database error when the shape is not the expected one. */
const rowsOf = (o: Outcome): Record<string, unknown>[] => {
  if ('rows' in o) return o.rows;
  throw new Error(`expected success, got ${o.code} ${o.message}`);
};
const errorOf = (o: Outcome): { code: string; message: string; detail: string } => {
  if ('code' in o) return o;
  throw new Error('expected an error, the statement succeeded');
};
const failureOf = (f: { ok: true } | { ok: false; message: string }): string => {
  if ('message' in f) return f.message;
  throw new Error('expected the SQL file to fail, it applied');
};
const versionOf = (o: Outcome) => Number(rowsOf(o)[0].version);
const denied = (o: Outcome) => expect(o).toMatchObject({ ok: false, code: '42501' });

/** The contract state, asserted as effective privileges. */
async function expectContractState() {
  expect(await tablePrivs('service_role')).toEqual(['SELECT']);
  for (const r of ['authenticated', 'anon', 'authenticator', 'public']) expect(await tablePrivs(r)).toEqual([]);
  for (const r of [...APP_ROLES, 'public']) expect(await seqPrivs(r)).toEqual([]);
}

/**
 * Closure-015R — the suite leaves the database as it found it: the exact ACLs of the table and its
 * identity sequence are snapshotted before anything runs and restored afterwards (the tests apply the
 * contract step, its rollback, hosted-default grants …). Without this the shared CI database would end
 * in whatever privilege state the LAST suite left — order-dependent, and not what the migrations define.
 */
type AclSnapshot = { table: string | null; seq: string | null };
async function snapshotAcl(): Promise<AclSnapshot> {
  const r = (await db.query(
    `SELECT (SELECT relacl::text FROM pg_class WHERE oid = 'public.rbac_config'::regclass) AS t,
            (SELECT relacl::text FROM pg_class WHERE oid = pg_get_serial_sequence('public.rbac_config', 'version')::regclass) AS s`)).rows[0];
  return { table: (r.t as string | null) ?? null, seq: (r.s as string | null) ?? null };
}
async function restoreAcl(snap: AclSnapshot) {
  // Its own connection: the shared `db` from setup.ts is already closed when the file-level afterAll runs.
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
  const seqName = (await c.query(`SELECT pg_get_serial_sequence('public.rbac_config', 'version') AS s`)).rows[0].s as string;
  const targets: Array<[string, string, string | null]> = [['TABLE', 'public.rbac_config', snap.table], ['SEQUENCE', seqName, snap.seq]];
  for (const [kind, obj, acl] of targets) {
    const owner = (await c.query(`SELECT relowner::text AS o FROM pg_class WHERE oid = $1::regclass`, [obj])).rows[0].o as string;
    const grantee = `CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END`;
    const current = (await c.query(
      `SELECT DISTINCT ${grantee} AS g FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = $1::regclass AND a.grantee <> $2::oid`, [obj, owner])).rows;
    for (const row of current) await c.query(`REVOKE ALL ON ${kind} ${obj} FROM ${row.g}`);
    if (acl === null) continue;
    const entries = (await c.query(
      `SELECT ${grantee} AS g, string_agg(a.privilege_type, ', ') AS p FROM aclexplode($1::aclitem[]) a WHERE a.grantee <> $2::oid GROUP BY 1`, [acl, owner])).rows;
    for (const e of entries) await c.query(`GRANT ${e.p} ON ${kind} ${obj} TO ${e.g}`);
  }
  } finally {
    await c.end();
  }
}
let aclAtStart: AclSnapshot;

beforeAll(async () => {
  aclAtStart = await snapshotAcl();
  if (!(await db.query(`SELECT to_regprocedure('public.save_rbac_config(jsonb, jsonb, uuid, bigint)') AS f`)).rows[0].f) {
    throw new Error('save_rbac_config (20261210000003) is not installed in this database');
  }
  if (process.env.C15N_NO_APPLY !== '1') {
    const r = await applyFile(CONTRACT);
    if ('message' in r) throw new Error(`contract step failed to apply: ${r.message}`);
  }
});
beforeEach(async () => { await db.query('TRUNCATE public.rbac_config RESTART IDENTITY'); });
// Runs after every describe-level afterAll: restore the exact privileges this suite found.
afterAll(async () => { await restoreAcl(aclAtStart); });

describe('effective privileges after the contract step', () => {
  it('service_role holds exactly SELECT on the table; the other application roles and PUBLIC hold nothing', async () => {
    await expectContractState();
  });

  it('no column-level INSERT / UPDATE / REFERENCES survives for any application role', async () => {
    const rows = (await db.query(
      `SELECT r || ':' || p AS x FROM unnest($1::text[]) r, unnest(ARRAY['INSERT','UPDATE','REFERENCES']) p
        WHERE has_any_column_privilege(r, 'public.rbac_config', p)`, [[...APP_ROLES, 'public']])).rows;
    expect(rows).toEqual([]);
  });

  it('no non-owner, non-superuser role can write the table or use / reset its sequence', async () => {
    const rows = (await db.query(
      `SELECT r.rolname || ':' || p AS x
         FROM pg_roles r, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
        WHERE NOT r.rolsuper AND r.rolname NOT LIKE 'pg\\_%'
          AND NOT pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = 'public.rbac_config'::regclass), 'USAGE')
          AND has_table_privilege(r.oid, 'public.rbac_config', p)
       UNION ALL
       SELECT r.rolname || ':seq-' || p
         FROM pg_roles r, unnest(ARRAY['USAGE','UPDATE']) p
        WHERE NOT r.rolsuper AND r.rolname NOT LIKE 'pg\\_%'
          AND NOT pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = 'public.rbac_config'::regclass), 'USAGE')
          AND has_sequence_privilege(r.oid, pg_get_serial_sequence('public.rbac_config', 'version'), p)`)).rows;
    expect(rows).toEqual([]);
  });

  it('the governed function is intact: SECURITY DEFINER, non-application owner, EXECUTE for service_role only', async () => {
    const fn = (await db.query(
      `SELECT prosecdef, pg_get_userbyid(proowner) AS owner,
              has_function_privilege('service_role', oid, 'EXECUTE') AS svc,
              has_function_privilege('authenticated', oid, 'EXECUTE') AS authd,
              has_function_privilege('anon', oid, 'EXECUTE') AS anon
         FROM pg_proc WHERE oid = 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)'::regprocedure`)).rows[0];
    expect(fn).toMatchObject({ prosecdef: true, svc: true, authd: false, anon: false });
    expect(APP_ROLES as readonly string[]).not.toContain(fn.owner);
  });
});

describe('direct writes by service_role are DENIED (42501)', () => {
  beforeEach(async () => {
    await db.query(`INSERT INTO public.rbac_config (roles, permissions, updated_by) VALUES ($1::jsonb, $2::jsonb, $3)`, [ROLES_JSON, PERMS_JSON, ACTOR]);
  });
  it('INSERT (the legacy path)', async () => {
    denied(await as('service_role', `INSERT INTO public.rbac_config (roles, permissions) VALUES ($1::jsonb, $2::jsonb)`, [ROLES_JSON, PERMS_JSON]));
  });
  it('UPDATE in place (would change permissions without a new version)', async () => {
    denied(await as('service_role', `UPDATE public.rbac_config SET permissions = '{"X":["Y"]}'::jsonb`));
  });
  it('DELETE (deleting the head would silently re-activate an older configuration)', async () => {
    denied(await as('service_role', `DELETE FROM public.rbac_config`));
  });
  it('TRUNCATE (would wipe history; the application would fall back to defaults)', async () => {
    denied(await as('service_role', `TRUNCATE public.rbac_config`));
  });
  it('LOCK TABLE … ACCESS EXCLUSIVE (needs UPDATE/DELETE/TRUNCATE/MAINTAIN — none held)', async () => {
    denied(await as('service_role', `LOCK TABLE public.rbac_config IN ACCESS EXCLUSIVE MODE`, [], false));
  });
  it('CREATE TRIGGER on the table (TRIGGER privilege)', async () => {
    denied(await as('service_role',
      `CREATE TRIGGER c15q_rogue BEFORE INSERT ON public.rbac_config FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_membership_company()`, [], false));
  });
  it('setval / nextval on the identity sequence (a lower value would make every governed save fail)', async () => {
    const s = await seq();
    denied(await as('service_role', `SELECT setval($1::regclass, 1)`, [s], false));
    denied(await as('service_role', `SELECT nextval($1::regclass)`, [s]));
  });
  it('the table still holds exactly the one owner-written row', async () => {
    expect((await db.query('SELECT count(*)::int AS n FROM public.rbac_config')).rows[0].n).toBe(1);
  });
  it('authenticated and anon cannot read the table at all', async () => {
    denied(await as('authenticated', `SELECT * FROM public.rbac_config`));
    denied(await as('anon', `SELECT * FROM public.rbac_config`));
  });
});

describe('the governed, versioned path works under the ACTUAL runtime role (service_role)', () => {
  it('first save (expected version NULL = editing the defaults) creates version 1; reads see it', async () => {
    const o = await save('service_role', null);
    expect(o.ok).toBe(true);
    const v1 = versionOf(o);
    const head = await as('service_role', `SELECT version, roles, permissions FROM public.rbac_config ORDER BY updated_at DESC LIMIT 1`);
    expect(head).toMatchObject({ ok: true, rows: [{ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], permissions: { VIEW_DASHBOARD: ['COMPANY_ADMIN'] } }] });
    expect(versionOf(head)).toBe(v1);
  });

  it('a stale edit is refused with RBAC_CONFIG_STALE (DETAIL = current head); a fresh one advances the version', async () => {
    const v1 = versionOf(await save('service_role', null));
    const stale = await save('service_role', null);
    expect(stale).toMatchObject({ ok: false, code: 'P0001' });
    expect(errorOf(stale).message).toContain('RBAC_CONFIG_STALE');
    expect(errorOf(stale).detail).toBe(String(v1));
    const fresh = await save('service_role', v1);
    expect(fresh.ok).toBe(true);
    expect(versionOf(fresh)).toBeGreaterThan(v1);
    const order = (await db.query(`SELECT version, updated_at FROM public.rbac_config ORDER BY version`)).rows;
    expect(order).toHaveLength(2);
    expect(new Date(order[1].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(order[0].updated_at).getTime());
  });

  it('two concurrent saves of the same version: exactly one wins, the other is STALE (advisory lock)', async () => {
    const v1 = versionOf(await save('service_role', null));
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      for (const c of [c1, c2]) { await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role'); }
      const q = `SELECT version FROM public.save_rbac_config($1::jsonb, $2::jsonb, $3::uuid, $4::bigint)`;
      await c1.query(q, [ROLES_JSON, PERMS_JSON, ACTOR, v1]);
      const second = c2.query(q, [ROLES_JSON, PERMS_JSON, ACTOR, v1]).then(() => 'ok', (e: { message?: string }) => e.message ?? '');
      await new Promise((r) => setTimeout(r, 300));
      await c1.query('COMMIT');
      const outcome = await second;
      await c2.query('ROLLBACK').catch(() => undefined);
      expect(outcome).toContain('RBAC_CONFIG_STALE');
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    expect((await db.query('SELECT count(*)::int AS n FROM public.rbac_config')).rows[0].n).toBe(2);
  });

  it('repair / recovery: a governed save supersedes an untrusted stored document', async () => {
    // An owner-written document the application would refuse to trust (no usable permission keys).
    const bad = (await db.query(`INSERT INTO public.rbac_config (roles, permissions) VALUES ('["SUPER_ADMIN"]'::jsonb, '{"NOT_A_PERMISSION":["NOBODY"]}'::jsonb) RETURNING version`)).rows[0].version;
    const repaired = await save('service_role', Number(bad));
    expect(repaired.ok).toBe(true);
    const head = (await db.query(`SELECT version, permissions FROM public.rbac_config ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    expect(Number(head.version)).toBe(versionOf(repaired));
    expect(head.permissions).toEqual({ VIEW_DASHBOARD: ['COMPANY_ADMIN'] });
  });

  it('authenticated / anon cannot call the save function', async () => {
    denied(await save('authenticated', null));
    denied(await save('anon', null));
    expect((await db.query('SELECT count(*)::int AS n FROM public.rbac_config')).rows[0].n).toBe(0);
  });
});

describe('post-conditions refuse a contract that would leave another write path open', () => {
  afterEach(async () => {
    await db.query('ROLLBACK').catch(() => undefined);
    for (const r of ['c15q_rogue_child', 'c15q_rogue']) {
      if ((await db.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [r])).rowCount) {
        await db.query(`REVOKE ALL ON public.rbac_config FROM ${r}`);
        await db.query(`DROP ROLE ${r}`);
      }
    }
  });

  it('a direct UPDATE grant to an unrelated role aborts the whole step (nothing changes)', async () => {
    await db.query('CREATE ROLE c15q_rogue NOLOGIN');
    await db.query('GRANT UPDATE ON public.rbac_config TO c15q_rogue');
    const r = await applyFile(CONTRACT);
    expect(r).toMatchObject({ ok: false });
    expect(failureOf(r)).toContain('RBAC_CONTRACT_POSTCONDITION');
    expect(failureOf(r)).toContain('c15q_rogue:UPDATE');
    expect(await tablePrivs('c15q_rogue')).toEqual(['UPDATE']);
  });

  it('an INHERITED write grant (role → member) is detected too', async () => {
    await db.query('CREATE ROLE c15q_rogue NOLOGIN');
    await db.query('CREATE ROLE c15q_rogue_child NOLOGIN INHERIT');
    await db.query('GRANT TRUNCATE ON public.rbac_config TO c15q_rogue');
    await db.query('GRANT c15q_rogue TO c15q_rogue_child');
    const r = await applyFile(CONTRACT);
    expect(r).toMatchObject({ ok: false });
    expect(failureOf(r)).toContain('c15q_rogue_child:TRUNCATE');
  });

  it('precondition: the step refuses when service_role cannot EXECUTE save_rbac_config (saves would break)', async () => {
    await db.query('REVOKE EXECUTE ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) FROM service_role');
    try {
      const r = await applyFile(CONTRACT);
      expect(r).toMatchObject({ ok: false });
      expect(failureOf(r)).toContain('RBAC_CONTRACT_PRECONDITION');
    } finally {
      await db.query('GRANT EXECUTE ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) TO service_role');
    }
  });
});

describe('rollback and repeatability', () => {
  afterAll(async () => {
    // Leave the database in the contract state whatever happened above.
    await applyFile(CONTRACT);
  });

  it('the rollback re-opens ONLY the legacy INSERT; the identity column needs no sequence privilege', async () => {
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    expect(await tablePrivs('service_role')).toEqual(['INSERT', 'SELECT']);
    expect(await seqPrivs('service_role')).toEqual([]);
    const legacy = await as('service_role',
      `INSERT INTO public.rbac_config (roles, permissions, updated_at) VALUES ($1::jsonb, $2::jsonb, now()) RETURNING version`, [ROLES_JSON, PERMS_JSON]);
    expect(legacy.ok).toBe(true);
    expect(versionOf(legacy)).toBeGreaterThan(0);
    denied(await as('service_role', `UPDATE public.rbac_config SET permissions = permissions`));
    denied(await as('service_role', `DELETE FROM public.rbac_config`));
    denied(await as('service_role', `TRUNCATE public.rbac_config`));
    // the governed path keeps working while rolled back
    expect((await save('service_role', versionOf(legacy))).ok).toBe(true);
  });

  it('the rollback is repeatable; re-applying the contract restores the contract state; re-applying it again is a no-op', async () => {
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    expect(await applyFile(CONTRACT)).toEqual({ ok: true });
    await expectContractState();
    const acl = (await db.query(`SELECT relacl::text AS a FROM pg_class WHERE oid = 'public.rbac_config'::regclass`)).rows[0].a;
    expect(await applyFile(CONTRACT)).toEqual({ ok: true });
    expect((await db.query(`SELECT relacl::text AS a FROM pg_class WHERE oid = 'public.rbac_config'::regclass`)).rows[0].a).toBe(acl);
    await expectContractState();
  });
});
