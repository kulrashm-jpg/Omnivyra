/**
 * Closure-015R — REAL-POSTGRES proof of the pre-C-7 privilege reduction
 * (supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql) and of the full chain
 * interim → deferred C-7 contract → contract rollback → interim.
 * DESTRUCTIVE: truncates public.rbac_config, re-grants the broad hosted-default privileges to reproduce
 * the F-1 state, creates and drops roles, re-applies migrations. Run on a DISPOSABLE database only,
 * after 20261210000001..4 (and normally 20261211000001) are installed:
 *
 *     npm run test:realschema -- closure015r
 *
 * beforeAll re-applies the forward migration (idempotent) unless C15N_NO_APPLY=1 (then it tests the
 * INSTALLED state — used by the SQL mutation runner). Privileges are EFFECTIVE privileges, and every
 * runtime operation runs under `SET LOCAL ROLE service_role`, the role PostgREST uses for the server key.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
// C15R_MIGRATION_FILE / C15R_ROLLBACK_FILE let the SQL mutation runner substitute mutated copies.
const MIGRATION = process.env.C15R_MIGRATION_FILE
  || path.resolve(__dirname, '../../../supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql');
const ROLLBACK = process.env.C15R_ROLLBACK_FILE
  || path.resolve(__dirname, '../../../supabase/migrations/rollbacks/rbac_config_pre_c7_privilege_reduction_rollback.sql');
const CONTRACT = path.resolve(__dirname, '../../../supabase/deferred/rbac_config_contract_legacy_insert.sql');
const CONTRACT_ROLLBACK = path.resolve(__dirname, '../../../supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql');
const ACTOR = '00000000-0000-4000-8000-000000c15b01';
const APP_ROLES = ['service_role', 'authenticated', 'anon', 'authenticator'] as const;
const TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] as const;
const ROLES_JSON = JSON.stringify(['SUPER_ADMIN', 'COMPANY_ADMIN']);
const PERMS_JSON = JSON.stringify({ VIEW_DASHBOARD: ['COMPANY_ADMIN'] });

type Outcome = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string; detail: string };
type FileResult = { ok: true } | { ok: false; message: string };

/** Runs `sql` in its own transaction as `role` (null = owner session); commits on success unless commit=false. */
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
async function applyFile(file: string): Promise<FileResult> {
  try {
    await db.query(fs.readFileSync(file, 'utf8'));
    return { ok: true };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    return { ok: false, message: (e as { message?: string }).message ?? '' };
  }
}

/** Narrowing helpers (no casts; `in` narrows under the project's strict:false). */
const rowsOf = (o: Outcome): Record<string, unknown>[] => {
  if ('rows' in o) return o.rows;
  throw new Error(`expected success, got ${o.code} ${o.message}`);
};
const errorOf = (o: Outcome): { code: string; message: string; detail: string } => {
  if ('code' in o) return o;
  throw new Error('expected an error, the statement succeeded');
};
const failureOf = (f: FileResult): string => {
  if ('message' in f) return f.message;
  throw new Error('expected the SQL file to fail, it applied');
};
const versionOf = (o: Outcome) => Number(rowsOf(o)[0].version);

const seq = async () => (await db.query(`SELECT pg_get_serial_sequence('public.rbac_config', 'version') AS s`)).rows[0].s as string;
const tablePrivs = async (role: string) =>
  (await db.query(`SELECT p FROM unnest($2::text[]) p WHERE has_table_privilege($1, 'public.rbac_config', p) ORDER BY p`, [role, [...TABLE_PRIVS]])).rows.map((r) => r.p as string);
const seqPrivs = async (role: string) =>
  (await db.query(`SELECT p FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) p WHERE has_sequence_privilege($1, $2, p) ORDER BY p`, [role, await seq()])).rows.map((r) => r.p as string);
const save = (role: string, expected: number | null) =>
  as(role, `SELECT version FROM public.save_rbac_config($1::jsonb, $2::jsonb, $3::uuid, $4::bigint)`, [ROLES_JSON, PERMS_JSON, ACTOR, expected]);
