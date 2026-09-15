/**
 * STEP 3AH-91 (W2F-2) — constant-time secret comparison gate
 * (scripts/check-constant-time-secrets.js) and the three remaining
 * timing-unsafe credential compares it found:
 *   - backend/security/SessionAuthorityService.ts   (session cookie HMAC)
 *   - backend/services/leadService.ts               (lead-webhook secret)
 *   - backend/services/plannerSecurityGovernance.ts (audit-chain HMAC)
 *
 * The conversions keep the exact-match, fail-closed semantics; only the timing
 * channel goes away. Behaviour tests therefore pass before and after; what
 * changes is (a) the gate's verdict on the repository and (b) that the
 * decision is made through constantTimeEqual (spied).
 */
import { createHmac } from 'crypto';

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-constant-time-secrets.js');

jest.mock('../../security/constantTimeEqual', () => {
  const actual = jest.requireActual('../../security/constantTimeEqual');
  return { ...actual, constantTimeEqual: jest.fn(actual.constantTimeEqual) };
});
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { constantTimeEqual } = require('../../security/constantTimeEqual') as { constantTimeEqual: jest.Mock };

function flagged(src: string): string[] {
  return gate.scanSource(src).map((v: { left: string; op: string; right: string }) => `${v.left} ${v.op} ${v.right}`);
}

describe('W2F-2 gate — timing-unsafe shapes are flagged', () => {
  it('header compared with a secret env var', () => {
    expect(flagged(`if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(401).end();`))
      .toEqual([`req.headers['x-cron-secret'] !== process.env.CRON_SECRET`]);
  });

  it('loose equality short-circuits too (== / !=)', () => {
    expect(flagged(`if (req.query.key != process.env.ADMIN_API_KEY) deny();`)).toEqual([`req.query.key != process.env.ADMIN_API_KEY`]);
    expect(flagged(`if (process.env.CRON_SECRET == hdr) ok();`)).toHaveLength(1);
    expect(flagged(`if (process.env.CRON_SECRET != null) ok();`)).toEqual([]);
  });

  it('bracket env access and config.X_TOKEN', () => {
    expect(flagged(`if (token === process.env['WORKER_TOKEN']) ok();`)).toHaveLength(1);
    expect(flagged(`if (hdr !== config.INTERNAL_API_KEY) deny();`)).toHaveLength(1);
  });

  it('a variable assigned from a secret env var (and a template built from it)', () => {
    const src = `
      const cronSecret = process.env.CRON_SECRET ?? '';
      const bearer = \`Bearer \${cronSecret}\`;
      if (req.headers.authorization !== bearer) deny();
      if (req.headers.authorization !== \`Bearer \${cronSecret}\`) deny();
      if (provided === cronSecret) allow();`;
    expect(flagged(src)).toHaveLength(3);
  });

  it('destructured from process.env', () => {
    expect(flagged(`const { WEBHOOK_SECRET } = process.env;\nif (sig !== WEBHOOK_SECRET) deny();`)).toHaveLength(1);
  });

  it('an HMAC-derived expected value (createHmac / sign…() / …Hmac())', () => {
    expect(flagged(`const expected = createHmac('sha256', k).update(body).digest('hex');\nif (sig !== expected) deny();`)).toHaveLength(1);
    expect(flagged(`const expected = signSessionPayload(id, at);\nif (parsed.signature !== expected) deny();`)).toHaveLength(1);
    expect(flagged(`if (given !== computeHmac(body)) deny();`)).toHaveLength(1);
  });

  it('secret-named operands (cfg.secret, f.hmac, webhookSecret)', () => {
    expect(flagged(`if (!cfg?.secret || cfg.secret !== webhookSecret) return null;`)).toEqual(['cfg.secret !== webhookSecret']);
    expect(flagged(`if (f.hmac !== other) bad();`)).toHaveLength(1);
  });

  it('the three pre-W2F-2 source shapes (verbatim) are flagged', () => {
    expect(flagged(`const expected = signSessionPayload(parsed.sessionId, (data as AuthSessionRow).created_at);
  if (parsed.signature !== expected || (data as AuthSessionRow).cookie_signature !== expected) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }`)).toHaveLength(2);
    expect(flagged(`  if (!cfg?.secret || cfg.secret !== webhookSecret) return null;`)).toHaveLength(1);
    expect(flagged(`    const expected = createHmac('sha256', key).update((f.prev_hmac ?? '') + payload).digest('hex');
    if (x) {} else if (f.hmac !== expected) {
      invalid.push({ reason: 'hmac_mismatch' });
    }`)).toHaveLength(1);
  });
});

