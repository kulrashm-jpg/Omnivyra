/**
 * Report 2 failure-path instrumentation.
 *
 * THE PROBLEM
 * `composePerformanceIntelligenceReport` races composition against a 45s liveness boundary in
 * `runDedupedReport`. `stage_timings_ms` is attached only to the SUCCESS and early-return payloads,
 * so when the boundary fires the timing record dies with the rejected promise. Production told us
 * only that the report exceeded 45s — a ~23s window was unattributable to any stage.
 *
 * WHAT IS UNDER TEST
 * The stage wrappers now write into a trace that lives outside the raced promise, so it survives
 * the rejection. These tests hold the two properties that make such a trace trustworthy:
 *   • a stage still in flight is reported as `running`, never as completed — an unfinished stage
 *     must not read as a successful one;
 *   • instrumentation observes, it never rescues: a failed stage stays failed and the composition
 *     failure is re-thrown unchanged.
 *
 * The 45s boundary, `runDedupedReport`, cancellation, caching, provider retry policy and every
 * stage's execution order are deliberately NOT changed by this work, and the guards at the end
 * pin that down against the source itself.
 */
import fs from 'fs';
import path from 'path';
import { withReportTimeout, type PerformanceStageTrace } from '../../services/performanceReportService';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../services/performanceReportService.ts'),
  'utf8',
);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('Report 2 — failure-path stage instrumentation', () => {
  // ── 1. The success path is unchanged and compatible ───────────────────────
  describe('1. successful stages record duration without changing the result', () => {
    it('returns the stage result untouched', async () => {
      const trace: PerformanceStageTrace = {};
      const result = await withReportTimeout('search_intelligence', Promise.resolve({ ok: 1 }), 1000, trace);
      expect(result).toEqual({ ok: 1 });
    });

    it('records started_at, completed_at, duration_ms and a completed status', async () => {
      const trace: PerformanceStageTrace = {};
      await withReportTimeout('analytics_health', Promise.resolve('value'), 1000, trace);
      const stage = trace.analytics_health;
      expect(stage.status).toBe('completed');
      expect(typeof stage.started_at).toBe('string');
      expect(typeof stage.completed_at).toBe('string');
      expect(typeof stage.duration_ms).toBe('number');
      expect(stage.duration_ms as number).toBeGreaterThanOrEqual(0);
    });

    it('works with no trace supplied — instrumentation is optional', async () => {
      await expect(withReportTimeout('behavior_intelligence', Promise.resolve(7), 1000)).resolves.toBe(7);
    });
  });

  // ── 2. The failure path emits timing information ──────────────────────────
  describe('2. the trace survives a stage that never completes', () => {
    it('reports an in-flight stage as running, not completed', async () => {
      const trace: PerformanceStageTrace = {};
      const pending = deferred<string>();
      const inFlight = withReportTimeout('snapshot_foundation', pending.promise, 10_000, trace);
      // Observed while the stage is still running — exactly the state the 45s boundary sees.
      expect(trace.snapshot_foundation.status).toBe('running');
      expect(trace.snapshot_foundation.completed_at).toBeNull();
      expect(trace.snapshot_foundation.duration_ms).toBeNull();
      pending.resolve('done');
      await inFlight;
    });

    it('keeps every opened stage in the trace so the timeline is readable', async () => {
      const trace: PerformanceStageTrace = {};
      await withReportTimeout('behavior_report', Promise.resolve(1), 1000, trace);
      await withReportTimeout('provider_and_snapshot', Promise.resolve(2), 1000, trace);
      const pending = deferred<number>();
      const inFlight = withReportTimeout('analytics_health', pending.promise, 10_000, trace);
      expect(Object.keys(trace).sort()).toEqual(['analytics_health', 'behavior_report', 'provider_and_snapshot']);
      expect(trace.behavior_report.status).toBe('completed');
      expect(trace.analytics_health.status).toBe('running');
      pending.resolve(3);
      await inFlight;
    });
  });

  // ── 3. A timed-out stage is marked as such ────────────────────────────────
  describe('3. a stage that exceeds its own wrapper is marked timed_out', () => {
    it('marks timed_out and returns null, as before', async () => {
      const trace: PerformanceStageTrace = {};
      const pending = deferred<string>();
      const result = await withReportTimeout('search_intelligence', pending.promise, 5, trace);
      expect(result).toBeNull();
      expect(trace.search_intelligence.status).toBe('timed_out');
      expect(trace.search_intelligence.completed_at).not.toBeNull();
      pending.resolve('late');
    });

    it('does not flip a timed-out stage to completed when the work settles later', async () => {
      const trace: PerformanceStageTrace = {};
      const pending = deferred<string>();
      await withReportTimeout('search_intelligence', pending.promise, 5, trace);
      expect(trace.search_intelligence.status).toBe('timed_out');
      pending.resolve('late');
      await new Promise((r) => setTimeout(r, 10));
      // The underlying work is NOT cancelled — but a late completion must never rewrite the
      // record into a success the report never received.
      expect(trace.search_intelligence.status).toBe('timed_out');
    });

    it('records a rejected stage as failed with the error shape only', async () => {
      const trace: PerformanceStageTrace = {};
      const failing = Promise.reject(new TypeError('boom'));
      await withReportTimeout('resolve_competitor_input', failing, 1000, trace).catch(() => null);
      await new Promise((r) => setTimeout(r, 5));
      expect(trace.resolve_competitor_input.status).toBe('failed');
      expect(trace.resolve_competitor_input.error).toBe('TypeError');
      // The message body may carry customer content and must not be logged.
      expect(JSON.stringify(trace)).not.toContain('boom');
    });
  });

  // ── 4. Instrumentation never rescues a failure ────────────────────────────
  describe('4. observing does not convert failure into success', () => {
    it('propagates a stage rejection rather than swallowing it', async () => {
      const trace: PerformanceStageTrace = {};
      await expect(withReportTimeout('behavior_report', Promise.reject(new Error('nope')), 1000, trace))
        .rejects.toThrow('nope');
    });

    it('re-throws the composition failure after logging the trace', () => {
      // The catch block records and re-throws; it must not return a value.
      const block = SOURCE.slice(SOURCE.indexOf("'[performance-report][composition-failed]'"));
      expect(block).toContain('stage_trace');
      expect(block.slice(0, block.indexOf('}'))).not.toMatch(/\breturn\b/);
      expect(block).toMatch(/throw error;/);
    });

    it('adds no await to the failure path, so it cannot extend the boundary', () => {
      const start = SOURCE.indexOf("} catch (error) {\n    console.warn('[performance-report][composition-failed]'");
      expect(start).toBeGreaterThan(-1);
      const block = SOURCE.slice(start, SOURCE.indexOf('throw error;', start));
      expect(block).not.toContain('await');
    });
  });

  // ── 5-6. The boundary and Report 2 semantics are unchanged ────────────────
  describe('5-6. guards: nothing else about Report 2 moved', () => {
    it('keeps the 45s concurrency boundary exactly as it was', () => {
      expect(SOURCE).toContain('timeoutMs: 45_000');
      expect((SOURCE.match(/timeoutMs: 45_000/g) || [])).toHaveLength(1);
      expect(SOURCE).toContain("key: `performance:${companyId}:${resolvedKey}`");
    });

    it('keeps every existing per-stage timeout value', () => {
      for (const budget of ['8000', '15000', '12000', '7000']) {
        expect(SOURCE).toContain(`, ${budget}, trace)`);
      }
      expect((SOURCE.match(/, 15000, trace\)/g) || [])).toHaveLength(2);
    });

    it('introduces no cancellation — that is deliberately a separate change', () => {
      expect(SOURCE).not.toContain('AbortController');
      expect(SOURCE).not.toContain('AbortSignal');
    });

    it('still emits stage_timings_ms on the success and early-return payloads', () => {
      expect((SOURCE.match(/stage_timings_ms: \{ \.\.\.stageTimings/g) || [])).toHaveLength(2);
    });

    it('leaves runDedupedReport as the single boundary owner', () => {
      expect((SOURCE.match(/runDedupedReport\(/g) || [])).toHaveLength(1);
    });
  });
});
