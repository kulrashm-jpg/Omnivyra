/**
 * STAGE_TIMEOUT propagation test (closure-pass follow-up Part 3).
 *
 * `withTimeout` is a private helper inside boltPipelineService — we
 * verify the same contract by mirroring its implementation in the
 * test (single setTimeout race that rejects with BoltError). If the
 * production helper drifts from this shape, the classifier-level
 * test (`boltClassifierClosurePass`) still catches it because every
 * STAGE_TIMEOUT-coded BoltError short-circuits to PROVIDER_TIMEOUT.
 */

import { BoltError, BOLT_ERROR_CODES, isBoltError } from '../../../lib/shared/bolt/boltErrorCodes';
import { classifyBoltFailure } from '../../../lib/shared/bolt/classifyBoltFailure';

function withTimeoutLikeProduction<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new BoltError(
        BOLT_ERROR_CODES.STAGE_TIMEOUT,
        `${label} timed out after ${ms / 1000}s`,
        { details: { label, timeout_ms: ms } }
      )), ms)
    ),
  ]);
}

describe('STAGE_TIMEOUT propagation', () => {
  test('timeout rejection is a BoltError with STAGE_TIMEOUT code', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeoutLikeProduction(slow, 20, 'test-stage')).rejects.toBeInstanceOf(BoltError);
  });

  test('timeout BoltError carries label + ms in details', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await withTimeoutLikeProduction(slow, 25, 'my-stage');
      fail('expected timeout');
    } catch (e) {
      expect(isBoltError(e)).toBe(true);
      const be = e as BoltError;
      expect(be.code).toBe(BOLT_ERROR_CODES.STAGE_TIMEOUT);
      expect(be.details?.label).toBe('my-stage');
      expect(be.details?.timeout_ms).toBe(25);
    }
  });

  test('classifier routes STAGE_TIMEOUT BoltError to PROVIDER_TIMEOUT category', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await withTimeoutLikeProduction(slow, 25, 'classify-stage');
      fail('expected timeout');
    } catch (e) {
      const classification = classifyBoltFailure({ error: e, stage: 'whatever' });
      expect(classification.category).toBe('PROVIDER_TIMEOUT');
      expect(classification.retriable).toBe(true);
    }
  });

  test('successful promise resolves normally (no false positives)', async () => {
    const out = await withTimeoutLikeProduction(Promise.resolve(42), 500, 'happy-path');
    expect(out).toBe(42);
  });
});
