/**
 * 3AH-117 (WS-E) — the route-auth harness database with targeted faults.
 *
 * Wraps routeAuthHarness.fakeSupabase so a test can make ONE operation on ONE
 * table return a database error, or make it throw. Everything else behaves
 * exactly like the shared harness.
 *
 *   jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/wseFaultClient').supabaseModule());
 */
import { fakeSupabase } from './routeAuthHarness';

export type Fault = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  error: { code: string; message: string };
  /** Throw the error instead of returning it. */
  throws?: boolean;
  /** Fire at most this many times. */
  times?: number;
  /**
   * A fault the test configures but does NOT expect to be reached (e.g. it proves a statement is never issued).
   * Without this flag, a configured fault that never fires FAILS the test (see the afterEach below).
   */
  mayNotFire?: boolean;
};

export const faults: Fault[] = [];

/** Faults that fired at least once in the current test. */
const fired = new WeakSet<Fault>();

export function resetFaults(): void {
  faults.length = 0;
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
    const f = faults.find((x) => x.table === table && x.op === op && (x.times === undefined || x.times > 0));
    if (f && f.times !== undefined) f.times -= 1;
    if (f) fired.add(f);
    return f;
  };
  for (const m of ['single', 'maybeSingle'] as const) {
    const original = b[m];
    b[m] = async () => {
      const f = takeFault();
      if (f?.throws) throw new Error(f.error.message);
      if (f) return { data: null, error: f.error };
      return original();
    };
  }
  const then = b.then;
  b.then = (ok: unknown, err: unknown) => {
    const f = takeFault();
    if (f?.throws) return Promise.reject(new Error(f.error.message)).then(ok as never, err as never);
    if (f) return Promise.resolve({ data: null, error: f.error, count: null }).then(ok as never, err as never);
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
