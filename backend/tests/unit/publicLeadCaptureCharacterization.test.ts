/**
 * INT-001 Phase 0 (P0-E) — characterization of POST /api/website/lead-capture
 * as an HTTP contract, with the REAL captureWebsiteLead underneath (only the
 * guard, tenant resolution and the write layer are mocked).
 *
 * Pins CURRENT behaviour exactly: 405, protection-blocked 429/403/409 (+ the
 * 429 default and Retry-After arithmetic), honeypot ordering, malformed-body
 * handling, duplicate (200) vs created (201) shapes, unknown-field tolerance,
 * and the ATTRIBUTION_FIELDS allow-list filtering into web_attribution.
 * The existing Phase-13 endpoint suite remains untouched. No production change.
 */

const evaluateCaptureProtection = jest.fn();
jest.mock('../../services/leadCaptureProtection', () => ({
  evaluateCaptureProtection: (...a: unknown[]) => evaluateCaptureProtection(...a),
}));

const resolveTenantForWebsite = jest.fn();
jest.mock('../../services/tenantResolutionService', () => ({
  resolveTenantForWebsite: (...a: unknown[]) => resolveTenantForWebsite(...a),
}));

// Write layer under the REAL leadCaptureService:
let recentLeads: Array<Record<string, unknown>> = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (_table: string) => {
    const chain: any = {
      select: jest.fn(() => chain), eq: jest.fn(() => chain), gte: jest.fn(() => chain),
      order: jest.fn(() => chain), limit: jest.fn(() => chain),
      then: (res: any, rej?: any) => Promise.resolve({ data: recentLeads, error: null }).then(res, rej),
    };
    return chain;
  },
}));
const createLead = jest.fn();
jest.mock('../../services/leadService', () => ({ createLead: (...a: unknown[]) => createLead(...a) }));
const recordLeadAttribution = jest.fn();
jest.mock('../../services/leadAttributionService', () => ({
  ...jest.requireActual('../../services/leadAttributionService'),
  recordLeadAttribution: (...a: unknown[]) => recordLeadAttribution(...a),
}));
const resolveVisitorSession = jest.fn();
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: (...a: unknown[]) => resolveVisitorSession(...a),
  stitchSessionToLead: jest.fn().mockResolvedValue(undefined),
  persistCampaignTouchpoint: jest.fn().mockResolvedValue(undefined),
}));

import handler from '../../../pages/api/website/lead-capture';
import { LEAD_CAPTURE_INTENTS } from '../../../lib/website/leadCaptureConfig';
import { createMockRes } from '../utils/setupApiTest';

const req = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST', headers: { origin: 'https://www.omnivyra.com', ...headers }, body, query: {}, cookies: {},
} as any);

const VALID_BODY = {
  intent: 'contact_sales', firstName: 'Jane', lastName: 'Doe',
  email: 'jane@acme.com', consent: true,
  // allow-listed attribution fields:
  utm_source: 'google', utm_campaign: 'spring', referrer: 'https://g.com',
  landing_page: '/l', current_page: '/contact-sales', session_id: 's-1',
  anonymous_id: 'a-1', cta_id: 'hero', website_id: 'w-1',
  // NOT in ATTRIBUTION_FIELDS — must be dropped from web_attribution:
  utm_bogus: 'x', fbclid: 'fb-1', random_extra: 'y',
};

beforeEach(() => {
  jest.clearAllMocks();
  recentLeads = [];
  evaluateCaptureProtection.mockResolvedValue({ allowed: true });
  resolveTenantForWebsite.mockResolvedValue({ tenantId: 'co-1' });
  resolveVisitorSession.mockResolvedValue({ sessionId: 'vs-1', firstTouch: {}, lastTouch: {} });
  createLead.mockResolvedValue({ id: 'L-new', source: 'website', unified_person_id: 'up-1' });
});