const legacyInsert = (role: string) =>
  as(role, `INSERT INTO public.rbac_config (roles, permissions, updated_by, updated_at) VALUES ($1::jsonb, $2::jsonb, $3, now()) RETURNING version`, [ROLES_JSON, PERMS_JSON, ACTOR]);
const denied = (o: Outcome) => expect(o).toMatchObject({ ok: false, code: '42501' });

/** The interim contract, asserted as effective privileges. */
async function expectInterimState() {
  expect(await tablePrivs('service_role')).toEqual(['INSERT', 'SELECT']);
  for (const r of ['authenticated', 'anon', 'authenticator', 'public']) expect(await tablePrivs(r)).toEqual([]);
  for (const r of [...APP_ROLES, 'public']) expect(await seqPrivs(r)).toEqual([]);
}

/** Reproduces the F-1 pre-state (what Supabase's default privileges grant when 0003 runs). */
async function grantHostedDefaults() {
  await db.query('GRANT ALL ON TABLE public.rbac_config TO service_role');
  await db.query(`GRANT ALL ON SEQUENCE ${await seq()} TO service_role, authenticated`);
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
    const r = await applyFile(MIGRATION);
    if ('message' in r) throw new Error(`pre-C-7 privilege reduction failed to apply: ${r.message}`);
  }
});
beforeEach(async () => { await db.query('TRUNCATE public.rbac_config RESTART IDENTITY'); });
// Runs after every describe-level afterAll: restore the exact privileges this suite found.
afterAll(async () => { await restoreAcl(aclAtStart); });

