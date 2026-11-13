/**
 * Financial + authorization READS contract (e9, register R2 from 05): every read of a MONEY or AUTHORIZATION table
 * must read its `error` - or explicitly handle the absence case (allowlisted with that reason).
 *
 * supabase-js returns a failed read as `{ data: null, error }` - it does NOT throw. A `{ data }`-only read therefore
 * turns "the read FAILED" into "there is no row": on a money path that is a zero balance / no wallet / no purchase,
 * on an authorization path no role / no company status. Whether that is merely wrong or dangerous depends on what the
 * absence branch does (refuse = fails closed; create / grant / default-allow = BLOCKING) - so every unread site is
 * TRIAGED and allowlisted with its tag and reason, and the allowlist may only SHRINK (a fixed site fails until its
 * entry is removed). A NEW unread read fails; an UNPARSEABLE one (builder held in a variable, inside Promise.all, ...)
 * fails - it cannot be followed, so it cannot be trusted (e9).
 *
 * A read counts as HANDLED when its result is: destructured WITH `error`; assigned to a variable whose `.error` (or a
 * destructure of `error` from it) is used afterwards in the same function; returned whole (the caller owns it); or
 * chained with `.then(`. Tables: money (the writes contract's set) + purchases + user_company_roles +
 * capability_assignments + companies when its status is selected.
 */
import * as fs from 'fs';
import * as path from 'path';
import { stripComments, statementStart, declarations, sourceFiles } from '../utils/sourceContractScan';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['backend', 'lib', 'pages'];

const NAMED_MONEY = new Set(['credit_transactions', 'organization_credits', 'billing_operations', 'billing_subscriptions',
  'payment_provider_events', 'payment_provider_event_state', 'usage_events', 'unified_transactions', 'invoices']);
const MONEY_TABLE = /^(credit_|billing_|payment_|invoice|cost_|refund|subscription|wallet|ledger|charge|purchase)/;
const AUTH_TABLES = new Set(['user_company_roles', 'capability_assignments']);
export function tableClass(table: string, selectArgs: string): 'money' | 'auth' | null {
  if (NAMED_MONEY.has(table) || MONEY_TABLE.test(table)) return 'money';
  if (AUTH_TABLES.has(table)) return 'auth';
  if (table === 'companies' && /\bstatus\b|\*/.test(selectArgs)) return 'auth';
  return null;
}

export type ReadVerdict = 'handled' | 'data-only' | 'dropped' | 'var-error-unused' | 'unparseable';
export interface ReadSite { file: string; key: string; table: string; cls: 'money' | 'auth'; verdict: ReadVerdict; line: number }

/** End of the statement that starts at i: the first ';' at bracket depth 0 (strings already intact). */
function statementEnd(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return j; depth--; }
    else if (c === ';' && depth === 0) return j;
  }
  return s.length;
}

