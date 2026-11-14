const tables: Record<string, any> = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tables[t] ?? null, error: null }),
          // S2 tier 2 (fixture): the campaign owner is read through the seam (ownerCompanyOfRow: .eq().limit()).
          limit: async () => ({ data: tables[t] ? [tables[t]] : [], error: null }),
        }),
      }),
    }),
  },
}));
import { resolvePublishingOrganization } from '../../services/creator/publishingOrganizationResolver';

// S2 tier 2 (fixture): the seam only answers a uuid owner (campaigns.company_id is a uuid column).
const ORG_CAMPAIGN = 'c0a00000-0000-4000-8000-00000000c0c1';

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

describe('Canonical publishing organization resolver', () => {
  it('uses social_accounts.company_id as the canonical owner', async () => {
    tables.social_accounts = { company_id: 'org-canonical' };
    expect(await resolvePublishingOrganization({ socialAccountId: 'acc1' })).toBe('org-canonical');
  });

  it('falls back to campaigns.company_id when no account', async () => {
    tables.campaigns = { company_id: ORG_CAMPAIGN };
    expect(await resolvePublishingOrganization({ campaignId: 'c1' })).toBe(ORG_CAMPAIGN);
  });

  it('returns null when the org genuinely cannot be determined (no userId-as-companyId)', async () => {
    expect(await resolvePublishingOrganization({ socialAccountId: 'missing' })).toBeNull();
    expect(await resolvePublishingOrganization({})).toBeNull();
  });
});
