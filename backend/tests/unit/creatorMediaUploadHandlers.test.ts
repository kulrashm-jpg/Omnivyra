/**
 * Phase 3A — video upload journey wiring (UI handlers).
 *
 * Proves the gating + endpoint contract that the live ActivityWorkspaceBriefSection
 * now relies on:
 *   - extractAttachmentRowState returns state ONLY for attachment-required
 *     rows (video/reel/short/podcast) → upload UI appears only for those;
 *     text/image/carousel/autonomous rows get null → unchanged (no upload UI).
 *   - lifecycle state is parsed for display (awaiting_media_upload …→ scheduled).
 *   - postUploadMedia hits the EXISTING /upload-media endpoint and surfaces the
 *     server-reported lifecycle (which reflects backend auto-scheduling).
 */

import {
  extractAttachmentRowState,
  postUploadMedia,
} from '../../../components/activity-workspace/creatorMediaUploadHandlers';

describe('Phase 3A — extractAttachmentRowState gating (mandatory #1, #5)', () => {
  test('video row → returns attachment state (upload UI enabled)', () => {
    const s = extractAttachmentRowState({
      dailyRaw: { id: 'dp-1', content: { creator_lifecycle_state: 'awaiting_media_upload' } },
      contentType: 'video',
    });
    expect(s).not.toBeNull();
    expect(s!.dailyPlanId).toBe('dp-1');
    expect(s!.contentType).toBe('video');
    expect(s!.lifecycle).toBe('awaiting_media_upload');
  });

  test('reel and short → attachment state', () => {
    expect(extractAttachmentRowState({ dailyRaw: { id: 'r' }, contentType: 'reel' })).not.toBeNull();
    expect(extractAttachmentRowState({ dailyRaw: { id: 's' }, contentType: 'short' })).not.toBeNull();
  });

  test('NON-VIDEO rows → null (no upload UI, unchanged)', () => {
    for (const ct of ['post', 'article', 'tweet', 'poll', 'image', 'carousel', 'infographic']) {
      expect(extractAttachmentRowState({ dailyRaw: { id: 'x' }, contentType: ct })).toBeNull();
    }
  });

  test('missing daily plan id → null (cannot upload without a row)', () => {
    expect(extractAttachmentRowState({ dailyRaw: {}, contentType: 'video' })).toBeNull();
  });
});

describe('Phase 3A — lifecycle state visibility (mandatory #3, #4)', () => {
  test('parses lifecycle from content.creator_lifecycle_state', () => {
    const s = extractAttachmentRowState({
      dailyRaw: { id: 'dp', content: { creator_lifecycle_state: 'ready_for_schedule', uploaded_media_url: 'https://x/v.mp4' } },
      contentType: 'video',
    });
    expect(s!.lifecycle).toBe('ready_for_schedule');
    expect(s!.uploadedMediaUrl).toBe('https://x/v.mp4');
  });

  test('falls back to content_status when lifecycle field absent', () => {
    const s = extractAttachmentRowState({
      dailyRaw: { id: 'dp', content_status: 'media_uploaded', content: {} },
      contentType: 'video',
    });
    expect(s!.lifecycle).toBe('media_uploaded');
  });

  test('scheduled state is surfaced (auto-schedule reflected)', () => {
    const s = extractAttachmentRowState({
      dailyRaw: { id: 'dp', content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: 'sp-9' } },
      contentType: 'video',
    });
    expect(s!.lifecycle).toBe('scheduled');
    expect(s!.scheduledPostId).toBe('sp-9');
  });

  test('content stored as JSON string is parsed', () => {
    const s = extractAttachmentRowState({
      dailyRaw: { id: 'dp', content: JSON.stringify({ creator_lifecycle_state: 'ready_for_schedule' }) },
      contentType: 'video',
    });
    expect(s!.lifecycle).toBe('ready_for_schedule');
  });
});

describe('Phase 3A — postUploadMedia endpoint contract (mandatory #2, #4)', () => {
  const realFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  test('POSTs to the existing /upload-media endpoint with media_url + source', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ to: 'scheduled', uploaded_media_url: 'https://cdn/v.mp4' }),
    });
    (global as any).fetch = fetchMock;

    const result = await postUploadMedia({
      dailyPlanId: 'dp-77',
      mediaUrl: 'https://cdn/v.mp4',
      source: 'external_link',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/activity-workspace/dp-77/upload-media');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.media_url).toBe('https://cdn/v.mp4');
    expect(body.source).toBe('external_link');
    // Server-reported lifecycle (reflects backend auto-schedule) surfaced to UI.
    expect(result.ok).toBe(true);
    expect(result.lifecycle).toBe('scheduled');
  });

  test('validation failure (success:false) → ok:false with message', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, to: 'upload_failed', message: 'Invalid media' }),
    });
    const result = await postUploadMedia({ dailyPlanId: 'dp', mediaUrl: 'x', source: 'user_upload' });
    expect(result.ok).toBe(false);
    expect(result.lifecycle).toBe('upload_failed');
    expect(result.message).toBe('Invalid media');
  });

  test('409 concurrent edit → conflict result', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'CONCURRENT_UPLOAD_CONFLICT', error: 'Concurrent edit detected' }),
    });
    const result = await postUploadMedia({ dailyPlanId: 'dp', mediaUrl: 'x', source: 'user_upload' });
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
  });
});
