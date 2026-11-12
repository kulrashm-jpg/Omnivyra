/**
 * e9 (2026-11-12), 20270217000023: NO app code calls the unguarded pair
 * apply_credit_reservation / apply_credit_partial_confirm. Every credit write goes
 * through apply_credit_reservation_guarded / apply_credit_partial_confirm_guarded.
 * This is the precondition evidence for 20270217000024 (the later revoke of the
 * old pair's service_role EXECUTE): a caller left behind would break the day
 * that lands.
 *
 * Scans every app source tree for the old names as an RPC target, in any quote
 * style (', ", `), comments excluded. Controls prove the scan is not vacuous:
 * it walks real files, finds the guarded names where they are called, and its
 * pattern matches every call shape it claims to catch.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TREES = ['backend', 'pages', 'lib', 'shared', 'app', 'hooks', 'components', 'scripts', 'src'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'tests', '__tests__', 'dist', 'build']);
/** The old name as a string literal (any quote), NOT followed by _guarded. */
const OLD = /(['"`])apply_credit_(reservation|partial_confirm)\1/;
const GUARDED = /(['"`])apply_credit_(reservation|partial_confirm)_guarded\1/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function scan(): { files: number; old: string[]; guarded: string[] } {
  const out = { files: 0, old: [] as string[], guarded: [] as string[] };
  const walk = (d: string) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) continue;
      out.files += 1;
      const src = stripComments(fs.readFileSync(p, 'utf8'));
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (OLD.test(src)) out.old.push(rel);
      if (GUARDED.test(src)) out.guarded.push(rel);
    }
  };
  for (const t of TREES) walk(path.join(ROOT, t));
  return out;
}

const result = scan();
const NL = String.fromCharCode(10);

it('NO app source file names the unguarded pair as a string literal (the 20270217000024 precondition)', () => {
  expect(result.old).toEqual([]);
});

it('control: the scan is not vacuous - it walked real files and finds the GUARDED callers', () => {
  expect(result.files).toBeGreaterThan(500);
  expect(result.guarded).toEqual(expect.arrayContaining([
    'backend/repositories/creditExecutionRepository.ts',
    'backend/services/creditExpiryService.ts',
    'backend/services/subscriptionCreditExpiryService.ts',
  ]));
});

it('control: the pattern catches every call shape and ignores the guarded names and comments', () => {
  for (const shape of [
    "supabase.rpc('apply_credit_reservation', {",
    'supabase.rpc("apply_credit_partial_confirm", args)',
    'rpc(`apply_credit_reservation`)',
    "const fn = 'apply_credit_partial_confirm';",
  ]) expect(OLD.test(stripComments(shape))).toBe(true);
  for (const ok of [
    "supabase.rpc('apply_credit_reservation_guarded', {",
    '/**' + NL + ' * via `apply_credit_reservation` phase=expire' + NL + ' */',
    "// supabase.rpc('apply_credit_reservation')",
    "/* supabase.rpc('apply_credit_partial_confirm') */",
  ]) expect(OLD.test(stripComments(ok))).toBe(false);
});
