/**
 * Coverage for the creator calendar STATUS LABEL mapper
 * (lib/shared/creatorStatusLabel.ts) — the visibility-only standardizer
 * that the calendar tiles + the post-preview drawer consume.
 *
 * Two guarantees this protects:
 *  1. AI-generated assets (image/carousel/infographic) never read as
 *     "Waiting For Video" and never count as creator-produced; they move
 *     GENERATING → SCHEDULED → PUBLISHED.
 *  2. Creator-produced assets (video/reel/short) read WAITING_FOR_VIDEO
 *     pre-upload, VIDEO_UPLOADED once media lands, then SCHEDULED/PUBLISHED.
 *
 * Plus a contract-lock guard: the SHARED canonical badge map
 * (CANONICAL_BADGE) is consumed by ~55 surfaces incl. BOLT Text preview —
 * its label/group strings must not drift.
 */

import {
  deriveCreatorStatusLabel,
  deriveWorkflowChecklist,
  isCreatorProduced,
  type CreatorStatusKey,
} from '../../../lib/shared/creatorStatusLabel';
import { CANONICAL_BADGE, CanonicalContentState } from '../../../lib/shared/contentLifecycle';

describe('creatorStatusLabel — isCreatorProduced', () => {
  test.each([
    ['video', true],
    ['reel', true],
    ['short', true],
    ['youtube_short', true],
    ['image', false],
    ['carousel', false],
    ['infographic', false],
    ['post', false],
    ['article', false],
  ])('asset_type %s → creatorProduced=%s', (asset_type, expected) => {
    expect(isCreatorProduced({ asset_type })).toBe(expected);
  });

  test('canonical_group "pending" forces creator-produced even without a video type', () => {
    expect(isCreatorProduced({ canonical_group: 'pending' })).toBe(true);
  });

  test('AI asset that is merely scheduled is NOT creator-produced', () => {
    expect(isCreatorProduced({ asset_type: 'carousel', canonical_group: 'scheduled' })).toBe(false);
  });
});

describe('creatorStatusLabel — deriveCreatorStatusLabel', () => {
  type Row = Parameters<typeof deriveCreatorStatusLabel>[0];

  const cases: Array<[string, Row, CreatorStatusKey]> = [
    // ── AI-generated assets (image/carousel/infographic) ──
    ['AI carousel planned → GENERATING', { asset_type: 'carousel', canonical_state: 'PLANNED' }, 'GENERATING'],
    ['AI image generating → GENERATING', { asset_type: 'image', canonical_state: 'AI_GENERATING' }, 'GENERATING'],
    ['AI infographic ready-for-review folds to GENERATING', { asset_type: 'infographic', canonical_state: 'READY_FOR_REVIEW' }, 'GENERATING'],
    ['AI carousel ready-for-schedule folds to GENERATING', { asset_type: 'carousel', canonical_state: 'READY_FOR_SCHEDULE' }, 'GENERATING'],
    ['AI carousel scheduled → SCHEDULED', { asset_type: 'carousel', canonical_state: 'SCHEDULED' }, 'SCHEDULED'],
    ['AI image published → PUBLISHED', { asset_type: 'image', canonical_state: 'PUBLISHED' }, 'PUBLISHED'],
    ['AI carousel failed → FAILED', { asset_type: 'carousel', canonical_state: 'FAILED' }, 'FAILED'],

    // ── Creator-produced assets (video/reel/short) ──
    ['video pending creator → WAITING_FOR_VIDEO', { asset_type: 'video', canonical_state: 'PENDING_CREATOR' }, 'WAITING_FOR_VIDEO'],
    ['reel planned → WAITING_FOR_VIDEO', { asset_type: 'reel', canonical_state: 'PLANNED' }, 'WAITING_FOR_VIDEO'],
    ['short awaiting upload via FSM → WAITING_FOR_VIDEO', { asset_type: 'short', content: { creator_lifecycle_state: 'awaiting_media_upload' } }, 'WAITING_FOR_VIDEO'],
    ['video media_uploaded → VIDEO_UPLOADED', { asset_type: 'video', canonical_state: 'READY_FOR_REVIEW', content: { creator_lifecycle_state: 'media_uploaded' } }, 'VIDEO_UPLOADED'],
    ['video ready_for_schedule → VIDEO_UPLOADED', { asset_type: 'video', canonical_state: 'READY_FOR_SCHEDULE', content: { creator_lifecycle_state: 'ready_for_schedule' } }, 'VIDEO_UPLOADED'],
    ['video scheduled → SCHEDULED', { asset_type: 'video', canonical_state: 'SCHEDULED' }, 'SCHEDULED'],
    ['reel published → PUBLISHED', { asset_type: 'reel', canonical_state: 'PUBLISHED' }, 'PUBLISHED'],
    ['short upload_failed stays WAITING_FOR_VIDEO', { asset_type: 'short', canonical_state: 'PENDING_CREATOR', content: { creator_lifecycle_state: 'upload_failed' } }, 'WAITING_FOR_VIDEO'],
  ];

  test.each(cases)('%s', (_label, row, expectedKey) => {
    expect(deriveCreatorStatusLabel(row).key).toBe(expectedKey);
  });

  test('label + group are derived from the key', () => {
    const r = deriveCreatorStatusLabel({ asset_type: 'video', canonical_state: 'PENDING_CREATOR' });
    expect(r).toEqual({ key: 'WAITING_FOR_VIDEO', label: 'Waiting For Video', group: 'pending' });
  });

  test('scheduled_post_id presence resolves SCHEDULED even without canonical_state', () => {
    expect(deriveCreatorStatusLabel({ asset_type: 'video', scheduled_post_id: 'sp_1' }).key).toBe('SCHEDULED');
  });

  test('never throws on an empty event', () => {
    expect(() => deriveCreatorStatusLabel({})).not.toThrow();
    expect(deriveCreatorStatusLabel({}).key).toBe('GENERATING');
  });
});

