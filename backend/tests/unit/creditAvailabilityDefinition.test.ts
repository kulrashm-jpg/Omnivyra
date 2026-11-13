/**
 * e9 BLOCKING-launch (2026-11-14): ONE availability definition, shared by the DB and every TS reader.
 *
 * A HOLD moves credits OUT of *_balance INTO reserved_* (live apply_credit_reservation, 'hold' branch). So *_balance
 * already excludes every open hold, and "available = balance - reserved" counts each open hold TWICE - refusing
 * customers with spendable credits and under-reporting their balance. The fix is the same in four places:
 *   - DB:  20270217000053 apply_credit_reservation 'hold' availability = GREATEST(0, *_balance)
 *   - TS:  creditPriorityService.computeAvailable, billing/admissionControl, billingWalletService,
 *          components/company-credits/creditPresentation (customer-visible).
 * This pins the TS and DB formulas together, proves the 300/50 example, and scans for any reintroduced subtraction.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeAvailable } from '../../services/creditPriorityService';
import { summarizeCompanyCredits } from '../../../components/company-credits/creditPresentation';

const ROOT = process.cwd();

// 300 free credits granted, then a 50-credit hold: the hold moved 50 out of free_balance into reserved_free.
const AFTER_HOLD = { free_balance: 250, incentive_balance: 0, paid_balance: 0, reserved_free: 50, reserved_incentive: 0, reserved_paid: 0 };

it('TS: 300 free with a 50 hold -> 250 available (the old formula said 200)', () => {
  expect(computeAvailable(AFTER_HOLD as never)).toMatchObject({ free: 250, total: 250 });
});

it('TS customer summary: effective credits = 250 for the same wallet', () => {
  const s = summarizeCompanyCredits({ freeBalance: 250, paidBalance: 0, incentiveBalance: 0, reservedFree: 50, reservedPaid: 0, reservedIncentive: 0 } as never);
  expect(s.effectiveCredits).toBe(250);
  expect(s.reservedCredits).toBe(50);
});

it('DB: the generated 053 hold branch uses the SAME definition (balance only, no reserved subtraction)', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270217000053_credit_settle_guards_reauthor.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_credit_reservation('));
  const hold = fn.slice(fn.indexOf("IF p_phase = 'hold' THEN"), fn.indexOf("ELSIF p_phase = 'confirm' THEN"));
  expect(hold).toMatch(/v_avail_free\s*:= GREATEST\(0, v_wallet\.free_balance\);/);
  expect(hold).toMatch(/v_avail_incentive\s*:= GREATEST\(0, v_wallet\.incentive_balance\);/);
  expect(hold).toMatch(/v_avail_paid\s*:= GREATEST\(0, v_wallet\.paid_balance\);/);
  expect(hold).not.toMatch(/-\s*v_wallet\.reserved_/);
});

/** A balance/availability expression that subtracts a reserved amount. */
const DOUBLE_SUBTRACT = /(balance|avail|free|paid|incentive|Credits)\b[^;\n]*-\s*[A-Za-z_.]*[Rr]eserv/;
// Not availability, with the reason:
const ALLOWED = new Map<string, string>([
  ['backend/services/creditReconciliation.ts', 'observed-minus-expected reserved DIFF, not availability'],
  ['lib/shield/creditEnforcer.ts', 'separate in-memory reservation system with its own balance; not wired to the wallet (examples only)'],
]);

function walk(rel: string, out: string[]): void {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'tests', '__tests__'].includes(e.name)) walk(r, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(r);
  }
}

it('no TS source reintroduces "balance - reserved" (positive control: the allowlisted files do match)', () => {
  const files: string[] = [];
  for (const d of ['backend', 'pages', 'lib', 'components', 'hooks', 'shared']) walk(d, files);
  const hits = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').some((l) => !/^\s*(\/\/|\*)/.test(l) && DOUBLE_SUBTRACT.test(l)));
  for (const allowed of ALLOWED.keys()) expect(hits).toContain(allowed);
  expect(hits.filter((h) => !ALLOWED.has(h))).toEqual([]);
});

it('the scan WOULD catch the old formula (mutation)', () => {
  expect(DOUBLE_SUBTRACT.test('  const free      = Math.max(0, wallet.free_balance      - wallet.reserved_free);')).toBe(true);
  expect(DOUBLE_SUBTRACT.test('    Math.max(0, free - reservedFree) +')).toBe(true);
});