describe('P0-E — public lead-capture HTTP matrix', () => {
  test('GET → 405 with Allow header', async () => {
    const res = createMockRes();
    await handler({ ...req({}), method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  test('honeypot ordering: neither guard nor tenant resolution runs; success-shaped 200 with null leadId', async () => {
    const res = createMockRes();
    await handler(req({ intent: 'bogus_intent', company_website: 'http://spam' }), res);
    expect(res.statusCode).toBe(200);
    // invalid intent falls back to the contact_sales confirmation config
    expect(res.body).toEqual({
      status: 'created', leadId: null,
      intent: 'contact_sales', confirmation: LEAD_CAPTURE_INTENTS.contact_sales.confirmation,
    });
    expect(evaluateCaptureProtection).not.toHaveBeenCalled();
    expect(resolveTenantForWebsite).not.toHaveBeenCalled();
  });

  test('guard 429: rate_limited body + Retry-After seconds (ceil of retryAfterMs)', async () => {
    evaluateCaptureProtection.mockResolvedValue({ allowed: false, reason: 'rate_limited', httpStatus: 429, retryAfterMs: 30_500 });
    const res = createMockRes();
    await handler(req(VALID_BODY), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '31');
    expect(resolveTenantForWebsite).not.toHaveBeenCalled(); // blocked before tenant resolution
  });

  test('guard 403 (bot) and 409 (replay) pass their status + reason through; no Retry-After without retryAfterMs', async () => {
    for (const [reason, status] of [['bot_detected', 403], ['replay_detected', 409]] as const) {
      jest.clearAllMocks();
      evaluateCaptureProtection.mockResolvedValue({ allowed: false, reason, httpStatus: status });
      const res = createMockRes();
      await handler(req(VALID_BODY), res);
      expect(res.statusCode).toBe(status);
      expect(res.body).toEqual({ error: reason });
      expect(res.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    }
  });

  test('guard blocked with NO httpStatus/reason → 429 default with error "blocked"', async () => {
    evaluateCaptureProtection.mockResolvedValue({ allowed: false });
    const res = createMockRes();
    await handler(req(VALID_BODY), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'blocked' });
  });

  test('malformed (non-object) body: treated as {}; guard + tenant still run; real validation rejects with INVALID_INTENT 400', async () => {
    const res = createMockRes();
    await handler(req('not-json-at-all'), res);
    expect(evaluateCaptureProtection).toHaveBeenCalledTimes(1);
    expect(resolveTenantForWebsite).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_INTENT', fields: undefined });
  });

  test('unrecognized website → 404 (guard passed, tenant null)', async () => {
    resolveTenantForWebsite.mockResolvedValue(null);
    const res = createMockRes();
    await handler(req(VALID_BODY), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unrecognized_website' });
  });

  test('created → 201 {status,leadId,intent,confirmation}; unknown fields tolerated; web_attribution keeps ONLY allow-listed fields', async () => {
    const res = createMockRes();
    await handler(req(VALID_BODY), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      status: 'created', leadId: 'L-new', intent: 'contact_sales',
      confirmation: LEAD_CAPTURE_INTENTS.contact_sales.confirmation,
    });
    const [, input] = createLead.mock.calls[0] as [string, Record<string, any>];
    // allow-list filtering (ATTRIBUTION_FIELDS) — listed fields preserved verbatim…
    expect(input.metadata.web_attribution).toEqual({
      utm_source: 'google', utm_campaign: 'spring', referrer: 'https://g.com',
      landing_page: '/l', current_page: '/contact-sales', session_id: 's-1',
      anonymous_id: 'a-1', cta_id: 'hero', website_id: 'w-1',
    });
    // …and non-listed extras are dropped (tolerated on input, never persisted here)
    expect(input.metadata.web_attribution.utm_bogus).toBeUndefined();
    expect(input.metadata.web_attribution.fbclid).toBeUndefined();
    expect(input.metadata.web_attribution.random_extra).toBeUndefined();
  });

  test('duplicate: a recent same-email lead → 200 {status:duplicate, leadId:existing} with NO second write', async () => {
    recentLeads = [{ id: 'L-old', created_at: new Date().toISOString() }];
    const res = createMockRes();
    await handler(req(VALID_BODY), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      status: 'duplicate', leadId: 'L-old', intent: 'contact_sales',
      confirmation: LEAD_CAPTURE_INTENTS.contact_sales.confirmation,
    });
    expect(createLead).not.toHaveBeenCalled();
    expect(recordLeadAttribution).not.toHaveBeenCalled();
  });
});
