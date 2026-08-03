/**
 * INT-001 Phase 0 (P0-D) — characterization of POST /api/leads (all three modes)
 * plus its CORS/OPTIONS surface.
 *
 * Pins CURRENT contracts exactly: webhook auth, embed origin/field validation and
 * dynamic email-field resolution, manual-mode auth + null-session attribution,
 * response shapes, unknown-field tolerance, and error propagation. No production change.
 */

const enforceCompanyAccess = jest.fn();
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

const createLead = jest.fn();
const getLeads = jest.fn();
const validateWebhookAuth = jest.fn();
const getForm = jest.fn();
jest.mock('../../services/leadService', () => ({
  createLead: (...a: unknown[]) => createLead(...a),
  getLeads: (...a: unknown[]) => getLeads(...a),
  validateWebhookAuth: (...a: unknown[]) => validateWebhookAuth(...a),
  getForm: (...a: unknown[]) => getForm(...a),
}));

const recordLeadAttribution = jest.fn();
jest.mock('../../services/leadAttributionService', () => ({
  ...jest.requireActual('../../services/leadAttributionService'), // REAL extractAttributionPayload
  recordLeadAttribution: (...a: unknown[]) => recordLeadAttribution(...a),
}));

const resolveVisitorSession = jest.fn();
const stitchSessionToLead = jest.fn();
const persistCampaignTouchpoint = jest.fn();
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: (...a: unknown[]) => resolveVisitorSession(...a),
  stitchSessionToLead: (...a: unknown[]) => stitchSessionToLead(...a),
  persistCampaignTouchpoint: (...a: unknown[]) => persistCampaignTouchpoint(...a),
}));

const checkFormOrigin = jest.fn();
jest.mock('../../services/websiteDomainEnforcementService', () => ({
  checkFormOrigin: (...a: unknown[]) => checkFormOrigin(...a),
}));

import handler from '../../../pages/api/leads/index';
import { createMockRes } from '../utils/setupApiTest';

const req = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { origin: 'https://caller.example' },
  query: {},
  body: {},
  cookies: {},
  ...over,
} as any);

const LEAD = { id: 'L1', source: 'webhook', unified_person_id: 'up-1' };
const SESSION = { sessionId: 'vs-1', firstTouch: { a: 1 }, lastTouch: { b: 2 } };

beforeEach(() => {
  jest.clearAllMocks();
  resolveVisitorSession.mockResolvedValue(SESSION);
  stitchSessionToLead.mockResolvedValue(undefined);
  persistCampaignTouchpoint.mockResolvedValue(undefined);
  recordLeadAttribution.mockResolvedValue(undefined);
  createLead.mockResolvedValue(LEAD);
});

