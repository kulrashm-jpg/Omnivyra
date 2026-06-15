/**
 * Phase 2B — Intelligent Mix per-row dispatch guardrails.
 *
 * The scheduler's combined-only branch dispatches via the pure, unit-tested
 * `partitionRowsByLane` helper:
 *   - creatorLane (CREATOR_AUTONOMOUS | CREATOR_ATTACHMENT | VIDEO_WAITING)
 *       → processCreatorStructuredSchedule (existing creator path, existing
 *         per-row eligibility decides schedule-vs-hold)
 *   - textLane (TEXT) → processBlockSchedule (existing text path)
 *   - ineligible (INELIGIBLE) → skipped
 *
 * This suite proves the dispatch buckets are correct and — critically — that
 * VIDEO rows can never be placed in a "schedule now" position: they land in
 * the creator lane where the existing eligibility gate holds them.
 *
 * Modes other than `combined` never invoke this helper (the scheduler gates
 * it behind `isCombined`), so text / creator / creator_dependent execution
 * paths are byte-identical — verified by the unchanged regression suite.
 */

import {
  partitionRowsByLane,
  classifyRowLane,
  type RoutableRow,
} from '../../../lib/shared/bolt/rowSchedulingLane';

const textPost: RoutableRow = { intent_type: 'text', content_type: 'post' };
const textArticle: RoutableRow = { intent_type: 'text', content_type: 'article' };
const autoCarousel: RoutableRow = { intent_type: 'creator', content_type: 'carousel' };
const autoImage: RoutableRow = { intent_type: 'creator', content_type: 'image' };
const videoWaiting: RoutableRow = { intent_type: 'creator', content_type: 'video' };
const videoReady: RoutableRow = {
  intent_type: 'creator',
  content_type: 'video',
  uploaded_media_url: 'https://cdn.example.com/clip.mp4',
  upload_validation: { valid: true },
  creator_lifecycle_state: 'ready_for_schedule',
};
const ineligible: RoutableRow = { intent_type: 'creator', content_type: 'hologram' };

describe('Phase 2B — partitionRowsByLane dispatch buckets', () => {
  test('text rows → textLane only', () => {
    const p = partitionRowsByLane([textPost, textArticle]);
    expect(p.textLane).toHaveLength(2);
    expect(p.creatorLane).toHaveLength(0);
    expect(p.ineligible).toHaveLength(0);
  });

  test('autonomous creator rows → creatorLane', () => {
    const p = partitionRowsByLane([autoCarousel, autoImage]);
    expect(p.creatorLane).toHaveLength(2);
    expect(p.textLane).toHaveLength(0);
  });

  test('ineligible rows → ineligible bucket (dispatched to neither path)', () => {
    const p = partitionRowsByLane([ineligible]);
    expect(p.ineligible).toHaveLength(1);
    expect(p.creatorLane).toHaveLength(0);
    expect(p.textLane).toHaveLength(0);
  });

  test('full mixed campaign (matrix E) buckets exactly', () => {
    const rows = [textPost, textArticle, autoCarousel, autoImage, videoWaiting, videoReady, ineligible];
    const p = partitionRowsByLane(rows);
    expect(p.textLane).toHaveLength(2);                  // post, article
    expect(p.creatorLane).toHaveLength(4);               // carousel, image, videoWaiting, videoReady
    expect(p.ineligible).toHaveLength(1);                // hologram
    // total conserved — no row is dropped or duplicated
    expect(p.textLane.length + p.creatorLane.length + p.ineligible.length).toBe(rows.length);
  });

  test('preserves the exact row objects (no copy / reshape)', () => {
    const p = partitionRowsByLane([textPost, autoCarousel, ineligible]);
    expect(p.textLane[0]).toBe(textPost);
    expect(p.creatorLane[0]).toBe(autoCarousel);
    expect(p.ineligible[0]).toBe(ineligible);
  });

  test('null / empty input is safe', () => {
    expect(partitionRowsByLane(null)).toEqual({ creatorLane: [], textLane: [], ineligible: [] });
    expect(partitionRowsByLane([])).toEqual({ creatorLane: [], textLane: [], ineligible: [] });
  });
});

describe('Phase 2B — VIDEO SAFETY (video can never auto-schedule)', () => {
  test('video with no upload → VIDEO_WAITING, lands in creatorLane, NOT schedulable now', () => {
    const decision = classifyRowLane(videoWaiting);
    expect(decision.lane).toBe('VIDEO_WAITING');
    expect(decision.canScheduleNow).toBe(false); // held by existing eligibility
    expect(decision.requiresUpload).toBe(true);

    const p = partitionRowsByLane([videoWaiting]);
    expect(p.creatorLane).toContain(videoWaiting); // routed to creator path (which holds it)
    expect(p.textLane).toHaveLength(0);            // never the text/auto-schedule path
  });

  test('video WITH validated upload → CREATOR_ATTACHMENT, creator lane, schedulable now', () => {
    const decision = classifyRowLane(videoReady);
    expect(decision.lane).toBe('CREATOR_ATTACHMENT');
    expect(decision.canScheduleNow).toBe(true);
    expect(partitionRowsByLane([videoReady]).creatorLane).toContain(videoReady);
  });

  test('partial upload (no validation) stays VIDEO_WAITING — not schedulable', () => {
    const partial: RoutableRow = {
      intent_type: 'creator',
      content_type: 'reel',
      uploaded_media_url: 'https://cdn.example.com/r.mp4',
      // upload_validation absent → not valid
      creator_lifecycle_state: 'media_uploaded',
    };
    const decision = classifyRowLane(partial);
    expect(decision.lane).toBe('VIDEO_WAITING');
    expect(decision.canScheduleNow).toBe(false);
  });
});
