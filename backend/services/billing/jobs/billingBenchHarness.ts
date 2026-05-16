/**
 * Billing Bench Harness — Phase 3 D
 *
 * In-process benchmarking harness for the orchestrator + middleware. NOT a
 * load-testing tool (use k6 / Artillery for that) — this is for catching
 * obvious slowness in the credit-path during dev + CI smoke runs.
 *
 * Measures:
 *   - Per-call latency of buildBillingIdempotencyKey
 *   - Per-call latency of fingerprintPayload
 *   - Per-call latency of seedBillingCorrelation
 *   - 1k iterations of each
 *
 * Returns structured results. Real workload latency (RPC roundtrip, lock
 * contention) is validated by separate integration tests against a real DB.
 */

import { buildBillingIdempotencyKey, fingerprintPayload } from '../billingIdempotencyService';
import { seedBillingCorrelation, buildExecutionHash } from '../billingCorrelationService';

export interface BenchResult {
  name:           string;
  iterations:     number;
  totalMs:        number;
  p50Ms:          number;
  p95Ms:          number;
  p99Ms:          number;
  avgMs:          number;
  opsPerSecond:   number;
}

function bench(name: string, iterations: number, fn: () => unknown): BenchResult {
  // Warm-up
  for (let i = 0; i < 100; i++) fn();
  const samples: number[] = new Array(iterations);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    samples[i] = Number(t1 - t0) / 1_000_000; // ns → ms
  }
  const totalMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  samples.sort((a, b) => a - b);
  const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    name,
    iterations,
    totalMs,
    p50Ms:        pct(0.5),
    p95Ms:        pct(0.95),
    p99Ms:        pct(0.99),
    avgMs:        sum / iterations,
    opsPerSecond: iterations / (totalMs / 1000),
  };
}

export function runBillingMicroBench(iterations = 1000): BenchResult[] {
  const samplePayload = { a: 1, b: 'two', c: { nested: true, list: [1, 2, 3] } };
  const results: BenchResult[] = [];

  results.push(bench('buildBillingIdempotencyKey:http', iterations, () =>
    buildBillingIdempotencyKey({
      kind: 'http', actorUserId: 'u1', action: 'content_rewrite',
      referenceId: 'r1', requestBody: samplePayload,
    })));

  results.push(bench('buildBillingIdempotencyKey:queue', iterations, () =>
    buildBillingIdempotencyKey({
      kind: 'queue', queueName: 'q', jobId: 'j', organizationId: 'o',
      action: 'content_generation', payloadFingerprint: 'fp-abc',
    })));

  results.push(bench('fingerprintPayload', iterations, () =>
    fingerprintPayload(samplePayload)));

  results.push(bench('buildExecutionHash', iterations, () =>
    buildExecutionHash({ queueName: 'q', jobId: 'j', payloadFingerprint: 'fp' })));

  results.push(bench('seedBillingCorrelation', iterations, () =>
    seedBillingCorrelation({ module: 'bench', seed: 'job-1' })));

  return results;
}
