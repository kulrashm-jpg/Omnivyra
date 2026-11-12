// Worker snapshot-refresh: re-resolve refs via the shared path, refresh the row.
const mockUpdate = jest.fn().mockResolvedValue({ error: null });
const mockEq = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({ update: (v: unknown) => { mockUpdate(v); return { eq: (...a: unknown[]) => mockEq(...a) }; } })),
}));
jest.mock('../../db/queries', () => ({
  getScheduledPost: jest.fn(),
  updateScheduledPostOnPublish: jest.fn(),
  updateScheduledPostOnFailure: jest.fn(),
}));
const mockResolve = jest.fn();
jest.mock('../../services/creator/creatorPublishResolution', () => ({ resolvePublishMedia: (...a: unknown[]) => mockResolve(...a) }));
// The org resolver is mocked explicitly (unread-error pkg 2): this suite used to pass only because the
// real resolver SWALLOWED its failed network read into null; it now throws a named read error.
const mockResolveOrg = jest.fn(async (..._a: unknown[]) => 'org-1' as string | null);
jest.mock('../../services/creator/publishingOrganizationResolver', () => ({
  ...jest.requireActual('../../services/creator/publishingOrganizationResolver'),
  resolvePublishingOrganization: (...a: unknown[]) => mockResolveOrg(...a),
}));
// Heavy transitive imports in publishNowService are irrelevant here; stub the riskiest.
jest.mock('../../adapters/platformAdapter', () => ({ publishToPlatform: jest.fn() }));

import { refreshScheduledPostMediaFromRefs } from '../../services/publishNowService';

beforeEach(() => {
  mockUpdate.mockClear(); mockEq.mockClear(); mockResolve.mockReset();
  mockResolveOrg.mockReset(); mockResolveOrg.mockResolvedValue('org-1');
});

describe('Worker media snapshot refresh (shared resolution path)', () => {
  const post = (media: string[]) => ({ id: 'sp1', user_id: 'u', platform: 'linkedin', media_urls: media, creator_attachment_metadata: [{ id: 'a1' }] });

  it('refreshes the snapshot when resolution succeeds with NEW media', async () => {
    mockResolve.mockResolvedValue({ mediaUrls: ['fresh.png'], resolvedCount: 1, totalRefs: 1, usedFallback: false });
    const p = post(['stale.png']);
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: p });
    expect(mockUpdate).toHaveBeenCalledWith({ media_urls: ['fresh.png'] }); // snapshot refreshed
    expect(p.media_urls).toEqual(['fresh.png']);                            // in-memory row updated
  });

  it('does NOT write when resolved media is unchanged (deterministic, no churn)', async () => {
    mockResolve.mockResolvedValue({ mediaUrls: ['same.png'], resolvedCount: 1, totalRefs: 1, usedFallback: false });
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: post(['same.png']) });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps the snapshot (fallback) when resolution fails — no regression', async () => {
    mockResolve.mockResolvedValue({ mediaUrls: ['stale.png'], resolvedCount: 0, totalRefs: 1, usedFallback: true });
    const p = post(['stale.png']);
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: p });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(p.media_urls).toEqual(['stale.png']);
  });

  it('fail-open: a refresh error never blocks publish', async () => {
    mockResolve.mockRejectedValue(new Error('boom'));
    await expect(refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: post(['x.png']) })).resolves.toBeUndefined();
  });

  it('an UNREADABLE organization skips the refresh (fail-open), never resolves media under company ""', async () => {
    const { PublishingOrgReadError } = jest.requireActual('../../services/creator/publishingOrganizationResolver');
    mockResolveOrg.mockRejectedValueOnce(new PublishingOrgReadError('scheduled_posts', { message: 'boom' }));
    mockResolve.mockResolvedValue({ mediaUrls: ['fresh.png'], resolvedCount: 1, totalRefs: 1, usedFallback: false });
    const p = post(['stale.png']);
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: p });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(p.media_urls).toEqual(['stale.png']);
  });

  it('CONTROL: the resolved organization is what media resolution receives', async () => {
    mockResolve.mockResolvedValue({ mediaUrls: ['same.png'], resolvedCount: 1, totalRefs: 1, usedFallback: false });
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: 'sp1', userId: 'u', post: post(['same.png']) });
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'org-1' }));
  });
});
