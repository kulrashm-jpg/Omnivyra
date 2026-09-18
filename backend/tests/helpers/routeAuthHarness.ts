/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — shared harness for route authentication and
 * tenant-isolation tests.
 *
 * Only the DATABASE and the IDENTITY PROVIDER are faked. Everything between the
 * route and the database — resolveUserContext, enforceCompanyAccess,
 * TenantGuard.assertTenantAccess, requireCampaignAccess, the campaign
 * ownership binding, rbacService — runs for real, so a regression in any link
 * of the authorization chain fails the route's test.
 *
 * Usage (jest.mock factories may `require`, but may not close over module
 * scope, so each test file wires the modules itself):
 *
 *   jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
 *   jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
 *   jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
 *   jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
 *   jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
 *
 * Fixture world: two active companies (CO_A, CO_B), one COMPANY_ADMIN member in
 * each (USER_A, USER_B), one campaign each (CAMPAIGN_A, CAMPAIGN_B, owned via
 * campaign_versions), and a super admin (USER_SUPER). Tests add route-specific
 * rows with seed().
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const CO_A = 'co-a-0000-0000-0000-00000000000a';
export const CO_B = 'co-b-0000-0000-0000-00000000000b';
export const USER_A = 'user-a-00-0000-0000-00000000000a';
export const USER_B = 'user-b-00-0000-0000-00000000000b';
export const USER_SUPER = 'user-s-00-0000-0000-00000000000s';
export const CAMPAIGN_A = 'camp-a-00-0000-0000-00000000000a';
export const CAMPAIGN_B = 'camp-b-00-0000-0000-00000000000b';
export const UNKNOWN_ID = 'unkn-x-00-0000-0000-00000000000x';
export const TOKENS: Record<string, string> = { A: 'tok-user-a', B: 'tok-user-b', SUPER: 'tok-user-super' };
/** If this string ever reaches a response for USER_A, isolation failed. */
export const CANARY_B = 'CANARY-COMPANY-B-CONFIDENTIAL';

const USERS_BY_TOKEN: Record<string, { id: string; email: string }> = {
  'tok-user-a': { id: USER_A, email: 'a@example.test' },
  'tok-user-b': { id: USER_B, email: 'b@example.test' },
  'tok-user-super': { id: USER_SUPER, email: 's@example.test' },
};

type Row = Record<string, any>;
export type Call = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown };

const state: {
  tables: Record<string, Row[]>;
  calls: Call[];
  failTables: Set<string>;
  /** table → columns that INSERT must find unoccupied (see uniqueKey). */
  unique: Record<string, string[]>;
} = {
  tables: {},
  calls: [],
  failTables: new Set(),
  unique: {},
};

function baseTables(): Record<string, Row[]> {
  return {
    companies: [
      { id: CO_A, status: 'active', name: 'Company A' },
      { id: CO_B, status: 'active', name: `Company B ${CANARY_B}` },
    ],
    user_company_roles: [
      { user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_B, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: USER_SUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'active' },
    ],
    campaigns: [
      { id: CAMPAIGN_A, company_id: CO_A, user_id: USER_A, name: 'Campaign A', status: 'planning' },
      { id: CAMPAIGN_B, company_id: CO_B, user_id: USER_B, name: `Campaign B ${CANARY_B}`, status: 'planning' },
    ],
    campaign_versions: [
      { campaign_id: CAMPAIGN_A, company_id: CO_A, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
      { campaign_id: CAMPAIGN_B, company_id: CO_B, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
    ],
  };
}

/** Reset to the base world, then merge route-specific rows (appended per table). */
export function seed(extra: Record<string, Row[]> = {}): void {
  state.tables = baseTables();
  state.calls = [];
  state.failTables = new Set();
  state.unique = {};
  for (const [t, rows] of Object.entries(extra)) state.tables[t] = [...(state.tables[t] || []), ...rows.map((r) => ({ ...r }))];
}
seed();

/** Make every query against `table` return a database error (lookup-failure paths). */
export function failTable(table: string): void {
  state.failTables.add(table);
}

/**
 * Declare a uniqueness constraint (e.g. a primary key) on `table.column`, so
 * an INSERT whose value is already present fails with Postgres 23505 instead of
 * silently appending. Opt-in and cleared by seed(): with no declaration the
 * builder behaves exactly as before, so no existing suite changes.
 *
 * This is what lets a suite exercise insert-then-conflict code paths — the
 * shape a route uses when it must not lose a create race (WSF-ORD-007).
 */
export function uniqueKey(table: string, column: string): void {
  state.unique[table] = [...(state.unique[table] || []), column];
}

export function calls(): Call[] {
  return state.calls;
}
export function rows(table: string): Row[] {
  return state.tables[table] || [];
}
/** Calls that touched one of `tables` (the route's sink), guard reads excluded by choice of tables. */
export function sinkCalls(tables: string[]): Call[] {
  return state.calls.filter((c) => tables.includes(c.table));
}
export function writeCalls(tables?: string[]): Call[] {
  return state.calls.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op) && (!tables || tables.includes(c.table)));
}

