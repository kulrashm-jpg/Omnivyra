/**
 * Phase 8 — canonical website lead capture. Verifies the service routes through the
 * EXISTING canonical pipeline (createLead/adoptLead + attribution + session +
 * touchpoint), preserves attribution + rich fields, reuses identity, protects against
 * duplicates, and is tenant-isolated (server-configured company, never client). Helpers
 * are mocked — no DB.
 */
const dbState: { recent: any[] } = { recent: [] };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret; b.eq = ret; b.gte = ret; b.order = ret; b.limit = () => Promise.resolve({ data: dbState.recent, error: null });
    return b;
  },
}));
const createLead = jest.fn();
jest.mock('../../services/leadService', () => ({ createLead: (...a: unknown[]) => createLead(...a) }));
const recordLeadAttribution = jest.fn();
jest.mock('../../services/leadAttributionService', () => ({
  extractAttributionPayload: (body: Record<string, unknown>) => ({
    website_id: (body.website_id as string) ?? null,
    utm_source: (body.utm_source as string) ?? null,
    utm_campaign: (body.utm_campaign as string) ?? null,
    referrer: (body.referrer as string) ?? null,
    session_id: (body.session_id as string) ?? null,
    anonymous_id: (body.anonymous_id as string) ?? null,
  }),
  recordLeadAttribution: (...a: unknown[]) => recordLeadAttribution(...a),
}));
type ResolveVisitorSessionArgs = Parameters<typeof import('../../services/attributionResolverService')['resolveVisitorSession']>;
const resolveVisitorSession = jest.fn(async (..._a: ResolveVisitorSessionArgs) => ({ sessionId: 'sess-1', firstTouch: { f: 1 }, lastTouch: { l: 1 } }));
const stitchSessionToLead = jest.fn();
const persistCampaignTouchpoint = jest.fn();
jest.mock('../../services/attributionResolverService', () => ({
  resolveVisitorSession: (...a: ResolveVisitorSessionArgs) => resolveVisitorSession(...a),
  stitchSessionToLead: (...a: unknown[]) => stitchSessionToLead(...a),
  persistCampaignTouchpoint: (...a: unknown[]) => persistCampaignTouchpoint(...a),
}));

import { captureWebsiteLead, validateWebsiteLead, LeadCaptureError } from '../../services/leadCaptureService';

