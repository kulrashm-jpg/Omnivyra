/**
 * Legacy plaintext RPA session invalidation.
 *
 *   - invalidated / plaintext rows are unusable by the worker loader;
 *   - platform health: connected ONLY for a valid, unexpired, decryptable,
 *     correctly-bound encrypted envelope; plaintext / invalidated /
 *     undecryptable / expired / mis-bound → rpa_session 'reauth_required';
 *     tenant isolation; storage_state is never selected whole;
 *   - callback reports reauth_required + reason for the marker;
 *   - no cookie content reaches any console call;
 *   - migration 20261231000010 static contract + refusing rollback;
 *   - filesystem purge never opens file contents or logs names.
 *
 * All fixtures are obviously fake. No database, no network, no browser.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const mockConfig: { ENCRYPTION_KEY: string | undefined } = { ENCRYPTION_KEY: KEY_A };
jest.mock('@/config', () => ({ config: mockConfig }));

type Row = Record<string, any>;
const mockTables: Record<string, Row[]> = {};
const mockSelects: Array<{ table: string; cols: string }> = [];

/** Value of `col->>key` as PostgREST returns it (text, or null). */
function jsonText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Minimal chainable PostgREST fake that HONOURS the select projection,
 * including `alias:col->>key`, so a test can prove which fields were fetched.
 */
