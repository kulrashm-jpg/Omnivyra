/**
 * Datadog dogstatsd UDP metrics exporter.
 *
 * Emits metrics in the dogstatsd wire format directly over UDP — NO
 * dd-trace-js SDK dependency. The Datadog Agent listens on UDP/8125 by
 * default; production deploys with the Datadog Agent sidecar (Vercel
 * integration, Railway addon, K8s sidecar) get full Datadog ingestion
 * "for free" once `DATADOG_STATSD_HOST` is set.
 *
 * Wire format reference:
 *   <metric>:<value>|<type>|@<sample-rate>|#<tag>:<value>,<tag>:<value>
 *   types: c=counter, g=gauge, h=histogram, ms=timing, d=distribution
 *
 * We use:
 *   counter   → c
 *   gauge     → g
 *   histogram → d  (distribution — preserves percentiles cluster-wide)
 *
 * Batching: dogstatsd UDP packets must stay under MTU (1432B safe). We
 * pack as many metric lines as fit, send the packet, then start the next.
 *
 * Failure mode: UDP is fire-and-forget. Send errors are counted but never
 * blocking. The exporter is a thin sink — losing a packet drops one
 * snapshot's worth of metrics, NOT the planner request.
 */

import dgram from 'dgram';
import { logger } from '../logger';
import { ExporterBatcher } from './exporterBase';
import type { TelemetrySnapshot, TelemetryExporter } from '../plannerTelemetry';

const SAFE_PACKET_BYTES = 1400;

interface DogstatsdLine {
  metric: string;
  value: number;
  type: 'c' | 'g' | 'd';
  tags: string;
}

function parseLabelString(labels: string): string {
  // Telemetry's canonical label string is "k=v|k=v"; dogstatsd wants
  // "k:v,k:v" so we convert. Empty string in → empty tags out.
  if (!labels) return '';
  return labels.split('|').filter(Boolean).map((kv) => kv.replace(/=/, ':')).join(',');
}

function lineToBytes(line: DogstatsdLine): string {
  const tags = line.tags ? `|#${line.tags}` : '';
  return `${line.metric}:${line.value}|${line.type}${tags}\n`;
}

function snapshotToLines(snapshot: TelemetrySnapshot): DogstatsdLine[] {
  const lines: DogstatsdLine[] = [];
  for (const c of snapshot.counters) lines.push({ metric: c.name, value: c.value, type: 'c', tags: parseLabelString(c.labels) });
  for (const g of snapshot.gauges)   lines.push({ metric: g.name, value: g.value, type: 'g', tags: parseLabelString(g.labels) });
  // Histograms: send each per-percentile value AS a gauge so dashboards
  // can plot them directly. Also send `count` as a counter for rate calc.
  for (const h of snapshot.histograms) {
    const tagsBase = parseLabelString(h.labels);
    const dims = [
      [`${h.name}.p50`, h.p50, 'g' as const],
      [`${h.name}.p95`, h.p95, 'g' as const],
      [`${h.name}.p99`, h.p99, 'g' as const],
      [`${h.name}.max`, h.max, 'g' as const],
      [`${h.name}.avg`, h.avg, 'g' as const],
      [`${h.name}.count`, h.count, 'c' as const],
    ] as Array<[string, number, 'g' | 'c']>;
    for (const [n, v, t] of dims) {
      lines.push({ metric: n, value: v, type: t === 'g' ? 'g' : 'c', tags: tagsBase });
    }
  }
  return lines;
}

interface DogstatsdConfig {
  host: string;
  port: number;
  metricPrefix?: string; // e.g. "myapp." — prepended to every metric name
  globalTags?: string[]; // applied to every line; e.g. ["env:prod","service:planner"]
}

function readConfig(): DogstatsdConfig | null {
  const host = process.env.DATADOG_STATSD_HOST;
  if (!host) return null;
  const port = Number(process.env.DATADOG_STATSD_PORT || 8125);
  const metricPrefix = process.env.DATADOG_STATSD_METRIC_PREFIX || '';
  const tagEnv = process.env.DATADOG_STATSD_GLOBAL_TAGS || '';
  const globalTags = tagEnv ? tagEnv.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { host, port, metricPrefix, globalTags };
}

/**
 * Build the Datadog statsd exporter. Returns null when env config is
 * missing — callers must check `!== null` before registering.
 */
export function buildDatadogStatsdExporter(): TelemetryExporter | null {
  const cfg = readConfig();
  if (!cfg) return null;

  const socket = dgram.createSocket('udp4');
  socket.on('error', (err) => {
    logger.warn('planner_exporter_dogstatsd_socket_error', { error: err.message });
  });
  try { socket.unref(); } catch { /* noop */ }

  const batcher = new ExporterBatcher<string>({
    exporterName: 'dogstatsd',
    kind: 'metrics',
    maxQueueSize: 10_000,
    flushBatchSize: 64,
    flushIntervalMs: 1_000,
    flush: async (packets: string[]) => {
      for (const pkt of packets) {
        await new Promise<void>((resolve, reject) => {
          socket.send(pkt, cfg.port, cfg.host, (err) => {
            if (err) reject(err); else resolve();
          });
        });
      }
    },
  });

  logger.info('planner_exporter_dogstatsd_started', {
    host: cfg.host, port: cfg.port, metric_prefix: cfg.metricPrefix, global_tags: cfg.globalTags,
  });

  return async (snapshot) => {
    const lines = snapshotToLines(snapshot);
    if (lines.length === 0) return;

    // Pack lines into MTU-safe UDP datagrams.
    let pkt = '';
    for (const raw of lines) {
      // Apply prefix + global tags.
      const prefixed: DogstatsdLine = {
        ...raw,
        metric: cfg.metricPrefix + raw.metric,
        tags: cfg.globalTags.length
          ? (raw.tags ? `${cfg.globalTags.join(',')},${raw.tags}` : cfg.globalTags.join(','))
          : raw.tags,
      };
      const serialized = lineToBytes(prefixed);
      if (pkt.length + serialized.length > SAFE_PACKET_BYTES && pkt.length > 0) {
        batcher.enqueue(pkt);
        pkt = '';
      }
      pkt += serialized;
    }
    if (pkt.length > 0) batcher.enqueue(pkt);
  };
}

/** Test-only: tear down the UDP socket bound by the exporter. */
export function __closeDatadogStatsdForTests(): void {
  /* the socket is owned by the closure; intentional no-op for now */
}
