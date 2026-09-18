/**
 * WSF-ORD-003 (abuse gap, owner pulled into scope 2026-09-18) —
 * pages/api/leads/index.ts Mode 2, the ANONYMOUS embedded-form branch.
 *
 * Being public is the product contract and does not change here. Being
 * UNMETERED was the gap: a leaked form_id could be used to flood its tenant's
 * lead list, and a form with no allowed_domains was accepted fail-open with no
 * record that it had happened.
 *
 * What this suite pins:
 *   (i)   the limiter blocks the abusive pattern — per client IP, and per
 *         form_id across many IPs (the dimension an IP limit cannot see);
 *   (ii)  a normal single submission still succeeds, unchanged;
 *   (iii) the tenant still comes ONLY from form.company_id;
 *   (iv)  a form with no allowed_domains is still ACCEPTED but is now counted;
 *   plus  the strict refusal is OFF unless its env flag is set.
 *
 * The limiter is a real counting fake driven by each call's own config, so the
 * budgets and key dimensions are genuinely exercised rather than stubbed to a
 * fixed answer. checkFormOrigin and getTrustedClientIp run FOR REAL.
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
  ...jest.requireActual('../../services/leadAttributionService'),
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

const triggerLeadIntelligence = jest.fn();
jest.mock('../../services/leadIntelligenceActivation', () => ({
  triggerLeadIntelligence: (...a: unknown[]) => triggerLeadIntelligence(...a),
}));

/** A counting limiter that honours each call's own keyPrefix/limit. */
const rlCounts = new Map<string, number>();
const checkRateLimit = jest.fn(async (identifier: string, config: { keyPrefix: string; limit: number }) => {
  const key = `${config.keyPrefix}:${identifier}`;
  const n = (rlCounts.get(key) ?? 0) + 1;
  rlCounts.set(key, n);
  return { allowed: n <= config.limit, remaining: Math.max(0, config.limit - n), resetAt: 0, bypassed: false };
});
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => (checkRateLimit as any)(...a),
}));

const recordRawCounter = jest.fn();
jest.mock('../../observability', () => ({
  // Keep the real module (routeFactory needs withApiObservability); intercept
  // only the counter so the emits can be asserted.
  ...jest.requireActual('../../observability'),
  recordRawCounter: (...a: unknown[]) => recordRawCounter(...a),
}));

import handler from '../../../pages/api/leads/index';
import { createMockRes } from '../utils/setupApiTest';

const CO_FORM_OWNER = 'co-form-owner-0001';
const CO_OTHER = 'co-someone-else-0002';

/** A capture form as getForm returns it. `allowed_domains` drives checkFormOrigin. */
const form = (over: Record<string, unknown> = {}) => ({
  id: 'form-1',
  company_id: CO_FORM_OWNER,
  name: 'Contact us',
  website_id: 'web-1',
  integration_id: null,
  allowed_domains: ['customer.example'],
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'name', label: 'Name', type: 'text', required: false },
  ],
  ...over,
});

const req = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { origin: 'https://customer.example' },
  query: {},
  cookies: {},
  socket: { remoteAddress: '203.0.113.7' },
  body: { form_id: 'form-1', email: 'visitor@example.test', name: 'Visitor' },
  ...over,
} as any);

/** One submission. Returns the mock response. */
async function submit(over: Record<string, unknown> = {}) {
  const res = createMockRes();
  await handler(req(over), res as any);
  return res;
}

const counterNames = () => recordRawCounter.mock.calls.map((c) => c[0]);

let savedVercel: string | undefined;
let savedHops: string | undefined;
let savedStrict: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  rlCounts.clear();
  // getTrustedClientIp runs for real: keep it on the socket-peer path.
  savedVercel = process.env.VERCEL;
  savedHops = process.env.TRUSTED_PROXY_HOPS;
  savedStrict = process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS;
  delete process.env.VERCEL;
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS;

  getForm.mockResolvedValue(form());
  resolveVisitorSession.mockResolvedValue({ sessionId: 'vs-1', firstTouch: {}, lastTouch: {} });
  createLead.mockResolvedValue({ id: 'lead-1', source: 'form_embed', unified_person_id: 'up-1' });
  recordLeadAttribution.mockResolvedValue(undefined);
  stitchSessionToLead.mockResolvedValue(undefined);
  persistCampaignTouchpoint.mockResolvedValue(undefined);
});

