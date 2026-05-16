import {
  applyTransition,
  canTransition,
  assertTransition,
  readLifecycleState,
  readLifecycleRevision,
  CreatorLifecycleTransitionError,
  CreatorConcurrencyConflictError,
  LIFECYCLE_STATES,
} from '../../../lib/shared/creatorLifecycleStateMachine';

describe('creator lifecycle state machine', () => {
  test('first transition from null is allowed', () => {
    expect(canTransition(null, 'awaiting_media_upload')).toBe(true);
    expect(canTransition(undefined, 'awaiting_media_upload')).toBe(true);
  });

  test('awaiting_media_upload → media_uploaded → ready_for_schedule → scheduled is allowed', () => {
    expect(canTransition('awaiting_media_upload', 'media_uploaded')).toBe(true);
    expect(canTransition('media_uploaded', 'ready_for_schedule')).toBe(true);
    expect(canTransition('ready_for_schedule', 'scheduled')).toBe(true);
  });

  test('upload_failed permits retry to media_uploaded and stays in upload_failed on repeated failure', () => {
    expect(canTransition('awaiting_media_upload', 'upload_failed')).toBe(true);
    expect(canTransition('upload_failed', 'media_uploaded')).toBe(true);
    expect(canTransition('upload_failed', 'upload_failed')).toBe(true);
  });

  test('re-upload from media_uploaded / ready_for_schedule is allowed', () => {
    expect(canTransition('media_uploaded', 'media_uploaded')).toBe(true);
    expect(canTransition('ready_for_schedule', 'media_uploaded')).toBe(true);
    expect(canTransition('ready_for_schedule', 'upload_failed')).toBe(true);
  });

  test('scheduled allows reschedule + replace-media + publish-fail transitions (no longer terminal)', () => {
    expect(canTransition('scheduled', 'media_uploaded')).toBe(true);
    expect(canTransition('scheduled', 'ready_for_schedule')).toBe(true);
    expect(canTransition('scheduled', 'upload_failed')).toBe(true);
    // But scheduled → scheduled is still disallowed (no self-loop on terminal-ish state)
    expect(canTransition('scheduled', 'scheduled')).toBe(false);
  });

  test('illegal transitions throw with code and from/to fields', () => {
    expect(() => assertTransition('awaiting_media_upload', 'scheduled')).toThrow(CreatorLifecycleTransitionError);
    try {
      assertTransition('awaiting_media_upload', 'scheduled');
    } catch (e) {
      const err = e as CreatorLifecycleTransitionError;
      expect(err.code).toBe('CREATOR_LIFECYCLE_TRANSITION_INVALID');
      expect(err.from).toBe('awaiting_media_upload');
      expect(err.to).toBe('scheduled');
      expect(err.statusCode).toBe(409);
    }
  });

  test('readLifecycleState prefers creator_lifecycle_state then falls back to content_status', () => {
    expect(readLifecycleState({ creator_lifecycle_state: 'media_uploaded' })).toBe('media_uploaded');
    expect(readLifecycleState({ content_status: 'ready_for_schedule' })).toBe('ready_for_schedule');
    // legacy guidance_ready maps to awaiting_media_upload
    expect(readLifecycleState({ content_status: 'guidance_ready' })).toBe('awaiting_media_upload');
    expect(readLifecycleState(null)).toBe(null);
    expect(readLifecycleState({})).toBe(null);
  });

  test('applyTransition mirrors creator_lifecycle_state + content_status, appends history with reason', () => {
    const result = applyTransition(
      { creator_lifecycle_state: 'awaiting_media_upload', content_status: 'awaiting_media_upload', topic: 'demo' },
      'media_uploaded',
      { reason: 'validation_passed', contentPatch: { uploaded_media_url: 'https://x.test/1.mp4' } },
    );
    expect(result.from).toBe('awaiting_media_upload');
    expect(result.to).toBe('media_uploaded');
    expect(result.contentStatus).toBe('media_uploaded');
    expect(result.content.creator_lifecycle_state).toBe('media_uploaded');
    expect(result.content.content_status).toBe('media_uploaded');
    expect(result.content.uploaded_media_url).toBe('https://x.test/1.mp4');
    expect(result.content.topic).toBe('demo');
    const history = result.content.creator_lifecycle_history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0].from).toBe('awaiting_media_upload');
    expect(history[0].to).toBe('media_uploaded');
    expect(history[0].reason).toBe('validation_passed');
  });

  test('applyTransition history caps at 24 entries', () => {
    let content: Record<string, unknown> = {};
    // First entry: null → awaiting_media_upload (legal initial entry)
    content = applyTransition(content, 'awaiting_media_upload').content;
    // Then alternate media_uploaded ↔ upload_failed for 30 cycles
    for (let i = 0; i < 30; i++) {
      content = applyTransition(content, i % 2 === 0 ? 'media_uploaded' : 'upload_failed').content;
    }
    expect((content.creator_lifecycle_history as unknown[]).length).toBe(24);
  });

  test('LIFECYCLE_STATES exports cover the lifecycle vocabulary', () => {
    expect(LIFECYCLE_STATES.AWAITING_MEDIA_UPLOAD).toBe('awaiting_media_upload');
    expect(LIFECYCLE_STATES.UPLOAD_FAILED).toBe('upload_failed');
    expect(LIFECYCLE_STATES.READY_FOR_SCHEDULE).toBe('ready_for_schedule');
  });

  test('readLifecycleRevision counts history entries', () => {
    expect(readLifecycleRevision(null)).toBe(0);
    expect(readLifecycleRevision({})).toBe(0);
    expect(readLifecycleRevision({ creator_lifecycle_history: [] })).toBe(0);
    expect(readLifecycleRevision({ creator_lifecycle_history: [{ to: 'awaiting_media_upload' }] })).toBe(1);
    expect(readLifecycleRevision({ creator_lifecycle_history: [1, 2, 3, 4] })).toBe(4);
  });

  test('expectedRevision matches actual → transition succeeds', () => {
    const content = applyTransition({}, 'awaiting_media_upload').content;
    // After one transition the row's revision is 1.
    expect(readLifecycleRevision(content)).toBe(1);
    const next = applyTransition(content, 'media_uploaded', { expectedRevision: 1 });
    expect(next.to).toBe('media_uploaded');
    expect(readLifecycleRevision(next.content)).toBe(2);
  });

  test('expectedRevision mismatch throws CreatorConcurrencyConflictError with 409 + actual', () => {
    let content: Record<string, unknown> = applyTransition({}, 'awaiting_media_upload').content;
    content = applyTransition(content, 'media_uploaded').content; // revision now 2
    expect(() => applyTransition(content, 'ready_for_schedule', { expectedRevision: 1 })).toThrow(CreatorConcurrencyConflictError);
    try {
      applyTransition(content, 'ready_for_schedule', { expectedRevision: 1 });
    } catch (e) {
      const err = e as CreatorConcurrencyConflictError;
      expect(err.code).toBe('CONCURRENT_UPLOAD_CONFLICT');
      expect(err.statusCode).toBe(409);
      expect(err.expected).toBe(1);
      expect(err.actual).toBe(2);
    }
  });

  test('reschedule flow: scheduled → media_uploaded → ready_for_schedule → scheduled is legal', () => {
    let content: Record<string, unknown> = applyTransition({}, 'awaiting_media_upload').content;
    content = applyTransition(content, 'media_uploaded').content;
    content = applyTransition(content, 'ready_for_schedule').content;
    content = applyTransition(content, 'scheduled').content;
    // Now reschedule + replace media
    content = applyTransition(content, 'media_uploaded', { reason: 'reschedule_replace_media' }).content;
    content = applyTransition(content, 'ready_for_schedule', { reason: 'auto_transition_after_reschedule_replace_media' }).content;
    const final = applyTransition(content, 'scheduled', { reason: 'reschedule_replace_media_and_retime' });
    expect(final.to).toBe('scheduled');
    // History contains the reschedule reason
    const history = (final.content.creator_lifecycle_history as Array<Record<string, unknown>>);
    const reasons = history.map((h) => h.reason).filter(Boolean);
    expect(reasons).toContain('reschedule_replace_media');
    expect(reasons).toContain('auto_transition_after_reschedule_replace_media');
    expect(reasons).toContain('reschedule_replace_media_and_retime');
  });

  test('publish-time validation failure: scheduled → upload_failed is legal', () => {
    let content: Record<string, unknown> = applyTransition({}, 'awaiting_media_upload').content;
    content = applyTransition(content, 'media_uploaded').content;
    content = applyTransition(content, 'ready_for_schedule').content;
    content = applyTransition(content, 'scheduled').content;
    const failed = applyTransition(content, 'upload_failed', {
      contentPatch: { publish_validation_error: 'URL dead' },
      reason: 'publish_validation_failed',
    });
    expect(failed.to).toBe('upload_failed');
    const lastHistoryEntry = (failed.content.creator_lifecycle_history as Array<Record<string, unknown>>).slice(-1)[0];
    expect(lastHistoryEntry.reason).toBe('publish_validation_failed');
  });
});
