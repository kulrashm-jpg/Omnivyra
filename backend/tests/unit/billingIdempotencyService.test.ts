/**
 * billingIdempotencyService — unit tests
 *
 * Covers:
 *   - Deterministic key derivation per caller class (http / queue / webhook / cron)
 *   - HOLD / CONFIRM / RELEASE suffix correctness
 *   - Stable fingerprinting (same payload → same key on retry)
 *   - Distinct fingerprints for distinct payloads
 */

import {
  buildBillingIdempotencyKey,
  fingerprintPayload,
} from '../../services/billing/billingIdempotencyService';

describe('billingIdempotencyService', () => {
  it('derives stable keys for queue retries with the same payload', () => {
    const fp = fingerprintPayload({ contentId: 'abc', userId: 'u1', n: 5 });
    const k1 = buildBillingIdempotencyKey({
      kind: 'queue',
      queueName: 'content-gen',
      jobId: 'job-42',
      organizationId: 'org-1',
      action: 'content_generation',
      payloadFingerprint: fp,
    });
    const k2 = buildBillingIdempotencyKey({
      kind: 'queue',
      queueName: 'content-gen',
      jobId: 'job-42',
      organizationId: 'org-1',
      action: 'content_generation',
      payloadFingerprint: fp,
    });
    expect(k1.root).toBe(k2.root);
    expect(k1.hold).toBe(`${k1.root}:hold`);
    expect(k1.confirm).toBe(`${k1.root}:confirm`);
    expect(k1.release).toBe(`${k1.root}:release`);
  });

  it('produces distinct keys for distinct payloads on the same job id', () => {
    const fpA = fingerprintPayload({ contentId: 'abc' });
    const fpB = fingerprintPayload({ contentId: 'xyz' });
    const a = buildBillingIdempotencyKey({
      kind: 'queue', queueName: 'q', jobId: 'j', organizationId: 'o', action: 'content_generation', payloadFingerprint: fpA,
    });
    const b = buildBillingIdempotencyKey({
      kind: 'queue', queueName: 'q', jobId: 'j', organizationId: 'o', action: 'content_generation', payloadFingerprint: fpB,
    });
    expect(a.root).not.toBe(b.root);
  });

  it('webhook keys are deterministic per (provider, event_id)', () => {
    const a = buildBillingIdempotencyKey({ kind: 'webhook', provider: 'razorpay', providerEventId: 'evt_1' });
    const b = buildBillingIdempotencyKey({ kind: 'webhook', provider: 'razorpay', providerEventId: 'evt_1' });
    const c = buildBillingIdempotencyKey({ kind: 'webhook', provider: 'razorpay', providerEventId: 'evt_2' });
    expect(a.root).toBe(b.root);
    expect(a.root).not.toBe(c.root);
  });

  it('http keys include header idempotency when present', () => {
    const a = buildBillingIdempotencyKey({
      kind: 'http', actorUserId: 'u', action: 'content_rewrite', referenceId: 'r', requestBody: { a: 1 },
      requestHeaderIdempotency: 'header-key-1',
    });
    const b = buildBillingIdempotencyKey({
      kind: 'http', actorUserId: 'u', action: 'content_rewrite', referenceId: 'r', requestBody: { a: 1 },
      requestHeaderIdempotency: 'header-key-2',
    });
    expect(a.root).not.toBe(b.root);
  });

  it('cron keys bucket by configured window', () => {
    // Two calls within the same hour bucket → same key
    const a = buildBillingIdempotencyKey({
      kind: 'cron', cronName: 'reconcile', action: 'reconciliation', bucketSeconds: 3600,
    });
    const b = buildBillingIdempotencyKey({
      kind: 'cron', cronName: 'reconcile', action: 'reconciliation', bucketSeconds: 3600,
    });
    expect(a.root).toBe(b.root);
  });

  it('fingerprintPayload is order-stable for objects', () => {
    const a = fingerprintPayload({ b: 2, a: 1 });
    const b = fingerprintPayload({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('fingerprintPayload distinguishes value differences', () => {
    expect(fingerprintPayload({ a: 1 })).not.toBe(fingerprintPayload({ a: 2 }));
    expect(fingerprintPayload([1, 2, 3])).not.toBe(fingerprintPayload([1, 2, 4]));
  });
});