type Filter = { col: string; op: string; val: unknown };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case 'eq': return v === f.val || (v != null && f.val != null && String(v) === String(f.val));
      case 'neq': return v !== f.val;
      case 'in': return Array.isArray(f.val) && (f.val as unknown[]).map(String).includes(String(v));
      case 'is': return f.val === null ? v == null : v === f.val;
      case 'gt': return v > (f.val as any);
      case 'gte': return v >= (f.val as any);
      case 'lt': return v < (f.val as any);
      case 'lte': return v <= (f.val as any);
      default: return true;
    }
  });
}

function makeBuilder(table: string): any {
  const filters: Filter[] = [];
  let op = 'select';
  let payload: any = null;
  let limitN: number | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;
  const b: any = {};
  const passthrough = ['select', 'range', 'or', 'not', 'ilike', 'like', 'contains', 'overlaps', 'match', 'textSearch', 'filter', 'returns', 'abortSignal', 'csv', 'throwOnError'];
  for (const m of passthrough) b[m] = () => b;
  for (const m of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte']) {
    b[m] = (col: string, val: unknown) => { filters.push({ col, op: m, val }); return b; };
  }
  b.order = (col: string, opts?: { ascending?: boolean }) => { orderBy = { col, asc: opts?.ascending !== false }; return b; };
  b.limit = (n: number) => { limitN = n; return b; };
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    b[m] = (p?: unknown) => { op = m; payload = p; return b; };
  }
  const run = (): { data: any; error: any; count: number } => {
    state.calls.push({ table, op, filters: Object.fromEntries(filters.map((f) => [f.col, f.val])), payload });
    if (state.failTables.has(table)) return { data: null, error: { message: `forced failure on ${table}`, code: 'XX000' }, count: 0 };
    const all = state.tables[table] || (state.tables[table] = []);
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: r?.id ?? `gen-${all.length + 1}`, ...r }));
      // A plain INSERT must respect declared uniqueness; an UPSERT is allowed
      // to land on an occupied key by definition.
      if (op === 'insert') {
        for (const col of state.unique[table] || []) {
          if (list.some((r: Row) => all.some((x) => x[col] != null && String(x[col]) === String(r[col])))) {
            return {
              data: null,
              error: { message: `duplicate key value violates unique constraint on ${table}.${col}`, code: '23505' },
              count: 0,
            };
          }
        }
      }
      all.push(...list);
      return { data: list, error: null, count: list.length };
    }
    let hit = all.filter((r) => matches(r, filters));
    if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null, count: hit.length }; }
    if (op === 'delete') { state.tables[table] = all.filter((r) => !hit.includes(r)); return { data: hit, error: null, count: hit.length }; }
    if (orderBy) {
      const { col, asc } = orderBy;
      hit = [...hit].sort((x, y) => (x[col] === y[col] ? 0 : (x[col] > y[col] ? 1 : -1) * (asc ? 1 : -1)));
    }
    if (limitN != null) hit = hit.slice(0, limitN);
    return { data: hit, error: null, count: hit.length };
  };
  b.maybeSingle = async () => { const r = run(); return { data: r.error ? null : (r.data[0] ?? null), error: r.error }; };
  b.single = async () => {
    const r = run();
    if (r.error) return { data: null, error: r.error };
    return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
  };
  b.then = (ok: any, err: any) => Promise.resolve(run()).then(ok, err);
  return b;
}

