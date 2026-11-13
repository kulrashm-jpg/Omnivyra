/**
 * Financial-writes contract (e9): every write to a MONEY table must read its result.
 *
 * supabase-js returns database errors in `{ error }` - it does NOT throw. So `await supabase.from(t).update(...)`
 * whose result is dropped, even inside `try { } catch { }`, silently loses a failed write. On a money table that
 * means a paid purchase that can never be closed, a render that runs unbilled, an invoice without lines, a
 * subscription reported expired while still active (6f triage, 2026-11-13, main 9cecd075f: 105 writes, 40 unread).
 *
 * A write counts as READ when its result is: destructured WITH `error`; assigned to a variable; returned (explicitly
 * or as an arrow body); or chained with `.then(`. A `{ data }`-only destructure is NOT a read (a failed write gives
 * data = null indistinguishable from "no row") unless allowlisted with the reason its null branch is safe.
 *
 * KNOWN unread sites are ALLOWLISTED, each tagged with its triage id, and fixed site by site; the allowlist may only
 * SHRINK: a NEW unread write fails, and an allowlisted site that is no longer unread (fixed) also fails until its
 * entry is removed. An UNPARSEABLE money write (a builder held in a variable, so the write cannot be followed) fails.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['backend', 'lib', 'pages'];

const NAMED = new Set(['credit_transactions', 'organization_credits', 'billing_operations', 'billing_subscriptions',
  'payment_provider_events', 'payment_provider_event_state', 'usage_events', 'unified_transactions', 'invoices']);
const MONEY_TABLE = /^(credit_|billing_|payment_|invoice|cost_|refund|subscription|wallet|ledger|charge)/;
const MONEY_RPC = /(credit|billing|payment|invoice|reserve|confirm|refund|charge|wallet|ledger|settle|grant|deduct|topup|top_up)/;
const isMoneyTable = (t: string) => NAMED.has(t) || MONEY_TABLE.test(t);

export interface WriteSite { file: string; key: string; table: string; op: string; read: boolean; unparseable: boolean; line: number }

// Removes line and block comments, leaving string / template literals intact.
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const q = ch; out += ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } out += src[i]; i++; }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

const READ_BEFORE = [
  /(?:const|let|var)\s*\{[^}]*\berror\b[^}]*\}\s*=\s*(?:await\s*)?$/, // const { error } = await
  /(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*(?:await\s*)?$/,          // const res = await
  /\breturn\s*(?:await\s*)?$/,                                          // return (await)
  /(?<![=!<>])\b\w+(?:\.\w+)*\s*=\s*(?:await\s*)?$/,                    // x = await / this.y = await
  /=>\s*(?:await\s*)?\(?\s*$/,                                          // arrow body (implicit return)
];

function statementStart(s: string, i: number): number {
  // '=>' is kept IN the statement (an arrow body is a returned value); the other boundaries start after themselves.
  return Math.max(s.lastIndexOf(';', i) + 1, s.lastIndexOf('{\n', i) + 1, s.lastIndexOf('}\n', i) + 1, s.lastIndexOf('=>', i), s.lastIndexOf(',\n', i) + 1);
}

const NOT_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'function', 'typeof', 'new', 'with']);
/** Function / method declarations (name, offset), so a write is keyed by its WRITER (e1), not by a line number. */
function declarations(s: string): Array<{ name: string; at: number }> {
  const out: Array<{ name: string; at: number }> = [];
  const re = /\bfunction\s+(\w+)\s*[<(]|\b(\w+)\s*[:=]\s*(?:async\s*)?(?:function\b[^(]*)?\([^()]*\)\s*(?::[^={]+)?=>|\b(?:async\s+)?(\w+)\s*\([^()]*\)\s*(?::\s*[^={;]+)?\{/g;
  for (const m of s.matchAll(re)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (name && !NOT_FN.has(name)) out.push({ name, at: m.index! });
  }
  return out;
}

export function scanSource(file: string, raw: string): WriteSite[] {
  const s = stripComments(raw);
  const sites: WriteSite[] = [];
  const counter = new Map<string, number>();
  const decls = declarations(s);
  const writerAt = (i: number) => { let n = '<module>'; for (const d of decls) { if (d.at <= i) n = d.name; else break; } return n; };
  const lineOf = (i: number) => s.slice(0, i).split('\n').length;
  const judge = (start: number, end: number) => {
    const chain = s.slice(end, (() => { const j = s.indexOf(';', end); return j < 0 ? s.length : j; })());
    const before = s.slice(statementStart(s, start), start)
      .replace(/(\(\s*\w+\s+as\s+any\s*\)|[\w.]+)\s*(\?\.|\.)?\s*$/, '') // drop the receiver (supabase / ownedDbTable / (sb as any) / deps.db)
      .replace(/\s+$/, ' ');
    const read = READ_BEFORE.some((re) => re.test(before.trimEnd()) || re.test(before)) || /\.then\s*\(/.test(chain);
    return { chain, read };
  };
  for (const m of s.matchAll(/(?:from|Table)\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g)) {
    const table = m[1];
    if (!isMoneyTable(table)) continue;
    const { chain, read } = judge(m.index!, m.index! + m[0].length);
    const w = /\.\s*(insert|update|upsert|delete)\s*\(/.exec(chain);
    const anyOp = /\.\s*(select|insert|update|upsert|delete|rpc)\s*\(/.test(chain);
    if (!w && anyOp) continue; // a read
    const op = w ? w[1] : 'unknown';
    const writer = writerAt(m.index!);
    const k = `${writer}|${table}|${op}`;
    counter.set(k, (counter.get(k) ?? 0) + 1);
    sites.push({ file, key: `${file}:${writer}|${table}|${op}|#${counter.get(k)}`, table, op, read: !!w && read, unparseable: !w, line: lineOf(m.index!) });
  }
  for (const m of s.matchAll(/\.rpc\(\s*['"`]([a-z_0-9]+)['"`]/g)) {
    const fn = m[1];
    if (!MONEY_RPC.test(fn)) continue;
    const { read } = judge(m.index!, m.index! + m[0].length);
    const writer = writerAt(m.index!);
    const k = `${writer}|rpc:${fn}|rpc`;
    counter.set(k, (counter.get(k) ?? 0) + 1);
    sites.push({ file, key: `${file}:${writer}|rpc:${fn}|rpc|#${counter.get(k)}`, table: `rpc:${fn}`, op: 'rpc', read, unparseable: false, line: lineOf(m.index!) });
  }
  return sites;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'tests', '__tests__'].includes(e.name) || e.name.startsWith('.')) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * KNOWN unread money writes (6f triage 2026-11-13; e9 rulings). Keyed file:writer|table|op|#n - the writer is the
 * nearest preceding function / method declaration, so a NEW unread write fails even in a listed file (e1).
 * B = BLOCKING (money, fixed first), N = non-blocking,
 * W = webhook/event status (e1's fix/payment-event-state), FP = verified safe (reason given). Remove an entry when
 * its site is fixed - the test fails until you do.
 */
export const ALLOWLIST: Record<string, string> = {
  'backend/services/billing/idempotency/heartbeatService.ts:heartbeatBillingOperation|billing_operations|update|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L45 @9cecd075f]',
  'backend/services/creditAlertService.ts:emitConsumptionAlert|credit_alert_log|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L52 @9cecd075f]',
  'backend/services/creditAlertService.ts:recordForecastEmail|credit_alert_log|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L70 @9cecd075f]',
  'backend/services/creditAlertService.ts:recordAlert|credit_alert_log|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L198 @9cecd075f]',
  'backend/services/creditEfficiencyEngine.ts:upsertEfficiencyTier|credit_efficiency_scores|upsert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L80 @9cecd075f]',
  'backend/services/creditEfficiencyEngine.ts:optimizeCreditEfficiency|credit_efficiency_scores|update|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L155 @9cecd075f]',
  'backend/services/creditExpiryService.ts:expireOrgFreeCredits|credit_expiry_log|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L189 @9cecd075f]',
  'backend/services/creditExpiryService.ts:expireOrgIncentiveCredits|credit_expiry_log|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L273 @9cecd075f]',
  'backend/services/initialFreeCreditService.ts:grantInitialFreeCredit|credit_transactions|update|#1':
    'N: e1-owned (pricing D-step touches this file) - e1 fixes [L120 @9cecd075f]',
  'backend/services/initialFreeCreditService.ts:grantInitialFreeCredit|organization_credits|upsert|#1':
    'N: e1-owned (pricing D-step touches this file) - e1 fixes [L164 @9cecd075f]',
  'backend/services/monetizationReservationReconciliationService.ts:stampHold|credit_transactions|update|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L228 @9cecd075f]',
  'backend/services/payments/razorpayStagingService.ts:markProviderEvent|payment_provider_events|update|#1':
    'W7: event status write - covered by e1 fix/payment-event-state guarded writer [L308 @9cecd075f]',
  'backend/services/payments/razorpayStagingService.ts:recordRejectedWebhook|payment_provider_events|update|#1':
    'W7: event status write - covered by e1 fix/payment-event-state guarded writer [L366 @9cecd075f]',
  'backend/services/payments/razorpayStagingService.ts:handleRazorpayStagingWebhook|payment_provider_events|update|#1':
    'W7: event status write - covered by e1 fix/payment-event-state guarded writer [L482 @9cecd075f]',
  'backend/services/payments/razorpayStagingService.ts:verifyAndFulfillRazorpayStagingPayment|payment_provider_events|update|#1':
    'W7: event status write - covered by e1 fix/payment-event-state guarded writer [L711 @9cecd075f]',
  'backend/services/pricingService.ts:recordCostAnomaly|cost_anomalies|insert|#1':
    'N: telemetry / audit / dedup write unread - 6f fixes (non-blocking) [L661 @9cecd075f]',
  'backend/services/purchaseService.ts:completePurchase|credit_purchases|update|#2':
    'B6 BLOCKING: purchase status update unread (6f fixes) [L178 @9cecd075f]',
  'backend/services/purchaseService.ts:reopenSystemClosedPurchase|credit_purchases|update|#1':
    'FP: { data } read; null -> not-updated branch is safe (verified 6f) [L255 @9cecd075f]',
  'backend/services/purchaseService.ts:failPurchase|credit_purchases|update|#1':
    'B6 BLOCKING: purchase status update unread (6f fixes) [L297 @9cecd075f]',
  'backend/services/usageLedgerService.ts:logUsageEvent|usage_events|insert|#1':
    'N: usage telemetry insert unread - 6f fixes (logger.error + counter, never throws) [L434 @9cecd075f]',
  'pages/api/stripe/webhook.ts:markEvent|payment_provider_events|update|#1':
    'W7: event status write - covered by e1 fix/payment-event-state guarded writer [L144 @9cecd075f]',
};

describe('financial-writes contract', () => {
  describe('POSITIVE CONTROLS - the scanner catches what it must', () => {
    const one = (src: string) => scanSource('backend/fixture/x.ts', src);
    it('an unread write fails; a try/catch-only write fails (supabase does not throw)', () => {
      expect(one("async function f() { await supabase.from('credit_purchases').update({ a: 1 }).eq('id', x); }")).toEqual([expect.objectContaining({ read: false, op: 'update' })]);
      expect(one("async function f() { try { await ownedDbTable('billing_operations').insert({ a: 1 }); } catch { /* x */ } }")).toEqual([expect.objectContaining({ read: false, op: 'insert' })]);
    });
    it('a { data }-only destructure is NOT a read; { error } is', () => {
      expect(one("async function f() { const { data } = await supabase.from('invoices').insert(r).select('id').single(); }")[0].read).toBe(false);
      expect(one("async function f() { const { error } = await supabase.from('invoices').insert(r); }")[0].read).toBe(true);
    });
    it('returned, assigned, arrow-returned and .then are reads', () => {
      expect(one("function f() { return supabase.from('billing_fx_rates').upsert(r); }")[0].read).toBe(true);
      expect(one("async function f() { const res = await supabase.from('credit_transactions').insert(r); }")[0].read).toBe(true);
      expect(one("const g = (a) => supabase.rpc('apply_credit_reservation', a);")[0].read).toBe(true);
      expect(one("function f() { supabase.from('credit_alert_log').insert(r).then((x) => x); }")[0].read).toBe(true);
    });
    it('an UNPARSEABLE money write (builder held in a variable) is flagged', () => {
      expect(one("async function f() { const q = supabase.from('credit_purchases');\n await q.update(r); }")).toEqual([expect.objectContaining({ unparseable: true })]);
    });
    it('a comment mention is not a write', () => {
      expect(one("// await supabase.from('credit_purchases').update(x);\nconst a = 1;")).toEqual([]);
    });
  });

  it('the codebase: every money write reads its result, except the shrinking allowlist (non-vacuous)', () => {
    const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
    const sites = files.flatMap((f) => scanSource(path.relative(ROOT, f).replace(/\\/g, '/'), fs.readFileSync(f, 'utf8')));
    const bad = sites.filter((x) => !x.read || x.unparseable);
    const unlisted = bad.filter((x) => !(x.key in ALLOWLIST)).map((x) => `${x.key} (line ${x.line})${x.unparseable ? ' UNPARSEABLE' : ''}`);
    const stale = Object.keys(ALLOWLIST).filter((k) => !bad.some((x) => x.key === k));
    expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] });
    expect(sites.length).toBeGreaterThan(90); // the scan really saw the money writes
  });
});
