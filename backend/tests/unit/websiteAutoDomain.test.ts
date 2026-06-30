/**
 * Phase 17 Part 2 — auto domain registration. createWebsiteFromSetup auto-creates the
 * company_domains record (reusing saveDomainRecord) + links website.domain_id, so the
 * tenant never has to know company_domains exists. Deps mocked; no DB.
 */
const createWebsite = jest.fn();
const updateWebsite = jest.fn();
jest.mock('../../services/websiteService', () => ({
  createWebsite: (...a: unknown[]) => createWebsite(...a),
  updateWebsite: (...a: unknown[]) => updateWebsite(...a),
  getWebsites: jest.fn(async () => []),
}));
const saveDomainRecord = jest.fn();
jest.mock('../../services/domainRecordService', () => ({ saveDomainRecord: (...a: unknown[]) => saveDomainRecord(...a) }));
jest.mock('../../services/domainCanonicalService', () => ({ normalizeDomain: (h: string) => h.toLowerCase() }));
jest.mock('../../services/integrationHealthService', () => ({ getWebsiteHealthSummary: jest.fn(async () => ({})) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret; b.eq = ret; b.insert = ret; b.update = ret; b.upsert = ret;
    b.maybeSingle = () => Promise.resolve({ data: { id: 'p1', completed_steps: ['create_website'], step_state: {} }, error: null });
    b.single = () => Promise.resolve({ data: { id: 'p1', completed_steps: ['create_website'], step_state: {} }, error: null });
    return b;
  },
}));

import { createWebsiteFromSetup } from '../../services/websiteSetupService';

beforeEach(() => {
  jest.clearAllMocks();
  createWebsite.mockResolvedValue({ id: 'w1', company_id: 'co1', canonical_url: 'https://acme.com', settings: {}, metadata: {}, domain_id: null });
  updateWebsite.mockImplementation(async (id: string, co: string, u: any) => ({ id, company_id: co, canonical_url: 'https://acme.com', domain_id: u.domainId }));
  saveDomainRecord.mockResolvedValue({ ok: true, id: 'dom1' });
});

describe('Phase 17 — auto domain registration', () => {
  it('registers company_domains (system, unverified) + links website.domain_id', async () => {
    const { website } = await createWebsiteFromSetup({ companyId: 'co1', userId: 'u1', name: 'Acme', canonicalUrl: 'https://acme.com' });
    expect(saveDomainRecord).toHaveBeenCalledWith(expect.objectContaining({ company_id: 'co1', input_domain: 'acme.com', final_domain: 'acme.com', verification_status: 'unverified', created_via: 'system', is_primary: true }));
    expect(updateWebsite).toHaveBeenCalledWith('w1', 'co1', expect.objectContaining({ domainId: 'dom1' }));
    expect(website.domain_id).toBe('dom1');
  });

  it('best-effort: a domain-claim conflict never blocks website creation', async () => {
    saveDomainRecord.mockResolvedValue({ ok: false, error: 'DOMAIN_ALREADY_CLAIMED' });
    const { website } = await createWebsiteFromSetup({ companyId: 'co1', userId: 'u1', name: 'Acme', canonicalUrl: 'https://acme.com' });
    expect(website.id).toBe('w1'); // still created
    expect(updateWebsite).not.toHaveBeenCalled(); // no link when registration failed
  });
});
