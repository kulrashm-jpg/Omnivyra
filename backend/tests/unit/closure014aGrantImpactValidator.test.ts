/**
 * Closure-014A — the local grant-impact validator fails closed.
 *
 * A scripted fake client stands in for Postgres (no database, no network): it
 * records every statement and answers by pattern, so each failure path —
 * UPDATE succeeding inside READ ONLY, an unexpected SQLSTATE, a fixture
 * mismatch, a failure mid-fixture, surviving synthetic rows, connect/close
 * failures — is exercised deterministically. The real end-to-end run against
 * the local certification database is recorded separately.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const V = require('../../../scripts/cert/validate-grant-impact-query.cjs') as {
  EXPECTED_MATRIX: readonly string[];
  assertLoopbackTarget: (url: string) => string;
  assertReadOnlyEnforced: (c: unknown, log?: (m: string) => void) => Promise<string>;
  runFixtureMatrix: (c: unknown, q: { q1: string; q2: string }, log?: (m: string) => void) => Promise<void>;
  assertNoSyntheticRows: (c: unknown) => Promise<void>;
  main: (o: Record<string, unknown>) => Promise<number>;
};

type Answer = (sql: string, params?: unknown[]) => unknown;
const pgError = (code: string) => Object.assign(new Error(`pg error ${code}`), { code });

/** Fake pg client: `script` maps a regex over the SQL to an answer (value, or throw). Records statements. */
function fakeClient(script: Array<[RegExp, Answer]>, opts: { connectError?: Error; endError?: Error } = {}) {
  const log: string[] = [];
  const state = { ended: 0, connected: false };
  const client = {
    async connect() { if (opts.connectError) throw opts.connectError; state.connected = true; },
    async end() { state.ended += 1; if (opts.endError) throw opts.endError; },
    async query(sql: string, params?: unknown[]) {
      log.push(sql.trim().split('\n')[0].slice(0, 60));
      for (const [re, ans] of script) if (re.test(sql)) return ans(sql, params);
      return { rows: [], rowCount: 0, command: 'SELECT', fields: [] };
    },
  };
  return { client, log, state };
}

/** Script for the fixture matrix: inserts return ids; q1 returns rows mapped from the inserted users. */
function fixtureScript(opts: { mismatch?: boolean; failOnInsertNo?: number } = {}) {
  let n = 0;
  const users: Record<string, string> = {};
  const answers: Array<[RegExp, Answer]> = [
    [/^\s*(BEGIN|ROLLBACK)/i, () => ({ rows: [] })],
    [/insert into public\.companies/i, () => ({ rows: [{ id: 'co-1' }] })],
    [/insert into public\.users/i, (_s, p) => {
      n += 1;
      if (opts.failOnInsertNo === n) throw pgError('23505');
      const key = String((p as string[])[0]).replace(/^c13g-|@c13g\.invalid$/g, '');
      users[key] = `u-${key}`;
      return { rows: [{ id: `u-${key}` }] };
    }],
    [/insert into public\.(user_company_roles|capability_assignments)/i, () => ({ rows: [] })],
    [/holders AS/, () => {
      const id: Record<string, string> = { deleted: 'deleted', inactiveSA: 'inactive-sa', lowerSA: 'lower-sa', orgScoped: 'org-scoped', parent: 'parent', viewer: 'viewer' };
      const rows = V.EXPECTED_MATRIX.map((line) => {
        const [k, capability, grant_source, grant_scope, super_admin_role_status, account_state, impact] = line.split('|');
        return { principal_user_id: users[id[k]], capability, grant_source, grant_scope, super_admin_role_status, account_state, impact };
      });
      if (opts.mismatch) rows[0] = { ...rows[0], impact: 'SOMETHING_ELSE' };
      return { rows };
    }],
    [/exact_sa AS/, () => ({ rows: [{ metric: 'm', principals: 1, grant_rows: 1 }] })],
  ];
  return answers;
}
const Q = { q1: 'WITH write_tier ... holders AS (...)', q2: 'WITH write_tier ... exact_sa AS (...)' };

describe('loopback target guard', () => {
  it.each(['postgresql://u:p@127.0.0.1:54322/postgres', 'postgresql://u:p@localhost:54322/x', 'postgresql://u:placeholder@[::1]:54322/x'])('accepts %s', (u) => {
    expect(() => V.assertLoopbackTarget(u)).not.toThrow();
  });
  it.each(['postgresql://u:placeholder@db.klkiseupptzbecbxwrky.supabase.co:5432/postgres', 'postgresql://u:placeholder@10.0.0.5:5432/x', 'not a url'])('refuses %s without echoing it', (u) => {
    let msg = '';
    try { V.assertLoopbackTarget(u); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/^REFUSING/);
    expect(msg).not.toContain('u:p');
  });
  it('main refuses a non-loopback target BEFORE constructing a client', async () => {
    const Ctor = jest.fn();
    const code = await V.main({ url: 'postgresql://u:p@prod.example.com:5432/db', ClientCtor: Ctor, sqlFile: 'x', log: () => {}, logError: () => {} });
    expect(code).toBe(1);
    expect(Ctor).not.toHaveBeenCalled();
  });
});

