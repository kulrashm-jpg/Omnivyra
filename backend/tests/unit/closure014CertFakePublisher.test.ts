/**
 * Closure-014 (G) — the certification-only fake publishing provider, the
 * loopback egress guard and the cert publish-worker plan.
 * No network: the egress test targets TEST-NET-3 (203.0.113.0/24, RFC 5737) and
 * is refused synchronously before any socket is created.
 */
const mockGetSocialAccount = jest.fn();
const mockGetToken = jest.fn();
const mockRefresh = jest.fn();
const mockLinkedIn = jest.fn();
jest.mock('../../db/queries', () => ({
  getScheduledPost: async (id: string) => ({ id, platform: 'linkedin', content_type: 'post', content: mockContent, media_urls: [] }),
  getSocialAccount: (...a: unknown[]) => mockGetSocialAccount(...a),
}));
jest.mock('../../auth/tokenStore', () => ({ getToken: (...a: unknown[]) => mockGetToken(...a), isTokenExpiringSoon: () => false, markSocialAccountNeedsReauth: jest.fn() }));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: (...a: unknown[]) => mockRefresh(...a), refreshTwitterTokenIfNeeded: (...a: unknown[]) => mockRefresh(...a) }));
jest.mock('../../adapters/linkedinAdapter', () => ({ publishToLinkedIn: (...a: unknown[]) => mockLinkedIn(...a) }));
let mockContent = 'synthetic';

import fs from 'fs';
import path from 'path';
import net from 'net';
import {
  resolveCertFakePublisher, certFakePublisherRefusals, certFakePublisherCalls, __resetCertFakePublisherForTest, CERT_FAKE_PROD_MARKERS,
} from '../../adapters/certFakePublisher';
import { publishToPlatform } from '../../adapters/platformAdapter';
import { classifyPublishAttempt } from '../../queue/publishOutcome';
import { certPublishWorkerRefusals } from '../../cert/certPublishWorkerPlan';
import { installLoopbackEgressGuard, EgressRefusedError } from '../../cert/loopbackEgressGuard';

const CERT = {
  CERT_ENV: '1', CERT_FAKE_PUBLISHER: '1', NODE_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321', DATABASE_URL: 'postgresql://p:x@127.0.0.1:54322/postgres', REDIS_URL: 'redis://127.0.0.1:6390/3',
};
const SAVED = { ...process.env };
beforeEach(() => {
  __resetCertFakePublisherForTest();
  for (const m of [mockGetSocialAccount, mockGetToken, mockRefresh, mockLinkedIn]) m.mockReset();
  mockContent = 'synthetic';
});
afterAll(() => { process.env = SAVED; });

describe('activation', () => {
  it('inert (null) when CERT_FAKE_PUBLISHER is not set — production path unchanged', () => {
    expect(resolveCertFakePublisher({ ...CERT, CERT_FAKE_PUBLISHER: undefined })).toBeNull();
  });
  it('active in a fully loopback certification env', () => {
    expect(resolveCertFakePublisher(CERT)).not.toBeNull();
  });
  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['a Railway marker', { RAILWAY_ENVIRONMENT: 'production' }],
    ['a Vercel marker', { VERCEL: '1' }],
    ['CERT_ENV unset', { CERT_ENV: undefined }],
    ['shared queues', { OMNIVYRA_ALLOW_SHARED_QUEUES: '1' }],
    ['a non-loopback Supabase', { SUPABASE_URL: 'https://abc.supabase.co' }],
    ['the production project ref', { SUPABASE_URL: 'https://klkiseupptzbecbxwrky.supabase.co' }],
    ['a pooler override off-host', { SUPABASE_POOLER_URL: 'postgresql://u:p@db.example.com:6543/postgres' }],
    ['the production Upstash host', { REDIS_URL: 'rediss://default:x@noble-dane-77325.upstash.io:6379' }],
    ['no Redis URL', { REDIS_URL: undefined }],
  ])('flag set with %s → THROWS (fail closed), never silently falls back to real adapters', (_n, over) => {
    expect(() => resolveCertFakePublisher({ ...CERT, ...over } as Record<string, string | undefined>)).toThrow(/CERT_FAKE_PUBLISHER_REFUSED/);
  });
  it('refusal messages name variables, never values', () => {
    const r = certFakePublisherRefusals({ ...CERT, DATABASE_URL: 'postgresql://admin:TopSecret@db.example.com/x' });
    expect(r.join(' ')).not.toContain('TopSecret');
  });
  it('its production markers stay in sync with the cert env loader', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PROD_MARKERS } = require('../../../scripts/lib/certAwareEnv.cjs');
    expect([...CERT_FAKE_PROD_MARKERS].sort()).toEqual([...PROD_MARKERS].sort());
  });
});

