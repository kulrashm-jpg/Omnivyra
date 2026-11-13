/**
 * 20270217000053 is GENERATED from the LIVE prod bodies (scripts/migrations/gen-053-credit-settle-guards.py). This pins
 * the two properties e9/05 required, structurally (the behaviour is proven against Postgres in
 * backend/tests/realschema/credit_settle_guards_053.test.ts):
 *   1. NOTHING LIVE IS LOST: every line of each live body appears, IN ORDER, in the 053 body - except exactly the lines
 *      053 replaces (the hold-availability double-subtract and the catch-all unique_violation handler).
 *   2. Every guard is present, and the bodies the migration pins by md5 are the ones in the file.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const FIX = path.join(ROOT, 'backend/tests/fixtures/live-credit-functions-20261113');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270217000053_credit_settle_guards_reauthor.sql'), 'utf8');
const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

/** Body of `CREATE OR REPLACE FUNCTION public.<name>(...) ... AS $fn$<body>$fn$`. */
function body(name: string): string {
  const at = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = SQL.indexOf('$fn$', at) + 4;
  return SQL.slice(open, SQL.indexOf('$fn$', open));
}
const RES = body('apply_credit_reservation');
const PC = body('apply_credit_partial_confirm');
const LIVE_RES = fs.readFileSync(path.join(FIX, 'LIVE-apply_credit_reservation.prosrc.sql'), 'utf8');
const LIVE_PC = fs.readFileSync(path.join(FIX, 'LIVE-apply_credit_partial_confirm.prosrc.sql'), 'utf8');

/** The live lines that 053 deliberately replaces (and nothing else). */
const REPLACED = [
  /v_avail_(free|incentive|paid)\s*:= GREATEST\(0, v_wallet\.\w+_balance\s*- v_wallet\.reserved_\w+\);/,
];

function missingLiveLines(live: string, next: string): string[] {
  const nextLines = next.split('\n');
  const missing: string[] = [];
  let j = 0;
  for (const line of live.split('\n')) {
    if (REPLACED.some((re) => re.test(line))) continue;
    let k = j;
    while (k < nextLines.length && nextLines[k] !== line) k++;
    if (k === nextLines.length) missing.push(line); else j = k + 1;
  }
  return missing;
}

it('the fixtures are the prod bodies', () => {
  expect(md5(LIVE_RES)).toBe('ad5383bf6ccf24a2c8ddee70db3b1297');
  expect(md5(LIVE_PC)).toBe('ff208f60617a7a272305a804037bf47d');
});

it('apply_credit_reservation: every live line survives, in order (only the double-subtract lines are replaced)', () => {
  expect(missingLiveLines(LIVE_RES, RES)).toEqual([]);
});

it('apply_credit_partial_confirm: every live line survives, in order', () => {
  expect(missingLiveLines(LIVE_PC, PC)).toEqual([]);
});

it('positive control: the subsequence check DOES catch a dropped live line', () => {
  const dropped = RES.replace('lifetime_consumed = lifetime_consumed + p_free_amount + p_incentive_amount + p_paid_amount,', '');
  expect(missingLiveLines(LIVE_RES, dropped).length).toBeGreaterThan(0);
});

it('the md5 the postcondition pins is the md5 of the bodies in this file', () => {
  expect(SQL).toContain(`IS DISTINCT FROM '${md5(RES)}'`);
  expect(SQL).toContain(`IS DISTINCT FROM '${md5(PC)}'`);
});

it.each([
  ['CREDIT_AMOUNT_NULL', RES], ['CREDIT_AMOUNT_NEGATIVE', RES], ['CREDIT_IDEMPOTENCY_KEY_REQUIRED', RES],
  ['SETTLE_REQUIRES_PARENT_HOLD', RES], ['SETTLE_PARENT_NOT_A_HOLD', RES], ['HOLD_ALREADY_SETTLED', RES],
  ['SETTLE_EXCEEDS_HOLD', RES], ['SETTLE_EXCEEDS_RESERVED', RES], ['PARENT_ONLY_FOR_SETTLE', RES],
  ['CREDIT_IDEMPOTENCY_COLLISION_WITHOUT_ROW', RES],
  ['CREDIT_AMOUNT_NULL', PC], ['CREDIT_AMOUNT_NEGATIVE', PC], ['CREDIT_IDEMPOTENCY_KEY_REQUIRED', PC],
  ['HOLD_ALREADY_SETTLED', PC], ['CREDIT_IDEMPOTENCY_COLLISION_WITHOUT_ROW', PC],
])('guard %s is present', (code, b) => {
  expect(b).toContain(code);
});

it('the already-settled check recognises every settle phase, including the live confirm_partial', () => {
  for (const b of [RES, PC]) expect(b).toContain("execution_phase IN ('confirm', 'confirm_partial', 'release')");
});

it('the unique_violation handler re-raises anything that is not the idempotency key', () => {
  for (const b of [RES, PC]) {
    expect(b).toMatch(/GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;\s*IF v_constraint IS NULL OR v_constraint NOT IN \(/);
    expect(b).toMatch(/THEN\s*RAISE;\s*END IF;/);
  }
});