const OMNI = 'omnivyra-co';
const baseSubmission = (over: Record<string, unknown> = {}) => ({
  intent: 'request_demo',
  firstName: 'Jane', lastName: 'Doe', email: 'Jane@Acme.com', phone: '+1 555', company: 'Acme',
  jobTitle: 'CTO', companySize: '51–200', industry: 'SaaS / Technology', country: 'US',
  primaryInterest: 'Product demo', message: 'Interested', consent: true,
  rawBody: { utm_source: 'google', utm_campaign: 'spring', referrer: 'https://g.com', session_id: 'anon-1', anonymous_id: 'anon-1', journey_id: 'j1', campaign_id: 'cmp1', content_id: 'ct1', cta_id: 'cta1', first_referrer: 'https://blog.omnivyra.com/x', company_id: 'ATTACKER-CO' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  dbState.recent = [];
  createLead.mockResolvedValue({ id: 'lead-1', source: 'website', unified_person_id: 'up-1' });
});

describe('Phase 8 — canonical website lead capture', () => {
  it('validates required fields (first/last/email/consent + email format)', () => {
    expect(validateWebsiteLead({})).toMatchObject({ firstName: expect.any(String), lastName: expect.any(String), email: expect.any(String), consent: expect.any(String) });
    expect(validateWebsiteLead({ firstName: 'A', lastName: 'B', email: 'bad', consent: true })).toEqual({ email: 'Enter a valid email address' });
    expect(validateWebsiteLead({ firstName: 'A', lastName: 'B', email: 'a@b.com', consent: true })).toEqual({});
  });

  it('throws VALIDATION (400) with field errors when required fields missing', async () => {
    await expect(captureWebsiteLead(baseSubmission({ email: '' }), { companyId: OMNI }))
      .rejects.toMatchObject({ code: 'VALIDATION', httpStatus: 400, fields: { email: expect.any(String) } });
    expect(createLead).not.toHaveBeenCalled();
  });

  it('routes through the canonical pipeline: createLead + attribution + stitch + touchpoint', async () => {
    const r = await captureWebsiteLead(baseSubmission(), { companyId: OMNI });
    expect(r.status).toBe('created');
    expect(r.leadId).toBe('lead-1');
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(recordLeadAttribution).toHaveBeenCalledTimes(1);
    expect(stitchSessionToLead).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', companyId: OMNI, visitorSessionId: 'sess-1', unifiedPersonId: 'up-1' }));
    expect(persistCampaignTouchpoint).toHaveBeenCalledWith(expect.objectContaining({ companyId: OMNI, touchpointType: 'conversion' }));
  });

  it('maps + preserves rich fields and attribution into the canonical lead', async () => {
    await captureWebsiteLead(baseSubmission(), { companyId: OMNI });
    const [companyArg, input] = createLead.mock.calls[0];
    expect(companyArg).toBe(OMNI);
    expect(input.name).toBe('Jane Doe');
    expect(input.email).toBe('jane@acme.com'); // normalized
    expect(input.source).toBe('website'); // canonical
    expect(input.consent_state).toBe('granted');
    expect(input.metadata).toMatchObject({ lead_capture: true, intent: 'request_demo', company_name: 'Acme', job_title: 'CTO', company_size: '51–200', industry: 'SaaS / Technology', country: 'US', primary_interest: 'Product demo', message: 'Interested' });
    expect(input.attribution).toMatchObject({ utm_source: 'google', utm_campaign: 'spring' });
    expect(input.visitor_session_id).toBe('sess-1');
    // hidden attribution fields the typed extractor doesn't map are preserved verbatim (nothing dropped)
    expect(input.metadata.web_attribution).toMatchObject({ journey_id: 'j1', campaign_id: 'cmp1', content_id: 'ct1', cta_id: 'cta1', first_referrer: 'https://blog.omnivyra.com/x' });
  });

  it('tenant isolation: uses the server-configured company, ignores a client-sent company_id', async () => {
    await captureWebsiteLead(baseSubmission(), { companyId: OMNI });
    expect(createLead.mock.calls[0][0]).toBe(OMNI); // not 'ATTACKER-CO' from rawBody.company_id
  });

  it('identity reuse: the unified person from createLead is stitched to the session', async () => {
    createLead.mockResolvedValue({ id: 'lead-9', source: 'website', unified_person_id: 'up-existing' });
    await captureWebsiteLead(baseSubmission(), { companyId: OMNI });
    expect(stitchSessionToLead).toHaveBeenCalledWith(expect.objectContaining({ unifiedPersonId: 'up-existing' }));
  });

  it('duplicate protection: a recent same-email lead short-circuits (no second write)', async () => {
    dbState.recent = [{ id: 'lead-existing', created_at: new Date().toISOString() }];
    const r = await captureWebsiteLead(baseSubmission(), { companyId: OMNI });
    expect(r.status).toBe('duplicate');
    expect(r.leadId).toBe('lead-existing');
    expect(createLead).not.toHaveBeenCalled();
  });

  it('returns the configured confirmation for the intent (no hardcoded behaviour)', async () => {
    const demo = await captureWebsiteLead(baseSubmission({ intent: 'request_demo' }), { companyId: OMNI });
    expect(demo.confirmation.mode).toBe('page');
    const sales = await captureWebsiteLead(baseSubmission({ intent: 'contact_sales', email: 'a@b.com' }), { companyId: OMNI });
    expect(sales.confirmation.mode).toBe('inline');
  });

  it('free-audit (lite) migration: no name required, name derived from email', async () => {
    expect(validateWebsiteLead({ email: 'a@b.com', consent: true }, 'free_audit')).toEqual({});
    const r = await captureWebsiteLead(
      { intent: 'free_audit', email: 'Audit@Acme.com', company: 'acme.com', message: 'audit', consent: true, rawBody: { utm_source: 'organic' } },
      { companyId: OMNI },
    );
    expect(r.status).toBe('created');
    expect(r.confirmation.mode).toBe('redirect');
    const [companyArg, input] = createLead.mock.calls[0];
    expect(companyArg).toBe(OMNI);
    expect(input.name).toBe('audit'); // derived from email local-part
    expect(input.source).toBe('website');
    expect(input.metadata.intent).toBe('free_audit');
  });

  it('rejects invalid intent (400) and unconfigured tenant (503)', async () => {
    await expect(captureWebsiteLead(baseSubmission({ intent: 'spam' }), { companyId: OMNI })).rejects.toMatchObject({ code: 'INVALID_INTENT', httpStatus: 400 });
    delete process.env.OMNIVYRA_LEAD_COMPANY_ID;
    await expect(captureWebsiteLead(baseSubmission())).rejects.toMatchObject({ code: 'NOT_CONFIGURED', httpStatus: 503 });
  });
});
