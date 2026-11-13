/**
 * 3AH-116 (WS-D) — the route-auth harness database with targeted faults.
 *
 * Wraps routeAuthHarness.fakeSupabase so a test can make ONE operation on ONE
 * table fail (e.g. the campaigns delete, the campaign_versions select) or run a
 * hook just before a write executes (to simulate a concurrent change inside a
 * failure window). Everything else behaves exactly like the shared harness.
 *
 *   jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/wsdFaultClient').supabaseModule());
 */
import { fakeSupabase } from './routeAuthHarness';

export type Fault = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  error: { code: string; message: string };
  /** Only fire while this returns true (e.g. after a prior step). */
  when?: () => boolean;
  /** Fire at most this many times. */
  times?: number;
  /**
   * A fault the test configures but does NOT expect to be reached (e.g. it proves a statement is never issued).
   * Without this flag, a configured fault that never fires FAILS the test (see the afterEach below).
   */
  mayNotFire?: boolean;
};

export const faults: Fault[] = [];
export const beforeWrite: Array<(table: string, op: string) => void> = [];
export const faultLog: string[] = [];

/** Faults that fired at least once in the current test. */
const fired = new WeakSet<Fault>();

export function resetFaults(): void {
  faults.length = 0;
  beforeWrite.length = 0;
  faultLog.length = 0;
}

type Builder = Record<string, (...args: unknown[]) => unknown>;

function wrap(table: string): Builder {
  const b = fakeSupabase.from(table) as Builder;
  let op: Fault['op'] = 'select';
  for (const m of ['insert', 'update', 'upsert', 'delete'] as const) {
    const original = b[m];
    b[m] = (...args: unknown[]) => { op = m; original(...args); return b; };
  }
  const takeFault = (): Fault | undefined => {
    const f = faults.find((x) => x.table === table && x.op === op && (!x.when || x.when()) && (x.times === undefined || x.times > 0));
    if (f && f.times !== undefined) f.times -= 1;
    if (f) fired.add(f);
    if (f) faultLog.push(`${op}:${table}`);
    return f;
  };
  const hook = () => { if (op !== 'select') for (const h of beforeWrite) h(table, op); };
  for (const m of ['single', 'maybeSingle'] as const) {
    const original = b[m];
    b[m] = async () => {
      const f = takeFault();
      if (f) return { data: null, error: f.error };
      hook();
      return original();
    };
  }
  const then = b.then;
  b.then = (ok: unknown, err: unknown) => {
    const f = takeFault();
    if (f) return Promise.resolve({ data: null, error: f.error, count: null }).then(ok as never, err as never);
    hook();
    return then(ok, err);
  };
  return b;
}

export function supabaseModule() {
  const supabase = { ...fakeSupabase, from: (t: string) => wrap(t) };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
}

/**
 * FAULT-HIT ASSERTION (e9, S2 2026-11-13). A converted route writes through the tenant seam (tenantTable ->
 * ownedDbTable), which bypasses this client unless the suite routes that table through it. A fault the test
 * configured then never fires, and the "failure window" test silently passes on the success path. Every test
 * whose configured fault never fired goes red here (opt out per fault with mayNotFire: true, and say why).
 */
afterEach(() => {
  const unfired = faults.filter((x) => !fired.has(x) && !x.mayNotFire);
  if (unfired.length > 0) {
    const names = unfired.map((x) => `${x.op}:${x.table}`).join(', ');
    resetFaults();
    throw new Error(`configured fault(s) never fired: ${names} - the statement no longer reaches this fault client (seam path?)`);
  }
});
