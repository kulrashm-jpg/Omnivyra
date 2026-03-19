/**
 * Worker Auto-Scaling Signal — #5
 *
 * Monitors queue depth and job latency to emit scaling signals.
 * Works on Railway, Render, or any platform that can act on webhook signals.
 *
 * Signal types:
 *   SCALE_UP    — queue is too deep / latency too high → add workers
 *   SCALE_DOWN  — queue is quiet → remove idle workers
 *   STEADY      — within normal operating range
 *
 * Delivery mechanisms:
 *   1. HTTP webhook (AUTOSCALE_WEBHOOK_URL env var)
 *   2. File-based signal (AUTOSCALE_SIGNAL_FILE env var) — Railway reads env file
 *   3. Console log — always, for visibility
 *
 * On Railway:
 *   - Set AUTOSCALE_WEBHOOK_URL to a Railway deploy hook URL with ?numReplicas=N
 *   - Or use the file-based approach with a sidecar watcher
 *
 * Usage:
 *   Call checkAndSignal() on a schedule (e.g. every 30 seconds from cron.ts).
 *   Or import it in the worker startup and run it in a setInterval.
 */

import { writeFile } from 'fs/promises';
import { getQueue, getEngagementPollingQueue, getAiHeavyQueue, getPostingQueue } from '../queue/bullmqClient';

// ── Thresholds ─────────────────────────────────────────────────────────────────

const SCALE_UP_QUEUE_DEPTH   = 500;  // waiting jobs → add workers
const SCALE_DOWN_QUEUE_DEPTH = 50;   // idle threshold → remove workers
const SCALE_UP_LATENCY_MS    = 10_000; // avg job latency > 10s → add workers
const SCALE_DOWN_LATENCY_MS  = 2_000;  // avg job latency < 2s → may scale down

// Hysteresis: must exceed threshold for N consecutive checks before signalling
const HYSTERESIS_COUNT = 3;

// ── Types ──────────────────────────────────────────────────────────────────────

export type ScaleSignal = 'SCALE_UP' | 'SCALE_DOWN' | 'STEADY';

interface ScalingState {
  consecutiveScaleUp:   number;
  consecutiveScaleDown: number;
  lastSignal:           ScaleSignal;
  lastSignalAt:         number;
}

// ── State ─────────────────────────────────────────────────────────────────────

const _state: ScalingState = {
  consecutiveScaleUp:   0,
  consecutiveScaleDown: 0,
  lastSignal:           'STEADY',
  lastSignalAt:         0,
};

// ── Queue depth aggregation ───────────────────────────────────────────────────

async function getAggregateQueueDepth(): Promise<number> {
  const queues = [
    { fn: getQueue,                    name: 'publish' },
    { fn: getEngagementPollingQueue,   name: 'engagement-polling' },
    { fn: getAiHeavyQueue,             name: 'ai-heavy' },
    { fn: getPostingQueue,             name: 'posting' },
  ];

  let total = 0;
  for (const { fn } of queues) {
    try {
      const q = fn();
      const counts = await q.getJobCounts('waiting', 'active', 'delayed');
      total += (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    } catch {
      // Queue unavailable — skip
    }
  }
  return total;
}

// ── Signal delivery ───────────────────────────────────────────────────────────

async function deliverSignal(signal: ScaleSignal, depth: number, latencyMs: number): Promise<void> {
  const payload = {
    signal,
    queueDepth: depth,
    avgLatencyMs: latencyMs,
    timestamp: new Date().toISOString(),
    recommendation: signal === 'SCALE_UP'
      ? 'Increase worker replicas (suggested: +1 to +3)'
      : signal === 'SCALE_DOWN'
      ? 'Reduce worker replicas to save cost'
      : 'No action needed',
  };

  // Always log
  const logFn = signal === 'SCALE_UP' ? console.warn : console.info;
  logFn('[autoscale]', JSON.stringify(payload));

  // 1. HTTP webhook
  const webhookUrl = process.env.AUTOSCALE_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const url = signal === 'SCALE_UP'
        ? `${webhookUrl}&scaleUp=true`
        : signal === 'SCALE_DOWN'
        ? `${webhookUrl}&scaleDown=true`
        : webhookUrl;

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn('[autoscale] webhook delivery failed:', (err as Error).message);
    }
  }

  // 2. File-based signal (sidecar or Railway file watcher)
  const signalFile = process.env.AUTOSCALE_SIGNAL_FILE;
  if (signalFile) {
    try {
      await writeFile(signalFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('[autoscale] signal file write failed:', (err as Error).message);
    }
  }
}

// ── Main check ─────────────────────────────────────────────────────────────────

/**
 * Evaluate current queue depth + latency and emit a scaling signal if warranted.
 *
 * @param avgLatencyMs - Current average job processing latency (from metricsCollector)
 */
export async function checkAndSignal(avgLatencyMs = 0): Promise<ScaleSignal> {
  let depth: number;
  try {
    depth = await getAggregateQueueDepth();
  } catch {
    return 'STEADY';
  }

  const needsScaleUp =
    depth >= SCALE_UP_QUEUE_DEPTH || avgLatencyMs >= SCALE_UP_LATENCY_MS;
  const canScaleDown =
    depth <= SCALE_DOWN_QUEUE_DEPTH && avgLatencyMs <= SCALE_DOWN_LATENCY_MS;

  if (needsScaleUp) {
    _state.consecutiveScaleDown = 0;
    _state.consecutiveScaleUp++;

    if (_state.consecutiveScaleUp >= HYSTERESIS_COUNT) {
      _state.consecutiveScaleUp = 0; // reset after firing
      _state.lastSignal  = 'SCALE_UP';
      _state.lastSignalAt = Date.now();
      await deliverSignal('SCALE_UP', depth, avgLatencyMs);
      return 'SCALE_UP';
    }
  } else if (canScaleDown) {
    _state.consecutiveScaleUp = 0;
    _state.consecutiveScaleDown++;

    if (_state.consecutiveScaleDown >= HYSTERESIS_COUNT) {
      // Only signal scale-down if we haven't already done it recently (10 min cooldown)
      const cooldownMs = 10 * 60 * 1000;
      if (_state.lastSignal !== 'SCALE_DOWN' || Date.now() - _state.lastSignalAt > cooldownMs) {
        _state.consecutiveScaleDown = 0;
        _state.lastSignal   = 'SCALE_DOWN';
        _state.lastSignalAt = Date.now();
        await deliverSignal('SCALE_DOWN', depth, avgLatencyMs);
        return 'SCALE_DOWN';
      }
    }
  } else {
    _state.consecutiveScaleUp   = 0;
    _state.consecutiveScaleDown = 0;
  }

  return 'STEADY';
}

/**
 * Start a background polling loop.
 * Call once from your worker process entry point.
 *
 * @param intervalMs - How often to check (default 30 seconds)
 * @param getLatency - Function to get current avg latency from metricsCollector
 */
export function startAutoScalingMonitor(
  intervalMs = 30_000,
  getLatency: () => number = () => 0,
): () => void {
  const timer = setInterval(async () => {
    try {
      await checkAndSignal(getLatency());
    } catch {
      // Non-fatal
    }
  }, intervalMs);

  // Return cleanup function
  return () => clearInterval(timer);
}