function mockFrom(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let cols = '*';
  let single = false;
  const project = (r: Row): Row => {
    if (cols.trim() === '*') return { ...r };
    const out: Row = {};
    for (const raw of cols.split(',')) {
      const tok = raw.trim();
      const m = tok.match(/^(?:(\w+):)?(\w+)->>(\w+)$/);
      if (m) {
        const alias = m[1] ?? m[3];
        const base = r[m[2]];
        out[alias] = base && typeof base === 'object' && !Array.isArray(base) ? jsonText(base[m[3]]) : null;
      } else {
        out[tok] = r[tok];
      }
    }
    return out;
  };
  const run = () => {
    const rows = (mockTables[table] ?? []).filter((r) => filters.every((f) => f(r))).map(project);
    if (single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  const q: any = {
    select(c?: string) { cols = c ?? '*'; mockSelects.push({ table, cols }); return q; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
    gte(k: string, v: any) { filters.push((r) => r[k] >= v); return q; },
    limit() { return q; },
    maybeSingle() { single = true; return Promise.resolve(run()); },
    then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
  };
  return q;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockFrom(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockFrom(t) } }));
jest.mock('../../services/platformTokenService', () => ({
  getPlatformsWithTokensForOrg: async () => [],
  getPlatformsWithActiveSocialAccountsForOrg: async () => [],
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const store = require('../../services/rpaWorker/rpaSessionStore');
const { getPlatformHealth } = require('../../services/platformHealth/platformHealthService');
const { runRpaScript } = require('../../services/rpaWorker/rpaPlaywrightRunner');
const callbackHandler = require('../../../pages/api/rpa/auth/callback').default;
const tokens = require('../../services/rpaWorker/rpaAuthTokens');
const { purgeLegacyRpaSessionFiles } = require('../../services/rpaWorker/rpaLegacySessionFilePurge');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SECRET = 'FAKE-COOKIE-DO-NOT-LOG-7f3c';
const STATE = { cookies: [{ name: 'fake_sess', value: SECRET, domain: '.example.invalid', path: '/' }], origins: [] };
const MARKER = { format: 'omnivyra.rpa_session.invalidated', reason: 'legacy_plaintext', invalidated_at: '2026-12-31T00:00:00Z' };
const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString();
const PAST = () => new Date(Date.now() - 60_000).toISOString();

const sealFor = (org: string, platform: string, key = KEY_A) => {
  const prev = mockConfig.ENCRYPTION_KEY;
  mockConfig.ENCRYPTION_KEY = key;
  try { return store.sealRpaSession(org, platform, STATE); } finally { mockConfig.ENCRYPTION_KEY = prev; }
};
const row = (org: string, platform: string, storage_state: unknown, expires_at: string | null = null): Row =>
  ({ id: `${org}-${platform}`, organization_id: org, platform, storage_state, expires_at, account_tier: null });

let consoleSpies: jest.SpyInstance[] = [];
const loggedText = () => consoleSpies
  .flatMap((s) => s.mock.calls)
  .map((args) => args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  .join('\n');

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.rpa_sessions = [];
  mockSelects.length = 0;
  mockConfig.ENCRYPTION_KEY = KEY_A;
  process.env.RPA_AUTH_SECRET = 'rpa-test-signing-secret-0123456789';
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const)
    .map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(() => {
  // Global invariant: no fixture cookie value ever reaches a console call.
  expect(loggedText()).not.toContain(SECRET);
  consoleSpies.forEach((s) => s.mockRestore());
});

// ─────────────────────────────────────────────────────────────────────────────
describe('worker loader refuses invalidated and plaintext rows', () => {
  it('invalidated marker → loadRpaSession null; logs a fixed code, no content', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', MARKER, FUTURE()));
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
    expect(loggedText()).toContain('RPA_SESSION_INVALIDATED_REFUSED');
  });

  it('legacy plaintext → loadRpaSession null; cookie never logged', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', STATE));
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toBeNull();
    expect(loggedText()).toContain('RPA_SESSION_PLAINTEXT_REFUSED');
  });

  it('the Playwright runner refuses a marker row with RPA_NO_SESSION before launching a browser', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', MARKER));
    const launch = jest.fn();
    const url = 'https://www.linkedin.com/feed/update/urn:li:activity:1/';
    const r = await runRpaScript(
      { tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'like', target_url: url, text: null, action_id: 'act-1' },
      { targetUrl: url, steps: [{ kind: 'wait_for_any', selectors: ['button.like'] }] },
      {
        envReady: async () => ({ ok: true as const }),
        loadPlaywright: async () => ({ chromium: { launch } }),
        loadSession: store.loadRpaSession,
        makeCancellationChecker: () => async () => false,
        saveArtifact: async () => null,
      },
    );
    expect(r).toMatchObject({ success: false, error: 'RPA_NO_SESSION', may_have_acted: false });
    expect(launch).not.toHaveBeenCalled();
  });

  it('a valid envelope still loads (control)', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', sealFor(ORG_A, 'linkedin'), FUTURE()));
    expect(await store.loadRpaSession(ORG_A, 'linkedin')).toEqual(STATE);
  });

  it('getRpaAccountTier ignores a marker row', async () => {
    mockTables.rpa_sessions.push({ ...row(ORG_A, 'instagram', MARKER), account_tier: 'business' });
    expect(await store.getRpaAccountTier(ORG_A, 'instagram')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkRpaSessionRow', () => {
  const check = (ss: unknown, exp: string | null = null, org = ORG_A, p = 'linkedin') =>
    store.checkRpaSessionRow({ storage_state: ss, expires_at: exp }, org, p);

  it('classifies every unusable shape as reauth_required with a reason', () => {
    expect(check(STATE)).toEqual({ status: 'reauth_required', reason: 'legacy_plaintext' });
    expect(check(MARKER)).toEqual({ status: 'reauth_required', reason: 'invalidated' });
    expect(check(sealFor(ORG_A, 'linkedin'), PAST())).toEqual({ status: 'reauth_required', reason: 'expired' });
    expect(check(sealFor(ORG_A, 'linkedin', KEY_B))).toEqual({ status: 'reauth_required', reason: 'undecryptable' });
    expect(check(sealFor(ORG_B, 'linkedin'))).toEqual({ status: 'reauth_required', reason: 'binding_mismatch' });
    expect(check(sealFor(ORG_A, 'twitter'))).toEqual({ status: 'reauth_required', reason: 'binding_mismatch' });
    expect(check(null)).toEqual({ status: 'reauth_required', reason: 'legacy_plaintext' });
    expect(check('not-json-object')).toEqual({ status: 'reauth_required', reason: 'legacy_plaintext' });
    expect(check(sealFor(ORG_A, 'linkedin'), 'not-a-date')).toEqual({ status: 'reauth_required', reason: 'expired' });
  });

  it('connected only for a valid, unexpired, decryptable, bound envelope', () => {
    expect(check(sealFor(ORG_A, 'linkedin'))).toEqual({ status: 'connected' });
    expect(check(sealFor(ORG_A, 'linkedin'), FUTURE())).toEqual({ status: 'connected' });
  });

  it('never logs (silent classifier)', () => {
    check(STATE); check(MARKER); check(sealFor(ORG_A, 'linkedin', KEY_B));
    expect(consoleSpies.every((s) => s.mock.calls.length === 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('platform health', () => {
  const healthFor = async (org: string, platform: string) =>
    ((await getPlatformHealth(org)) as Array<Record<string, any>>).find((h) => h.platform === platform);

  const cases: Array<[string, () => Row, string]> = [
    ['legacy plaintext', () => row(ORG_A, 'linkedin', STATE, FUTURE()), 'legacy_plaintext'],
    ['invalidated marker', () => row(ORG_A, 'linkedin', MARKER, PAST()), 'invalidated'],
    ['undecryptable (other key)', () => row(ORG_A, 'linkedin', sealFor(ORG_A, 'linkedin', KEY_B), FUTURE()), 'undecryptable'],
    ['expired envelope', () => row(ORG_A, 'linkedin', sealFor(ORG_A, 'linkedin'), PAST()), 'expired'],
    ['ciphertext copied from another tenant', () => row(ORG_A, 'linkedin', sealFor(ORG_B, 'linkedin'), FUTURE()), 'binding_mismatch'],
  ];

  it.each(cases)('%s → reauth_required, not connected', async (_n, mk, reason) => {
    mockTables.rpa_sessions.push(mk());
    const h = await healthFor(ORG_A, 'linkedin');
    expect(h).toBeDefined();
    expect(h!.rpa_session).toBe('reauth_required');
    expect(h!.rpa_session_reason).toBe(reason);
    expect(h!.connected_via).not.toContain('rpa');
    expect(h!.has_live_connection).toBe(false);
    expect(h!.egress.reply.rpa).toBe('no_session'); // drives the re-login prompt
    expect(h!.egress.like.rpa).toBe('no_session');
    expect(JSON.stringify(h)).not.toContain(SECRET);
  });

  it('valid encrypted unexpired envelope → connected', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', sealFor(ORG_A, 'linkedin'), FUTURE()));
    mockTables.rpa_sessions.push(row(ORG_A, 'reddit', sealFor(ORG_A, 'reddit'), null));
    for (const p of ['linkedin', 'reddit']) {
      const h = await healthFor(ORG_A, p);
      expect(h!.rpa_session).toBe('connected');
      expect(h!.rpa_session_reason).toBeNull();
      expect(h!.connected_via).toContain('rpa');
      expect(h!.has_live_connection).toBe(true);
      expect(h!.egress.reply.rpa).toBe('ok');
    }
  });

  it('tenant isolation: another org\'s valid session never makes this org connected', async () => {
    mockTables.rpa_sessions.push(row(ORG_B, 'linkedin', sealFor(ORG_B, 'linkedin'), FUTURE()));
    expect(await healthFor(ORG_A, 'linkedin')).toBeUndefined();
    expect((await healthFor(ORG_B, 'linkedin'))!.rpa_session).toBe('connected');
  });

  it('storage_state is never selected whole (only format/alg/ciphertext projections)', async () => {
    mockTables.rpa_sessions.push(row(ORG_A, 'linkedin', STATE, FUTURE()));
    await getPlatformHealth(ORG_A);
    const sel = mockSelects.filter((s) => s.table === 'rpa_sessions');
    expect(sel.length).toBe(1);
    const cols = sel[0].cols.split(',').map((c) => c.trim());
    expect(cols).not.toContain('storage_state');
    expect(cols).not.toContain('*');
    for (const c of cols.filter((x) => x.includes('storage_state'))) {
      expect(c).toMatch(/^ss_\w+:storage_state->>(format|alg|ciphertext)$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('callback reports invalidated rows as reauth_required', () => {
  it('marker → reauth_required, reason invalidated; plaintext → legacy_plaintext', async () => {
    mockTables.rpa_sessions.push({ ...row(ORG_A, 'linkedin', MARKER), last_login_at: null, last_verified_at: null });
    mockTables.rpa_sessions.push({ ...row(ORG_A, 'twitter', STATE), last_login_at: null, last_verified_at: null });
    const res = (body: any = {}) => {
      const r: any = { statusCode: 0, body };
      r.status = (c: number) => { r.statusCode = c; return r; };
      r.json = (b: unknown) => { r.body = b; return r; };
      r.setHeader = () => r;
      return r;
    };
    for (const [platform, reason] of [['linkedin', 'invalidated'], ['twitter', 'legacy_plaintext']] as const) {
      const { token } = tokens.issueRpaAuthToken({ organization_id: ORG_A, platform, user_id: 'admin_a' });
      const r = res();
      await callbackHandler({ method: 'GET', headers: {}, query: { session_token: token } }, r);
      expect(r.statusCode).toBe(200);
      expect(r.body).toMatchObject({ status: 'reauth_required', reauth_reason: reason, account_tier: null });
      expect(JSON.stringify(r.body)).not.toContain(SECRET);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('migration 20261231000010 static contract', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const mig = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261231000010_rpa_legacy_session_invalidation.sql'), 'utf8');
  const rb = fs.readFileSync(path.join(root, 'supabase', 'migrations', 'rollbacks', 'rpa_legacy_session_invalidation_rollback.sql'), 'utf8');
  const code = (sql: string) => sql.replace(/--[^\n]*/g, '');
  const m = code(mig);

  it('scrub predicate excludes exactly valid envelopes and existing markers', () => {
    const scrub = m.slice(m.indexOf('$scrub$'), m.lastIndexOf('$scrub$'));
    expect(scrub).toMatch(/WHERE NOT \(/);
    expect(scrub).toContain("s.storage_state->>'format' = 'omnivyra.rpa_session.v1'");
    expect(scrub).toContain("s.storage_state->>'alg' = 'aes-256-gcm'");
    expect(scrub).toContain("jsonb_typeof(s.storage_state->'ciphertext') = 'string'");
    // Same ciphertext shape the application enforces.
    expect(scrub).toContain("~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'");
    expect(store.isEncryptedSessionEnvelope({ format: 'omnivyra.rpa_session.v1', alg: 'aes-256-gcm', ciphertext: `${'0'.repeat(24)}:${'0'.repeat(32)}:ab` })).toBe(true);
    expect(scrub).toContain("s.storage_state->>'format' = 'omnivyra.rpa_session.invalidated'");
    expect(scrub).toContain(store.RPA_SESSION_INVALIDATED_FORMAT);
    expect(scrub).toContain(store.RPA_SESSION_ENVELOPE_FORMAT);
  });

  it('marker holds no source content; tier cleared; expiry clamped; bounded batches', () => {
    const set = m.slice(m.indexOf('SET storage_state'), m.indexOf('FROM candidates'));
    expect(set).toMatch(/jsonb_build_object\(\s*'format', 'omnivyra\.rpa_session\.invalidated',\s*'reason', 'legacy_plaintext',\s*'invalidated_at', now\(\)\)/);
    expect(set).not.toMatch(/storage_state\s*(->|\|\||#>)/); // never derived from the old blob
    expect(set).toContain('account_tier = NULL');
    expect(set).toContain('LEAST(COALESCE(s.expires_at, now()), now())');
    expect(m).toMatch(/LIMIT 500\s+FOR UPDATE/);
    expect(m).toMatch(/IF v_iterations > 10000 THEN/);
  });

  it('audit records counts per org/platform only, never content', () => {
    const create = m.slice(m.indexOf('CREATE TABLE IF NOT EXISTS public.rpa_session_invalidation_audit'), m.indexOf('ALTER TABLE public.rpa_session_invalidation_audit'));
    expect(create).not.toMatch(/storage_state|jsonb|cookie/i);
    expect(m).toContain('ALTER TABLE public.rpa_session_invalidation_audit ENABLE ROW LEVEL SECURITY');
    expect(m).toContain('REVOKE ALL ON TABLE public.rpa_session_invalidation_audit FROM PUBLIC, anon, authenticated');
    const ins = m.slice(m.indexOf('INSERT INTO public.rpa_session_invalidation_audit'), m.indexOf('RETURNING rows_invalidated'));
    expect(ins).not.toContain('storage_state');
    expect(ins).toContain('count(*)');
    expect(m).toMatch(/RETURNING s\.organization_id, s\.platform\n/);
  });

  it('idempotent: guarded DDL; re-run matches no row (markers excluded); postcondition', () => {
    expect(m).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(m).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
    expect(m).toContain('EXIT WHEN v_batch = 0');
    expect(m).toContain('$post$');
  });

  it('no NOTICE/LOG/WARNING/INFO output; no DELETE, functions, triggers or schedules', () => {
    expect(m).not.toMatch(/RAISE\s+(NOTICE|LOG|WARNING|INFO|DEBUG)/i);
    const exceptions = m.match(/RAISE EXCEPTION[^;]*;/g) ?? [];
    for (const e of exceptions) expect(e).not.toMatch(/storage_state|cookie/i);
    expect(m).not.toMatch(/\bDELETE\b/i);
    expect(m).not.toMatch(/CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|cron\.schedule|pg_cron/i);
    expect(m).not.toMatch(/\bCOPY\b|pg_notify|dblink/i);
  });

  it('rollback refuses unconditionally and restores nothing', () => {
    const r = code(rb);
    expect(r).toMatch(/RAISE EXCEPTION/);
    expect(r).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDROP\b|\bDELETE\b|current_setting/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('filesystem purge of legacy tmp/rpa-sessions copies', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-purge-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const seed = () => {
    fs.writeFileSync(path.join(dir, `${ORG_A}__linkedin.json`), JSON.stringify(STATE));
    fs.writeFileSync(path.join(dir, `${ORG_B}__twitter.json`), JSON.stringify(STATE));
    fs.writeFileSync(path.join(dir, 'README.txt'), 'keep me');
    fs.mkdirSync(path.join(dir, 'x__y.json'));
  };

  it('dry run by default: counts only, deletes nothing, never reads contents or logs names', async () => {
    seed();
    const readSpy = jest.spyOn(fsp, 'readFile');
    const openSpy = jest.spyOn(fsp, 'open');
    const logger = jest.fn();
    const r = await purgeLegacyRpaSessionFiles({ dir, logger });
    expect(r).toMatchObject({ dir_present: true, matched: 2, deleted: 0, skipped_non_matching: 1, skipped_not_regular_file: 1, applied: false });
    expect(fs.readdirSync(dir).sort()).toEqual(['README.txt', `${ORG_A}__linkedin.json`, `${ORG_B}__twitter.json`, 'x__y.json'].sort());
    expect(readSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(ORG_A);
    readSpy.mockRestore(); openSpy.mockRestore();
  });

  it('--apply deletes only matching regular files, without reading them', async () => {
    seed();
    const readSpy = jest.spyOn(fsp, 'readFile');
    const logger = jest.fn();
    const r = await purgeLegacyRpaSessionFiles({ dir, apply: true, logger });
    expect(r).toMatchObject({ matched: 2, deleted: 2, failed: 0, applied: true });
    expect(fs.readdirSync(dir).sort()).toEqual(['README.txt', 'x__y.json']);
    expect(readSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(new RegExp(`${SECRET}|${ORG_A}|${ORG_B}`));
    readSpy.mockRestore();
  });

  it('is bounded by maxFiles and reports truncation', async () => {
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `org${i}__linkedin.json`), '{}');
    const r = await purgeLegacyRpaSessionFiles({ dir, apply: true, maxFiles: 2, logger: jest.fn() });
    expect(r.deleted).toBe(2);
    expect(r.truncated).toBe(true);
    expect(fs.readdirSync(dir).length).toBe(3);
  });

  it('absent directory is a no-op', async () => {
    const r = await purgeLegacyRpaSessionFiles({ dir: path.join(dir, 'missing'), apply: true, logger: jest.fn() });
    expect(r).toMatchObject({ dir_present: false, matched: 0, deleted: 0 });
  });

  it('defaults to the store legacy directory (RPA_SESSION_DIR)', async () => {
    process.env.RPA_SESSION_DIR = dir;
    try {
      fs.writeFileSync(path.join(dir, `${ORG_A}__linkedin.json`), JSON.stringify(STATE));
      const r = await purgeLegacyRpaSessionFiles({ apply: true, logger: jest.fn() });
      expect(r.deleted).toBe(1);
    } finally { delete process.env.RPA_SESSION_DIR; }
  });
});
