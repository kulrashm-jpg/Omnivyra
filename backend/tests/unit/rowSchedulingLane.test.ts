/**
 * Phase 2A — Per-row routing infrastructure tests (INERT capability).
 *
 * Proves:
 *   1. classifyRowLane correctness across every lane.
 *   2-6. NO-OP guardrails: the CURRENT (campaign-level) route is a faithful
 *        reproduction of the scheduler's usesUnifiedMediaFlow decision and is
 *        independent of row content, for text / creator / creator_dependent /
 *        combined. Future (row-level) route is informational only and never
 *        changes the current route. routing_active is always false.
 *
 * These modules are NOT imported by any execution file (verified separately
 * by the empty git diff on the scheduler/pipeline). This suite locks the
 * classifier contract and the "calculations exist but are not active" boundary.
 */

import {
  classifyRowLane,
  classifyRowLanes,
  type RoutableRow,
} from '../../../lib/shared/bolt/rowSchedulingLane';
import {
  computeCurrentCampaignPath,
  laneToFuturePath,
  previewRowRoutes,
  buildRoutingDiagnostics,
  emitRoutingDiagnostics,
} from '../../../lib/shared/bolt/boltRoutingPreview';

const videoReady: RoutableRow = {
  intent_type: 'creator',
  content_type: 'video',
  uploaded_media_url: 'https://cdn.example.com/clip.mp4',
  upload_validation: { valid: true },
  creator_lifecycle_state: 'ready_for_schedule',
};

describe('Phase 2A — classifyRowLane correctness', () => {
  test('text intent → TEXT', () => {
    expect(classifyRowLane({ intent_type: 'text', content_type: 'post' }).lane).toBe('TEXT');
  });

  test('no intent, text content_type → TEXT (inferred)', () => {
    const d = classifyRowLane({ content_type: 'tweet' });
    expect(d.lane).toBe('TEXT');
    expect(d.intent).toBe('text');
  });

  test('creator autonomous (carousel) → CREATOR_AUTONOMOUS', () => {
    const d = classifyRowLane({ intent_type: 'creator', content_type: 'carousel' });
    expect(d.lane).toBe('CREATOR_AUTONOMOUS');
    expect(d.creatorLifecycle).toBe('autonomous');
  });

  test('creator autonomous (image) → CREATOR_AUTONOMOUS', () => {
    expect(classifyRowLane({ intent_type: 'creator', content_type: 'image' }).lane).toBe('CREATOR_AUTONOMOUS');
  });

  test('creator video with no uploaded media → VIDEO_WAITING', () => {
    const d = classifyRowLane({ intent_type: 'creator', content_type: 'video' });
    expect(d.lane).toBe('VIDEO_WAITING');
    expect(d.creatorLifecycle).toBe('attachment_required');
    expect(d.requiresUpload).toBe(true);
  });

  test('creator reel awaiting upload → VIDEO_WAITING', () => {
    expect(classifyRowLane({ intent_type: 'creator', content_type: 'reel' }).lane).toBe('VIDEO_WAITING');
  });

  test('creator video uploaded + valid + ready → CREATOR_ATTACHMENT', () => {
    const d = classifyRowLane(videoReady);
    expect(d.lane).toBe('CREATOR_ATTACHMENT');
    expect(d.canScheduleNow).toBe(true);
  });

  test('lifecycle/upload fields nested under content JSON resolve correctly', () => {
    const d = classifyRowLane({
      intent_type: 'creator',
      content_type: 'video',
      content: {
        uploaded_media_url: 'https://cdn.example.com/v.mp4',
        upload_validation: { valid: true },
        creator_lifecycle_state: 'ready_for_schedule',
      },
    });
    expect(d.lane).toBe('CREATOR_ATTACHMENT');
  });

  test('creator-intent text-like format (post) → TEXT lane', () => {
    const d = classifyRowLane({ intent_type: 'creator', content_type: 'post' });
    expect(d.lane).toBe('TEXT');
    expect(d.creatorLifecycle).toBe('text_only');
  });

  test('creator-intent unsupported format → INELIGIBLE', () => {
    expect(classifyRowLane({ intent_type: 'creator', content_type: 'hologram' }).lane).toBe('INELIGIBLE');
  });

  test('unknown family (no intent, unknown content_type) → INELIGIBLE', () => {
    const d = classifyRowLane({ content_type: 'zzz_nonsense' });
    expect(d.lane).toBe('INELIGIBLE');
    expect(d.intent).toBe('unknown');
  });

  test('null/empty row → INELIGIBLE, never throws', () => {
    expect(classifyRowLane(null).lane).toBe('INELIGIBLE');
    expect(classifyRowLane(undefined).lane).toBe('INELIGIBLE');
    expect(classifyRowLane({}).lane).toBe('INELIGIBLE');
  });

  test('classifyRowLanes batches and is pure (stable on repeat)', () => {
    const rows = [{ intent_type: 'text', content_type: 'post' }, videoReady];
    const a = classifyRowLanes(rows);
    const b = classifyRowLanes(rows);
    expect(a.map((r) => r.lane)).toEqual(['TEXT', 'CREATOR_ATTACHMENT']);
    expect(a).toEqual(b);
  });
});

