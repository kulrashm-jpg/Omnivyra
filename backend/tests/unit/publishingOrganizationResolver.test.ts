const tables: Record<string, any> = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: tables[t] ?? null, error: null }),
        }),
      }),
    }),
  },
}));
import { resolvePublishingOrganization } from '../../services/creator/publishingOrganizationResolver';

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

describe('Canonical publishing organization resolver', () => {
  it('uses social_accounts.company_id as the canonical owner', async () => {
    tables.social_accounts = { company_id: 'org-canonical' };
    expect(await resolvePublishingOrganization({ socialAccountId: 'acc1' })).toBe('org-canonical');
  });

  it('falls back to campaigns.company_id when no account', async () => {
    tables.campaigns = { company_id: 'org-campaign' };
    expect(await resolvePublishingOrganization({ campaignId: 'c1' })).toBe('org-campaign');
  });

  it('returns null when the org genuinely cannot be determined (no userId-as-companyId)', async () => {
    expect(await resolvePublishingOrganization({ socialAccountId: 'missing' })).toBeNull();
    expect(await resolvePublishingOrganization({})).toBeNull();
  });
});
