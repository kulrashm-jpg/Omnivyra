import assert from 'node:assert/strict';
import test from 'node:test';

import { E2ECleanupError, cleanupIdentity } from './e2eIdentityCleanup';

/**
 * Minimal fake of the Supabase client surface `cleanupIdentity` uses, recording
 * every statement so the tests can assert that each delete carried an explicit
 * identity predicate — and that the append-only audit table is never targeted.
 */
type Recorded = { table: string; op: string; column?: string; values?: unknown };

type FakeOptions = {
  authUsers?: Array<{ id: string; email: string }>;
  appUsers?: Array<{ id: string; supabase_uid?: string | null }>;
  /** e.g. 'users.id' to make that delete fail, or 'deleteUser'. */
  failOn?: string;
  auditCount?: number;
};

function makeAdmin(options: FakeOptions) {
  const recorded: Recorded[] = [];
  const deletedAuthIds: string[] = [];

  const client = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: options.authUsers ?? [] }, error: null }),
        deleteUser: async (id: string) => {
          if (options.failOn === 'deleteUser') return { error: { message: 'auth delete failed' } };
          deletedAuthIds.push(id);
          return { error: null };
        },
      },
    },
    from(table: string) {
      return {
        select(_columns: string, opts?: { count?: string; head?: boolean }) {
          const isCount = Boolean(opts && opts.count);
          return {
            ilike(column: string, value: string) {
              recorded.push({ table, op: 'select.ilike', column, values: value });
              const rows = table === 'users' ? (options.appUsers ?? []) : [];
              return Promise.resolve({ data: rows, error: null });
            },
            in(column: string, values: unknown[]) {
              recorded.push({
                table,
                op: isCount ? 'count.in' : 'select.in',
                column,
                values,
              });
              if (options.failOn === `count.${table}`) {
                return Promise.resolve({ count: null, data: null, error: { message: 'count failed' } });
              }
              return Promise.resolve({
                count: options.auditCount ?? 0,
                data: [],
                error: null,
              });
            },
          };
        },
        delete() {
          return {
            in(column: string, values: unknown[]) {
              return {
                select: async () => {
                  recorded.push({ table, op: 'delete.in', column, values });
                  if (options.failOn === `${table}.${column}`) {
                    return { data: null, error: { message: 'delete failed' } };
                  }
                  const n = table === 'users' ? (options.appUsers ?? []).length : 0;
                  return {
                    data: Array.from({ length: n }, (_unused, i) => ({ id: `row-${i}` })),
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    client: client as unknown as Parameters<typeof cleanupIdentity>[0],
    recorded,
    deletedAuthIds,
  };
}

const EMAIL = 'authcallb-abc123-xy@qa.co';
const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const APP_ID = '11111111-1111-4111-8111-111111111111';

const presentIdentity: FakeOptions = {
  authUsers: [{ id: AUTH_ID, email: EMAIL }],
  appUsers: [{ id: APP_ID, supabase_uid: AUTH_ID }],
};

test('cleanup removes the auth user and the application user row', async () => {
  const { client, deletedAuthIds } = makeAdmin({ ...presentIdentity, auditCount: 2 });
  const result = await cleanupIdentity(client, EMAIL);

  assert.equal(result.authUserDeleted, true);
  assert.equal(result.appUserRowsDeleted, 1);
  assert.deepEqual(deletedAuthIds, [AUTH_ID]);
});

test('append-only audit rows are observed, never deleted', async () => {
  const { client, recorded } = makeAdmin({ ...presentIdentity, auditCount: 2 });
  const result = await cleanupIdentity(client, EMAIL);

  assert.equal(result.auditRowsObserved, 2);
  const auditDeletes = recorded.filter(
    (r) => r.table === 'capability_audit_log' && r.op.startsWith('delete'),
  );
  assert.deepEqual(
    auditDeletes,
    [],
    'capability_audit_log is append-only (capability_audit_log_no_delete trigger, ' +
      'present in production); attempting a DELETE raises and fails every spec',
  );
});

test('every delete carries an explicit identity predicate', async () => {
  const { client, recorded } = makeAdmin(presentIdentity);
  await cleanupIdentity(client, EMAIL);

  const deletes = recorded.filter((r) => r.op.startsWith('delete'));
  assert.ok(deletes.length >= 1, 'expected at least the users delete');
  for (const d of deletes) {
    assert.equal(d.op, 'delete.in', `delete on ${d.table} must use an .in() predicate`);
    assert.ok(d.column, `delete on ${d.table} must name a predicate column`);
    assert.ok(
      Array.isArray(d.values) && d.values.length > 0,
      `delete on ${d.table}.${d.column} must have a non-empty identity list`,
    );
  }
});

test('IDEMPOTENT: a second run resolves no identity and deletes nothing', async () => {
  const { client, recorded } = makeAdmin({ authUsers: [], appUsers: [] });
  const result = await cleanupIdentity(client, EMAIL);

  assert.deepEqual(result.userIds, []);
  assert.equal(result.authUserDeleted, false);
  assert.equal(result.appUserRowsDeleted, 0);
  assert.equal(result.auditRowsObserved, 0);
  assert.ok(result.notes.includes('identity not present (already cleaned)'));
  assert.deepEqual(
    recorded.filter((r) => r.op.startsWith('delete')),
    [],
    'a repeat cleanup must issue NO delete statements',
  );
});

test('no unpredicated delete is ever issued when the identity list is empty', async () => {
  const { client, recorded } = makeAdmin({ authUsers: [], appUsers: [] });
  await cleanupIdentity(client, EMAIL);
  assert.equal(
    recorded.some((r) => r.op.startsWith('delete')),
    false,
  );
});

test('a failed user delete is surfaced, not swallowed', async () => {
  const { client } = makeAdmin({ ...presentIdentity, failOn: 'users.id' });
  await assert.rejects(
    () => cleanupIdentity(client, EMAIL),
    (error: unknown) =>
      error instanceof E2ECleanupError && /delete failed/.test((error as Error).message),
  );
});

test('a failed auth deleteUser is surfaced, not swallowed', async () => {
  const { client } = makeAdmin({ ...presentIdentity, failOn: 'deleteUser' });
  await assert.rejects(
    () => cleanupIdentity(client, EMAIL),
    (error: unknown) =>
      error instanceof E2ECleanupError && /auth delete failed/.test((error as Error).message),
  );
});

test('an empty email is refused rather than matching everything', async () => {
  const { client, recorded } = makeAdmin({});
  await assert.rejects(() => cleanupIdentity(client, '   '), E2ECleanupError);
  assert.deepEqual(recorded, []);
});
