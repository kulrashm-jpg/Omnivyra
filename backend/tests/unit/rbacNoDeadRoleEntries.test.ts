/**
 * DEAD ENTRIES (e9 ruling, 2026-11-12). getUserRole -> normalizeRole REWRITES
 * some role names (e.g. ADMIN -> COMPANY_ADMIN) before enforceRole compares the
 * role EXACTLY against an allow-list. A rewritten name in such a list can never
 * match: content approve/reject listed [SUPER_ADMIN, ADMIN, CONTENT_MANAGER]
 * and so refused every company admin. This scan fails if any role list that is
 * compared AFTER normalisation names a role normalizeRole rewrites.
 *
 * The rewritten set is computed from the REAL normalizeRole, never hand-kept.
 * Scope: withRBAC(handler, allowed, forbidden), `allowedRoles: [...]`, and the
 * campaigns routes' local requireCompanyRole(req, res, companyId, [...]).
 * Lists compared against RAW database values (e.g. `.in('role', [...])`) are
 * out of scope on purpose - a legacy 'ADMIN' row can legitimately match there.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Role, normalizeRole } from '../../services/rbacPrimitives';

const ROOT = path.resolve(__dirname, '../../..');
const REWRITTEN = new Set(
  (Object.values(Role) as string[]).filter((v) => normalizeRole(v) !== v),
);
const ROLE_KEY_TO_VALUE = Role as unknown as Record<string, string>;

// HELD (e9, 2026-11-12): user admin is super-admin-only today because of the
// dead Role.ADMIN. Opening it to COMPANY_ADMIN activates writers that can
// remove / demote the LAST admin, so it lands with the atomic last-admin guard.
// Each entry must STILL violate (a fixed file must leave this list).
const HELD = new Set([
  'pages/api/users/index.ts',
  'pages/api/users/invite.ts',
  'pages/api/users/[userId]/index.ts',
  'pages/api/users/[userId]/role.ts',
]);

function files(dir: string, out: string[] = []): string[] {
  let es: fs.Dirent[] = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (['node_modules', '.next', 'tests', '__tests__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Role names in an array literal: Role.X tokens and quoted string tokens. */
