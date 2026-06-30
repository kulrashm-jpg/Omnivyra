/**
 * Phase 13 — Canonical Tenant Resolution. Verifies all resolution strategies reuse
 * existing website/org infrastructure, customer isolation, unknown rejection, the
 * configured-default (OmniVyra) path, and canonical context generation. ownedDbTable
 * + validateWebhookAuth + getWebsite are mocked; checkWebsiteOrigin runs real over the
 * mocked company_domains.
 */
const fx: { websites: any; company_domains: any } = { websites: null, company_domains: null };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret; b.eq = ret; b.is = ret;
    b.maybeSingle = () => Promise.resolve({ data: (fx as Record<string, unknown>)[table] ?? null, error: null });
    b.single = b.maybeSingle;
    return b;
  },
}));
const validateWebhookAuth = jest.fn();
jest.mock('../../services/leadService', () => ({ validateWebhookAuth: (...a: unknown[]) => validateWebhookAuth(...a) }));
const getWebsite = jest.fn();
jest.mock('../../services/websiteService', () => ({ getWebsite: (...a: unknown[]) => getWebsite(...a) }));

import { resolveTenantForWebsite, getTenantContext } from '../../services/tenantResolutionService';

const website = (over: Record<string, unknown> = {}) => ({
  id: 'w1', company_id: 'acme-co', domain_id: null, name: 'Acme', canonical_url: 'https://shop.acme.com',
  cms_provider: null, status: 'active', settings: {}, metadata: {}, created_by: null, deleted_at: null,
  created_at: '', updated_at: '', ...over,
});

const ENV_KEYS = ['OMNIVYRA_LEAD_COMPANY_ID', 'LEAD_CAPTURE_DEFAULT_COMPANY_ID', 'LEAD_CAPTURE_DEFAULT_WEBSITE_ID', 'OMNIVYRA_SITE_ORIGINS', 'LEAD_CAPTURE_DEFAULT_ORIGINS'];
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  fx.websites = null; fx.company_domains = null;
  jest.clearAllMocks();
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

describe('Phase 13 — Tenant Resolution', () => {
  it('resolves a customer by verified website domain (origin)', async () => {
    fx.company_domains = { id: 'd1', verified: true, verification_status: 'verified', final_domain: 'shop.acme.com' };
    fx.websites = website({ domain_id: 'd1' });
    const ctx = await resolveTenantForWebsite({ origin: 'https://shop.acme.com' });
    expect(ctx).toBeTruthy();
    expect(ctx!.resolvedBy).toBe('verified_domain');
    expect(ctx!.tenantId).toBe('acme-co');
    expect(ctx!.companyId).toBe('acme-co');
    expect(ctx!.organizationId).toBe('acme-co');
    expect(ctx!.websiteId).toBe('w1');
    expect(ctx!.websiteDomain).toBe('shop.acme.com');
  });

  it('does NOT resolve an unverified domain via the verified-domain strategy', async () => {
    fx.company_domains = { id: 'd1', verified: false, verification_status: 'pending', final_domain: 'shop.acme.com' };
    fx.websites = website({ domain_id: 'd1' });
    const ctx = await resolveTenantForWebsite({ origin: 'https://shop.acme.com' }); // no host/default → null
    expect(ctx).toBeNull();
  });

  it('resolves by configured website id (origin-enforced)', async () => {
    fx.websites = website(); // domain_id null → allow_unverified
    const ctx = await resolveTenantForWebsite({ websiteId: 'w1', origin: 'https://shop.acme.com' });
    expect(ctx!.resolvedBy).toBe('website_id');
    expect(ctx!.tenantId).toBe('acme-co');
    expect(ctx!.websiteId).toBe('w1');
  });

  it('tenant isolation: a website id used from a foreign origin is rejected', async () => {
    fx.websites = website(); // canonical shop.acme.com
    const ctx = await resolveTenantForWebsite({ websiteId: 'w1', origin: 'https://evil.com' });
    expect(ctx).toBeNull();
  });

  it('resolves by host header (unverified domain allowed)', async () => {
    fx.company_domains = { id: 'd2', verified: false, verification_status: 'pending', final_domain: 'leads.acme.com' };
    fx.websites = website({ id: 'w2', domain_id: 'd2', canonical_url: 'https://leads.acme.com' });
    const ctx = await resolveTenantForWebsite({ host: 'leads.acme.com' });
    expect(ctx!.resolvedBy).toBe('host_header');
    expect(ctx!.websiteId).toBe('w2');
  });

  it('resolves by signed integration key', async () => {
    validateWebhookAuth.mockResolvedValue({ company_id: 'cust-co', website_id: null, integration_id: 'i1' });
    const ctx = await resolveTenantForWebsite({ integrationId: 'i1', integrationSecret: 's1' });
    expect(ctx!.resolvedBy).toBe('integration_key');
    expect(ctx!.tenantId).toBe('cust-co');
    expect(validateWebhookAuth).toHaveBeenCalledWith('i1', 's1');
  });

  it('resolves OmniVyra via the configured default site (backward compatible)', async () => {
    process.env.OMNIVYRA_LEAD_COMPANY_ID = 'omni-co';
    const ctx = await resolveTenantForWebsite({ origin: 'https://www.omnivyra.com' });
    expect(ctx!.resolvedBy).toBe('site_config');
    expect(ctx!.tenantId).toBe('omni-co');
  });

  it('default site enforces configured origins when set', async () => {
    process.env.OMNIVYRA_LEAD_COMPANY_ID = 'omni-co';
    process.env.OMNIVYRA_SITE_ORIGINS = 'https://www.omnivyra.com';
    expect(await resolveTenantForWebsite({ origin: 'https://www.omnivyra.com' })).toBeTruthy();
    expect(await resolveTenantForWebsite({ origin: 'https://evil.com' })).toBeNull(); // configured + mismatch → reject
  });

  it('rejects an unknown website when no default site is configured', async () => {
    const ctx = await resolveTenantForWebsite({ websiteId: 'nope', origin: 'https://stranger.com' });
    expect(ctx).toBeNull();
  });

  it('generates a complete canonical context (timezone/locale/flags from settings)', async () => {
    fx.websites = website({ settings: { timezone: 'America/New_York', locale: 'en-US', feature_flags: { beta: true }, allow_unverified_ingestion: true } });
    const ctx = await resolveTenantForWebsite({ websiteId: 'w1', origin: 'https://shop.acme.com' });
    expect(ctx!.timezone).toBe('America/New_York');
    expect(ctx!.locale).toBe('en-US');
    expect(ctx!.featureFlags).toEqual({ beta: true });
    expect(ctx!.siteConfiguration).toMatchObject({ timezone: 'America/New_York' });
  });

  it('getTenantContext builds context from a known company (+ optional website)', async () => {
    getWebsite.mockResolvedValue(website({ settings: { locale: 'fr' } }));
    const withSite = await getTenantContext('acme-co', 'w1');
    expect(withSite!.tenantId).toBe('acme-co');
    expect(withSite!.locale).toBe('fr');
    const minimal = await getTenantContext('acme-co');
    expect(minimal!.tenantId).toBe('acme-co');
    expect(minimal!.timezone).toBe('UTC');
    expect(await getTenantContext('')).toBeNull();
  });
});