describe('Phase 2A — current route faithfully mirrors usesUnifiedMediaFlow (NO-OP)', () => {
  // usesUnifiedMediaFlow = executionProfile === 'creator' (structuredPlanScheduler.ts).
  // Only the creator profile takes the creator path today; everything else
  // (text / combined / creator_dependent) takes the text path.
  test.each([
    ['text', 'TEXT_PATH'],
    ['creator', 'CREATOR_PATH'],
    ['combined', 'TEXT_PATH'],
    ['creator_dependent', 'TEXT_PATH'],
    ['', 'TEXT_PATH'],
    [undefined, 'TEXT_PATH'],
  ] as const)('profile %s → current path %s', (profile, expected) => {
    expect(computeCurrentCampaignPath(profile)).toBe(expected);
  });

  test('current path is INDEPENDENT of row content (campaign-level routing unchanged)', () => {
    const rowsA: RoutableRow[] = [{ intent_type: 'text', content_type: 'post' }];
    const rowsB: RoutableRow[] = [videoReady, { intent_type: 'creator', content_type: 'carousel' }];
    for (const profile of ['text', 'creator', 'combined', 'creator_dependent']) {
      const pA = previewRowRoutes(profile, rowsA).map((p) => p.currentPath);
      const pB = previewRowRoutes(profile, rowsB).map((p) => p.currentPath);
      const expected = computeCurrentCampaignPath(profile);
      expect(new Set([...pA, ...pB])).toEqual(new Set([expected]));
    }
  });
});

describe('Phase 2A — future route is informational only', () => {
  test('laneToFuturePath mapping', () => {
    expect(laneToFuturePath('TEXT')).toBe('TEXT_PATH');
    expect(laneToFuturePath('CREATOR_AUTONOMOUS')).toBe('CREATOR_PATH');
    expect(laneToFuturePath('CREATOR_ATTACHMENT')).toBe('CREATOR_PATH');
    expect(laneToFuturePath('VIDEO_WAITING')).toBe('HOLD');
    expect(laneToFuturePath('INELIGIBLE')).toBe('HOLD');
  });

  test('wouldReroute is computed but current path is never altered by it', () => {
    // A creator-autonomous row in a combined (text-path) campaign WOULD reroute
    // under Phase 2B, but the current path stays TEXT_PATH today.
    const preview = previewRowRoutes('combined', [{ intent_type: 'creator', content_type: 'carousel' }]);
    expect(preview[0].currentPath).toBe('TEXT_PATH');
    expect(preview[0].futurePath).toBe('CREATOR_PATH');
    expect(preview[0].wouldReroute).toBe(true);
  });
});

describe('Phase 2A — telemetry diagnostics (NO-OP)', () => {
  const mixedRows: RoutableRow[] = [
    { intent_type: 'text', content_type: 'post' },
    { intent_type: 'text', content_type: 'article' },
    { intent_type: 'creator', content_type: 'carousel' }, // autonomous
    { intent_type: 'creator', content_type: 'image' },    // autonomous
    { intent_type: 'creator', content_type: 'video' },    // waiting
    videoReady,                                            // attachment ready
    { intent_type: 'creator', content_type: 'hologram' }, // ineligible
  ];

  test('counts every lane for a mixed (combined) campaign', () => {
    const d = buildRoutingDiagnostics('combined', mixedRows);
    expect(d.total_rows).toBe(7);
    expect(d.text_rows).toBe(2);
    expect(d.autonomous_rows).toBe(2);
    expect(d.video_waiting_rows).toBe(1);
    expect(d.attachment_rows).toBe(1);
    expect(d.ineligible_rows).toBe(1);
    expect(d.creator_rows).toBe(5); // carousel, image, video, videoReady, hologram
    expect(d.current_path).toBe('TEXT_PATH'); // combined still uses text lane
  });

  test('routing_active is ALWAYS false (guard against accidental wiring)', () => {
    for (const profile of ['text', 'creator', 'combined', 'creator_dependent']) {
      expect(buildRoutingDiagnostics(profile, mixedRows).routing_active).toBe(false);
    }
  });

  test('emitRoutingDiagnostics logs only through an injected logger', () => {
    const calls: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const d = buildRoutingDiagnostics('combined', mixedRows);
    const returned = emitRoutingDiagnostics(d, (event, payload) => calls.push({ event, payload }));
    expect(returned).toBe(d);
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('bolt.routing.preview');
    expect(calls[0].payload.total_rows).toBe(7);
  });

  test('emitRoutingDiagnostics without a logger is a pure no-op (no throw, no IO)', () => {
    const d = buildRoutingDiagnostics('text', mixedRows);
    expect(() => emitRoutingDiagnostics(d)).not.toThrow();
    expect(emitRoutingDiagnostics(d)).toBe(d);
  });
});
