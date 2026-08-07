/**
 * WS1-E6-T006 — shared test contract for the caller-scoped idempotency
 * middleware. One implementation of each mechanism, reused by every suite whose
 * endpoint adopted `withIdempotency`.
 *
 * Adoption changed what a request must look like to reach a handler. A suite
 * that predates it fails in four distinct ways, each masking the next:
 *
 *   1. no Idempotency-Key            -> 400 IDEMPOTENCY_KEY_REQUIRED
 *   2. no authenticated principal    -> 401 IDEMPOTENCY_PRINCIPAL_REQUIRED
 *   3. DB double lacks the table     -> TypeError (.is is not a function)
 *   4. DB double is stateless        -> 500 Failed to initialize idempotency state
 *   5. res methods replaced          -> assertions read the replacement, not the mock
 *
 * None of these is a production defect. Each is the test not representing a
 * real client.
 */

// ── 1. Keys ────────────────────────────────────────────────────────────
// One logical operation == one key, reused for every retry of it. A fresh key
// per attempt is not a retry, it is a new operation, and it silently disables
// the replay protection the test means to exercise. Independent operations MUST
// use different keys or the second replays the first.

let counter = 0;

export function newIdempotencyKey(label = 'op'): string {
  counter += 1;
  return `test-${label}-${counter}`;
}

export function resetIdempotencyKeys(): void {
  counter = 0;
}

/** Header bag. Pass an existing key to model a RETRY of the same operation. */
export function idempotencyHeaders(
  key: string = newIdempotencyKey(),
  extra: Record<string, string> = {},
): Record<string, string> {
  // Lowercase: Next normalizes incoming header names and the middleware reads
  // req.headers['idempotency-key'].
  return { 'idempotency-key': key, ...extra };
}

// ── 2. Principal ───────────────────────────────────────────────────────
/**
 * OR-09 resolves the AUTHENTICATED caller before touching the cache and fails
 * closed on an unresolvable one, so no record can exist without an owner.
 *
 * Deliberately does NOT `jest.requireActual`: IdentityResolver has a
 * module-load side-effect import (`./platformCapabilities`) that THROWS on a
 * capability-isolation violation — the reason withIdempotency imports it
 * dynamically. Loading it here fails the whole suite, including tests that never
 * touch idempotency. `resolvePrincipal` is the only export the middleware uses.
 *
 * Use from the suite's own jest.mock factory so hoisting is correct:
 *   jest.mock('../../security/IdentityResolver', () =>
 *     require('../utils/idempotency').identityResolverMock());
 *
 * AUTHENTICATION only — the endpoint's own authorization still runs in the
 * handler and is still asserted by the suite.
 */
export function identityResolverMock(userId = 'test-caller-1') {
  const resolvePrincipal = jest.fn().mockResolvedValue({
    ok: true,
    principal: { userId, legacyCookieSuperAdmin: false },
  });

  // Returning ONLY resolvePrincipal strips the module's other exports, which
  // breaks unrelated consumers (observed: `bootAuthSubsystem is not a function`).
  // A Proxy keeps the module shaped like a module — every other export answers
  // as an inert jest.fn — without requireActual pulling in the throwing
  // platformCapabilities side-effect.
  return new Proxy(
    { resolvePrincipal } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        if (prop === '__esModule') return true;
        if (typeof prop !== 'string') return undefined;
        // NEVER synthesize the promise protocol. withIdempotency reaches this
        // module via `await import(...)`; a `then` that is a jest.fn is a
        // thenable that never resolves, so the await hangs forever (observed as
        // uniform 30s test timeouts).
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
        (target as any)[prop] = jest.fn();
        return (target as any)[prop];
      },
    },
  );
}

// ── 3 + 4. Stateful api_idempotency_keys table ─────────────────────────
const rows: Array<Record<string, any>> = [];

export function resetIdempotencyTable(): void {
  rows.length = 0;
}

/** Rows currently stored — lets a suite assert replay/caller isolation. */
export function idempotencyTableRows(): ReadonlyArray<Record<string, any>> {
  return rows;
}

/**
 * Wrap a suite's own table factory. Requests for `api_idempotency_keys` get a
 * complete, STATEFUL double; every other table falls through unchanged.
 *
 * Stateful by necessity: createRecord() inserts and then loadExisting() reads
 * the row back, and the middleware 500s when that read misses. Statefulness is
 * also what makes replay real — a second request with the same key finds the
 * stored row.
 */
export function withIdempotencyTable<T>(tableFactory: (table: string) => T) {
  return (table: string): T => {
    if (table !== 'api_idempotency_keys') return tableFactory(table);

    const filters: Record<string, any> = {};
    let patch: Record<string, any> | null = null;
    const matches = (r: Record<string, any>) =>
      Object.entries(filters).every(([k, v]) => r[k] === v);

    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => { filters[k] = v; return q; },
      is: (k: string, v: any) => { filters[k] = v; return q; },
      maybeSingle: async () => ({ data: rows.find(matches) ?? null, error: null }),
      insert: async (row: Record<string, any>) => {
        rows.push({ id: `idem-${rows.length + 1}`, ...row });
        return { error: null };
      },
      update: (p: Record<string, any>) => { patch = p; return q; },
      then: (resolve: (v: { error: null }) => unknown) => {
        if (patch) { rows.filter(matches).forEach((r) => Object.assign(r, patch)); patch = null; }
        return resolve({ error: null });
      },
    };
    return q as T;
  };
}

// ── 5. Assertable response double ──────────────────────────────────────
/**
 * withIdempotency captures the replay response by REPLACING res.status and
 * res.json (withIdempotency.ts:392-412). It binds the originals first, so the
 * suite's mock still records the call — but the property the test asserts on is
 * afterwards the replacement, an anonymous arrow, which is why
 * `expect(res.status).toHaveBeenCalledWith(400)` reports `[Function anonymous]`.
 *
 * That replacement is correct middleware behaviour: without it there is no
 * captured body to replay.
 *
 * This converts `status`/`json` into accessor properties. The setter re-wraps
 * whatever the middleware assigns in a fresh jest.fn, so the property stays a
 * mock and keeps recording. Replacement happens before the handler runs, so
 * every handler call is observed. Handler behaviour is untouched — the wrapper
 * delegates straight through.
 */
export function makeAssertable<T extends Record<string, any>>(res: T): T {
  // The middleware sets X-Request-Id on EVERY request (withIdempotency.ts:231,
  // 242), including methods it passes straight through. Doubles written before
  // adoption often omit setHeader entirely.
  if (typeof (res as any).setHeader !== 'function') (res as any).setHeader = jest.fn();

  for (const name of ['status', 'json'] as const) {
    if (typeof (res as any)[name] !== 'function') continue;
    let impl: any = (res as any)[name];
    Object.defineProperty(res, name, {
      configurable: true,
      enumerable: true,
      get: () => impl,
      set: (fn: any) => { impl = jest.fn((...args: any[]) => fn(...args)); },
    });
  }
  return res;
}

/** Reset all per-test idempotency state. Call in beforeEach. */
export function resetIdempotency(): void {
  resetIdempotencyKeys();
  resetIdempotencyTable();
}
