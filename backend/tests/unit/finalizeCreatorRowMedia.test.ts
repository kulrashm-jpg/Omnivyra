/**
 * Phase 3B — external video URL workflow completion.
 *
 * finalizeCreatorRowMediaLifecycle drives a URL-attached video row through the
 * SAME lifecycle as an uploaded video, reusing the existing primitives. These
 * tests mock the three I/O primitives (validation, DB write, scheduler) and
 * exercise the REAL lifecycle state machine + governance registry.
 */

jest.mock('@/backend/services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(),
}));
jest.mock('@/backend/services/creator/creatorRowScheduler', () => ({
  autoScheduleReadyCreatorRowById: jest.fn(),
}));

// Capture DB writes through a chainable mock matching `.update(...).eq(...)`.
const updateEq = jest.fn(() => Promise.resolve({ error: null }));
type UpdateArgs = Parameters<ReturnType<typeof import('@/backend/db/writeOwner')['ownedDbTable']>['update']>;
const updateMock = jest.fn((..._a: UpdateArgs) => ({ eq: updateEq }));
jest.mock('@/backend/db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({ update: updateMock })),
}));

import { finalizeCreatorRowMediaLifecycle } from '@/backend/services/creator/finalizeCreatorRowMedia';
import { validateMediaUpload } from '@/backend/services/mediaUploadValidationService';
import { autoScheduleReadyCreatorRowById } from '@/backend/services/creator/creatorRowScheduler';

const mockValidate = validateMediaUpload as jest.Mock;
const mockSchedule = autoScheduleReadyCreatorRowById as jest.Mock;

const awaitingContent = { creator_lifecycle_state: 'awaiting_media_upload' };

beforeEach(() => {
  updateEq.mockClear();
  updateMock.mockClear();
  mockValidate.mockReset();
  mockSchedule.mockReset();
});

describe('Phase 3B — finalizeCreatorRowMediaLifecycle (URL ≡ upload)', () => {
  test('valid URL → media_uploaded → ready_for_schedule → autoSchedule → scheduled (#1-#5)', async () => {
    mockValidate.mockResolvedValue({
      valid: true,
      validated_at: '2026-06-15T00:00:00.000Z',
      details: { detected_mime: 'video/mp4', detected_size_bytes: 1234 },
    });
    mockSchedule.mockResolvedValue({ status: 'scheduled', scheduledPostId: 'sp-1' });

    const result = await finalizeCreatorRowMediaLifecycle({
      rowId: 'dp-1',
      content: { ...awaitingContent },
      contentType: 'video',
      mediaUrl: 'https://youtube.com/watch?v=abc',
      source: 'external_link',
    });

    // #2 validation applied with the URL
    expect(mockValidate).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: 'https://youtube.com/watch?v=abc', contentType: 'video' }));
    // #3 lifecycle persisted as ready_for_schedule with upload_validation set
    expect(updateMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse((updateMock.mock.calls[0][0] as any).content);
    expect(written.creator_lifecycle_state).toBe('ready_for_schedule');
    expect(written.upload_validation).toBeTruthy();
    expect(written.uploaded_media_url).toBe('https://youtube.com/watch?v=abc');
    expect(written.upload_source).toBe('external_link');
    // #4 auto-schedule invoked for THIS row
    expect(mockSchedule).toHaveBeenCalledWith('dp-1');
    // #5 scheduled state achieved
    expect(result.ok).toBe(true);
    expect(result.scheduled).toBe(true);
    expect(result.to).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-1');
  });

  test('validation failure → upload_failed, NO scheduling', async () => {
    mockValidate.mockResolvedValue({
      valid: false,
      validated_at: '2026-06-15T00:00:00.000Z',
      errors: ['media_url is not reachable'],
    });

    const result = await finalizeCreatorRowMediaLifecycle({
      rowId: 'dp-2',
      content: { ...awaitingContent },
      contentType: 'video',
      mediaUrl: 'https://broken.example/x',
    });

    expect(result.ok).toBe(false);
    expect(result.validationValid).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
    const written = JSON.parse((updateMock.mock.calls[0][0] as any).content);
    expect(written.creator_lifecycle_state).toBe('upload_failed');
  });

  test('ready_for_schedule reflects when scheduler defers (not scheduled now)', async () => {
    mockValidate.mockResolvedValue({ valid: true, validated_at: 't', details: {} });
    mockSchedule.mockResolvedValue({ status: 'skipped', scheduledPostId: null });

    const result = await finalizeCreatorRowMediaLifecycle({
      rowId: 'dp-3',
      content: { ...awaitingContent },
      contentType: 'reel',
      mediaUrl: 'https://cdn/x.mp4',
    });

    expect(result.ok).toBe(true);
    expect(result.scheduled).toBe(false);
    expect(result.to).toBe('ready_for_schedule');
    expect(mockSchedule).toHaveBeenCalledWith('dp-3');
  });

  test('non-attachment content type → no-op (no validate, no schedule)', async () => {
    const result = await finalizeCreatorRowMediaLifecycle({
      rowId: 'dp-4',
      content: {},
      contentType: 'image',
      mediaUrl: 'https://cdn/x.png',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_attachment_required');
    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('missing media url → no-op', async () => {
    const result = await finalizeCreatorRowMediaLifecycle({
      rowId: 'dp-5',
      content: { ...awaitingContent },
      contentType: 'video',
      mediaUrl: '',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_media_url');
    expect(mockValidate).not.toHaveBeenCalled();
  });
});
