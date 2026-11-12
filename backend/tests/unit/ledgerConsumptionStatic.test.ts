/**
 * MONEY (e9, 2026-11-12): no app code may count consumption or settlements by
 * execution_phase = 'confirm' alone - a token-priced charge is 'confirm_partial'.
 * Readers use shared/billing/ledgerPhases.ts (CONSUMPTION_PHASES /
 * SETTLEMENT_PHASES / isConsumptionPhase). Comments are ignored.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TREES = ['backend', 'pages', 'lib', 'shared', 'components', 'hooks'];
const SKIP = new Set(['node_modules', '.next', 'tests', '__tests__']);
/** A single-phase consumption filter, or the old two-phase settlement list. */
const BAD = /\.eq\(\s*['"]execution_phase['"]\s*,\s*['"]confirm['"]\s*\)|execution_phase\s*===\s*['"]confirm['"]|\[\s*['"]confirm['"]\s*,\s*['"]release['"]\s*\]/;
/**
 * Reviewed exceptions (not readers of consumption):
 *  - creditExecutionRepository SETTLE_PHASES: the PHASES apply_credit_reservation
 *    accepts for a settlement call (confirm / release); its ledger reads use
 *    SETTLEMENT_ROW_PHASES, which includes confirm_partial.
 */
const ALLOWED = new Set(['backend/repositories/creditExecutionRepository.ts']);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function scan(): { files: number; bad: string[] } {
  const out = { files: 0, bad: [] as string[] };
  const walk = (d: string) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      out.files += 1;
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (!ALLOWED.has(rel) && BAD.test(strip(fs.readFileSync(p, 'utf8')))) out.bad.push(rel);
    }
  };
  for (const t of TREES) walk(path.join(ROOT, t));
  return out;
}

const result = scan();

it("no app code counts consumption / settlements by 'confirm' alone", () => {
  expect(result.bad.sort()).toEqual([]);
});

it('control: the scan walked real files, and the pattern catches each shape it claims to', () => {
  expect(result.files).toBeGreaterThan(1000);
  for (const shape of [
    ".eq('execution_phase', 'confirm')",
    "if (r.execution_phase === 'confirm') {",
    ".in('execution_phase', ['confirm', 'release'])",
  ]) expect(BAD.test(strip(shape))).toBe(true);
  for (const ok of [
    ".in('execution_phase', [...CONSUMPTION_PHASES])",
    "// .eq('execution_phase', 'confirm')",
    "if (isConsumptionPhase(r.execution_phase)) {",
  ]) expect(BAD.test(strip(ok))).toBe(false);
});