describe('publishToPlatform with the fake active', () => {
  beforeEach(() => { Object.assign(process.env, CERT); for (const k of ['NODE_ENV']) process.env[k] = 'test'; });
  afterEach(() => { for (const k of Object.keys(CERT)) if (!(k in SAVED)) delete process.env[k]; else process.env[k] = SAVED[k]; });

  it.each([
    ['synthetic', 'published'],
    ['x [cert-fake:reject]', 'not_created'],
    ['x [cert-fake:ambiguous]', 'ambiguous'],
    ['x [cert-fake:throw]', 'ambiguous'],
    ['x [cert-fake:no-id]', 'ambiguous'],
  ])('content %j → classifier outcome %s; no social account, token, refresh or real adapter touched', async (content, expected) => {
    mockContent = content;
    const result = await publishToPlatform('post-1', 'acct-1');
    expect(classifyPublishAttempt(result)).toBe(expected);
    expect(mockGetSocialAccount).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockLinkedIn).not.toHaveBeenCalled();
    expect(certFakePublisherCalls().map((c) => c.scheduledPostId)).toEqual(['post-1']);
  });

  it('flag set in a non-loopback env → not_sent failure, still no real provider call', async () => {
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    const result = await publishToPlatform('post-2', 'acct-1');
    expect(result.success).toBe(false);
    expect(result.error?.delivery).toBe('not_sent');
    expect(mockGetSocialAccount).not.toHaveBeenCalled();
    expect(mockLinkedIn).not.toHaveBeenCalled();
  });
});

describe('cert publish-worker plan', () => {
  it('a safe plan has no refusals', () => {
    expect(certPublishWorkerRefusals(CERT, 'omnivyra:local:')).toEqual([]);
  });
  it.each([
    ['the shared bull prefix', CERT, 'bull'],
    ['DB 0', { ...CERT, REDIS_URL: 'redis://127.0.0.1:6390/0' }, 'omnivyra:local:'],
    ['no DB index', { ...CERT, REDIS_URL: 'redis://127.0.0.1:6390' }, 'omnivyra:local:'],
    ['an invalid DB index', { ...CERT, REDIS_URL: 'redis://127.0.0.1:6390/99' }, 'omnivyra:local:'],
    ['the fake disabled', { ...CERT, CERT_FAKE_PUBLISHER: undefined }, 'omnivyra:local:'],
    ['auto workers on', { ...CERT, ENABLE_AUTO_WORKERS: '1' }, 'omnivyra:local:'],
  ])('refuses %s', (_n, env, prefix) => {
    expect(certPublishWorkerRefusals(env as Record<string, string | undefined>, prefix as string).length).toBeGreaterThan(0);
  });

  it('the launcher imports ONLY the publish consumer path (no cron, all-worker bootstraps, pollers or OAuth refresh)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/cert/publish-worker-cert.ts'), 'utf8');
    const imports = [...src.matchAll(/(?:import\(|require\()'([^']+)'/g)].map((m) => m[1]);
    for (const banned of ['workers/main', 'queue/startWorkers', 'scheduler/cron', 'intelligencePollingWorker', 'oauthRefreshWorker', 'engagementPolling', 'workerTopologyManifest']) {
      expect(imports.some((i) => i.includes(banned))).toBe(false);
    }
    expect(src.match(/getWorker\(/g)).toHaveLength(1);
    expect(src).toMatch(/getWorker\('publish', processPublishJob, \{ concurrency: 1 \}\)/);
  });
});

describe('loopback egress guard', () => {
  const refused = installLoopbackEgressGuard();
  it('refuses a non-loopback TCP target synchronously (RFC 5737 TEST-NET-3; no packet leaves)', () => {
    expect(() => net.connect({ host: '203.0.113.7', port: 443 })).toThrow(EgressRefusedError);
    expect(() => net.createConnection(443, '203.0.113.8')).toThrow(EgressRefusedError);
    expect(refused().map((r) => r.host)).toEqual(expect.arrayContaining(['203.0.113.7', '203.0.113.8']));
  });
  it('allows loopback', () => {
    const s = net.connect({ host: '127.0.0.1', port: 9 });
    s.on('error', () => undefined);
    s.destroy();
  });
});
