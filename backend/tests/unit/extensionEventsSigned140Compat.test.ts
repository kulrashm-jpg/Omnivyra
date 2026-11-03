/**
 * R-1 proof 3: the published extension 1.4.0, UNMODIFIED, still delivers
 * events to the signed /api/extension/events route.
 *
 * Why this is not a contradiction: 1.4.0's service worker signs EVERY
 * /api/extension/* request except bootstrap/redeem (serviceWorker.js
 * requiresSignature), and content scripts can only reach the backend through
 * that worker. The route's old bearer-only acceptance helped nobody who held
 * the secret; it helped only holders of a bare token (page scripts that
 * received it from 1.4.0, or GET /api/extension/session tokens).
 *
 * End to end, no network: the real 1.4.0 extension code (service worker in a
 * vm, LinkedIn content scripts in jsdom, via the extension repo's test
 * harness) pairs through the real claim-code path, then its content script's
 * apiClient.sendSyncEvents() goes through the worker's signer and lands on
 * the REAL validate and events handlers of this branch.
 *
 * Needs the 1.4.0 source and the harness (extension repo). Skipped, and
 * reported as skipped, when they are not present:
 *   OMNIVYRA_EXTENSION_BASELINE_ROOT = an export of tag baseline-1.4.0
 *   OMNIVYRA_EXTENSION_HARNESS       = <extension repo>/tests/harness.js
 */

process.env.EXTENSION_SESSION_SECRET = 'test-extension-session-secret-not-production';
delete process.env.DEV_EXTENSION_AUTH_BYPASS;

import fs from 'fs';

const BASELINE = process.env.OMNIVYRA_EXTENSION_BASELINE_ROOT || '';
const HARNESS = process.env.OMNIVYRA_EXTENSION_HARNESS || '';
const available = Boolean(BASELINE && HARNESS && fs.existsSync(`${BASELINE}/manifest.json`) && fs.existsSync(HARNESS));

const ORG = 'org-compat-1';
const USER = 'user-compat-1';
const ingested: Record<string, unknown>[] = [];
jest.mock('../../services/extensionEventIngestionService', () => ({
  ingestExtensionEvent: async (input: Record<string, unknown>) => { ingested.push(input); return { id: `evt-${ingested.length}` }; },
}));
function rolesBuilder() {
  const preds: Array<[string, unknown]> = [];
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { preds.push([c, v]); return api; },
    maybeSingle() {
      const ok = preds.some(([c, v]) => c === 'user_id' && v === USER) && preds.some(([c, v]) => c === 'company_id' && v === ORG);
      return Promise.resolve({ data: ok ? { company_id: ORG, role: 'COMPANY_ADMIN' } : null, error: null });
    },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => rolesBuilder() } }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: () => rolesBuilder() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import eventsHandler from '../../../pages/api/extension/events';
import validateHandler from '../../../pages/api/extension/validate';
import {
  issueExtensionSessionToken,
  deriveExtensionHmacSecret,
} from '../../services/extensionSessionService';

const maybe = available ? describe : describe.skip;

async function callHandler(handler: any, rec: { method: string; path: string; headers: Record<string, string>; body: string; url: string }) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  const query = Object.fromEntries(new URL(rec.url).searchParams.entries());
  await handler({ method: rec.method, url: new URL(rec.url).pathname + new URL(rec.url).search, headers: rec.headers, body: rec.body ? JSON.parse(rec.body) : undefined, query }, res);
  return { status: res.statusCode, body: res.body };
}