describe('READ ONLY enforcement check (fail closed)', () => {
  it('25006 is the only proof: passes and rolls back', async () => {
    const f = fakeClient([[/^update/i, () => { throw pgError('25006'); }]]);
    await expect(V.assertReadOnlyEnforced(f.client)).resolves.toBe('25006');
    expect(f.log.filter((l) => /^ROLLBACK/.test(l))).toHaveLength(1);
  });
  it('the UPDATE SUCCEEDING fails the check (and still rolls back)', async () => {
    const f = fakeClient([[/^update/i, () => ({ rows: [], rowCount: 0 })]]);
    await expect(V.assertReadOnlyEnforced(f.client)).rejects.toThrow(/UPDATE SUCCEEDED inside a READ ONLY transaction/);
    expect(f.log.filter((l) => /^ROLLBACK/.test(l))).toHaveLength(1);
  });
  it.each(['42P01', '57014', '08006'])('an unexpected SQLSTATE %s is NOT counted as enforcement', async (code) => {
    const f = fakeClient([[/^update/i, () => { throw pgError(code); }]]);
    await expect(V.assertReadOnlyEnforced(f.client)).rejects.toThrow(new RegExp(`unexpected database error \\(SQLSTATE ${code}\\)`));
    expect(f.log.filter((l) => /^ROLLBACK/.test(l))).toHaveLength(1);
  });
  it('an error without any SQLSTATE fails too', async () => {
    const f = fakeClient([[/^update/i, () => { throw new Error('socket hang up'); }]]);
    await expect(V.assertReadOnlyEnforced(f.client)).rejects.toThrow(/SQLSTATE none/);
  });
  it('a failing ROLLBACK after a correct 25006 still fails the check', async () => {
    const f = fakeClient([[/^update/i, () => { throw pgError('25006'); }], [/^ROLLBACK/, () => { throw pgError('08006'); }]]);
    await expect(V.assertReadOnlyEnforced(f.client)).rejects.toThrow(/ROLLBACK failed/);
  });
});

describe('fixture matrix (always rolled back)', () => {
  it('the expected classification passes and the transaction is rolled back', async () => {
    const f = fakeClient(fixtureScript());
    await expect(V.runFixtureMatrix(f.client, Q)).resolves.toBeUndefined();
    expect(f.log[0]).toMatch(/^BEGIN/);
    expect(f.log[f.log.length - 1]).toMatch(/^ROLLBACK/);
  });
  it('a MISMATCH fails (non-zero path) after rolling back', async () => {
    const f = fakeClient(fixtureScript({ mismatch: true }));
    await expect(V.runFixtureMatrix(f.client, Q)).rejects.toThrow(/fixture matrix MISMATCH/);
    expect(f.log[f.log.length - 1]).toMatch(/^ROLLBACK/);
  });
  it('a failure mid-fixture still rolls back, and the ORIGINAL error wins', async () => {
    const f = fakeClient(fixtureScript({ failOnInsertNo: 3 }));
    await expect(V.runFixtureMatrix(f.client, Q)).rejects.toMatchObject({ code: '23505' });
    expect(f.log[f.log.length - 1]).toMatch(/^ROLLBACK/);
    expect(f.log.some((l) => /holders AS|WITH write_tier/.test(l))).toBe(false);
  });
  it('the matrix PASSES but its ROLLBACK throws → fails with the fixture rollback diagnostic', async () => {
    const f = fakeClient([[/^ROLLBACK/, () => { throw pgError('08006'); }], ...fixtureScript()]);
    const logs: string[] = [];
    await expect(V.runFixtureMatrix(f.client, Q, (m) => logs.push(m))).rejects.toThrow(/fixture matrix: ROLLBACK failed \(SQLSTATE 08006\)/);
    expect(logs).toContain('diagnostic: ROLLBACK failed during fixture matrix (SQLSTATE 08006)');
    expect(logs.some((m) => m.startsWith('fixture matrix: PASS'))).toBe(true); // the assertions themselves passed
    expect(f.log[f.log.length - 1]).toMatch(/^ROLLBACK/);
  });
  it('a fixture failure AND a failing ROLLBACK → the ORIGINAL error stays primary; the rollback error is attached and logged', async () => {
    const f = fakeClient([[/^ROLLBACK/, () => { throw pgError('08006'); }], ...fixtureScript({ mismatch: true })]);
    const logs: string[] = [];
    let thrown: (Error & { rollbackError?: { code?: string } }) | null = null;
    try { await V.runFixtureMatrix(f.client, Q, (m) => logs.push(m)); } catch (e) { thrown = e as Error & { rollbackError?: { code?: string } }; }
    expect(thrown?.message).toMatch(/^fixture matrix MISMATCH/);
    expect(thrown?.rollbackError?.code).toBe('08006');
    expect(logs).toContain('diagnostic: ROLLBACK failed during fixture matrix (SQLSTATE 08006)');
  });
  it('the expected matrix is the unchanged six-row classification', () => {
    expect(V.EXPECTED_MATRIX).toHaveLength(6);
    expect(V.EXPECTED_MATRIX.filter((l) => l.endsWith('RELEASE_BLOCKER_super_admin_lockout'))).toHaveLength(1);
    expect(V.EXPECTED_MATRIX.some((l) => l.startsWith('exactSA|') || l.startsWith('expired|') || l.startsWith('revoked|') || l.startsWith('readOnly|'))).toBe(false);
  });
});

