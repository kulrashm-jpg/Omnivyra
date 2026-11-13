/**
 * The hidden billing catalog is RETIRED (owner; e9 C97 1(a), 2026-11-13). Its tables may still exist and hold
 * historical rows, so retirement means "nothing reads or writes them", pinned here: no application source names either
 * table as a quoted identifier (the shape of every .from('...') / .rpc / SQL-string access). The only sanctioned
 * mention is the governance module's RETIRED list, which asserts the audit trail stays frozen.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['backend', 'pages', 'lib', 'shared', 'components', 'hooks', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'tests', '__tests__', 'fixtures']);
const GOVERNANCE = path.join('backend', 'services', 'billing', 'payments', 'settlementMigrationGovernance.ts');
const QUOTED_TABLE = /['"`]hidden_billing_catalog(?:_audit)?['"`]/;

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); continue; }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.test\.[tj]sx?$/.test(e.name)) out.push(path.join(dir, e.name));
  }
}

const files: string[] = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
const rel = (f: string) => path.relative(ROOT, f);

describe('retired hidden billing: no application access', () => {
  test('positive control: the scan covers the codebase and the pattern matches the governance RETIRED list', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map(rel)).toContain(GOVERNANCE);
    expect(QUOTED_TABLE.test(fs.readFileSync(path.join(ROOT, GOVERNANCE), 'utf8'))).toBe(true);
  });

  test('no source outside the governance module names a retired table', () => {
    const hits = files
      .filter((f) => rel(f) !== GOVERNANCE)
      .filter((f) => QUOTED_TABLE.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(hits).toEqual([]);
  });
});
