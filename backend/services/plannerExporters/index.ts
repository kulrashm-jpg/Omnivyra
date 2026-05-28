/**
 * Planner exporter bootstrap composer.
 *
 * Reads env to decide which exporters to register, then chains them into
 * a single `TelemetryExporter` that fans out to every active sink. Each
 * sink is independent — a failure in one does not block the others.
 *
 * Env contract (set any subset; all default to OFF):
 *   DATADOG_STATSD_HOST              → enable dogstatsd metrics
 *   OTLP_METRICS_ENDPOINT            → enable OTLP HTTP metrics
 *   OTLP_TRACES_ENDPOINT             → enable OTLP HTTP traces
 *   PROMETHEUS_EXPORTER_ENABLED=true → enable Prometheus pull endpoint cache
 *
 * Call `bootstrapPlannerExporters()` once at worker / web bootstrap. It's
 * idempotent — re-calling replaces the previous fanout exporter cleanly.
 */

import { logger } from '../logger';
import {
  registerTelemetryExporter,
  startTelemetryExportLoop,
  type TelemetryExporter,
  type TelemetrySnapshot,
} from '../plannerTelemetry';
import { buildDatadogStatsdExporter } from './datadogStatsdExporter';
import { buildOtlpMetricsExporter } from './otlpMetricsExporter';
import { registerOtlpTracer } from './otlpTracesExporter';
import { buildPrometheusExporter } from './prometheusRegistry';

export interface ExporterBootstrapResult {
  metrics_exporters: string[];
  trace_exporters: string[];
  fallback_log_exporter: boolean;
}

function fanout(exporters: TelemetryExporter[]): TelemetryExporter {
  // Each sink runs independently. Failures in one do NOT block the others.
  // Errors are logged at the individual exporter; the fanout swallows so
  // the export-loop tick completes cleanly.
  return async (snapshot: TelemetrySnapshot) => {
    await Promise.all(
      exporters.map(async (e) => {
        try { await e(snapshot); }
        catch (err) {
          logger.warn('planner_exporter_sink_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  };
}

/**
 * Inspect env, build the active exporter set, register the fanout
 * exporter on `plannerTelemetry`, register the OTLP tracer if enabled,
 * and start the 10s export loop.
 *
 * Returns a description of what got wired — used by `startWorkers` for
 * the bootstrap diag log.
 */
export function bootstrapPlannerExporters(): ExporterBootstrapResult {
  const metricExporters: TelemetryExporter[] = [];
  const metricNames: string[] = [];
  const traceNames: string[] = [];

  const dd = buildDatadogStatsdExporter();
  if (dd) { metricExporters.push(dd); metricNames.push('dogstatsd'); }
  const otlpM = buildOtlpMetricsExporter();
  if (otlpM) { metricExporters.push(otlpM); metricNames.push('otlp_http'); }
  const prom = buildPrometheusExporter();
  if (prom) { metricExporters.push(prom); metricNames.push('prometheus'); }

  // OTLP traces is registered as the active Tracer (NOT as a metrics
  // exporter) so the standard `withSpan(...)` API gets exported spans.
  const traceReg = registerOtlpTracer();
  if (traceReg.registered) traceNames.push('otlp_http');

  let fallbackLog = false;
  if (metricExporters.length > 0) {
    registerTelemetryExporter(fanout(metricExporters));
  } else {
    // No real exporter — leave the default log-based exporter in place.
    // This is the "ship without observability SDK" path; dashboards work
    // via log-based metrics.
    fallbackLog = true;
  }

  // Start (or keep running) the export loop. Idempotent.
  startTelemetryExportLoop();

  logger.info('planner_exporter_bootstrap_complete', {
    metric_exporters: metricNames,
    trace_exporters: traceNames,
    fallback_log_exporter: fallbackLog,
  });
  return {
    metrics_exporters: metricNames,
    trace_exporters: traceNames,
    fallback_log_exporter: fallbackLog,
  };
}