describe('effective privileges in the interim (pre-C-7) contract', () => {
  it('service_role holds exactly SELECT and INSERT; authenticated / anon / authenticator / PUBLIC hold nothing; nobody holds the sequence', async () => {
    await expectInterimState();
  });

  it('no column-level UPDATE / REFERENCES; column INSERT only for service_role', async () => {
    const rows = (await db.query(
      `SELECT r || ':' || p AS x FROM unnest($1::text[]) r, unnest(ARRAY['INSERT','UPDATE','REFERENCES']) p
        WHERE has_any_column_privilege(r, 'public.rbac_config', p) ORDER BY 1`, [[...APP_ROLES, 'public']])).rows.map((r) => r.x);
    expect(rows).toEqual(['service_role:INSERT']);
  });

  it('no unexpected (non-owner, non-superuser) writer — including through inheritance — and no sequence user', async () => {
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
          AND has_sequence_privilege(r.oid, pg_get_serial_sequence('public.rbac_config', 'version'), p)
       ORDER BY 1`)).rows.map((r) => r.x);
    expect(rows).toEqual(['service_role:INSERT']);
  });

  it('the governed function is unchanged: SECURITY DEFINER, non-application owner, EXECUTE for service_role only', async () => {
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

describe('unauthorized direct access is DENIED (42501) in the interim contract', () => {
  beforeEach(async () => {
    await db.query(`INSERT INTO public.rbac_config (roles, permissions, updated_by) VALUES ($1::jsonb, $2::jsonb, $3)`, [ROLES_JSON, PERMS_JSON, ACTOR]);
  });
  it('service_role UPDATE in place', async () => {
    denied(await as('service_role', `UPDATE public.rbac_config SET permissions = '{"X":["Y"]}'::jsonb`));
  });
  it('service_role DELETE (would re-activate an older configuration)', async () => {
    denied(await as('service_role', `DELETE FROM public.rbac_config`));
  });
  it('service_role TRUNCATE', async () => {
    denied(await as('service_role', `TRUNCATE public.rbac_config`));
  });
  it('service_role LOCK … ACCESS EXCLUSIVE (needs UPDATE/DELETE/TRUNCATE/MAINTAIN)', async () => {
    denied(await as('service_role', `LOCK TABLE public.rbac_config IN ACCESS EXCLUSIVE MODE`, [], false));
  });
  it('service_role CREATE TRIGGER on the table', async () => {
    denied(await as('service_role',
      `CREATE TRIGGER c15r_rogue BEFORE INSERT ON public.rbac_config FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_membership_company()`, [], false));
  });
  it('sequence reset (setval) and nextval — service_role and authenticated', async () => {
    const s = await seq();
    for (const r of ['service_role', 'authenticated']) {
      denied(await as(r, `SELECT setval($1::regclass, 1)`, [s], false));
      denied(await as(r, `SELECT nextval($1::regclass)`, [s], false));
    }
  });
  it('authenticated / anon can neither read nor insert', async () => {
    for (const r of ['authenticated', 'anon']) {
      denied(await as(r, `SELECT * FROM public.rbac_config`));
      denied(await legacyInsert(r));
    }
  });
  it('the owner-written row is untouched', async () => {
    expect((await db.query('SELECT count(*)::int AS n FROM public.rbac_config')).rows[0].n).toBe(1);
  });
});

describe('legitimate paths keep working under service_role (pre-C-7)', () => {
  it('legacy direct INSERT (the PGRST202 fallback) succeeds and gets an identity version WITHOUT any sequence privilege', async () => {
    expect(await seqPrivs('service_role')).toEqual([]);
    const o = await legacyInsert('service_role');
    expect(versionOf(o)).toBeGreaterThan(0);
    const read = await as('service_role', `SELECT updated_at FROM public.rbac_config ORDER BY updated_at DESC LIMIT 1`);
    expect(rowsOf(read)).toHaveLength(1);
  });

  it('versioned saves: NULL → v1, stale refused (DETAIL = head), fresh advances; reads see the head', async () => {
    const v1 = versionOf(await save('service_role', null));
    const stale = errorOf(await save('service_role', null));
    expect(stale.message).toContain('RBAC_CONFIG_STALE');
    expect(stale.detail).toBe(String(v1));
    const v2 = versionOf(await save('service_role', v1));
    expect(v2).toBeGreaterThan(v1);
    const head = await as('service_role', `SELECT version FROM public.rbac_config ORDER BY updated_at DESC LIMIT 1`);
    expect(versionOf(head)).toBe(v2);
  });

  it('a legacy row and a governed save interleave correctly (the governed save must name the legacy head)', async () => {
    const legacy = versionOf(await legacyInsert('service_role'));
    expect(errorOf(await save('service_role', null)).message).toContain('RBAC_CONFIG_STALE');
    expect(versionOf(await save('service_role', legacy))).toBeGreaterThan(legacy);
  });

  it('repair / recovery: a governed save supersedes an untrusted stored document', async () => {
    const bad = (await db.query(`INSERT INTO public.rbac_config (roles, permissions) VALUES ('["SUPER_ADMIN"]'::jsonb, '{"NOT_A_PERMISSION":["NOBODY"]}'::jsonb) RETURNING version`)).rows[0].version;
    const repaired = versionOf(await save('service_role', Number(bad)));
    const head = (await db.query(`SELECT version, permissions FROM public.rbac_config ORDER BY updated_at DESC LIMIT 1`)).rows[0];
    expect(Number(head.version)).toBe(repaired);
    expect(head.permissions).toEqual({ VIEW_DASHBOARD: ['COMPANY_ADMIN'] });
  });

  it('authenticated / anon cannot call the save function', async () => {
    denied(await save('authenticated', null));
    denied(await save('anon', null));
  });
});

describe('the migration itself: effect, fail-safety, idempotency', () => {
  afterEach(async () => {
    await db.query('ROLLBACK').catch(() => undefined);
    for (const r of ['c15r_rogue_child', 'c15r_rogue']) {
      if ((await db.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [r])).rowCount) {
        await db.query(`REVOKE ALL ON public.rbac_config FROM ${r}`);
        await db.query(`DROP ROLE ${r}`);
      }
    }
    // always leave the interim contract in place
    expect(await applyFile(MIGRATION)).toEqual({ ok: true });
  });

  it('from the F-1 state (hosted-default ALL on table, rwU on the sequence) it produces exactly the interim contract', async () => {
    await grantHostedDefaults();
    expect(await tablePrivs('service_role')).toEqual([...TABLE_PRIVS].sort());
    expect(await seqPrivs('authenticated')).toEqual(['SELECT', 'UPDATE', 'USAGE']);
    expect(await applyFile(MIGRATION)).toEqual({ ok: true });
    await expectInterimState();
  });

  it('re-applying is a no-op (identical ACLs)', async () => {
    const before = (await db.query(`SELECT relacl::text AS a FROM pg_class WHERE oid = 'public.rbac_config'::regclass`)).rows[0].a;
    expect(await applyFile(MIGRATION)).toEqual({ ok: true });
    expect((await db.query(`SELECT relacl::text AS a FROM pg_class WHERE oid = 'public.rbac_config'::regclass`)).rows[0].a).toBe(before);
    await expectInterimState();
  });

  it('an unexpected direct writer aborts the whole migration — nothing changes, not even the hosted-default revoke', async () => {
    await grantHostedDefaults();
    await db.query('CREATE ROLE c15r_rogue NOLOGIN');
    await db.query('GRANT DELETE ON public.rbac_config TO c15r_rogue');
    const msg = failureOf(await applyFile(MIGRATION));
    expect(msg).toContain('RBAC_PRIVILEGE_REDUCTION_POSTCONDITION');
    expect(msg).toContain('c15r_rogue:DELETE');
    expect(await tablePrivs('service_role')).toEqual([...TABLE_PRIVS].sort());   // rolled back as a whole
    expect(await tablePrivs('c15r_rogue')).toEqual(['DELETE']);
  });

  it('an INHERITED writer (role → member) is detected', async () => {
    await db.query('CREATE ROLE c15r_rogue NOLOGIN');
    await db.query('CREATE ROLE c15r_rogue_child NOLOGIN INHERIT');
    await db.query('GRANT UPDATE ON public.rbac_config TO c15r_rogue');
    await db.query('GRANT c15r_rogue TO c15r_rogue_child');
    expect(failureOf(await applyFile(MIGRATION))).toContain('c15r_rogue_child:UPDATE');
  });

  it('a second INSERT holder besides service_role is an unexpected writer', async () => {
    await db.query('CREATE ROLE c15r_rogue NOLOGIN');
    await db.query('GRANT INSERT ON public.rbac_config TO c15r_rogue');
    expect(failureOf(await applyFile(MIGRATION))).toContain('c15r_rogue:INSERT');
  });

  it('precondition: refuses when service_role cannot EXECUTE save_rbac_config', async () => {
    await db.query('REVOKE EXECUTE ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) FROM service_role');
    try {
      expect(failureOf(await applyFile(MIGRATION))).toContain('RBAC_PRIVILEGE_REDUCTION_PRECONDITION');
    } finally {
      await db.query('GRANT EXECUTE ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) TO service_role');
    }
  });

  it('the rollback re-asserts ONLY the interim contract (repeatable; never the broad default)', async () => {
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    await expectInterimState();
  });

  it('the rollback re-establishes the interim contract even when applied from the post-C-7 contract state', async () => {
    expect(await applyFile(CONTRACT)).toEqual({ ok: true });
    expect(await tablePrivs('service_role')).toEqual(['SELECT']);
    expect(await applyFile(ROLLBACK)).toEqual({ ok: true });
    await expectInterimState();
  });
});

describe('the full chain: interim → deferred C-7 contract → contract rollback → interim', () => {
  afterAll(async () => { await applyFile(MIGRATION); });

  it('the deferred contract removes INSERT only (SELECT stays, sequence stays empty); the legacy path then fails closed', async () => {
    expect(await applyFile(CONTRACT)).toEqual({ ok: true });
    expect(await tablePrivs('service_role')).toEqual(['SELECT']);
    for (const r of [...APP_ROLES, 'public']) expect(await seqPrivs(r)).toEqual([]);
    denied(await legacyInsert('service_role'));
    expect(versionOf(await save('service_role', null))).toBeGreaterThan(0);
  });

  it('the contract rollback returns to exactly the interim contract', async () => {
    expect(await applyFile(CONTRACT)).toEqual({ ok: true });
    expect(await applyFile(CONTRACT_ROLLBACK)).toEqual({ ok: true });
    await expectInterimState();
    expect(versionOf(await legacyInsert('service_role'))).toBeGreaterThan(0);
  });
});
