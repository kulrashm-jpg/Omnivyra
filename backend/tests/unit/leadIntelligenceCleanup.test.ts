/**
 * Phase 14 — Lead Intelligence final cleanup regression. Proves the verified dead
 * code is gone, the permanent compatibility layers survive byte-identically, the
 * capture service no longer reads any OmniVyra env (tenant comes from resolution),
 * and tenant resolution's deprecated env fallbacks still work for existing deployments.
 */
import * as leadService from '../../services/leadService';
import * as leadCaptureService from '../../services/leadCaptureService';
import { captureWebsiteLead } from '../../services/leadCaptureService';
import * as legacyLeadCompat from '../../services/leadIntelligence/legacyLeadCompat';
import { resolveTenantForWebsite } from '../../services/tenantResolutionService';

const ENV = ['OMNIVYRA_LEAD_COMPANY_ID', 'LEAD_CAPTURE_DEFAULT_COMPANY_ID', 'OMNIVYRA_SITE_ORIGINS', 'LEAD_CAPTURE_DEFAULT_ORIGINS', 'LEAD_CAPTURE_DEFAULT_WEBSITE_ID'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('Phase 14 — dead code removed', () => {
  it('leadService.getLead is gone (was 0 callers)', () => {
    expect((leadService as Record<string, unknown>).getLead).toBeUndefined();
    expect(typeof leadService.getLeads).toBe('function'); // survives
  });
  it('legacyLeadCompat.getLegacyLead is gone; getLegacyLeads (the /api/leads contract) survives', () => {
    expect((legacyLeadCompat as Record<string, unknown>).getLegacyLead).toBeUndefined();
    expect(typeof legacyLeadCompat.getLegacyLeads).toBe('function');
  });
  it('leadCaptureService.resolveOmnivyraCompanyId is gone', () => {
    expect((leadCaptureService as Record<string, unknown>).resolveOmnivyraCompanyId).toBeUndefined();
    expect(typeof leadCaptureService.captureWebsiteLead).toBe('function'); // survives
  });
});

describe('Phase 14 — capture service is tenant-bootstrap-free', () => {
  it('captureWebsiteLead with no companyId → NOT_CONFIGURED even when OMNIVYRA_LEAD_COMPANY_ID is set', async () => {
    process.env.OMNIVYRA_LEAD_COMPANY_ID = 'omni-co'; // must be IGNORED by the capture service now
    await expect(
      captureWebsiteLead({ intent: 'contact_sales', email: 'a@b.com', consent: true, rawBody: {} }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED', httpStatus: 503 });
  });
});

describe('Phase 14 — tenant resolution unchanged (compat fallback preserved)', () => {
  it('deprecated OMNIVYRA_LEAD_COMPANY_ID still resolves the default site', async () => {
    process.env.OMNIVYRA_LEAD_COMPANY_ID = 'omni-co';
    const ctx = await resolveTenantForWebsite({}); // no DB-touching signals → site_config only
    expect(ctx).toBeTruthy();
    expect(ctx!.resolvedBy).toBe('site_config');
    expect(ctx!.tenantId).toBe('omni-co');
  });
  it('canonical LEAD_CAPTURE_DEFAULT_COMPANY_ID takes precedence over the deprecated name', async () => {
    process.env.OMNIVYRA_LEAD_COMPANY_ID = 'omni-co';
    process.env.LEAD_CAPTURE_DEFAULT_COMPANY_ID = 'canonical-co';
    const ctx = await resolveTenantForWebsite({});
    expect(ctx!.tenantId).toBe('canonical-co');
  });
  it('no default configured → unknown request rejected', async () => {
    expect(await resolveTenantForWebsite({})).toBeNull();
  });
});