export function namesIn(arrayText: string): string[] {
  const out: string[] = [];
  for (const m of arrayText.matchAll(/Role\.([A-Z_]+)/g)) out.push(ROLE_KEY_TO_VALUE[m[1]] ?? m[1]);
  for (const m of arrayText.matchAll(/['"]([A-Za-z_]+)['"]/g)) out.push(m[1].toUpperCase());
  return out;
}

/** Every role list in `src` that is compared after normalisation. */
export function roleLists(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const resolve = (tok: string): string | null => {
    if (tok.startsWith('[')) return tok;
    const m = code.match(new RegExp(String.raw`const\s+${tok}\b[^=]*=\s*(\[[^\]]*\])`));
    return m ? m[1] : null;
  };
  const lists: string[] = [];
  const ARR = String.raw`(\[[^\]]*\]|[A-Z_][A-Z0-9_]*|undefined)`;
  for (const m of code.matchAll(new RegExp(String.raw`withRBAC\(\s*[\w.]+\s*,\s*${ARR}(?:\s*,\s*${ARR})?`, 'g'))) {
    for (const t of [m[1], m[2]]) { if (t && t !== 'undefined') { const r = resolve(t); if (r) lists.push(r); } }
  }
  for (const m of code.matchAll(new RegExp(String.raw`allowedRoles\s*:\s*${ARR}`, 'g'))) { const r = resolve(m[1]); if (r) lists.push(r); }
  for (const m of code.matchAll(new RegExp(String.raw`requireCompanyRole\(\s*req\s*,\s*res\s*,\s*[\w.]+\s*,\s*${ARR}`, 'g'))) { const r = resolve(m[1]); if (r) lists.push(r); }
  return lists;
}

describe('no role list names a role normalizeRole rewrites', () => {
  const all = ['pages', 'backend', 'lib'].flatMap((d) => files(path.join(ROOT, d)));
  const scanned: Array<{ file: string; lists: string[] }> = all.map((f) => ({
    file: path.relative(ROOT, f).split(path.sep).join('/'),
    lists: roleLists(fs.readFileSync(f, 'utf8')),
  }));
  const dead = (lists: string[]) => lists.flatMap((l) => namesIn(l).filter((n) => REWRITTEN.has(n)));

  it('the rewritten set is computed from normalizeRole and includes the known rewrites', () => {
    expect(REWRITTEN.has('ADMIN')).toBe(true);
    // Approach A (e9 2026-11-12): the four content roles keep their identity.
    for (const r of ['CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER']) expect(REWRITTEN.has(r)).toBe(false);
    expect(REWRITTEN.has('COMPANY_ADMIN')).toBe(false);
  });

  it('non-vacuous: the scan finds the role lists (>= 60) incl. the ones this fix touched', () => {
    const n = scanned.reduce((s, x) => s + x.lists.length, 0);
    expect(n).toBeGreaterThanOrEqual(60);
    const byFile = new Map(scanned.map((x) => [x.file, x.lists.length]));
    for (const f of ['pages/api/content/approve.ts', 'pages/api/campaigns/list.ts', 'pages/api/campaigns/[id]/continuity.ts', 'pages/api/company/intelligence/topics.ts']) {
      expect(byFile.get(f)).toBeGreaterThan(0);
    }
  });

  it('controls: the scanner flags the pre-fix shapes (inline, named const, allowedRoles, requireCompanyRole, forbidden)', () => {
    expect(dead(roleLists('withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_MANAGER])'))).toEqual(['ADMIN']);
    expect(dead(roleLists('const ALLOWED_ROLES = [\n  Role.COMPANY_ADMIN,\n  Role.ADMIN,\n];\nexport default withRBAC(handler, ALLOWED_ROLES);'))).toEqual(['ADMIN']);
    expect(dead(roleLists('enforceRole({ allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN] })'))).toEqual(['ADMIN']);
    expect(dead(roleLists('await requireCompanyRole(req, res, companyId, [Role.ADMIN, Role.VIEW_ONLY])'))).toEqual(['ADMIN']);
    expect(dead(roleLists("withRBAC(handler, undefined, ['VIEW_ONLY', 'ADMIN'])"))).toEqual(['ADMIN']);
    expect(dead(roleLists('// withRBAC(handler, [Role.ADMIN])'))).toEqual([]); // comments ignored
  });

  it('no live role list contains a rewritten name (HELD files excepted)', () => {
    const offenders = scanned
      .filter((x) => !HELD.has(x.file))
      .map((x) => ({ file: x.file, dead: dead(x.lists) }))
      .filter((x) => x.dead.length > 0);
    expect(offenders).toEqual([]);
  });

  it('HELD files still carry the dead entry (a fixed file must leave HELD)', () => {
    for (const f of HELD) {
      const x = scanned.find((s) => s.file === f);
      expect(x && dead(x.lists).length).toBeGreaterThan(0);
    }
  });
});

/**
 * SHAPE 2 (05, 2026-11-12): an EQUALITY (=== / !==) or `case` against a
 * rewritten name, on a value that is ALREADY normalised. In scope only by the
 * SOURCE of the value: a variable assigned from getUserRole(...) (destructured
 * `role`, or `role: alias`), getCompanyRoleIncludingInvited(...) or
 * normalizeRole(...). A raw `.select('role')` value is out of scope (a legacy
 * row legitimately matches), and so are the normalisers themselves (their
 * input is raw).
 */
export function normalisedComparisons(src: string): Array<{ v: string; name: string }> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const vars = new Set<string>();
  for (const m of code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:getCompanyRoleIncludingInvited|normalizeRole)\s*\(/g)) vars.add(m[1]);
  for (const m of code.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?getUserRole\s*\(/g)) {
    for (const part of m[1].split(',')) {
      const [k, alias] = part.split(':').map((x) => x.trim());
      if (k === 'role') vars.add(alias || 'role');
    }
  }
  const out: Array<{ v: string; name: string }> = [];
  for (const v of vars) {
    const V = v.replace(/\$/g, '\$');
    for (const m of code.matchAll(new RegExp(String.raw`\b${V}\s*[!=]==\s*Role\.([A-Z_]+)`, 'g'))) out.push({ v, name: ROLE_KEY_TO_VALUE[m[1]] ?? m[1] });
    for (const m of code.matchAll(new RegExp(String.raw`Role\.([A-Z_]+)\s*[!=]==\s*${V}\b`, 'g'))) out.push({ v, name: ROLE_KEY_TO_VALUE[m[1]] ?? m[1] });
    for (const sw of code.matchAll(new RegExp(String.raw`switch\s*\(\s*${V}\s*\)\s*\{([\s\S]*?)\n\s*\}`, 'g'))) {
      for (const m of sw[1].matchAll(/case\s+Role\.([A-Z_]+)\s*:/g)) out.push({ v, name: ROLE_KEY_TO_VALUE[m[1]] ?? m[1] });
    }
  }
  return out;
}

// HELD comparisons (same reason as HELD lists: user administration waits for
// the atomic last-admin guard). Each must STILL compare a rewritten name.
const HELD_CMP = new Set([
  'backend/services/userManagementService.ts', // requireUserAdminAccess: role !== Role.ADMIN
  'pages/api/company/users/[userId]/role.ts', // requireCompanyAdmin: role !== Role.ADMIN
]);

describe('no comparison of a NORMALISED role against a rewritten name (shape 2)', () => {
  const all = ['pages', 'backend', 'lib'].flatMap((d) => files(path.join(ROOT, d)));
  const scanned = all.map((f) => ({
    file: path.relative(ROOT, f).split(path.sep).join('/'),
    cmps: normalisedComparisons(fs.readFileSync(f, 'utf8')),
  }));

  it('non-vacuous: the scan sees normalised-role comparisons (>= 15), incl. known sites', () => {
    expect(scanned.reduce((n, x) => n + x.cmps.length, 0)).toBeGreaterThanOrEqual(15);
    for (const f of ['backend/apiHandlers/company/usersShared.ts', 'pages/api/admin/delete-campaign.ts', 'backend/services/userContextService.ts']) {
      expect(scanned.find((x) => x.file === f)?.cmps.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('controls: flags each source x syntax; ignores raw values and normalisers', () => {
    const dead = (src: string) => normalisedComparisons(src).filter((c) => REWRITTEN.has(c.name)).map((c) => c.name);
    expect(dead('const fallbackRole = await getCompanyRoleIncludingInvited(u, c);\nif (fallbackRole === Role.ADMIN) x();')).toEqual(['ADMIN']);
    expect(dead('const { role, error } = await getUserRole(u, c);\nif (role !== Role.ADMIN) deny();')).toEqual(['ADMIN']);
    expect(dead('const { role: r } = await getUserRole(u, c);\nif (Role.ADMIN === r) x();')).toEqual(['ADMIN']);
    expect(dead('const n = normalizeRole(raw);\nswitch (n) {\n  case Role.ADMIN: a();\n  case Role.COMPANY_ADMIN: b();\n}')).toEqual(['ADMIN']);
    expect(dead("const { data } = await db.from('user_company_roles').select('role');\nif (data.role === Role.ADMIN) x();")).toEqual([]); // raw value
    expect(dead('export const normalizePermissionRole = (role: string) => {\n  if (role === Role.ADMIN) return Role.COMPANY_ADMIN;\n};')).toEqual([]); // normaliser input
  });

  it('no normalised-role comparison names a rewritten role (HELD_CMP excepted)', () => {
    const offenders = scanned
      .filter((x) => !HELD_CMP.has(x.file))
      .map((x) => ({ file: x.file, dead: x.cmps.filter((c) => REWRITTEN.has(c.name)) }))
      .filter((x) => x.dead.length > 0);
    expect(offenders).toEqual([]);
  });

  it('HELD_CMP files still compare a rewritten name (a fixed file must leave HELD_CMP)', () => {
    for (const f of HELD_CMP) {
      const x = scanned.find((s) => s.file === f);
      expect(x && x.cmps.filter((c) => REWRITTEN.has(c.name)).length).toBeGreaterThan(0);
    }
  });
});