afterEach(() => {
  if (savedVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = savedVercel;
  if (savedHops === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = savedHops;
  if (savedStrict === undefined) delete process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS;
  else process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS = savedStrict;
});

// ── (ii) the normal case is untouched ───────────────────────────────────────
describe('a normal submission still succeeds, unchanged', () => {
  it('one submission → 201 with the lead, and the whole capture chain still runs', async () => {
    const res = await submit();
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ lead: { id: 'lead-1', source: 'form_embed', unified_person_id: 'up-1' } });
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(recordLeadAttribution).toHaveBeenCalledTimes(1);
    expect(stitchSessionToLead).toHaveBeenCalledTimes(1);
    expect(persistCampaignTouchpoint).toHaveBeenCalledTimes(1);
    expect(triggerLeadIntelligence).toHaveBeenCalledTimes(1);
  });

  it('a whole minute of realistic traffic (19 from one visitor) is never throttled', async () => {
    for (let i = 0; i < 19; i++) expect((await submit()).statusCode).toBe(201);
    expect(createLead).toHaveBeenCalledTimes(19);
    expect(counterNames()).not.toContain('leads.form_submission_rate_limited');
  });

  it('both limits are checked BEFORE the form is read or any lead is written', async () => {
    checkRateLimit.mockImplementationOnce(async () => ({ allowed: false, remaining: 0, resetAt: 0, bypassed: false }));
    await submit();
    expect(getForm).not.toHaveBeenCalled();
    expect(createLead).not.toHaveBeenCalled();
    expect(resolveVisitorSession).not.toHaveBeenCalled();
  });
});

// ── (i) the abusive patterns are blocked ────────────────────────────────────
describe('the limiter blocks the abusive pattern', () => {
  it('per IP: the 21st submission from one address in the window → 429, nothing written', async () => {
    for (let i = 0; i < 20; i++) expect((await submit()).statusCode).toBe(201);
    createLead.mockClear();

    const res = await submit();
    expect(res.statusCode).toBe(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(createLead).not.toHaveBeenCalled();
    expect(recordRawCounter).toHaveBeenCalledWith('leads.form_submission_rate_limited', 1, { scope: 'ip' });
  });

  it('the per-IP limit is keyed by the PLATFORM-TRUSTED ip: a spoofed X-Forwarded-For buys no fresh bucket', async () => {
    for (let i = 0; i < 20; i++) await submit();
    const res = await submit({
      headers: { origin: 'https://customer.example', 'x-forwarded-for': '9.9.9.9' },
    });
    expect(res.statusCode).toBe(429);
  });

  it('a different real client is unaffected by another IP exhausting its budget', async () => {
    for (let i = 0; i < 21; i++) await submit();
    const res = await submit({ socket: { remoteAddress: '198.51.100.22' } });
    expect(res.statusCode).toBe(201);
  });

  it('per FORM: one form_id flooded from many addresses is capped at 60 — the case an IP limit cannot see', async () => {
    // 60 distinct IPs, each well inside the per-IP budget, all hitting one form.
    for (let i = 0; i < 60; i++) {
      const res = await submit({ socket: { remoteAddress: `198.51.100.${i + 1}` } });
      expect(res.statusCode).toBe(201);
    }
    createLead.mockClear();

    const res = await submit({ socket: { remoteAddress: '198.51.100.200' } });
    expect(res.statusCode).toBe(429);
    expect(createLead).not.toHaveBeenCalled();
    expect(recordRawCounter).toHaveBeenCalledWith('leads.form_submission_rate_limited', 1, { scope: 'form' });
  });

  it('the per-form limit does not spill onto another tenant\'s form', async () => {
    for (let i = 0; i < 61; i++) await submit({ socket: { remoteAddress: `198.51.100.${(i % 200) + 1}` } });
    getForm.mockResolvedValue(form({ id: 'form-2', company_id: CO_OTHER }));
    const res = await submit({
      socket: { remoteAddress: '203.0.113.99' },
      body: { form_id: 'form-2', email: 'v@example.test' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the per-form key is the RESOLVED form id, so posting id variants cannot dodge it', async () => {
    getForm.mockResolvedValue(form({ id: 'form-1' }));
    await submit({ body: { form_id: 'form-1', email: 'v@example.test' } });
    await submit({ body: { form_id: 'FORM-1-alias', email: 'v@example.test' } });
    const formKeys = checkRateLimit.mock.calls
      .filter((c: any[]) => c[1].keyPrefix === 'rl:leads:form:id')
      .map((c: any[]) => c[0]);
    expect(formKeys).toEqual(['form-1', 'form-1']);
  });
});

// ── (iii) tenant derivation is untouched ────────────────────────────────────
describe('tenant derivation still comes only from form.company_id', () => {
  it('a body company_id is ignored: every write uses the form owner', async () => {
    const res = await submit({
      body: {
        form_id: 'form-1',
        email: 'visitor@example.test',
        company_id: CO_OTHER,           // attacker-supplied
        organization_id: CO_OTHER,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(createLead).toHaveBeenCalledWith(CO_FORM_OWNER, expect.anything());
    expect(resolveVisitorSession).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_FORM_OWNER }));
    expect(recordLeadAttribution).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_FORM_OWNER }));
    expect(stitchSessionToLead).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_FORM_OWNER }));
    expect(persistCampaignTouchpoint).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_FORM_OWNER }));
    expect(triggerLeadIntelligence).toHaveBeenCalledWith(CO_FORM_OWNER, 'lead-1', 'lead_captured');
    // Nothing anywhere received the attacker's company.
    const everyCompany = [createLead, resolveVisitorSession, recordLeadAttribution, stitchSessionToLead, persistCampaignTouchpoint]
      .flatMap((m) => m.mock.calls.flat())
      .map((a) => JSON.stringify(a ?? null));
    expect(everyCompany.some((s) => s.includes(CO_OTHER))).toBe(false);
  });
});

