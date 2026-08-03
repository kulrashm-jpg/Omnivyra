/**
 * INT-001 Phase 0 (P0-F) — characterization of POST /api/website-events/track
 * (the canonical visitor-event ingestion endpoint; INT-001 Phase 2 will point
 * omnivyra.com's own traffic here).
 *
 * Pins CURRENT behaviour exactly: required fields, rate limit + Retry-After,
 * website/origin gates, the 25-event batch cap, the full tracking_events insert
 * payload (ip_hash / user_agent / bot_flag / consent default / dedupe key /
 * category mapping / metadata composition), per-event failure swallowing, and
 * the 202 response shape. No production change.
 */

const trackingInserts: Array<Record<string, unknown>> = [];
let trackingInsertError: unknown = null;
let websiteRow: Record<string, unknown> | null = { id: 'w-1', company_id: 'co-1' };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: any = {
      select: jest.fn(() => chain), eq: jest.fn(() => chain), is: jest.fn(() => chain),
      single: jest.fn(async () =>
        websiteRow ? { data: websiteRow, error: null } : { data: null, error: { message: 'not found' } }),
      insert: jest.fn((p: Record<string, unknown>) => {
        if (table === 'tracking_events') trackingInserts.push(p);
        return { then: (res: any, rej?: any) => Promise.resolve({ data: null, error: trackingInsertError }).then(res, rej) };
      }),
    };
    return chain;
  },
}));

const resolveVisitorSession = jest.fn();
const persistCampaignTouchpoint = jest.fn();
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: (...a: unknown[]) => resolveVisitorSession(...a),
  persistCampaignTouchpoint: (...a: unknown[]) => persistCampaignTouchpoint(...a),
}));

const checkWebsiteOrigin = jest.fn();
jest.mock('../../services/websiteDomainEnforcementService', () => ({
  checkWebsiteOrigin: (...a: unknown[]) => checkWebsiteOrigin(...a),
  hashIp: (v: string | undefined) => (v ? `HASH(${v})` : null),
}));

const checkInMemoryRateLimit = jest.fn();
const isLikelyBot = jest.fn();
jest.mock('../../services/trackingRateLimitService', () => ({
  checkInMemoryRateLimit: (...a: unknown[]) => checkInMemoryRateLimit(...a),
  isLikelyBot: (...a: unknown[]) => isLikelyBot(...a),
}));

import handler from '../../../pages/api/website-events/track';
import { createMockRes } from '../utils/setupApiTest';

const req = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { origin: 'https://tenant.example', 'user-agent': 'UA-1', 'x-forwarded-for': '9.9.9.9', ...headers },
  socket: { remoteAddress: '9.9.9.9' },
  body, query: {}, cookies: {},
} as any);

const ENFORCEMENT = { allowed: true, mode: 'verified' };

beforeEach(() => {
  jest.clearAllMocks();
  trackingInserts.length = 0;
  trackingInsertError = null;
  websiteRow = { id: 'w-1', company_id: 'co-1' };
  checkInMemoryRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
  isLikelyBot.mockReturnValue(false);
  checkWebsiteOrigin.mockResolvedValue(ENFORCEMENT);
  resolveVisitorSession.mockResolvedValue({ sessionId: 'vs-1', firstTouch: {}, lastTouch: {} });
  persistCampaignTouchpoint.mockResolvedValue(undefined);
});