describe('P0-D — CORS / method surface', () => {
  test('OPTIONS → 200 with origin-echoing CORS headers incl. X-Omnivera-Signature', async () => {
    const res = createMockRes();
    await handler(req({ method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://caller.example');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, X-Omnivera-Signature');
  });

  test('unsupported method → 405 {error}', async () => {
    const res = createMockRes();
    await handler(req({ method: 'DELETE' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });
});

describe('P0-D — Mode 1: inbound webhook', () => {
  const webhookBody = {
    integration_id: 'int-1', webhook_secret: 's3cret',
    name: '  Jane  ', email: 'JANE@Acme.com', phone: ' 555 ',
    metadata: { crm: 'hubspot' }, utm_source: 'google', is_test: 1,
    totally_unknown_field: 'ignored-but-tolerated',
  };

  test('invalid credentials → 401 exact error string', async () => {
    validateWebhookAuth.mockResolvedValue(null);
    const res = createMockRes();
    await handler(req({ body: webhookBody }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid integration_id or webhook_secret' });
    expect(createLead).not.toHaveBeenCalled();
  });

  test('missing name/email → 400', async () => {
    validateWebhookAuth.mockResolvedValue({ company_id: 'co-1', website_id: null, integration_id: 'int-1' });
    const res = createMockRes();
    await handler(req({ body: { integration_id: 'int-1', api_key: 'k', email: 'a@b.c' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'name and email are required' });
  });

  test('valid webhook → 201 {lead}; trims/lowercases, defaults source, merges caller metadata + attribution, runs the full chain', async () => {
    validateWebhookAuth.mockResolvedValue({ company_id: 'co-1', website_id: 'w-1', integration_id: 'int-1' });
    const res = createMockRes();
    await handler(req({ body: webhookBody }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ lead: LEAD });
    const [companyId, input] = createLead.mock.calls[0];
    expect(companyId).toBe('co-1');
    expect(input).toMatchObject({
      name: 'Jane', email: 'jane@acme.com', phone: '555',
      source: 'webhook',                    // default when body.source absent
      integration_id: 'int-1',
      website_id: 'w-1',                    // auth website wins over attribution
      visitor_session_id: 'vs-1',
      consent_state: null,
      is_test: true,
    });
    expect(input.metadata).toMatchObject({ crm: 'hubspot' });          // caller metadata preserved
    expect(input.metadata.attribution).toMatchObject({ utm_source: 'google' }); // + attribution merged in
    expect((input.metadata as Record<string, unknown>).totally_unknown_field).toBeUndefined(); // unknown fields NOT copied
    // attribution snapshot carries the resolved first/last touch
    expect(recordLeadAttribution).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'co-1', leadId: 'L1', visitorSessionId: 'vs-1',
      attribution: expect.objectContaining({ first_touch: SESSION.firstTouch, last_touch: SESSION.lastTouch }),
    }));
    expect(stitchSessionToLead).toHaveBeenCalledWith({ leadId: 'L1', companyId: 'co-1', visitorSessionId: 'vs-1', unifiedPersonId: 'up-1' });
    expect(persistCampaignTouchpoint).toHaveBeenCalledWith(expect.objectContaining({ touchpointType: 'conversion' }));
  });

  test('createLead failure → 500 {error: message}', async () => {
    validateWebhookAuth.mockResolvedValue({ company_id: 'co-1', website_id: null, integration_id: 'int-1' });
    createLead.mockRejectedValue(new Error('IDENTITY_REQUIRED_FOR_LEAD'));
    const res = createMockRes();
    await handler(req({ body: { integration_id: 'i', webhook_secret: 's', name: 'J', email: 'j@a.c' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'IDENTITY_REQUIRED_FOR_LEAD' });
  });
});

describe('P0-D — Mode 2: embedded form', () => {
  const FORM = {
    id: 'F1', company_id: 'co-2', website_id: 'w-2', name: 'Contact Us',
    integration_id: 'int-2',
    fields: [
      { name: 'work_email', label: 'Work Email', type: 'email', required: true },
      { name: 'full_name', label: 'Full Name', type: 'text', required: true },
      { name: 'mobile', label: 'Mobile', type: 'phone', required: false },
    ],
  };

  test('unknown form → 404 Form not found', async () => {
    getForm.mockResolvedValue(null);
    const res = createMockRes();
    await handler(req({ body: { form_id: 'nope' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Form not found' });
  });

  test('origin rejected → 403 with the decision message', async () => {
    getForm.mockResolvedValue(FORM);
    checkFormOrigin.mockResolvedValue({ allowed: false, message: 'Origin not allowed for this form' });
    const res = createMockRes();
    await handler(req({ body: { form_id: 'F1' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Origin not allowed for this form' });
  });

  test('missing required field → 400 "<label> is required"', async () => {
    getForm.mockResolvedValue(FORM);
    checkFormOrigin.mockResolvedValue({ allowed: true, mode: 'open' });
    const res = createMockRes();
    await handler(req({ body: { form_id: 'F1', work_email: 'a@b.c' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Full Name is required' });
  });

  test('dynamic field resolution: email/name/phone come from typed fields; 201; source form_embed; origin_decision persisted in metadata', async () => {
    getForm.mockResolvedValue(FORM);
    const decision = { allowed: true, mode: 'allowlist', matched: 'caller.example' };
    checkFormOrigin.mockResolvedValue(decision);
    const res = createMockRes();
    await handler(req({ body: { form_id: 'F1', work_email: 'USER@Acme.com ', full_name: ' Pat Lee ', mobile: ' 777 ', utm_campaign: 'spring' } }), res);
    expect(res.statusCode).toBe(201);
    const [companyId, input] = createLead.mock.calls[0];
    expect(companyId).toBe('co-2');
    expect(input).toMatchObject({
      name: 'Pat Lee', email: 'user@acme.com', phone: '777',
      source: 'form_embed', form_id: 'F1', integration_id: 'int-2',
      website_id: 'w-2', visitor_session_id: 'vs-1',
    });
    expect(input.metadata).toMatchObject({ form_name: 'Contact Us', origin_decision: decision });
    expect(recordLeadAttribution).toHaveBeenCalledWith(expect.objectContaining({ formId: 'F1' }));
    expect(stitchSessionToLead).toHaveBeenCalled();
    expect(persistCampaignTouchpoint).toHaveBeenCalled();
  });

  test('no email field on the form and no body.email → 400 email is required', async () => {
    getForm.mockResolvedValue({ ...FORM, fields: [{ name: 'full_name', label: 'Full Name', type: 'text', required: false }] });
    checkFormOrigin.mockResolvedValue({ allowed: true });
    const res = createMockRes();
    await handler(req({ body: { form_id: 'F1', full_name: 'Pat' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'email is required' });
  });
});

describe('P0-D — Mode 3: authenticated manual entry', () => {
  test('missing company_id → 400 before any auth call', async () => {
    const res = createMockRes();
    await handler(req({ body: { name: 'J', email: 'j@a.c' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'company_id is required' });
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  test('access denied → handler returns with no JSON body of its own', async () => {
    enforceCompanyAccess.mockResolvedValue(null); // guard writes its own response
    const res = createMockRes();
    await handler(req({ body: { company_id: 'co-3', name: 'J', email: 'j@a.c' } }), res);
    expect(createLead).not.toHaveBeenCalled();
  });

  test('manual create → 201; source manual; NO session resolve/stitch/touchpoint; attribution recorded with visitorSessionId null', async () => {
    enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
    const res = createMockRes();
    await handler(req({ body: { company_id: 'co-3', name: ' Sam ', email: ' SAM@x.io ', utm_source: 'newsletter' } }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ lead: LEAD });
    const [companyId, input] = createLead.mock.calls[0];
    expect(companyId).toBe('co-3');
    expect(input).toMatchObject({ name: 'Sam', email: 'sam@x.io', source: 'manual', website_id: null });
    expect(input.visitor_session_id).toBeUndefined(); // manual mode never resolves a session
    expect(resolveVisitorSession).not.toHaveBeenCalled();
    expect(stitchSessionToLead).not.toHaveBeenCalled();
    expect(persistCampaignTouchpoint).not.toHaveBeenCalled();
    expect(recordLeadAttribution).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'co-3', leadId: 'L1', visitorSessionId: null,
      attribution: expect.objectContaining({ utm_source: 'newsletter' }),
    }));
  });
});
