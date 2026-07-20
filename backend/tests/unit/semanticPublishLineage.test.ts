/**
 * WS-1b (OMNIVYRA-PMO-001 · PMO-ADR-06) — PUBLISH → LINEAGE linkage tests.
 *
 * Proves the publish path (approvalService, A1 zone) reads the generation-time
 * Semantic Root soft-ref from `content.source_metadata.semanticRootId` and carries
 * it into the ONE certified lineage store (publicationLineageService.recordEvent)
 * — completing generation→publish lineage with NO second store, and NEVER
 * fabricating a root when one is absent.
 */

jest.mock('../../services/content/contentService', () => ({
  getContent: jest.fn(),
  setLifecycleStatus: jest.fn(),
}));
jest.mock('../../services/content/publicationLineageService', () => ({
  recordEvent: jest.fn(),
}));
jest.mock('../../services/content/learningEngine', () => ({
  recordLearningEvent: jest.fn(),
}));
jest.mock('../../observability/qualityMetrics', () => ({
  recordApprovalLatency: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  },
}));

import { advanceApproval } from '../../services/content/approvalService';
import { getContent, setLifecycleStatus } from '../../services/content/contentService';
import { recordEvent } from '../../services/content/publicationLineageService';
import { recordLearningEvent } from '../../services/content/learningEngine';

const mGetContent = getContent as jest.MockedFunction<typeof getContent>;
const mSetLifecycle = setLifecycleStatus as jest.MockedFunction<typeof setLifecycleStatus>;
const mRecordEvent = recordEvent as jest.MockedFunction<typeof recordEvent>;
const mRecordLearning = recordLearningEvent as jest.MockedFunction<typeof recordLearningEvent>;

const VALID_ROOT_ID = 'sroot_0123456789abcdef01234567';
const COMPANY = 'co-1';
const CONTENT = 'content-1';

function content(sourceMetadata: Record<string, unknown> | null) {
  return {
    id: CONTENT,
    companyId: COMPANY,
    contentType: 'post',
    lifecycleStatus: 'approved',
    title: 't',
    body: 'b',
    topic: 't',
    objective: null,
    audience: null,
    tone: null,
    brief: null,
    sourceMetadata,
    sourceRef: null,
    currentRevision: 1,
    createdBy: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    archivedAt: null,
  } as unknown as Awaited<ReturnType<typeof getContent>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mRecordEvent.mockResolvedValue(null);
  mRecordLearning.mockResolvedValue(undefined as never);
});

afterEach(() => {
  delete process.env.SEMANTIC_ROOT_ENABLED;
});

describe('publish → lineage carries the Semantic Root soft-ref', () => {
  it('reads source_metadata.semanticRootId and passes it into recordEvent', async () => {
    mGetContent.mockResolvedValue(content({ semanticRootId: VALID_ROOT_ID }));
    mSetLifecycle.mockResolvedValue(
      content({ semanticRootId: VALID_ROOT_ID }) as never,
    );
    // setLifecycleStatus returns the row with lifecycleStatus 'published'.
    mSetLifecycle.mockResolvedValue({
      ...(content({ semanticRootId: VALID_ROOT_ID }) as object),
      lifecycleStatus: 'published',
    } as never);

    const res = await advanceApproval({ companyId: COMPANY, contentId: CONTENT, toStatus: 'published' });

    expect(res.ok).toBe(true);
    expect(mRecordEvent).toHaveBeenCalledTimes(1);
    expect(mRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        contentId: CONTENT,
        eventType: 'published',
        semanticRootId: VALID_ROOT_ID,
      }),
    );
  });

  it('does NOT fabricate a root when source_metadata has none (flag ON = observable gap, no mint)', async () => {
    process.env.SEMANTIC_ROOT_ENABLED = '1';
    mGetContent.mockResolvedValue(content({}));
    mSetLifecycle.mockResolvedValue({
      ...(content({}) as object),
      lifecycleStatus: 'published',
    } as never);

    const res = await advanceApproval({ companyId: COMPANY, contentId: CONTENT, toStatus: 'published' });

    expect(res.ok).toBe(true);
    expect(mRecordEvent).toHaveBeenCalledTimes(1);
    const arg = mRecordEvent.mock.calls[0][0];
    expect(arg.eventType).toBe('published');
    // No fabricated id — the field is simply absent (recordEvent leaves metadata unchanged).
    expect(arg.semanticRootId).toBeUndefined();
  });

  it('ignores a malformed (non-canonical) semanticRootId rather than passing it through', async () => {
    mGetContent.mockResolvedValue(content({ semanticRootId: 'not-a-real-root' }));
    mSetLifecycle.mockResolvedValue({
      ...(content({ semanticRootId: 'not-a-real-root' }) as object),
      lifecycleStatus: 'published',
    } as never);

    const res = await advanceApproval({ companyId: COMPANY, contentId: CONTENT, toStatus: 'published' });

    expect(res.ok).toBe(true);
    const arg = mRecordEvent.mock.calls[0][0];
    expect(arg.semanticRootId).toBeUndefined();
  });

  it('a non-publish transition records NO lineage event (unchanged behavior)', async () => {
    mGetContent.mockResolvedValue(content({ semanticRootId: VALID_ROOT_ID }));
    mSetLifecycle.mockResolvedValue({
      ...(content({ semanticRootId: VALID_ROOT_ID }) as object),
      lifecycleStatus: 'approved',
    } as never);

    // approved → (already approved is a no-op) use draft→approved instead.
    mGetContent.mockResolvedValue({
      ...(content({ semanticRootId: VALID_ROOT_ID }) as object),
      lifecycleStatus: 'draft',
    } as never);

    const res = await advanceApproval({ companyId: COMPANY, contentId: CONTENT, toStatus: 'approved' });
    expect(res.ok).toBe(true);
    expect(mRecordEvent).not.toHaveBeenCalled();
  });
});