describe('creatorStatusLabel — deriveWorkflowChecklist', () => {
  test('video item: 6 steps, upload current while waiting', () => {
    const steps = deriveWorkflowChecklist({ asset_type: 'video', canonical_state: 'PENDING_CREATOR' });
    expect(steps.map((s) => s.label)).toEqual([
      'Daily Plan', 'Video Brief Generated', 'Schedule Reserved', 'Video Uploaded', 'Scheduled', 'Published',
    ]);
    const upload = steps.find((s) => s.label === 'Video Uploaded')!;
    expect(upload.done).toBe(false);
    expect(upload.current).toBe(true);
    expect(steps.find((s) => s.label === 'Published')!.done).toBe(false);
  });

  test('video item uploaded: upload done, scheduled becomes current', () => {
    const steps = deriveWorkflowChecklist({ asset_type: 'video', canonical_state: 'READY_FOR_SCHEDULE', content: { creator_lifecycle_state: 'ready_for_schedule' } });
    expect(steps.find((s) => s.label === 'Video Uploaded')!.done).toBe(true);
    expect(steps.find((s) => s.label === 'Scheduled')!.current).toBe(true);
  });

  test('AI item: 4 steps, generate current while generating', () => {
    const steps = deriveWorkflowChecklist({ asset_type: 'carousel', canonical_state: 'AI_GENERATING' });
    expect(steps.map((s) => s.label)).toEqual(['Daily Plan', 'Generated', 'Scheduled', 'Published']);
    expect(steps.find((s) => s.label === 'Generated')!.current).toBe(true);
  });

  test('AI item published: all four steps done', () => {
    const steps = deriveWorkflowChecklist({ asset_type: 'image', canonical_state: 'PUBLISHED' });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});

describe('CONTRACT LOCK — CANONICAL_BADGE must not drift (BOLT Text + ~55 surfaces depend on it)', () => {
  test('label + group strings are pinned', () => {
    expect(CANONICAL_BADGE[CanonicalContentState.PLANNED]).toMatchObject({ label: 'Planned', group: 'draft' });
    expect(CANONICAL_BADGE[CanonicalContentState.AI_GENERATING]).toMatchObject({ label: 'AI Generating', group: 'draft' });
    expect(CANONICAL_BADGE[CanonicalContentState.PENDING_CREATOR]).toMatchObject({ label: 'Awaiting Video Upload', group: 'pending' });
    expect(CANONICAL_BADGE[CanonicalContentState.READY_FOR_REVIEW]).toMatchObject({ label: 'AI Asset — Ready for Review', group: 'ready' });
    expect(CANONICAL_BADGE[CanonicalContentState.READY_FOR_SCHEDULE]).toMatchObject({ label: 'AI Asset — Ready to Schedule', group: 'ready' });
    expect(CANONICAL_BADGE[CanonicalContentState.SCHEDULED]).toMatchObject({ label: 'Scheduled', group: 'scheduled' });
    expect(CANONICAL_BADGE[CanonicalContentState.PUBLISHED]).toMatchObject({ label: 'Published', group: 'published' });
    expect(CANONICAL_BADGE[CanonicalContentState.FAILED]).toMatchObject({ label: 'Failed', group: 'failed' });
  });
});