export const fakeSupabase: any = {
  from: (t: string) => makeBuilder(t),
  rpc: async (fn: string, args?: unknown) => {
    state.calls.push({ table: `rpc:${fn}`, op: 'rpc', filters: {}, payload: args });
    return { data: null, error: null };
  },
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) },
  auth: {
    getUser: async (token?: string) => {
      const u = token ? USERS_BY_TOKEN[token] : null;
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
    },
    admin: { getUserById: async (id: string) => ({ data: { user: Object.values(USERS_BY_TOKEN).find((u) => u.id === id) ?? null }, error: null }) },
  },
};

export function supabaseModule() {
  return { supabase: fakeSupabase, default: fakeSupabase, getSupabase: () => fakeSupabase, supabaseAdmin: fakeSupabase };
}
export function writeOwnerModule() {
  return { ownedDbTable: (t: string) => makeBuilder(t) };
}

function tokenOf(req: any): string | null {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
export function userForRequest(req: any): { id: string; email: string } | null {
  const t = tokenOf(req);
  return t ? USERS_BY_TOKEN[t] ?? null : null;
}

export function authModule() {
  return {
    getSupabaseUserFromRequest: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      if (u) return { user: u, error: null };
      return { user: null, error: tokenOf(req) ? 'INVALID_AUTH' : 'MISSING_AUTH' };
    }),
  };
}

export function identityModule() {
  return {
    resolvePrincipal: jest.fn(async (req: any) => {
      const u = userForRequest(req);
      return u
        ? { ok: true, principal: { userId: u.id, supabaseUid: u.id, email: u.email, legacyCookieSuperAdmin: false } }
        : { ok: false, reason: 'NO_AUTH' };
    }),
  };
}

export type Invoked = { status: number; body: any; headers: Record<string, unknown>; redirect: string | null };

/** Invoke a Next.js API handler with a fake req/res. `as` picks the caller (A, B, SUPER) or anonymous. */
export async function invoke(
  handler: (req: any, res: any) => unknown,
  opts: { method?: string; query?: Record<string, unknown>; body?: unknown; as?: 'A' | 'B' | 'SUPER' | null; headers?: Record<string, string> } = {},
): Promise<Invoked> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.as) headers.authorization = `Bearer ${TOKENS[opts.as]}`;
  const req: any = {
    method: opts.method || 'GET',
    query: { ...(opts.query || {}) },
    body: opts.body ?? {},
    headers,
    cookies: {},
    url: '/api/test',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const out: Invoked = { status: 200, body: undefined, headers: {}, redirect: null };
  const res: any = {
    statusCode: 200,
    headersSent: false,
    status(code: number) { out.status = code; this.statusCode = code; return this; },
    json(b: unknown) { out.body = b; this.headersSent = true; return this; },
    send(b: unknown) { out.body = b; this.headersSent = true; return this; },
    end(b?: unknown) { if (b !== undefined) out.body = b; this.headersSent = true; return this; },
    setHeader(k: string, v: unknown) { out.headers[k.toLowerCase()] = v; return this; },
    getHeader(k: string) { return out.headers[k.toLowerCase()]; },
    removeHeader(k: string) { delete out.headers[k.toLowerCase()]; },
    writeHead(code: number) { out.status = code; return this; },
    write() { return true; },
    redirect(a: number | string, b?: string) {
      if (typeof a === 'number') { out.status = a; out.redirect = b ?? null; } else { out.status = 307; out.redirect = a; }
      this.headersSent = true;
      return this;
    },
    on() { return this; },
    once() { return this; },
  };
  await handler(req, res);
  return out;
}

/** True when a serialized response body mentions company B's canary. */
export function leaksB(body: unknown): boolean {
  try { return JSON.stringify(body ?? '').includes(CANARY_B) || JSON.stringify(body ?? '').includes(CO_B); } catch { return false; }
}