// ── (iv) the fail-open origin state is accepted but counted ─────────────────
describe('a form with no allowed_domains', () => {
  const noAllowlist = () => getForm.mockResolvedValue(form({ allowed_domains: [] }));

  it('is STILL ACCEPTED — capture must not silently stop for these tenants', async () => {
    noAllowlist();
    const res = await submit({ headers: { origin: 'https://anywhere.example' } });
    expect(res.statusCode).toBe(201);
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it('now emits the unverified-origin counter naming the form', async () => {
    noAllowlist();
    await submit({ headers: { origin: 'https://anywhere.example' } });
    expect(recordRawCounter).toHaveBeenCalledWith(
      'leads.form_submission_unverified_origin', 1, { form_id: 'form-1' },
    );
  });

  it('a form WITH an allowlist does not emit the counter', async () => {
    await submit();
    expect(counterNames()).not.toContain('leads.form_submission_unverified_origin');
  });

  it('a mismatched origin against a configured allowlist is still refused → 403', async () => {
    const res = await submit({ headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(createLead).not.toHaveBeenCalled();
  });
});

describe('strict origin mode', () => {
  it('is OFF by default — that is the shipped state', async () => {
    expect(process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS).toBeUndefined();
    getForm.mockResolvedValue(form({ allowed_domains: [] }));
    expect((await submit({ headers: { origin: 'https://anywhere.example' } })).statusCode).toBe(201);
  });

  it('refuses an allowlist-less form ONLY when an operator sets the flag', async () => {
    process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS = '1';
    getForm.mockResolvedValue(form({ allowed_domains: [] }));
    const res = await submit({ headers: { origin: 'https://anywhere.example' } });
    expect(res.statusCode).toBe(403);
    expect(createLead).not.toHaveBeenCalled();
  });

  it('with the flag on, a form that HAS an allowlist is unaffected', async () => {
    process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS = '1';
    expect((await submit()).statusCode).toBe(201);
  });
});
