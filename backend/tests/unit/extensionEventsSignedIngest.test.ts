/**
 * /api/extension/events — bearer token alone no longer ingests.
 *
 * Extension 1.4.0 hands its session token to scripts on platform pages, and
 * this route accepted the token (or a Supabase user JWT) without a request
 * signature, so anyone holding the token could inject inbox events for up to
 * 12 h. The HMAC secret is derived server-side and never reaches a page.
 *
 * These tests run the REAL auth middleware and session service (only the DB,
 * the ingest service and the route factory are mocked) and sign requests the
 * way the extension's shared/requestSigner.js does, so they also prove that
 * genuine 1.4.0 traffic is still accepted.
 */

process.env.EXTENSION_SESSION_SECRET = 'test-extension-session-secret-not-production';
delete process.env.DEV_EXTENSION_AUTH_BYPASS;

const ingested: Record<string, unknown>[] = [];
jest.mock('../../services/extensionEventIngestionService', () => ({
  ingestExtensionEvent: async (input: Record<string, unknown>) => { ingested.push(input); return { id: 'evt-1' }; },
}));
const roles: Array<{ user_id: string; company_id: string; status: string }> = [];
function rolesBuilder() {
  const preds: Array<(r: Record<string, unknown>) => boolean> = [];
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return api; },
    maybeSingle() {
      const row = roles.find((r) => preds.every((p) => p(r as unknown as Record<string, unknown>)));
      return Promise.resolve({ data: row ? { company_id: row.company_id } : null, error: null });
    },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => rolesBuilder() } }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: () => rolesBuilder() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// R-3 suspends ingestion on these routes; this suite proves the signature
// layer underneath, which still guards them if ingestion is ever re-enabled.
jest.mock('../../services/extensionIngestionSuspension', () => ({
  ...jest.requireActual('../../services/extensionIngestionSuspension'),
  EXTENSION_BROWSER_INGESTION_SUSPENDED: false,
}));

import { createHash, createHmac, randomBytes } from 'crypto';
import handler from '../../../pages/api/extension/events';
import {
  issueExtensionSessionToken,
  deriveExtensionHmacSecret,
} from '../../services/extensionSessionService';

const ORG = 'org-ext-1';
const OTHER_ORG = 'org-ext-2';
const USER = 'user-ext-1';
const SESSION = { userId: USER, orgId: ORG, expiresAt: Date.now() + 3600_000, hmacNonce: 'session-nonce-1' };
const TOKEN = issueExtensionSessionToken(SESSION);
const SECRET = deriveExtensionHmacSecret({ ...SESSION, nonce: SESSION.hmacNonce });

/** shared/requestSigner.js buildSignedHeaders, reproduced. */
function sign(method: string, path: string, body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const nonce = randomBytes(16).toString('hex');
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
  return {
    'x-omnivyra-timestamp': String(ts),
    'x-omnivyra-nonce': nonce,
    'x-omnivyra-signature': createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

/** Event exactly as 1.4.0's apiClient.sendSyncEvents + worker org injection build it. */
const event = (over: Record<string, unknown> = {}) => ({
  platform: 'linkedin',
  event_type: 'comment',
  platform_message_id: 'urn:li:comment:1',
  data: { content: 'hello', author_name: 'A' },
  organization_id: ORG,
  ...over,
});

async function post(body: Record<string, unknown>, headers: Record<string, string>) {
  const res = mockRes();
  await (handler as any)({ method: 'POST', url: '/api/extension/events', body, headers, query: {} }, res);
  return res;
}

beforeEach(() => {
  ingested.length = 0;
  roles.length = 0;
  roles.push({ user_id: USER, company_id: ORG, status: 'active' });
});

describe('/api/extension/events requires a signed extension request', () => {
  it('ingests a request signed the way the published extension signs it', async () => {
    const body = event();
    const res = await post(body, { authorization: `Bearer ${TOKEN}`, ...sign('POST', '/api/extension/events', JSON.stringify(body)) });
    expect(res.statusCode).toBe(200);
    expect(ingested).toHaveLength(1);
    expect(ingested[0].organization_id).toBe(ORG);
  });

  it('refuses the bearer token alone (the 1.4.0 page-leak replay)', async () => {
    const res = await post(event(), { authorization: `Bearer ${TOKEN}` });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'SIGNATURE_INVALID', reason: 'MISSING_SIGNATURE_HEADER' });
    expect(ingested).toHaveLength(0);
  });

  it('refuses a signature made with anything other than the derived secret', async () => {
    const body = event();
    const forged = sign('POST', '/api/extension/events', JSON.stringify(body), TOKEN);
    const res = await post(body, { authorization: `Bearer ${TOKEN}`, ...forged });
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('SIGNATURE_MISMATCH');
    expect(ingested).toHaveLength(0);
  });

  it('refuses a replayed nonce', async () => {
    const body = event();
    const headers = { authorization: `Bearer ${TOKEN}`, ...sign('POST', '/api/extension/events', JSON.stringify(body)) };
    expect((await post(body, headers)).statusCode).toBe(200);
    const again = await post(body, headers);
    expect(again.statusCode).toBe(401);
    expect(again.body.reason).toBe('NONCE_REPLAYED');
    expect(ingested).toHaveLength(1);
  });

  it('refuses a body altered after signing', async () => {
    const signedBody = event();
    const headers = { authorization: `Bearer ${TOKEN}`, ...sign('POST', '/api/extension/events', JSON.stringify(signedBody)) };
    const res = await post(event({ data: { content: 'injected' } }), headers);
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('SIGNATURE_MISMATCH');
    expect(ingested).toHaveLength(0);
  });

  it('refuses a stale timestamp', async () => {
    const body = event();
    const res = await post(body, {
      authorization: `Bearer ${TOKEN}`,
      ...sign('POST', '/api/extension/events', JSON.stringify(body), SECRET, Math.floor(Date.now() / 1000) - 600),
    });
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('TIMESTAMP_OUT_OF_WINDOW');
  });

  it('no longer accepts a Supabase user JWT in place of an extension session', async () => {
    const body = event();
    // An obviously fake, JWT-shaped user token (three dot-separated parts):
    // it is not an extension session, so the route must refuse it.
    const fakeUserJwt = ['placeholder-header', 'placeholder-payload', 'placeholder-signature'].join('.');
    const res = await post(body, { authorization: `Bearer ${fakeUserJwt}`, ...sign('POST', '/api/extension/events', JSON.stringify(body)) });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('INVALID_SESSION');
    expect(ingested).toHaveLength(0);
  });

  it('keeps the organisation and membership checks', async () => {
    const other = event({ organization_id: OTHER_ORG });
    const r1 = await post(other, { authorization: `Bearer ${TOKEN}`, ...sign('POST', '/api/extension/events', JSON.stringify(other)) });
    expect(r1.statusCode).toBe(403);

    roles.length = 0;
    const body = event();
    const r2 = await post(body, { authorization: `Bearer ${TOKEN}`, ...sign('POST', '/api/extension/events', JSON.stringify(body)) });
    expect(r2.statusCode).toBe(403);
    expect(ingested).toHaveLength(0);
  });
});