maybe('published extension 1.4.0 → signed /api/extension/events (end to end)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let h: any;
  const seen: Array<{ path: string; status: number; signed: boolean }> = [];

  beforeAll(() => {
    process.env.OMVX_EXT_ROOT = BASELINE;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    h = require(HARNESS);
  });

  function routes() {
    const expiresAt = Date.now() + 3600_000;
    const session = { userId: USER, orgId: ORG, expiresAt, hmacNonce: 'compat-nonce-1' };
    const forward = (handler: any) => async (rec: any) => {
      const out = await callHandler(handler, rec);
      seen.push({ path: rec.path, status: out.status, signed: Boolean(rec.headers['x-omnivyra-signature']) });
      return { status: out.status, body: out.body };
    };
    return {
      'POST /api/extension/redeem': () => ({ body: { success: true, data: {
        session_token: issueExtensionSessionToken(session),
        hmac_secret: deriveExtensionHmacSecret({ ...session, nonce: session.hmacNonce }),
        user_id: USER, org_id: ORG, user: { id: USER },
        api_base_url: 'https://www.omnivyra.com', expires_at: expiresAt,
      } } }),
      'POST /api/extension/validate': forward(validateHandler),
      'POST /api/extension/events': forward(eventsHandler),
      'GET /api/extension/commands': () => ({ body: { commands: [] } }),
    };
  }

  it('is really the published 1.4.0 source', () => {
    const manifest = JSON.parse(fs.readFileSync(`${BASELINE}/manifest.json`, 'utf8'));
    expect(manifest.version).toBe('1.4.0');
    expect(fs.existsSync(`${BASELINE}/core/syncEngine.js`)).toBe(true);
  });

  it('pairs through the real validate route and delivers a signed event the route accepts', async () => {
    const ext = h.createExtension({ routes: routes() });
    try {
      ext.startServiceWorker();
      const { result } = await h.pairViaClaimCode(ext);
      expect(result.success).toBe(true);
      expect(seen.find((s) => s.path === '/api/extension/validate')).toMatchObject({ status: 200, signed: true });

      const li = ext.openTab('https://www.linkedin.com/feed/');
      await h.sleep(200);
      const event = {
        platform: 'linkedin', event_type: 'comment', platform_message_id: 'urn:li:comment:(urn:li:activity:1,2)',
        data: { content: 'Synthetic comment', author_name: 'Synthetic Author', thread_id: 'urn:li:activity:1', created_at: new Date().toISOString() },
      };
      const sent = await li.window.apiClient.sendSyncEvents([event]);

      const call = seen.find((s) => s.path === '/api/extension/events');
      expect(call).toBeDefined();
      expect(call).toMatchObject({ status: 200, signed: true });
      expect(sent.success).toBe(true);
      expect(ingested).toHaveLength(1);
      expect(ingested[0]).toMatchObject({ platform: 'linkedin', platform_message_id: event.platform_message_id, organization_id: ORG });
    } finally {
      await ext.close();
    }
  }, 30000);

  it('the same 1.4.0 request replayed (same nonce) is rejected', async () => {
    const ext = h.createExtension({ routes: routes() });
    try {
      ext.startServiceWorker();
      await h.pairViaClaimCode(ext);
      const li = ext.openTab('https://www.linkedin.com/feed/');
      await h.sleep(200);
      await li.window.apiClient.sendSyncEvents([{ platform: 'linkedin', event_type: 'comment', platform_message_id: 'urn:li:comment:replay', data: { content: 'x' } }]);
      const original = ext.calls.fetch.filter((f: any) => f.path === '/api/extension/events').at(-1);
      expect(original).toBeDefined();
      const replay = await callHandler(eventsHandler, original);
      expect(replay.status).toBe(401);
      expect(replay.body).toMatchObject({ error: 'SIGNATURE_INVALID', reason: 'NONCE_REPLAYED' });
    } finally {
      await ext.close();
    }
  }, 30000);
});

if (!available) {
  // Make the skip visible in the run output rather than silently passing.
  // eslint-disable-next-line no-console
  console.warn('[extensionEventsSigned140Compat] SKIPPED: set OMNIVYRA_EXTENSION_BASELINE_ROOT and OMNIVYRA_EXTENSION_HARNESS');
}
