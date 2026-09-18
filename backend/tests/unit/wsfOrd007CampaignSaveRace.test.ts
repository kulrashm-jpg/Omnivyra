/**
 * WSF-ORD-007 — pages/api/campaigns/save.ts check-then-act race.
 *
 * THE DEFECT: the route read whether the campaign id existed, ran
 * requireCampaignAccess only when it did, and then UPSERTED by that id —
 * stamping user_id with the caller. Those are two statements with a gap
 * between them (two lookups, plus the whole guard chain when the id existed).
 * A campaign created by ANOTHER TENANT inside that gap matched no existence
 * read, so the guard was skipped entirely, and the upsert then overwrote the
 * row and took its ownership.
 *
 * The fix makes the create path INSERT-ONLY, so the database decides whether
 * the id was free: a lost race fails on the primary key (23505) and the route
 * authorizes the campaign that actually exists before applying the change.
 *
 * The race is driven deterministically: the competing row is inserted between
 * the route's existence read of `campaigns` and its write to `campaigns`.
 *
 * Only the database and the identity provider are faked; requireCampaignAccess
 * and the whole guard chain run for real.
 */
import * as harness from '../helpers/routeAuthHarness';
import {
  seed, invoke, rows, writeCalls, uniqueKey,
  CO_A, CO_B, USER_A, USER_B, CAMPAIGN_A, CAMPAIGN_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const saveCampaign = require('../../../pages/api/campaigns/save').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const RACED_ID = 'camp-raced-0000-0000-000000000r';

const campaign = (id: string) => rows('campaigns').find((r) => r.id === id);

/**
 * Let the route's existence read of `campaigns` see nothing, then have
 * `competitor` create the id before the route reaches its write — the exact
 * interleaving the old upsert lost.
 */
function raceInCampaignsWrite(competitor: Record<string, unknown>, extraTables: Record<string, any[]> = {}) {
  const real = harness.fakeSupabase.from.bind(harness.fakeSupabase);
  let campaignsCalls = 0;
  let committed = false;

  const commitCompetitor = () => {
    if (committed) return;
    committed = true;
    rows('campaigns').push({ ...competitor, id: RACED_ID });
    for (const [t, list] of Object.entries(extraTables)) {
      for (const r of list) (rows(t) as any[]).push(r);
    }
  };

  jest.spyOn(harness.fakeSupabase, 'from').mockImplementation(((table: string) => {
    if (table === 'campaigns') {
      campaignsCalls += 1;
      // Call 1 is the route's existence SELECT, which has already executed by
      // the time call 2 (the WRITE) builds its query. Committing here is the
      // precise interleaving the old upsert lost: the existence read saw
      // nothing, so the guard was skipped, and the write then landed on a row
      // that had appeared in between.
      if (campaignsCalls === 2) commitCompetitor();
    }
    return real(table);
  }) as any);
}

beforeEach(() => {
  jest.restoreAllMocks();
  seed();
  // The real campaigns table has `id` as its primary key; the harness only
  // enforces what a suite declares.
  uniqueKey('campaigns', 'id');
});

describe('WSF-ORD-007 — campaigns/save create race', () => {
  it("THE EXPLOIT: company B creates the id mid-flight and A's save used to overwrite it — now refused, B's row intact", async () => {
    raceInCampaignsWrite(
      { company_id: CO_B, user_id: USER_B, name: "B's campaign", status: 'planning' },
      { campaign_versions: [{ campaign_id: RACED_ID, company_id: CO_B, version: 1, created_at: '2026-01-01' }] },
    );

    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: RACED_ID, name: 'pwned' } });

    expect([403, 404]).toContain(r.status);
    const raced = campaign(RACED_ID)!;
    expect(raced.user_id).toBe(USER_B);
    expect(raced.name).toBe("B's campaign");
    // Nothing of A's landed on the row.
    expect(writeCalls(['campaigns']).some((c) => (c.payload as any)?.user_id === USER_A && c.op === 'update')).toBe(false);
  });

  it("THE EXPLOIT (orphan variant): a mid-flight row with no owner record cannot be taken over either", async () => {
    raceInCampaignsWrite({ company_id: null, user_id: USER_B, name: 'orphan' });

    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: RACED_ID, name: 'pwned' } });

    expect(r.status).toBe(404);
    expect(campaign(RACED_ID)!.user_id).toBe(USER_B);
    expect(campaign(RACED_ID)!.name).toBe('orphan');
  });

  it("the benign race — the caller's OWN company wins it — still succeeds as an update", async () => {
    raceInCampaignsWrite(
      { company_id: CO_A, user_id: USER_A, name: 'first write', status: 'planning' },
      { campaign_versions: [{ campaign_id: RACED_ID, company_id: CO_A, version: 1, created_at: '2026-01-01' }] },
    );

    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: RACED_ID, name: 'second write' } });

    expect(r.status).toBe(200);
    expect(campaign(RACED_ID)!.name).toBe('second write');
    // Exactly one row for the id: the insert conflicted rather than duplicating.
    expect(rows('campaigns').filter((x) => x.id === RACED_ID)).toHaveLength(1);
  });
});

describe('WSF-ORD-007 — the unraced paths are unchanged', () => {
  it('unauthenticated → 401, nothing written', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: null, body: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(writeCalls()).toHaveLength(0);
  });

  it("member of A still cannot overwrite B's existing campaign → 403/404", async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_B, name: 'pwned' } });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls(['campaigns'])).toHaveLength(0);
    expect(campaign(CAMPAIGN_B)!.user_id).toBe(USER_B);
  });

  it('member of A saves its own existing campaign → 200, applied as a scoped update', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, name: 'Renamed' } });
    expect(r.status).toBe(200);
    const writes = writeCalls(['campaigns']);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('update');
    expect(writes[0].filters).toMatchObject({ id: CAMPAIGN_A });
    expect(campaign(CAMPAIGN_A)!.name).toBe('Renamed');
  });

  it('a genuinely new id is created with an INSERT, not an upsert → 200', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: 'camp-brand-new', name: 'New' } });
    expect(r.status).toBe(200);
    const writes = writeCalls(['campaigns']);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('insert');
    expect(writes[0].payload).toMatchObject({ id: 'camp-brand-new', user_id: USER_A });
  });

  it('a campaign lookup failure is still a retryable 503 with nothing written', async () => {
    harness.failTable('campaign_versions');
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: 'camp-brand-new' } });
    expect(r.status).toBe(503);
    expect(writeCalls(['campaigns'])).toHaveLength(0);
  });
});
