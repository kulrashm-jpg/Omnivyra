/**
 * Phase 13 — lead-capture endpoint integration: tenant resolution is the entry point;
 * resolved tenant flows to captureWebsiteLead unchanged; unknown websites are rejected;
 * honeypot still drops bots. Existing capture pipeline regression (the call shape is
 * unchanged apart from the now-resolved companyId).
 */
const resolveTenantForWebsite = jest.fn();
jest.mock('../../services/tenantResolutionService', () => ({ resolveTenantForWebsite: (...a: unknown[]) => resolveTenantForWebsite(...a) }));
const captureWebsiteLead = jest.fn();
jest.mock('../../services/leadCaptureService', () => ({
  captureWebsiteLead: (...a: unknown[]) => captureWebsiteLead(...a),
  LeadCaptureError: class LeadCaptureError extends Error { constructor(public code: string, public httpStatus: number, public fields?: unknown) { super(code); } },
}));

import handler from '../../../pages/api/website/lead-capture';

function mockRes() {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.end = () => res;
  return res;
}
const req = (body: Record<string, unknown>, headers: Record<string, string> = {}) => ({ method: 'POST', headers, body } as any);

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 13 — lead-capture endpoint × tenant resolution', () => {
  it('rejects an unrecognized website (tenant resolution returns null)', async () => {
    resolveTenantForWebsite.mockResolvedValue(null);
    const res = mockRes();
    await handler(req({ intent: 'contact_sales', email: 'a@b.com' }, { origin: 'https://stranger.com' }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'unrecognized_website' });
    expect(captureWebsiteLead).not.toHaveBeenCalled();
  });

  it('forwards the resolved tenant to the canonical pipeline unchanged', async () => {
    resolveTenantForWebsite.mockResolvedValue({ tenantId: 'acme-co', companyId: 'acme-co' });
    captureWebsiteLead.mockResolvedValue({ status: 'created', leadId: 'L1', intent: 'contact_sales', confirmation: { mode: 'inline', message: 'ok' } });
    const res = mockRes();
    await handler(req({ intent: 'contact_sales', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com', consent: true }, { origin: 'https://shop.acme.com', host: 'shop.acme.com' }), res);
    expect(resolveTenantForWebsite).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://shop.acme.com', host: 'shop.acme.com' }));
    expect(res.statusCode).toBe(201);
    const [submission, opts] = captureWebsiteLead.mock.calls[0];
    expect(opts).toEqual({ companyId: 'acme-co' }); // resolved tenant, not hardcoded
    expect(submission).toMatchObject({ intent: 'contact_sales', email: 'jane@acme.com', consent: true });
  });

  it('honeypot drops bots before tenant resolution', async () => {
    const res = mockRes();
    await handler(req({ intent: 'contact_sales', company_website: 'bot', email: 'a@b.com' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'created', leadId: null });
    expect(resolveTenantForWebsite).not.toHaveBeenCalled();
    expect(captureWebsiteLead).not.toHaveBeenCalled();
  });

  it('maps LeadCaptureError to its http status', async () => {
    const { LeadCaptureError } = jest.requireMock('../../services/leadCaptureService') as { LeadCaptureError: new (c: string, s: number, f?: unknown) => Error };
    resolveTenantForWebsite.mockResolvedValue({ tenantId: 'acme-co' });
    captureWebsiteLead.mockRejectedValue(new LeadCaptureError('VALIDATION', 400, { email: 'bad' }));
    const res = mockRes();
    await handler(req({ intent: 'contact_sales', email: 'bad' }, { origin: 'https://shop.acme.com' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'VALIDATION' });
  });
});
