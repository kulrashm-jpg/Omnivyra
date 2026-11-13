/**
 * Test-only model of public.revoke_super_admin (20270217000052, M2) over the routeAuthHarness's in-memory rows.
 *
 * The harness's rpc() returns {data:null, error:null} for every function and models no write, so suites that drive the
 * governed revoke route through it route 'revoke_super_admin' here instead (the same pattern they already use for
 * save_rbac_config). The semantics mirror the SQL body; the real guarantees - one transaction, the shared advisory
 * lock, two concurrent revokes of the last two admins -> exactly one succeeds - are proven against Postgres in
 * backend/tests/realschema/super_admin_guards_m1_m2.test.ts, not here.
 */
import { rows } from './routeAuthHarness';

type Row = Record<string, unknown>;
const isSa = (r: Row) => String(r.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN';

export const revokeModelControl: { failWith: { code?: string; message: string } | null } = { failWith: null };

export function modelRevokeSuperAdmin(args: { p_user_id?: string } | undefined): { data: unknown; error: unknown } {
  if (revokeModelControl.failWith) return { data: null, error: revokeModelControl.failWith };
  const target = args?.p_user_id;
  if (!target) return { data: null, error: { code: 'P0001', message: 'REVOKE_SUPER_ADMIN_MISSING_ARGUMENT' } };
  const memberships = rows('user_company_roles');
  const users = rows('users');
  const notDeleted = (uid: unknown) => users.some((u) => u.id === uid && u.is_deleted !== true);

  const targetActive = memberships.some((r) => r.user_id === target && isSa(r) && r.status === 'active');
  const others = new Set(
    memberships.filter((r) => isSa(r) && r.status === 'active' && r.user_id !== target && notDeleted(r.user_id)).map((r) => r.user_id),
  ).size;
  if (targetActive && others === 0) {
    return { data: null, error: { code: 'P0001', message: 'LAST_SUPER_ADMIN' } };
  }

  let usersRow = 0;
  for (const u of users) if (u.id === target && isSa(u)) { u.role = 'COMPANY_ADMIN'; usersRow++; }
  const companies: unknown[] = [];
  for (const r of memberships) if (r.user_id === target && isSa(r)) { r.role = 'COMPANY_ADMIN'; companies.push(r.company_id); }
  return {
    data: { users_role_downgraded: usersRow > 0, downgraded_company_ids: companies, remaining_super_admins: others },
    error: null,
  };
}
