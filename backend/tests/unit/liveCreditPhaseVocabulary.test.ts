/**
 * Breaks the fixture circularity (05/e9, standing rule): instead of trusting hand-written row shapes, READ the committed
 * LIVE function bodies (C100 extraction, md5 = prod md5(prosrc); backend/tests/fixtures/live-credit-functions-20261113)
 * and derive the execution_phase values they WRITE. The classifier in billing/holdSettlementState.ts must recognise
 * every one - as a settle phase or as an explicit non-settle phase - and every confirm-type phase must be in
 * CONFIRM_PHASES. When the next producer writes a new phase, this fails in CI instead of a settle reading as 'open'.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIRM_PHASES, SETTLE_PHASES, NON_SETTLE_PHASES } from '../../services/billing/holdSettlementState';

const DIR = path.join(process.cwd(), 'backend/tests/fixtures/live-credit-functions-20261113');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const RESERVATION = read('LIVE-apply_credit_reservation.prosrc.sql');
const PARTIAL = read('LIVE-apply_credit_partial_confirm.prosrc.sql');

/** Split a parenthesised SQL list at top-level commas. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The balanced (...) group starting at `open`. */
function group(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  throw new Error('unbalanced');
}

/** For every INSERT INTO credit_transactions, the VALUES expression in the execution_phase position. */
function phaseExpressions(body: string): string[] {
  const out: string[] = [];
  const re = /INSERT INTO credit_transactions\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const colsOpen = body.indexOf('(', m.index);
    const colsText = group(body, colsOpen);
    const cols = splitTopLevel(colsText).map((c) => c.replace(/--.*$/gm, '').trim());
    // Either INSERT ... VALUES (...) or INSERT ... SELECT <list> FROM ... (the live 20260322 body uses the latter).
    const after = body.slice(colsOpen + colsText.length + 2);
    const head = /^\s*(VALUES|SELECT)\b/i.exec(after);
    if (!head) throw new Error('INSERT INTO credit_transactions with neither VALUES nor SELECT');
    let listText: string;
    if (head[1].toUpperCase() === 'VALUES') {
      const open = colsOpen + colsText.length + 2 + after.indexOf('(');
      listText = group(body, open);
    } else {
      const start = head.index + head[0].length;
      listText = after.slice(start, after.search(/\bFROM\b/i));
    }
    const vals = splitTopLevel(listText).map((v) => v.replace(/--.*$/gm, '').trim());
    if (vals.length !== cols.length) throw new Error(`column/value count mismatch: ${cols.length} vs ${vals.length}`);
    out.push(vals[cols.indexOf('execution_phase')]);
  }
  return out;
}

/** Phases a body writes: literal VALUES, or - when it writes p_phase - every p_phase it dispatches on. */
function writtenPhases(body: string): Set<string> {
  const phases = new Set<string>();
  for (const expr of phaseExpressions(body)) {
    const lit = /^'([a-z_]+)'$/.exec(expr ?? '');
    if (lit) { phases.add(lit[1]); continue; }
    if (expr === 'p_phase') {
      for (const d of body.matchAll(/p_phase\s*=\s*'([a-z_]+)'/g)) phases.add(d[1]);
      continue;
    }
    throw new Error(`unrecognised execution_phase expression in a live body: ${expr}`);
  }
  return phases;
}

it('the fixtures ARE the prod bodies (md5 = C100 prod md5(prosrc))', () => {
  const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');
  expect(md5(RESERVATION)).toBe('ad5383bf6ccf24a2c8ddee70db3b1297');
  expect(md5(PARTIAL)).toBe('ff208f60617a7a272305a804037bf47d');
});

it('positive control: the parser finds the phases each live body writes', () => {
  expect([...writtenPhases(PARTIAL)]).toEqual(['confirm_partial']);
  expect([...writtenPhases(RESERVATION)].sort()).toEqual(['confirm', 'expire', 'expire_incentive', 'grant', 'hold', 'release']);
});

it('every phase prod writes is classified (settle or explicit non-settle), and the vocabulary is exactly that set', () => {
  const written = new Set([...writtenPhases(RESERVATION), ...writtenPhases(PARTIAL)]);
  const classified = new Set([...SETTLE_PHASES, ...NON_SETTLE_PHASES]);
  expect([...written].sort()).toEqual([...classified].sort());
});

it('CONFIRM_PHASES contains every confirm-type phase prod writes', () => {
  const written = new Set([...writtenPhases(RESERVATION), ...writtenPhases(PARTIAL)]);
  for (const p of written) if (p.startsWith('confirm')) expect(CONFIRM_PHASES).toContain(p);
});
