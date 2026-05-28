/**
 * Phase 27B.3 — BullMQ jobId parity tests.
 */

import {
  buildCanonicalPublishJobId,
  JobIdParityTracker,
} from '../../../../../services/orchestration/distributed/domain/production/bullmqJobIdParity';

describe('buildCanonicalPublishJobId', () => {
  test('same components yield same jobId regardless of caller', () => {
    const a = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    const b = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^publish-[0-9a-f]{16}$/);
  });

  test('different scheduled_for yields different jobId', () => {
    const a = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    const b = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T13:00:00.000Z',
    });
    expect(a).not.toBe(b);
  });

  test('different postId yields different jobId', () => {
    const a = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    const b = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-2',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    expect(a).not.toBe(b);
  });

  test('timestamp normalization treats equivalent ISO strings as same', () => {
    const a = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00Z',
    });
    const b = buildCanonicalPublishJobId({
      scheduledPostId: 'sp-1',
      scheduledForIso: '2026-05-30T12:00:00.000Z',
    });
    expect(a).toBe(b);
  });

  test('rejects missing inputs', () => {
    expect(() => buildCanonicalPublishJobId({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scheduledPostId: '', scheduledForIso: '2026-05-30T12:00:00Z',
    } as any)).toThrow();
  });
});

describe('JobIdParityTracker', () => {
  test('same source + matching observed id does not flag divergent', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const tracker = new JobIdParityTracker({
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });
    const components = { scheduledPostId: 'sp-1', scheduledForIso: '2026-05-30T12:00:00Z' };
    const canonical = buildCanonicalPublishJobId(components);

    const r1 = tracker.recordEnqueue({ source: 'cron', components, observedJobId: canonical });
    const r2 = tracker.recordEnqueue({ source: 'runtime', components, observedJobId: canonical });

    expect(r1.divergent).toBe(false);
    expect(r2.divergent).toBe(false);
    expect(events.some((e) => e.event === 'bullmq_duplicate_suppressed')).toBe(true);
    expect(events.some((e) => e.event === 'enqueue_path_divergence_detected')).toBe(false);
  });

  test('different observed ids across sources flag divergence', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const tracker = new JobIdParityTracker({
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });
    const components = { scheduledPostId: 'sp-2', scheduledForIso: '2026-05-30T12:00:00Z' };

    tracker.recordEnqueue({ source: 'cron', components, observedJobId: 'db-uuid-aaa' });
    const second = tracker.recordEnqueue({ source: 'runtime', components, observedJobId: 'db-uuid-bbb' });

    expect(second.divergent).toBe(true);
    expect(events.some((e) => e.event === 'enqueue_path_divergence_detected')).toBe(true);
    const snap = tracker.snapshot();
    expect(snap.divergentKeys).toBe(1);
  });

  test('TTL eviction drops old records', () => {
    let nowMs = 1_000_000;
    const tracker = new JobIdParityTracker({
      telemetry: { emit: () => {} },
      clock: () => nowMs,
    });
    const components = { scheduledPostId: 'sp-3', scheduledForIso: '2026-05-30T12:00:00Z' };
    tracker.recordEnqueue({ source: 'cron', components, observedJobId: 'a' });
    nowMs += 10 * 60 * 1000; // 10 min later
    tracker.recordEnqueue({
      source: 'cron',
      components: { scheduledPostId: 'sp-4', scheduledForIso: '2026-05-30T12:00:00Z' },
      observedJobId: 'b',
    });
    const snap = tracker.snapshot();
    // sp-3 was evicted; only sp-4 remains.
    expect(snap.trackedCanonicalKeys).toBe(1);
  });
});