export function scanReads(file: string, raw: string): ReadSite[] {
  const s = stripComments(raw);
  const sites: ReadSite[] = [];
  const counter = new Map<string, number>();
  const decls = declarations(s);
  const fnAt = (i: number) => { let n = '<module>', at = 0; for (const d of decls) { if (d.at <= i) { n = d.name; at = d.at; } else break; } return { n, at }; };
  const nextFnAt = (i: number) => { for (const d of decls) if (d.at > i) return d.at; return s.length; };
  const lineOf = (i: number) => s.slice(0, i).split('\n').length;
  for (const m of s.matchAll(/(?:from|Table)\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g)) {
    const table = m[1];
    const start = m.index!;
    const end = statementEnd(s, start);
    const chain = s.slice(start, end);
    if (/\.\s*(insert|update|upsert|delete)\s*\(/.test(chain)) continue;   // a write: the writes contract's domain
    const sel = /\.\s*select\s*\(([^)]*)\)/.exec(chain);
    if (!sel) continue;
    const cls = tableClass(table, sel[1]);
    if (!cls) continue;
    const before = s.slice(statementStart(s, start), start).replace(/(\(\s*\w+\s+as\s+any\s*\)|[\w.]+)\s*(\?\.|\.)?\s*$/, '').trimEnd();
    const awaited = /\bawait\s*\(?\s*$/.test(before);
    let verdict: ReadVerdict;
    if (/\.then\s*\(/.test(chain)) verdict = 'handled';
    else if (/\breturn\s*(?:await\s*)?\(?\s*$/.test(before) || /=>\s*(?:await\s*)?\(?\s*$/.test(before)) verdict = 'handled';
    else if (/Promise\.all(?:Settled)?\s*\(\s*\[[^\]]*$/.test(s.slice(Math.max(0, start - 600), start))) verdict = 'unparseable';
    else {
      const destr = /(?:const|let|var)?\s*\{([^}]*)\}\s*=\s*(?:await\s*)?\(?\s*$/.exec(before);
      const assign = /(?:const|let|var)?\s*(\w+)\s*(?::[^=]+)?=\s*(await\s*)?\(?\s*$/.exec(before);
      if (destr) verdict = /\berror\b/.test(destr[1]) ? 'handled' : (awaited ? 'data-only' : 'unparseable');
      else if (assign && !awaited) {
        // A builder held in a variable: handled when the SAME function later awaits it into a destructure WITH error,
        // or into a variable whose .error is then used (triage: 24 such false positives). Otherwise unparseable.
        const v = assign[1];
        const rest = s.slice(end, nextFnAt(start));
        const destrAwait = new RegExp(`\\{[^}]*\\berror\\b[^}]*\\}\\s*=\\s*await\\s+${v}\\b`).test(rest);
        const varAwait = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*await\\s+${v}\\b`).exec(rest);
        const varUsesError = !!varAwait && new RegExp(`\\b${varAwait[1]}\\s*(?:\\?\\.|\\.)\\s*error\\b`).test(rest);
        verdict = destrAwait || varUsesError ? 'handled' : 'unparseable';
      }
      else if (assign) {
        const v = assign[1];
        const rest = s.slice(end, nextFnAt(start));
        const usesError = new RegExp(`\\b${v}\\s*(?:\\?\\.|\\.)\\s*error\\b|\\{[^}]*\\berror\\b[^}]*\\}\\s*=\\s*${v}\\b`).test(rest);
        verdict = usesError ? 'handled' : 'var-error-unused';
      } else if (awaited) verdict = 'dropped';
      else verdict = 'unparseable';
    }
    const { n } = fnAt(start);
    const k = `${n}|${table}|read`;
    counter.set(k, (counter.get(k) ?? 0) + 1);
    sites.push({ file, key: `${file}:${k}|#${counter.get(k)}`, table, cls, verdict, line: lineOf(start) });
  }
  return sites;
}

describe('financial + authorization reads contract', () => {
  describe('POSITIVE CONTROLS - the scanner catches what it must', () => {
    const one = (src: string) => scanReads('backend/fixture/x.ts', src).map((x) => x.verdict);
    it('a { data }-only read is NOT handled; { data, error } is', () => {
      expect(one("async function f() { const { data } = await supabase.from('credit_purchases').select('id').eq('id', x).maybeSingle(); }")).toEqual(['data-only']);
      expect(one("async function f() { const { data, error } = await supabase.from('credit_purchases').select('id').maybeSingle(); }")).toEqual(['handled']);
    });
    it('a result variable is handled only when its .error is used', () => {
      expect(one("async function f() { const r = await supabase.from('user_company_roles').select('role').eq('u', 1); return r.data; }")).toEqual(['var-error-unused']);
      expect(one("async function f() { const r = await supabase.from('user_company_roles').select('role'); if (r.error) throw r.error; return r.data; }")).toEqual(['handled']);
    });
    it('returned / arrow-returned / .then are handled; a dropped await is not', () => {
      expect(one("async function f() { return supabase.from('invoices').select('*').eq('id', x); }")).toEqual(['handled']);
      expect(one("const f = () => supabase.from('invoices').select('*');")).toEqual(['handled']);
      expect(one("function f() { supabase.from('invoices').select('id').then(({ data, error }) => g(data, error)); }")).toEqual(['handled']);
      expect(one("async function f() { await supabase.from('invoices').select('id'); }")).toEqual(['dropped']);
    });
    it('a builder held in a variable is HANDLED only when later awaited with error; else UNPARSEABLE; Promise.all is UNPARSEABLE', () => {
      expect(one("async function f() { const q = supabase.from('credit_transactions').select('id'); const { data } = await q; }")).toEqual(['unparseable']);
      expect(one("async function f() { let q = supabase.from('credit_transactions').select('id'); q = q.eq('a', 1); const { data, error } = await q; if (error) throw error; }")).toEqual(['handled']);
      expect(one("async function f() { const q = supabase.from('credit_transactions').select('id'); const r = await q; if (r.error) throw r.error; }")).toEqual(['handled']);
      expect(one("async function f() { const [a, b] = await Promise.all([supabase.from('credit_transactions').select('id'), g()]); }")).toEqual(['unparseable']);
    });
    it('companies counts only when its status is read; writes and other tables are ignored', () => {
      expect(one("async function f() { const { data } = await supabase.from('companies').select('name').eq('id', x); }")).toEqual([]);
      expect(one("async function f() { const { data } = await supabase.from('companies').select('id, status').eq('id', x); }")).toEqual(['data-only']);
      expect(one("async function f() { const { data } = await supabase.from('credit_purchases').update({ a: 1 }).select('id'); }")).toEqual([]);
      expect(one("async function f() { const { data } = await supabase.from('campaigns').select('id'); }")).toEqual([]);
    });
  });

  /**
   * The allowlist (financialReadsContract.allowlist.json) holds every currently unhandled site with its TRIAGE tag
   * (2026-11-13, four read-only triage passes over the census; BLOCKING claims verified site by site before fixing):
   *   BLOCKING          - a failed read leads to grant / create / charge / complete / skipped refusal: fix, then remove;
   *   FAIL-CLOSED       - the absence path denies / refuses / throws: tolerated, ideally still made explicit;
   *   MISLEADING        - no state change, a false display or report value;
   *   HANDLED-ELSEWHERE - the error IS read through a shape the scanner cannot follow (helper, Promise.all, ...).
   * It may only SHRINK: a NEW unhandled read fails (unlisted), and a fixed site fails until its entry is removed (stale).
   */
  it('the codebase: every money / auth read handles its error, except the shrinking allowlist (non-vacuous)', () => {
    const ALLOW = JSON.parse(fs.readFileSync(path.join(__dirname, 'financialReadsContract.allowlist.json'), 'utf8')) as Record<string, string>;
    const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
    const sites = files.flatMap((f) => scanReads(path.relative(ROOT, f).replace(/\\/g, '/'), fs.readFileSync(f, 'utf8')));
    expect(sites.length).toBeGreaterThan(300);                                  // non-vacuous: the scan really ran
    expect(sites.filter((x) => x.verdict === 'handled').length).toBeGreaterThan(100);
    const bad = sites.filter((x) => x.verdict !== 'handled');
    const unlisted = bad.filter((x) => !(x.key in ALLOW)).map((x) => `${x.key} (line ${x.line}, ${x.verdict})`);
    const stale = Object.keys(ALLOW).filter((k) => !bad.some((x) => x.key === k));
    expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] });
    // every entry carries a triage tag and a reason
    for (const [k, v] of Object.entries(ALLOW)) expect([k, /^(BLOCKING|FAIL-CLOSED|MISLEADING|HANDLED-ELSEWHERE)\b.*: \S/.test(v)]).toEqual([k, true]);
  }, 300_000);
});