describe('P0-F — tracking endpoint characterization', () => {
  test('method surface: OPTIONS 200, GET 405', async () => {
    let res = createMockRes();
    await handler({ ...req({}), method: 'OPTIONS' }, res);
    expect(res.statusCode).toBe(200);
    res = createMockRes();
    await handler({ ...req({}), method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });

  test('required fields: missing website_id → 400; missing anonymous_id → 400', async () => {
    let res = createMockRes();
    await handler(req({ anonymous_id: 'a-1' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'website_id is required' });
    res = createMockRes();
    await handler(req({ website_id: 'w-1' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'anonymous_id is required' });
  });

  test('rate limited → 429 + Retry-After; key is websiteId:ip at 240/60s', async () => {
    checkInMemoryRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 12_400 });
    const res = createMockRes();
    await handler(req({ website_id: 'w-1', anonymous_id: 'a-1' }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Rate limit exceeded' });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '13');
    expect(checkInMemoryRateLimit).toHaveBeenCalledWith('w-1:9.9.9.9', 240, 60_000);
  });

  test('unknown website → 404; rejected origin → 403 with the enforcement message', async () => {
    websiteRow = null;
    let res = createMockRes();
    await handler(req({ website_id: 'w-x', anonymous_id: 'a-1' }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Website not found' });

    websiteRow = { id: 'w-1', company_id: 'co-1' };
    checkWebsiteOrigin.mockResolvedValue({ allowed: false, message: 'Origin mismatch' });
    res = createMockRes();
    await handler(req({ website_id: 'w-1', anonymous_id: 'a-1' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Origin mismatch' });
  });

  test('batch cap: 30 events → exactly 25 inserted/accepted; 202 {ok, accepted, events}', async () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ event_name: `e${i}` }));
    const res = createMockRes();
    await handler(req({ website_id: 'w-1', anonymous_id: 'a-1', events }), res);
    expect(res.statusCode).toBe(202);
    expect(trackingInserts).toHaveLength(25);
    expect(res.body).toMatchObject({ ok: true, accepted: 25 });
    expect((res.body as { events: string[] }).events).toHaveLength(25);
  });

  test('tracking_events payload: full column pin (defaults, ip hash, UA, bot flag, consent default, metadata composition, category mapping)', async () => {
    isLikelyBot.mockReturnValue(true);
    const res = createMockRes();
    await handler(req({
      website_id: 'w-1', anonymous_id: 'a-1', session_id: 's-1', batch_id: 'b-1',
      events: [
        { event_name: 'page_view', current_page: '/p', referrer: '/r', utm_source: 'google', properties: { foo: 'bar' } },
        { event_name: 'cta_click' },
        { event_name: 'x'.repeat(200) }, // long name → truncated to 120
      ],
    }), res);
    expect(res.statusCode).toBe(202);
    const [pv, cta, long] = trackingInserts;
    expect(pv).toMatchObject({
      company_id: 'co-1', website_id: 'w-1', visitor_session_id: 'vs-1',
      anonymous_id: 'a-1', event_name: 'page_view', event_category: 'navigation',
      page_url: '/p', referrer: '/r', consent_state: 'unknown', batch_id: 'b-1',
      user_agent: 'UA-1', ip_hash: 'HASH(9.9.9.9)', bot_flag: true,
    });
    expect(pv.metadata).toMatchObject({
      foo: 'bar', event_type: 'page_view', session_id: 's-1',
      utm_source: 'google', utm_medium: null, domain_enforcement: ENFORCEMENT,
    });
    expect(cta).toMatchObject({ event_category: 'conversion' });
    expect(long).toMatchObject({ event_category: 'engagement' });
    expect(String(long.event_name)).toHaveLength(120);
  });

  test('dedupe key: event_id wins; otherwise session:name:page:timestamp composite', async () => {
    const res = createMockRes();
    await handler(req({
      website_id: 'w-1', anonymous_id: 'a-1',
      events: [
        { event_id: 'evt-42', event_name: 'page_view' },
        { event_name: 'page_view', session_id: 's-1', current_page: '/p', properties: { timestamp: 'T1' } },
      ],
    }), res);
    expect(res.statusCode).toBe(202);
    expect(trackingInserts[0].dedupe_key).toBe('evt-42');
    expect(trackingInserts[1].dedupe_key).toBe('s-1:page_view:/p:T1');
  });

  test('per-event insert failure swallowed: still 202 with accepted 0 (no error surfaced)', async () => {
    trackingInsertError = { message: 'unique violation' };
    const res = createMockRes();
    await handler(req({ website_id: 'w-1', anonymous_id: 'a-1', events: [{ event_name: 'page_view' }] }), res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ ok: true, accepted: 0, events: [] });
  });

  test('touchpoints only when utm present: page_view → first_touch, other events → event; none without utm', async () => {
    const res = createMockRes();
    await handler(req({
      website_id: 'w-1', anonymous_id: 'a-1',
      events: [
        { event_name: 'page_view', utm_source: 'google' },
        { event_name: 'cta_click', utm_campaign: 'spring' },
        { event_name: 'scroll' }, // no utm → no touchpoint
      ],
    }), res);
    expect(res.statusCode).toBe(202);
    expect(persistCampaignTouchpoint).toHaveBeenCalledTimes(2);
    expect(persistCampaignTouchpoint.mock.calls[0][0]).toMatchObject({ touchpointType: 'first_touch' });
    expect(persistCampaignTouchpoint.mock.calls[1][0]).toMatchObject({ touchpointType: 'event' });
  });
});
