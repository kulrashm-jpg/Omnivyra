/**
 * billingCorrelationService — unit tests
 *
 * Covers:
 *   - deriveCorrelationId is deterministic (queue retries share lineage)
 *   - buildExecutionHash distinguishes (queue, job, payload) tuples
 *   - seedBillingCorrelation produces stable IDs given a seed
 */

import {
  deriveCorrelationId,
  buildExecutionHash,
  seedBillingCorrelation,
  getBillingCorrelation,
} from '../../services/billing/billingCorrelationService';

describe('billingCorrelationService', () => {
  it('deriveCorrelationId is deterministic', () => {
    const a = deriveCorrelationId('queue:content-gen', 'job-1');
    const b = deriveCorrelationId('queue:content-gen', 'job-1');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('deriveCorrelationId differentiates modules', () => {
    const a = deriveCorrelationId('queue:a', 'job-1');
    const b = deriveCorrelationId('queue:b', 'job-1');
    expect(a).not.toBe(b);
  });

  it('buildExecutionHash distinguishes payloads even with same job_id', () => {
    const a = buildExecutionHash({ queueName: 'q', jobId: 'j', payloadFingerprint: 'fp-A' });
    const b = buildExecutionHash({ queueName: 'q', jobId: 'j', payloadFingerprint: 'fp-B' });
    expect(a).not.toBe(b);
  });

  it('seedBillingCorrelation with same seed yields same correlationId', () => {
    const a = seedBillingCorrelation({ module: 'queue:x', seed: 'job-1' });
    const b = seedBillingCorrelation({ module: 'queue:x', seed: 'job-1' });
    expect(a.correlationId).toBe(b.correlationId);
  });

  it('getBillingCorrelation falls back to a synthesized id when no request context', () => {
    const c = getBillingCorrelation({ module: 'whatever' });
    expect(typeof c.correlationId).toBe('string');
    expect(c.correlationId.length).toBeGreaterThan(0);
  });
});