describe('W2F-2 gate — shapes that must stay green', () => {
  it('comparisons with literals, typeof and lengths', () => {
    const src = `
      const s = process.env.CRON_SECRET;
      if (s === undefined || s === '' || s === null) deny();
      if (typeof s === 'string' && s.length === 32) ok();
      if (process.env.WEBHOOK_SECRET !== 'placeholder') ok();
      if (a.length !== s.length) deny();`;
    expect(flagged(src)).toEqual([]);
  });

  it('the constant-time helpers themselves', () => {
    const src = `
      const s = process.env.CRON_SECRET;
      if (!constantTimeEqual(req.headers['x-cron-secret'], s)) deny();
      if (!bearerTokenMatches(req.headers.authorization, s)) deny();`;
    expect(flagged(src)).toEqual([]);
  });

  it('public / non-credential env names (NEXT_PUBLIC_*, *_URL, MAX_TOKENS, *_INDEX)', () => {
    const src = `
      if (key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) a();
      if (url === process.env.TOKEN_ENDPOINT_URL) b();
      if (n === process.env.MAX_TOKENS) c();
      if (idx === process.env.SALT_INDEX) d();`;
    expect(flagged(src)).toEqual([]);
  });

  it('taint is lexically scoped (a secret "key" in one function does not taint "key" in another)', () => {
    const src = `
      function a() { const key = process.env.PEXELS_API_KEY; return fetchIt(key); }
      function b(q) { for (const key of Object.keys(MAP)) { if (q === key) return MAP[key]; } }`;
    expect(flagged(src)).toEqual([]);
    const same = `function a(q) { const key = process.env.PEXELS_API_KEY; if (q === key) return 1; }`;
    expect(flagged(same)).toHaveLength(1);
  });

  it('operators and names inside comments and strings never count', () => {
    const src = `
      // if (hdr !== process.env.CRON_SECRET) — old shape
      const msg = 'hdr !== process.env.CRON_SECRET';`;
    expect(flagged(src)).toEqual([]);
  });

  it('a reviewed `// ct-ok: <reason>` suppresses the line (reason required)', () => {
    expect(flagged(`// ct-ok: chain link between two stored values, not a credential\nif (prev !== prevHmac) bad();`)).toEqual([]);
    expect(flagged(`if (prev !== prevHmac) bad(); // ct-ok: stored-value chain link`)).toEqual([]);
    expect(flagged(`if (prev !== prevHmac) bad(); // ct-ok:`)).toHaveLength(1);
  });
});

describe('W2F-2 gate — the repository', () => {
  const repo = gate.scanRepo();

  it('scans pages/api/** and backend/** (non-trivial scope)', () => {
    expect(repo.scanned).toBeGreaterThan(3000);
  });

  it('PASSES: no un-tracked timing-unsafe secret comparison remains', () => {
    expect(repo.violations).toEqual([]);
  });

  it('known-open entries are real, still reproduce, and name an owner', () => {
    expect(repo.staleKnown).toEqual([]);
    expect(repo.known.map((k: { file: string }) => k.file).sort()).toEqual(gate.KNOWN_OPEN.map((k: { file: string }) => k.file).sort());
    for (const k of gate.KNOWN_OPEN) expect(k.owner).toMatch(/^SEC-[A-F]$/);
  });

  it('the three converted sites are no longer flagged and import the helper', () => {
    const fs = require('fs');
    const path = require('path');
    for (const rel of ['backend/security/SessionAuthorityService.ts', 'backend/services/leadService.ts', 'backend/services/plannerSecurityGovernance.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');
      expect(gate.scanSource(src)).toEqual([]);
      expect(src).toMatch(/import \{ constantTimeEqual \} from '(?:\.\.\/security|\.)\/constantTimeEqual';/);
    }
  });
});

