/**
 * Foundation Batch A (F-02) — Prometheus exporter + trace kit.
 *
 * Exporter: renders the real registry accessors in exposition format 0.0.4 —
 * sanitized names, escaped labels, summary quantiles, meta series.
 * Trace kit: enqueue-side stamping is context-gated; worker-side restore
 * seeds the RequestContext ALS from `_trace` (or job identity) and is
 * fail-safe.
 */
import { registry } from '../../../backend/observability/registry';
import {
  renderPrometheusText,
  PROMETHEUS_CONTENT_TYPE,
} from '../../../backend/observability/promExporter';
import {
  TRACE_JOB_FIELD,
  withTraceMeta,
  traceMetaForEnqueue,
  runWithJobTraceContext,
} from '../../../backend/observability/traceKit';
import {
  runWithRequestExecutionContext,
  getTraceId,
  getRequestId,
  getRequestContext,
} from '../../../lib/platform/requestContext';

describe('F-02 Prometheus exporter', () => {
  test('renders counters, gauges, and histogram summaries with sanitized names', () => {
    registry.incr('batcha.export.count', 3, { route: '/api/x', ok: true });
    registry.gauge('batcha.export.gauge_ms', 42);
    registry.observe('batcha.export.duration_ms', 100);
    registry.observe('batcha.export.duration_ms', 300);

    const text = renderPrometheusText();

    expect(text).toContain('# TYPE batcha_export_count counter');
    expect(text).toContain('batcha_export_count{ok="true",route="/api/x"} 3');
    expect(text).toContain('# TYPE batcha_export_gauge_ms gauge');
    expect(text).toContain('batcha_export_gauge_ms 42');
    expect(text).toContain('# TYPE batcha_export_duration_ms summary');
    expect(text).toContain('batcha_export_duration_ms{quantile="0.5"}');
    expect(text).toContain('batcha_export_duration_ms_sum 400');
    expect(text).toContain('batcha_export_duration_ms_count 2');
    // Registry meta series for scrape-side cold-start/cardinality visibility.
    expect(text).toContain('observability_process_start_time_seconds');
    expect(text).toContain('observability_dropped_series_total');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('escapes label values and emits one TYPE line per metric name', () => {
    registry.incr('batcha.escape.count', 1, { msg: 'quote " backslash \\ nl \n end' });
    registry.incr('batcha.escape.count', 1, { msg: 'other' });
    const text = renderPrometheusText();
    expect(text).toContain('msg="quote \\" backslash \\\\ nl \\n end"');
    const typeLines = text.split('\n').filter((l) => l === '# TYPE batcha_escape_count counter');
    expect(typeLines).toHaveLength(1);
  });

  test('content type matches Prometheus text exposition', () => {
    expect(PROMETHEUS_CONTENT_TYPE).toContain('text/plain');
    expect(PROMETHEUS_CONTENT_TYPE).toContain('version=0.0.4');
  });
});

describe('F-02 trace kit', () => {
  test('withTraceMeta outside any context returns payload unchanged', () => {
    const data = { postId: 'p1' };
    expect(withTraceMeta(data)).toBe(data);
    expect(traceMetaForEnqueue()).toBeUndefined();
  });

  test('withTraceMeta inside a context stamps _trace additively', () => {
    runWithRequestExecutionContext({ requestId: 'req-9', correlationId: 'corr-9' }, () => {
      const stamped = withTraceMeta({ postId: 'p1' });
      expect(stamped.postId).toBe('p1');
      expect(stamped[TRACE_JOB_FIELD]).toEqual({
        requestId: 'req-9',
        correlationId: 'corr-9',
        traceId: 'corr-9',
      });
    });
  });

  test('runWithJobTraceContext restores the enqueuer trace on the worker side', () => {
    const job = {
      id: 42,
      queueName: 'publish',
      data: { postId: 'p1', [TRACE_JOB_FIELD]: { traceId: 'corr-9', correlationId: 'corr-9' } },
    };
    runWithJobTraceContext(job, () => {
      expect(getTraceId()).toBe('corr-9');
      expect(getRequestId()).toBe('job:publish:42');
      expect(getRequestContext().correlationId).toBe('corr-9');
    });
  });

  test('unstamped jobs get a job-identity context (no undefined trace)', () => {
    runWithJobTraceContext({ id: 'j7', queueName: 'bolt-execution', data: {} }, () => {
      expect(getTraceId()).toBe('job:bolt-execution:j7');
    });
  });

  test('fail-safe: malformed job still runs the processor', () => {
    let ran = false;
    runWithJobTraceContext(undefined, () => { ran = true; });
    expect(ran).toBe(true);
    runWithJobTraceContext({ data: { [TRACE_JOB_FIELD]: 'not-an-object' } }, () => {
      expect(getTraceId()).toContain('job:');
    });
  });
});
