/**
 * Ingestion must not turn a failed tenant lookup into "belongs to nobody".
 *
 * THE DEFECT
 * ----------
 * `ingestComments` resolved the owning company, then handed the answer to the
 * unified engagement sync:
 *
 *     const { data: role } = await ownedDbTable('user_company_roles')...
 *     organizationId = role?.company_id ? String(role.company_id) : null;
 *
 * The `error` half of the Supabase result was discarded. A database failure
 * therefore produced exactly the same value as a user who genuinely belongs to
 * no company — `null` — and the engagement was persisted with no tenant.
 *
 * WHY THAT IS NOT A COSMETIC PROBLEM
 * ----------------------------------
 * `resolveThread` keys threads on (platform, platform_thread_id,
 * organization_id) and matches a null organization with `IS NULL`. So the
 * unscoped write is not a placeholder that later repairs itself:
 *
 *   - every failing cycle REUSES the same orphan thread;
 *   - the next successful cycle resolves a real company, matches nothing, and
 *     creates a SECOND thread beside the orphan;
 *   - the messages written during the failure stay in the orphan permanently —
 *     no tenant-scoped reader selects them (`.eq('organization_id', ...)`) and
 *     no engagement worker selects them (`.not('organization_id','is',null)`).
 *
 * `backend/scripts/engagementPhase1Validation.js` counts exactly these rows and
 * reports "ORGANIZATION_ID NOT POPULATED: ingestion mapping may be broken".
 *
 * WHAT THESE TESTS PIN
 * --------------------
 * Three distinguishable states, not two:
 *   resolved      → attributed and synced;
 *   unowned       → every authority answered and none claims the post;
 *   lookup_failed → an authority could not answer, so nothing is written.
 *
 * Section D grounds the whole decision by driving the REAL `resolveThread`:
 * it demonstrates that a null organization really does create an unscoped
 * thread, rather than asserting it.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const mockResolveCampaignCompanyId = jest.fn();
const mockSyncFromPostComments = jest.fn();
const mockGetToken = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockAdapterFetch = jest.fn();
const mockEvaluatePostEngagement = jest.fn();

/** What the `user_company_roles` lookup returns, per test. */
let roleLookupResult: { data: unknown; error?: { message: string } | null } = { data: null };

/** Every row handed to `post_comments.upsert` — the canonical persistence. */
let postCommentUpserts: Record<string, unknown>[][] = [];

/** Fake `engagement_threads` table, used only by section D. */
let threadRows: Record<string, unknown>[] = [];

