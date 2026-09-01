/**
 * PHASE 168 — /api/bolt/execute request idempotency.
 *
 * Phase 167 proved one user action produced two campaigns and two executions
 * 1.6s apart: same company, same user, same title, `generatedCampaignId` null so
 * the endpoint's only duplicate guard could not fire.
 *
 * The fingerprint identifies the REQUEST. These tests pin both directions:
 * genuinely identical intent must collide, and anything a user could
 * meaningfully change must NOT collide (or the guard would block legitimate
 * work, which is worse than the duplicate it prevents).
 */

import {
  computeBoltRequestFingerprint,
  isLiveBoltRequestDuplicateViolation,
  BOLT_IDEMPOTENCY_PAYLOAD_KEY,
  BOLT_LIVE_REQUEST_UNIQUE_INDEX,
  type BoltRequestIdentity,
} from '../../services/boltExecuteIdempotency';

const base: BoltRequestIdentity = {
  companyId: 'company-1',
  userId: 'user-1',
  recId: 'rec-1',
  sourceOpportunityId: null,
  generatedCampaignId: null,
  outcomeView: 'week_plan',
  title: 'Why Ai-driven Insights for Campaign Success Is Becoming Hard',
  executionConfig: { campaign_mode: 'text', frequency: 3, selected_platforms: ['linkedin', 'x'] },
  sourceStrategicTheme: { id: 'theme-1', title: 'Insight-led GTM' },
};

const fp = (o: Partial<BoltRequestIdentity> = {}) =>
  computeBoltRequestFingerprint({ ...base, ...o });

describe('A. the duplicate that actually happened is caught', () => {
  test('two identical submissions produce the same fingerprint', () => {
    expect(fp()).toBe(fp());
  });

  test('the Phase 167 shape — same title, null campaign id — collides', () => {
    const first = fp({ generatedCampaignId: null });
    const second = fp({ generatedCampaignId: null });
    expect(first).toBe(second);
  });

  test('property order does not change identity', () => {
    const a = computeBoltRequestFingerprint({
      ...base,
      executionConfig: { frequency: 3, selected_platforms: ['linkedin', 'x'], campaign_mode: 'text' },
    });
    expect(a).toBe(fp());
  });

  test('a fingerprint is a stable sha256 hex digest', () => {
    expect(fp()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('B. legitimate work is never blocked', () => {
  test('a different company does not collide', () => {
    expect(fp({ companyId: 'company-2' })).not.toBe(fp());
  });

  test('a different user does not collide', () => {
    expect(fp({ userId: 'user-2' })).not.toBe(fp());
  });

  test('the SAME title with a genuinely different config does not collide', () => {
    expect(fp({ executionConfig: { campaign_mode: 'creator', frequency: 3 } })).not.toBe(fp());
  });

  test('a different platform selection does not collide', () => {
    expect(fp({ executionConfig: { ...(base.executionConfig as object), selected_platforms: ['linkedin'] } }))
      .not.toBe(fp());
  });

  test('a different strategic theme does not collide', () => {
    expect(fp({ sourceStrategicTheme: { id: 'theme-2', title: 'Other' } })).not.toBe(fp());
  });

  test('a different outcome view does not collide', () => {
    expect(fp({ outcomeView: 'daily_plan' })).not.toBe(fp());
  });

  test('a different recommendation card does not collide', () => {
    expect(fp({ recId: 'rec-2' })).not.toBe(fp());
  });
});

describe('C. server-derived noise must not defeat the guard', () => {
  test('theme prose that varies between renders does not change identity', () => {
    const a = computeBoltRequestFingerprint({
      ...base,
      sourceStrategicTheme: { id: 'theme-1', title: 'Insight-led GTM', rationale: 'generated text A' },
    });
    const b = computeBoltRequestFingerprint({
      ...base,
      sourceStrategicTheme: { id: 'theme-1', title: 'Insight-led GTM', rationale: 'generated text B' },
    });
    expect(a).toBe(b);
  });

  test('absent optional fields are stable across null and undefined', () => {
    expect(fp({ sourceOpportunityId: null })).toBe(fp({ sourceOpportunityId: undefined }));
  });

  test('a null theme is handled without throwing', () => {
    expect(() => fp({ sourceStrategicTheme: null })).not.toThrow();
  });
});

describe('D. concurrent-race arbitration', () => {
  test('a 23505 naming the live-request index is recognised', () => {
    expect(isLiveBoltRequestDuplicateViolation({
      code: '23505',
      message: `duplicate key value violates unique constraint "${BOLT_LIVE_REQUEST_UNIQUE_INDEX}"`,
    })).toBe(true);
  });

  test('a 23505 from an UNRELATED constraint is not mistaken for a duplicate request', () => {
    expect(isLiveBoltRequestDuplicateViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "some_other_idx"',
    })).toBe(false);
  });

  test('a non-23505 error is not a duplicate', () => {
    expect(isLiveBoltRequestDuplicateViolation({ code: '42703', message: 'column missing' })).toBe(false);
  });

  test('null / malformed errors are handled', () => {
    expect(isLiveBoltRequestDuplicateViolation(null)).toBe(false);
    expect(isLiveBoltRequestDuplicateViolation(undefined)).toBe(false);
    expect(isLiveBoltRequestDuplicateViolation('boom')).toBe(false);
  });
});

describe('E. payload contract', () => {
  test('the key the endpoint stamps matches the one the index reads', () => {
    expect(BOLT_IDEMPOTENCY_PAYLOAD_KEY).toBe('idempotency_key');
  });
});