describe('synthetic-row survival check', () => {
  it('passes only when no synthetic user or company remains', async () => {
    await expect(V.assertNoSyntheticRows(fakeClient([[/from public.users where email like/, () => ({ rows: [{ u: 0, co: 0 }] })]]).client)).resolves.toBeUndefined();
  });
  it.each([[1, 0], [0, 1]])('fails when users=%i companies=%i survived', async (u, co) => {
    await expect(V.assertNoSyntheticRows(fakeClient([[/from public.users where email like/, () => ({ rows: [{ u, co }] })]]).client)).rejects.toThrow(/survived the rollback/);
  });
});

describe('main: client lifecycle and exit codes', () => {
  const okSql = 'select 1;\n';
  const quiet = { log: () => {}, logError: () => {} };
  function ctorFor(f: ReturnType<typeof fakeClient>) { return jest.fn(() => f.client); }

  it('connect failure → exit 1, client closed', async () => {
    const f = fakeClient([], { connectError: new Error('ECONNREFUSED') });
    const errors: string[] = [];
    const code = await V.main({ url: 'postgresql://u:p@127.0.0.1:54322/x', ClientCtor: ctorFor(f), sqlFile: okSql, log: () => {}, logError: (m: string) => errors.push(m) });
    expect(code).toBe(1);
    expect(f.state.ended).toBe(1);
    expect(errors.join(' ')).toMatch(/ECONNREFUSED/);
  });
  it('a validation failure → exit 1, client closed; a close failure does not mask the original error', async () => {
    const f = fakeClient([], { endError: new Error('close boom') });
    const errors: string[] = [];
    const code = await V.main({ url: 'postgresql://u:p@127.0.0.1:54322/x', ClientCtor: ctorFor(f), sqlFile: okSql, log: () => {}, logError: (m: string) => errors.push(m) });
    expect(code).toBe(1);
    expect(f.state.ended).toBe(1);
    expect(errors.find((m) => m.startsWith('VALIDATION FAILED'))).toMatch(/does not contain the expected Query 1/);
    expect(errors.some((m) => /client close failed: close boom/.test(m))).toBe(true);
  });
  it('the SQL file returning 3 result sets instead of 4 → exit 1 with the expected-4 error, client closed', async () => {
    const sqlFile = 'WITH write_tier x holders AS (y);\nWITH write_tier x exact_sa AS (z);\n';
    const f = fakeClient([
      [/server_version/, () => ({ rows: [{ v: '17.6', tables: 838 }] })],
      [/^WITH write_tier x holders AS \(y\);\nWITH/, () => [1, 2, 3].map(() => ({ command: 'SELECT', rows: [], rowCount: 0, fields: [{ name: 'c' }] }))],
    ]);
    const errors: string[] = [];
    const code = await V.main({ url: 'postgresql://u:p@127.0.0.1:54322/x', ClientCtor: ctorFor(f), sqlFile, log: () => {}, logError: (m: string) => errors.push(m) });
    expect(code).toBe(1);
    expect(errors.find((m) => m.startsWith('VALIDATION FAILED'))).toMatch(/expected 4 result sets from the SQL file, got 3/);
    expect(f.state.ended).toBe(1);
    expect(f.log.some((l) => /^BEGIN TRANSACTION READ ONLY|^update/i.test(l))).toBe(false); // stopped before later checks
  });
  it('the full happy path → exit 0, client closed once', async () => {
    const sqlFile = 'WITH write_tier x holders AS (y);\nWITH write_tier x exact_sa AS (z);\n';
    const f = fakeClient([
      [/server_version/, () => ({ rows: [{ v: '17.6', tables: 838 }] })],
      [/^WITH write_tier x holders AS \(y\);\nWITH/, () => [1, 2, 3, 4].map(() => ({ command: 'SELECT', rows: [], rowCount: 0, fields: [{ name: 'c' }] }))],
      [/^BEGIN TRANSACTION READ ONLY/, () => ({ rows: [] })],
      [/^update/i, () => { throw pgError('25006'); }],
      ...fixtureScript(),
      [/from public\.users where email like/, () => ({ rows: [{ u: 0, co: 0 }] })],
    ]);
    const code = await V.main({ url: 'postgresql://u:p@127.0.0.1:54322/x', ClientCtor: ctorFor(f), sqlFile, ...quiet });
    expect(code).toBe(0);
    expect(f.state.ended).toBe(1);
  });
});
