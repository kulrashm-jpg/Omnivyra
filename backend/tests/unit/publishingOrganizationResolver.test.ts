const tables: Record<string, any> = {};
/** unread-error pkg 2: a PostgREST error (returned) or a thrown failure, per table. */
const errors: Record<string, { message: string } | 'throw'> = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (errors[t] === 'throw') throw new Error('fetch failed');
            if (errors[t]) return { data: null, error: errors[t] };
            return { data: tables[t] ?? null, error: null };
          },
        }),
      }),
    }),
  },
}));
import { resolvePublishingOrganization, PublishingOrgReadError } from '../../services/creator/publishingOrganizationResolver';

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(errors)) delete errors[k];
});

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

describe('unread-error pkg 2: a FAILED read is never "cannot be determined"', () => {
  it('a failed social_accounts read THROWS, and never falls through to the campaign company', async () => {
    errors.social_accounts = { message: 'boom' };
    tables.campaigns = { company_id: 'org-campaign' };
    const err = await resolvePublishingOrganization({ socialAccountId: 'acc1', campaignId: 'c1' }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishingOrgReadError);
    expect(err).toMatchObject({ source: 'social_accounts', code: 'PUBLISHING_ORG_READ_FAILED' });
  });

  it('a failed campaigns read THROWS, never null', async () => {
    errors.campaigns = { message: 'boom' };
    await expect(resolvePublishingOrganization({ campaignId: 'c1' })).rejects.toMatchObject({ source: 'campaigns' });
  });

  it('a failed scheduled_posts read THROWS, never null', async () => {
    errors.scheduled_posts = { message: 'boom' };
    await expect(resolvePublishingOrganization({ scheduledPostId: 'p1' })).rejects.toMatchObject({ source: 'scheduled_posts' });
  });

  it('a THROWN failure (network) is the same named error, never swallowed into null', async () => {
    errors.social_accounts = 'throw';
    await expect(resolvePublishingOrganization({ socialAccountId: 'acc1' })).rejects.toBeInstanceOf(PublishingOrgReadError);
  });

  it('CONTROL: the scheduled post bindings still resolve when every read succeeds', async () => {
    tables.scheduled_posts = { social_account_id: null, campaign_id: 'c9' };
    tables.campaigns = { company_id: 'org-from-post' };
    expect(await resolvePublishingOrganization({ scheduledPostId: 'p1' })).toBe('org-from-post');
  });
});
