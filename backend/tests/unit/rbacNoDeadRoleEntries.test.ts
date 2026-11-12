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
    for (const r of ['ADMIN', 'CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER']) expect(REWRITTEN.has(r)).toBe(true);
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
    expect(dead(roleLists('withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_MANAGER])'))).toEqual(['ADMIN', 'CONTENT_MANAGER']);
    expect(dead(roleLists('const ALLOWED_ROLES = [\n  Role.COMPANY_ADMIN,\n  Role.CONTENT_PLANNER,\n];\nexport default withRBAC(handler, ALLOWED_ROLES);'))).toEqual(['CONTENT_PLANNER']);
    expect(dead(roleLists('enforceRole({ allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN] })'))).toEqual(['ADMIN']);
    expect(dead(roleLists('await requireCompanyRole(req, res, companyId, [Role.VIEWER, Role.VIEW_ONLY])'))).toEqual(['VIEWER']);
    expect(dead(roleLists("withRBAC(handler, undefined, ['VIEW_ONLY', 'VIEWER'])"))).toEqual(['VIEWER']);
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
