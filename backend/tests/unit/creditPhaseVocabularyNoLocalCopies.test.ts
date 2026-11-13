/**
 * e9/05 ruling 2026-11-13: ONE execution_phase vocabulary (shared/billing/creditPhaseVocabulary.ts). A local
 * ['confirm', 'confirm_partial'] copy can drift from prod's vocabulary unseen, so ANY 'confirm_partial' string literal
 * in application source outside that module fails here. (Comments are ignored.) Customers never see a raw phase name.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIRM_PHASES, SETTLE_PHASES, NON_SETTLE_PHASES, isConfirmPhase, customerLedgerPhaseLabel,
} from '../../../shared/billing/creditPhaseVocabulary';

const ROOT = process.cwd();
const MODULE = 'shared/billing/creditPhaseVocabulary.ts';
const DIRS = ['backend', 'pages', 'components', 'lib', 'shared', 'hooks'];

function walk(rel: string, out: string[]): void {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__') continue;
      walk(r, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(r);
  }
}

/** Source with comments removed, so a literal in a comment is not a "copy". */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function localCopies(files: Array<{ rel: string; src: string }>): string[] {
  return files.filter((f) => f.rel !== MODULE && /['"`]confirm_partial['"`]/.test(code(f.src))).map((f) => f.rel);
}

const FILES = (() => {
  const rels: string[] = [];
  for (const d of DIRS) walk(d, rels);
  return rels.map((rel) => ({ rel, src: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
})();

it('positive control: the scan reads the vocabulary module itself and finds the literal there', () => {
  const mod = FILES.find((f) => f.rel === MODULE);
  expect(mod).toBeDefined();
  expect(/['"`]confirm_partial['"`]/.test(code(mod!.src))).toBe(true);
});

it('no application source outside the shared module carries its own confirm_partial literal', () => {
  expect(localCopies(FILES)).toEqual([]);
});

it('the scan WOULD catch a local copy (mutation of a fake file)', () => {
  expect(localCopies([{ rel: 'pages/api/x.ts', src: "const P = ['confirm', 'confirm_partial'];" }])).toEqual(['pages/api/x.ts']);
  expect(localCopies([{ rel: 'pages/api/y.ts', src: "// 'confirm_partial' only in a comment" }])).toEqual([]);
});

describe('the vocabulary', () => {
  it('credits used = confirm + confirm_partial; settle = + release; the sets are disjoint', () => {
    expect([...CONFIRM_PHASES]).toEqual(['confirm', 'confirm_partial']);
    expect([...SETTLE_PHASES]).toEqual(['confirm', 'confirm_partial', 'release']);
    for (const p of NON_SETTLE_PHASES) expect(SETTLE_PHASES).not.toContain(p);
    expect(isConfirmPhase('confirm_partial')).toBe(true);
    expect(isConfirmPhase('release')).toBe(false);
    expect(isConfirmPhase(null)).toBe(false);
  });

  it('every known phase has a customer label that is NOT the raw phase name; unknown phases render "Other"', () => {
    for (const p of [...SETTLE_PHASES, ...NON_SETTLE_PHASES]) {
      const label = customerLedgerPhaseLabel(p);
      expect(label).not.toBe(p);
      expect(label).not.toBe('Other');
    }
    expect(customerLedgerPhaseLabel('confirm_partial')).toBe(customerLedgerPhaseLabel('confirm'));
    expect(customerLedgerPhaseLabel('some_future_phase')).toBe('Other');
    expect(customerLedgerPhaseLabel(undefined)).toBe('Other');
  });
});

describe('customer surfaces (source pins)', () => {
  const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('the billing page never renders a raw execution_phase as text', () => {
    const page = code(src('pages/company/billing/index.tsx'));
    expect(page).not.toMatch(/>\s*\{\s*[a-z]\.execution_phase\s*\}\s*</);
    expect(page.match(/customerLedgerPhaseLabel\([a-z]\.execution_phase\)/g)?.length).toBe(2);
  });

  it("the company ledger API maps a 'confirm' filter to every confirm phase", () => {
    const s = src('pages/api/company/billing/ledger.ts');
    expect(s).toMatch(/isConfirmPhase\(phase\) \? q\.in\('execution_phase', \[\.\.\.CONFIRM_PHASES\]\)/);
  });
});