// ── behaviour: the three converted sites keep exact-match, fail-closed semantics ──

const COOKIE_SECRET = 'test-only-session-cookie-secret-placeholder-000000';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const CREATED_AT = '2026-05-11T03:07:26.191Z';

let sessionRow: Record<string, unknown> | null = null;
let integrationRow: Record<string, unknown> | null = null;
let mergedConfig: Record<string, string> | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const row = () => (table === 'auth_sessions' ? sessionRow : integrationRow);
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: row(), error: null });
    chain.single = async () => ({ data: row(), error: row() ? null : { message: 'not found' } });
    return chain;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/integrationCredentialService', () => ({ mergeConnectionConfig: async () => mergedConfig }));
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: jest.fn() }));
jest.mock('../../services/leadIntelligence/leadIntelligenceRuntime', () => ({ adoptLead: jest.fn() }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../services/leadIntelligence/legacyLeadCompat', () => ({ getLegacyLeads: jest.fn() }));

function sign(id: string, at: string): string {
  return createHmac('sha256', COOKIE_SECRET).update(`${id}|${new Date(Date.parse(at)).toISOString()}`).digest('base64url');
}

describe('SessionAuthorityService.resolveSessionFromRequest — cookie HMAC via constantTimeEqual', () => {
  const OLD = process.env.SESSION_COOKIE_SECRET;
  beforeAll(() => { process.env.SESSION_COOKIE_SECRET = COOKIE_SECRET; });
  afterAll(() => { if (OLD === undefined) delete process.env.SESSION_COOKIE_SECRET; else process.env.SESSION_COOKIE_SECRET = OLD; });
  beforeEach(() => { constantTimeEqual.mockClear(); });

  const { resolveSessionFromRequest } = require('../../security/SessionAuthorityService');
  const good = sign(SESSION_ID, CREATED_AT);
  const req = (cookieSig: string) => ({ headers: { cookie: `omnivyra_session=${encodeURIComponent(`${SESSION_ID}.${cookieSig}`)}` } });
  const row = (over: Record<string, unknown> = {}) => ({
    id: SESSION_ID, user_id: 'u1', supabase_uid: 'u1', cookie_signature: good, created_at: CREATED_AT,
    last_seen_at: CREATED_AT, expires_at: new Date(Date.now() + 3600_000).toISOString(), revoked_at: null, ...over,
  });

  it('accepts the exact signature (decision made in constant time)', async () => {
    sessionRow = row();
    await expect(resolveSessionFromRequest(req(good))).resolves.toMatchObject({ ok: true });
    expect(constantTimeEqual).toHaveBeenCalledWith(good, good);
  });

  it('rejects a tampered cookie signature', async () => {
    sessionRow = row();
    const bad = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
    await expect(resolveSessionFromRequest(req(bad))).resolves.toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(constantTimeEqual).toHaveBeenCalled();
  });

  it('rejects when the stored cookie_signature differs or is missing (fails closed)', async () => {
    sessionRow = row({ cookie_signature: 'x' + good.slice(1) });
    await expect(resolveSessionFromRequest(req(good))).resolves.toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    sessionRow = row({ cookie_signature: null });
    await expect(resolveSessionFromRequest(req(good))).resolves.toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
});

describe('leadService.validateWebhookAuth — webhook secret via constantTimeEqual', () => {
  const { validateWebhookAuth } = require('../../services/leadService');
  const WEBHOOK = 'lead-webhook-test-placeholder-value';
  beforeEach(() => {
    constantTimeEqual.mockClear();
    integrationRow = { id: 'int-1', company_id: 'co-1', website_id: null, website_connection_id: null, config: {}, non_secret_config: {}, type: 'lead_webhook' };
    mergedConfig = { secret: WEBHOOK };
  });

  it('accepts the exact secret (decision made in constant time)', async () => {
    await expect(validateWebhookAuth('int-1', WEBHOOK)).resolves.toEqual({ company_id: 'co-1', website_id: null, integration_id: 'int-1' });
    expect(constantTimeEqual).toHaveBeenCalledWith(WEBHOOK, WEBHOOK);
  });

  it('rejects a wrong, prefixed, padded or empty secret', async () => {
    for (const presented of [WEBHOOK + 'x', WEBHOOK.slice(0, -1), ` ${WEBHOOK}`, '']) {
      await expect(validateWebhookAuth('int-1', presented)).resolves.toBeNull();
    }
  });

  it('fails closed when the integration has no secret configured', async () => {
    mergedConfig = { secret: '' };
    await expect(validateWebhookAuth('int-1', '')).resolves.toBeNull();
    mergedConfig = {};
    await expect(validateWebhookAuth('int-1', 'anything')).resolves.toBeNull();
  });
});

describe('plannerSecurityGovernance.verifyOperatorAuditChain — entry HMAC via constantTimeEqual', () => {
  const KEY = 'planner-audit-hmac-test-placeholder';
  let entries: Array<[string, string[]]> = [];
  const fakeClient = { xrange: async () => entries };
  jest.doMock('../../queue/standaloneRedisClient', () => ({ getInstrumentedStandaloneRedisClient: () => fakeClient }));
  const OLD = process.env.PLANNER_AUDIT_HMAC_KEY;
  beforeAll(() => { process.env.PLANNER_AUDIT_HMAC_KEY = KEY; });
  afterAll(() => { if (OLD === undefined) delete process.env.PLANNER_AUDIT_HMAC_KEY; else process.env.PLANNER_AUDIT_HMAC_KEY = OLD; });
  beforeEach(() => { constantTimeEqual.mockClear(); });

  function chain(n: number): Array<[string, string[]]> {
    const out: Array<[string, string[]]> = [];
    let prev = '';
    for (let i = 0; i < n; i++) {
      const payload = JSON.stringify({ ts: 1000 + i, operator_id: 'op', action: `a${i}`, details: {}, request_id: undefined });
      const hmac = createHmac('sha256', KEY).update(prev + payload).digest('hex');
      out.push([`${i}-0`, ['ts', String(1000 + i), 'operator_id', 'op', 'action', `a${i}`, 'details', '{}', 'request_id', '', 'prev_hmac', prev, 'hmac', hmac]]);
      prev = hmac;
    }
    return out;
  }
  const { verifyOperatorAuditChain } = require('../../services/plannerSecurityGovernance');

  it('verifies an intact chain (each entry HMAC checked in constant time)', async () => {
    entries = chain(3);
    await expect(verifyOperatorAuditChain()).resolves.toMatchObject({ total: 3, verified: 3, invalid: [], chained: true });
    expect(constantTimeEqual).toHaveBeenCalledTimes(3);
  });

  it('flags a tampered entry HMAC and a broken chain link', async () => {
    entries = chain(3);
    const f = entries[1][1];
    f[f.length - 1] = f[f.length - 1].replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    const r = await verifyOperatorAuditChain();
    expect(r.invalid.map((x: { reason: string }) => x.reason)).toEqual(['hmac_mismatch', 'chain_break_prev_hmac_mismatch']);
  });

  it('a missing entry HMAC never verifies (fails closed)', async () => {
    entries = chain(1);
    entries[0][1] = entries[0][1].slice(0, -2);
    const r = await verifyOperatorAuditChain();
    expect(r.verified).toBe(0);
    expect(r.invalid[0].reason).toBe('hmac_mismatch');
  });
});
