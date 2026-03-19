/**
 * In-process metrics collector — RISK 5: Observability
 *
 * Lightweight, zero-dependency metrics that accumulate in memory.
 * Designed for serverless (resets per-process) but useful for Railway workers
 * that stay alive long-term.
 *
 * Tracks:
 *   - AI cache exact hits / near-hits / misses / template hits
 *   - GPT call count (used to compute calls-per-minute)
 *   - AI call latency samples (rolling 100-sample window)
 *   - Redis connectivity + memory
 *
 * Import recordXxx() from this module in the appropriate hot paths:
 *   - aiResponseCache.ts  → recordCacheHit / recordCacheMiss / recordNearHit
 *   - aiGateway.ts        → recordGptCall / recordGptLatency
 *   - aiTemplateLayer.ts  → recordTemplateHit
 */

import { getSharedRedisClient } from '../queue/bullmqClient';

// ── Counters ──────────────────────────────────────────────────────────────────

let _exactHits    = 0;
let _nearHits     = 0;
let _misses       = 0;
let _templateHits = 0;
let _gptCalls     = 0;
let _gptFailures  = 0;

// Sliding window for latency (last 100 samples)
const _latencySamples: number[] = [];
const MAX_LATENCY_SAMPLES = 100;

// GPT call timestamps for calls-per-minute computation (last 60s)
const _gptTimestamps: number[] = [];

// ── Recording functions (called from hot paths) ───────────────────────────────

export function recordCacheExactHit() { _exactHits++; }
export function recordCacheNearHit()  { _nearHits++; }
export function recordCacheMiss()     { _misses++; }
export function recordTemplateHit()   { _templateHits++; }

export function recordGptCall() {
  _gptCalls++;
  const now = Date.now();
  _gptTimestamps.push(now);
  // Keep only last 60 seconds
  const cutoff = now - 60_000;
  while (_gptTimestamps.length > 0 && _gptTimestamps[0] < cutoff) {
    _gptTimestamps.shift();
  }
}

/** Increment GPT failure counter. Call from aiGateway catch block. */
export function recordGptFailure() { _gptFailures++; }

export function recordGptLatency(ms: number) {
  _latencySamples.push(ms);
  if (_latencySamples.length > MAX_LATENCY_SAMPLES) {
    _latencySamples.shift();
  }
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  cacheExactHits:    number;
  cacheNearHits:     number;
  cacheMisses:       number;
  cacheHitRate:      number;   // 0–1
  templateHitRate:   number;   // 0–1
  gptCallsPerMinute: number;
  gptCallsTotal:     number;
  gptFailures:       number;
  avgLatencyMs:      number;
  redisMemoryMb:     number | null;
  redisConnected:    boolean;
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const total   = _exactHits + _nearHits + _misses;
  const cacheHitRate = total > 0 ? (_exactHits + _nearHits) / total : 0;

  const blueprintTotal = _exactHits + _nearHits + _misses + _templateHits;
  const templateHitRate = blueprintTotal > 0 ? _templateHits / blueprintTotal : 0;

  const avgLatencyMs = _latencySamples.length > 0
    ? _latencySamples.reduce((a, b) => a + b, 0) / _latencySamples.length
    : 0;

  // Redis info — use shared singleton, never create a new connection here
  let redisMemoryMb: number | null = null;
  let redisConnected = false;
  try {
    const client = getSharedRedisClient();
    const info = await client.info('memory');
    redisConnected = true;
    const match = info.match(/used_memory:(\d+)/);
    if (match) {
      redisMemoryMb = Math.round(parseInt(match[1]) / 1024 / 1024 * 10) / 10;
    }
  } catch {
    redisConnected = false;
  }

  return {
    cacheExactHits:    _exactHits,
    cacheNearHits:     _nearHits,
    cacheMisses:       _misses,
    cacheHitRate:      Math.round(cacheHitRate * 1000) / 1000,
    templateHitRate:   Math.round(templateHitRate * 1000) / 1000,
    gptCallsPerMinute: _gptTimestamps.length,
    gptCallsTotal:     _gptCalls,
    gptFailures:       _gptFailures,
    avgLatencyMs:      Math.round(avgLatencyMs),
    redisMemoryMb,
    redisConnected,
  };
}

// ── Campaign-level metrics (Upgrade F) ────────────────────────────────────────

interface CampaignMetricEntry {
  gptCalls:   number;
  elapsedMs:  number;
  confidence: number;
  planTier:   string;
  at:         number;
}

const _campaignMetrics: CampaignMetricEntry[] = [];
const MAX_CAMPAIGN_METRICS = 200;

/**
 * Record per-campaign planning metrics (called by campaignPlanningProcessor).
 * Stored in a rolling buffer; surfaced via getMetricsSnapshot().
 */
export function recordCampaignMetric(opts: {
  gptCalls:   number;
  elapsedMs:  number;
  confidence: number;
  planTier:   string;
}): void {
  _campaignMetrics.push({ ...opts, at: Date.now() });
  if (_campaignMetrics.length > MAX_CAMPAIGN_METRICS) {
    _campaignMetrics.shift();
  }
}

/**
 * Summarize recent campaign metrics (last N entries).
 */
export function getCampaignMetricsSummary(last = 50): {
  count:         number;
  avgGptCalls:   number;
  avgElapsedMs:  number;
  avgConfidence: number;
} {
  const slice = _campaignMetrics.slice(-last);
  if (slice.length === 0) return { count: 0, avgGptCalls: 0, avgElapsedMs: 0, avgConfidence: 0 };
  const avg = (fn: (e: CampaignMetricEntry) => number) =>
    Math.round((slice.reduce((s, e) => s + fn(e), 0) / slice.length) * 100) / 100;
  return {
    count:         slice.length,
    avgGptCalls:   avg(e => e.gptCalls),
    avgElapsedMs:  avg(e => e.elapsedMs),
    avgConfidence: avg(e => e.confidence),
  };
}

export function resetMetrics() {
  _exactHits    = 0;
  _nearHits     = 0;
  _misses       = 0;
  _templateHits = 0;
  _gptCalls     = 0;
  _gptFailures  = 0;
  _latencySamples.length  = 0;
  _gptTimestamps.length   = 0;
  _campaignMetrics.length = 0;
}
