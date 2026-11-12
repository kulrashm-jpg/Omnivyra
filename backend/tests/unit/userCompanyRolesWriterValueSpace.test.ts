/**
 * 20270217000011 (user_company_roles_role_check) - 05's ordering finding.
 * The CHECK excludes the ADMIN alias, and user_company_roles.role has many
 * writers (invite / reinvite / accept / super-admin create + update / self-
 * joined / onboarding / bootstrap / revoke). A writer producing a value outside
 * the CHECK would raise 23514 = a 500 on a real action. This pins every
 * writer's VALUE SPACE inside the CHECK:
 *   1. every validated list a writer takes its role from is a subset;
 *   2. every LITERAL role written in a file that touches user_company_roles
 *      (`role: 'X'` / `role: Role.X`) is a CHECK value (case-sensitive - a
 *      lowercase 'admin' literal fails here, not in production).
 * The CHECK set is read from the migration itself, never hand-copied.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));

const ROOT = path.resolve(__dirname, '../../..');
const CHECK: string[] = (() => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270217000011_user_company_roles_role_check.sql'), 'utf8');
  const i = sql.indexOf('ADD CONSTRAINT user_company_roles_role_check CHECK');
  const arr = sql.slice(i, sql.indexOf(']::text[]', i));
  return Array.from(arr.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]);
})();

it('the CHECK set was read from the migration (non-vacuous)', () => {
  expect(CHECK.length).toBe(10);
  expect(CHECK).not.toContain('ADMIN');
});

it('every validated role list that feeds a user_company_roles writer is inside the CHECK', () => {
  const prims = jest.requireActual('../../services/rbacPrimitives');
  const svc = jest.requireActual('../../services/rbacService');
  const ums = jest.requireActual('../../services/userManagementService');
  const acc = jest.requireActual('../../services/onboardingInvitationAcceptance');
  const saCreate = jest.requireActual('../../apiHandlers/superAdmin/usersCreateShared');
  const saShared = jest.requireActual('../../apiHandlers/superAdmin/usersShared');
  const lists: Record<string, ReadonlyArray<string>> = {
    'rbacService.ALL_ROLES (super-admin create/update source)': svc.ALL_ROLES,
    'superAdmin/usersCreateShared.ALLOWED_INVITE_ROLES': saCreate.ALLOWED_INVITE_ROLES,
    'superAdmin/usersShared.allowedRoles': saShared.allowedRoles,
    'rbacPrimitives.INVITABLE_TENANT_ROLES (company invite / reinvite)': prims.INVITABLE_TENANT_ROLES,
    'rbacPrimitives.NON_ADMIN_TENANT_ROLES (self-joined / recovery)': prims.NON_ADMIN_TENANT_ROLES,
    'onboardingInvitationAcceptance.INVITATION_ACCEPTANCE_ROLES (accept)': acc.INVITATION_ACCEPTANCE_ROLES,
    'userManagementService.INVITABLE_ROLES (users/* invite + update)': ums.INVITABLE_ROLES,
  };
  for (const [name, list] of Object.entries(lists)) {
    expect({ name, outside: [...list].filter((r) => !CHECK.includes(r)) }).toEqual({ name, outside: [] });
    expect(list.length).toBeGreaterThan(0);
  }
});

it('mapAppRoleToRbac (company role update) only ever yields a CHECK value', () => {
  const { mapAppRoleToRbac } = jest.requireActual('../../apiHandlers/company/usersShared');
  for (const input of ['COMPANY_ADMIN', 'USER', ...CHECK, 'ADMIN', 'admin', 'SUPER_ADMIN', 'nope']) {
    const out = mapAppRoleToRbac(input);
    if (out !== null) expect(CHECK).toContain(out);
  }
});

const ROLE_KEYS: Record<string, string> = {
  SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', COMPANY_ADMIN: 'COMPANY_ADMIN', CONTENT_MANAGER: 'CONTENT_MANAGER',
  CONTENT_REVIEWER: 'CONTENT_REVIEWER', CONTENT_PUBLISHER: 'CONTENT_PUBLISHER', CONTENT_PLANNER: 'CONTENT_PLANNER',
  CONTENT_CREATOR: 'CONTENT_CREATOR', CONTENT_ENGAGER: 'CONTENT_ENGAGER', VIEWER: 'VIEWER', VIEW_ONLY: 'VIEW_ONLY',
};

function walk(d: string, out: string[] = []): string[] {
  let es: fs.Dirent[] = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (['node_modules', '.next', 'tests', '__tests__'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Literals that are NOT writes to user_company_roles (response / context objects
// in a file that also touches the table). Each must STILL exist (this list
// shrinks; it never hides a new literal).
const NOT_A_WRITE: Record<string, string> = {
  "pages/api/company-profile/index.ts: role: 'CONTENT_ARCHITECT'": 'response rolesByCompany for the content-architect principal',
  "backend/apiHandlers/superAdmin/usersRead.ts: role: 'UNASSIGNED'": 'super-admin user list: users with no membership row',
  "backend/services/userContextService.ts: role: 'user'": 'UserContext.role for unauthenticated / tenant-less contexts (x2)',
};

it('every LITERAL role in a file touching user_company_roles is a CHECK value (case-sensitive)', () => {
  const offenders: string[] = [];
  const allowedSeen = new Set<string>();
  let seen = 0;
  for (const f of ['pages', 'backend', 'lib'].flatMap((d) => walk(path.join(ROOT, d)))) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('user_company_roles')) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/\brole:\s*(?:'([A-Za-z_]+)'|Role\.([A-Z_]+))/g)) {
      seen += 1;
      const v = m[1] ?? ROLE_KEYS[m[2]];
      const key = `${path.relative(ROOT, f).split(path.sep).join('/')}: ${m[0]}`;
      if (CHECK.includes(v)) continue;
      if (NOT_A_WRITE[key]) { allowedSeen.add(key); continue; }
      offenders.push(key);
    }
  }
  expect(seen).toBeGreaterThan(5); // non-vacuous
  expect(offenders).toEqual([]);
  expect([...allowedSeen].sort()).toEqual(Object.keys(NOT_A_WRITE).sort()); // a stale entry must be removed
});