// ── Fake DB ──────────────────────────────────────────────────────────────────
// Per-table builders rather than a generic chainable, so each shape asserts
// that the service issued the query the service is documented to issue.
function fakeTable(table: string): any {
  if (table === 'post_comments') {
    return {
      upsert: async (rows: Record<string, unknown>[]) => {
        postCommentUpserts.push(rows);
        return { data: rows, error: null };
      },
      select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
    };
  }

  if (table === 'user_company_roles') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => roleLookupResult,
            }),
          }),
        }),
      }),
    };
  }

  if (table === 'engagement_threads') {
    // Only what resolveThread uses: filtered read, then insert.
    const filters: Array<[string, unknown]> = [];
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      is: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        const hit = threadRows.find((r) => filters.every(([c, v]) => r[c] === v));
        return { data: hit ?? null, error: null };
      },
      insert: (row: Record<string, unknown>) => {
        const created = { id: `thread-${threadRows.length + 1}`, ...row };
        threadRows.push(created);
        return { select: () => ({ single: async () => ({ data: created, error: null }) }) };
      },
    };
    return builder;
  }

  throw new Error(`unexpected table in ingestion path: ${table}`);
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeTable(t) } }));
jest.mock('../../services/campaignAccessService', () => ({
  resolveCampaignCompanyId: (...a: any[]) => mockResolveCampaignCompanyId(...a),
}));
jest.mock('../../services/engagementNormalizationService', () => ({
  syncFromPostComments: (...a: any[]) => mockSyncFromPostComments(...a),
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: jest.fn() }));
jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a) }));
jest.mock('../../services/platformAdapters', () => ({
  getPlatformAdapter: () => ({ fetchComments: (...a: any[]) => mockAdapterFetch(...a) }),
}));
jest.mock('../../services/platformRegistryService', () => ({ getPlatformCategory: () => 'social' }));
jest.mock('../../services/engagementEvaluationService', () => ({
  evaluatePostEngagement: (...a: any[]) => mockEvaluatePostEngagement(...a),
}));
jest.mock('../../services/creator/strategyAnalyticsRuntime', () => ({
  recordCommentStrategyEvents: jest.fn().mockResolvedValue(undefined),
}));
// Pulled in only by the REAL normalization module that section D loads.
jest.mock('../../services/systemHealthMetricsService', () => ({ recordMetric: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../queue/bullmqClient', () => ({ getConversationMemoryRebuildQueue: () => null }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: jest.fn().mockResolvedValue(undefined) }));

let ingestComments: typeof import('../../services/engagementIngestionService').ingestComments;

beforeAll(async () => {
  ({ ingestComments } = await import('../../services/engagementIngestionService'));
});

/** One comment, so the attribution branch actually runs. */
const ONE_COMMENT = {
  data: [{ id: 'c1', text: 'hello', author_id: 'a1', created_at: '2026-01-01T00:00:00Z' }],
};

const POST = {
  id: 'p1',
  platform: 'x',
  platform_post_id: 't1',
  social_account_id: 'acct-1',
  campaign_id: 'camp-1',
  user_id: 'user-1',
};

/** organization_id actually handed to the unified persistence layer. */
const syncedOrgIds = () => mockSyncFromPostComments.mock.calls.map((c) => c[1].organization_id);

let errorLogs: unknown[][] = [];

beforeEach(() => {
  postCommentUpserts = [];
  threadRows = [];
  errorLogs = [];
  roleLookupResult = { data: null };
  mockGetScheduledPost.mockResolvedValue({ ...POST });
  mockGetToken.mockResolvedValue({ access_token: 'tok', refresh_token: 'r', is_active: true });
  mockAdapterFetch.mockResolvedValue(ONE_COMMENT);
  mockResolveCampaignCompanyId.mockResolvedValue('co-1');
  mockSyncFromPostComments.mockResolvedValue({ synced: 1, errors: 0 });
  mockEvaluatePostEngagement.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errorLogs.push(a); });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A — a resolved tenant is persisted normally', () => {
  it('CRITICAL: the resolved company is what engagement is attributed to', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue('co-77');

    const r = await ingestComments('p1');

    expect(r).toEqual({ success: true, ingested: 1 });
    expect(mockSyncFromPostComments).toHaveBeenCalledTimes(1);
    expect(syncedOrgIds()).toEqual(['co-77']);
  });

  it('the user-role fallback resolves when the campaign has no owner', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    roleLookupResult = { data: { company_id: 'co-fallback' }, error: null };

    await ingestComments('p1');

    expect(syncedOrgIds()).toEqual(['co-fallback']);
  });

  it('the canonical post_comments write happens on the resolved path', async () => {
    await ingestComments('p1');
    expect(postCommentUpserts).toHaveLength(1);
    expect(postCommentUpserts[0][0]).toMatchObject({ platform_comment_id: 'c1', scheduled_post_id: 'p1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B — a database lookup error never becomes "belongs to nobody"', () => {
  const withRoleLookupError = () => {
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    roleLookupResult = { data: null, error: { message: 'canceling statement due to statement timeout' } };
  };

  it('CRITICAL: NOTHING is persisted to the unified model', async () => {
    withRoleLookupError();

    await ingestComments('p1');

    // The mutation "allow unscoped persistence" makes this call happen.
    expect(mockSyncFromPostComments).not.toHaveBeenCalled();
  });

  it('CRITICAL: no unscoped organization_id is written', async () => {
    withRoleLookupError();

    await ingestComments('p1');

    // The mutation "restore the null fallback on error" puts null in this list.
    expect(syncedOrgIds()).not.toContain(null);
    expect(syncedOrgIds()).toEqual([]);
  });

  it('CRITICAL: the failure is reported, not swallowed', async () => {
    withRoleLookupError();

    await ingestComments('p1');

    const line = errorLogs.find((a) => String(a[0]).includes('tenant attribution failed'));
    expect(line).toBeDefined();
    expect(line?.[1]).toMatchObject({ scheduled_post_id: 'p1', platform: 'x' });
    // The DB's own reason survives — the original code discarded it entirely.
    expect(JSON.stringify(line?.[1])).toContain('statement timeout');
  });

  it('the canonical post_comments rows ARE still kept, so nothing is lost', async () => {
    withRoleLookupError();

    const r = await ingestComments('p1');

    // post_comments is keyed by scheduled_post_id, not by tenant, so declining
    // to attribute costs nothing: the next cycle re-reads and syncs these.
    expect(postCommentUpserts).toHaveLength(1);
    expect(r.success).toBe(true);
  });

  it('a resolved campaign short-circuits before the failing lookup is ever reached', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue('co-1');
    roleLookupResult = { data: null, error: { message: 'boom' } };

    await ingestComments('p1');

    // An unrelated failure downstream of a good answer must not block ingestion.
    expect(syncedOrgIds()).toEqual(['co-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — a genuinely unowned post is distinguishable from a broken lookup', () => {
  const genuinelyUnowned = () => {
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    roleLookupResult = { data: null, error: null };
  };

  it('CRITICAL: it is NOT reported as an attribution failure', async () => {
    genuinelyUnowned();

    await ingestComments('p1');

    // The two states were previously identical. This is the whole fix.
    expect(errorLogs.find((a) => String(a[0]).includes('tenant attribution failed'))).toBeUndefined();
  });

  it('CRITICAL: no company is invented for it', async () => {
    genuinelyUnowned();

    await ingestComments('p1');

    expect(syncedOrgIds()).not.toContain('co-1');
    expect(syncedOrgIds().filter(Boolean)).toEqual([]);
  });

  it('is announced rather than left for the validation script to find later', async () => {
    genuinelyUnowned();
    const warnings: unknown[][] = [];
    (console.warn as jest.Mock).mockImplementation((...a: unknown[]) => { warnings.push(a); });

    await ingestComments('p1');

    expect(warnings.some((a) => String(a[0]).includes('no owning company'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D — grounding: a null organization really does write an unscoped thread', () => {
  // Drives the REAL resolveThread. This is the observed behaviour that makes
  // failing closed on a lookup error the correct choice rather than a taste.
  const realNormalization = () =>
    jest.requireActual('../../services/engagementNormalizationService') as
      typeof import('../../services/engagementNormalizationService');

  it('CRITICAL: organization_id null produces a thread with NO tenant', async () => {
    const { resolveThread } = realNormalization();

    const id = await resolveThread({
      platform: 'x',
      platform_thread_id: 't1',
      source_id: null,
      organization_id: null,
    });

    expect(id).toBeTruthy();
    expect(threadRows).toHaveLength(1);
    expect(threadRows[0].organization_id).toBeNull();
  });

  it('CRITICAL: the orphan is reused by later null-org calls and never repaired', async () => {
    const { resolveThread } = realNormalization();

    const first = await resolveThread({ platform: 'x', platform_thread_id: 't1', source_id: null, organization_id: null });
    const second = await resolveThread({ platform: 'x', platform_thread_id: 't1', source_id: null, organization_id: null });
    expect(second).toBe(first);
    expect(threadRows).toHaveLength(1);

    // A later cycle that DOES resolve the company matches nothing and creates a
    // second thread — the orphan's messages are stranded for good.
    const scoped = await resolveThread({ platform: 'x', platform_thread_id: 't1', source_id: null, organization_id: 'co-1' });
    expect(scoped).not.toBe(first);
    expect(threadRows).toHaveLength(2);
    expect(threadRows.filter((r) => r.organization_id === null)).toHaveLength(1);
  });
});
