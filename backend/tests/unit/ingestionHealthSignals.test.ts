/**
 * Phase 99 — the ingestion cycle says what is broken, and only escalates when
 * something actually is.
 *
 * WHAT THIS GUARDS
 * ----------------
 * Ingestion failed every post on every 10-minute cycle for weeks and nothing
 * surfaced it, because the summary was three numbers:
 *
 *     processed: 11, total_ingested: 0, errors: 11
 *
 * which cannot say which provider failed, why, or whether a human has to act.
 *
 * The two properties that matter, and that these tests pin:
 *
 *   1. A failing cycle is ATTRIBUTABLE — provider and typed reason, per cycle.
 *   2. `processed: 0` is NEVER actionable. It means the window found no
 *      eligible post, which is production's current, healthy state. An alert
 *      on zero would fire forever and train everyone to ignore it — the exact
 *      failure mode that let the real outage hide.
 */

export {};

import {
  summarizeIngestionCycle,
  ingestionCycleLogPayload,
  type IngestOutcome,
} from '../../services/engagement/ingestionHealth';

const ok = (platform: string): IngestOutcome => ({ platform, success: true });
const fail = (platform: string, failure: any): IngestOutcome => ({ platform, success: false, failure });

describe('A — cycle classification', () => {
  it('CRITICAL: no eligible work is idle, never actionable', () => {
    const s = summarizeIngestionCycle([], 0);
    expect(s.health).toBe('idle');
    // The whole point. Production sits here whenever nothing was published
    // inside the window, which is not a fault and must never page anyone.
    expect(s.actionable).toBe(false);
    expect(s.processed).toBe(0);
  });

  it('CRITICAL: eligible work where EVERYTHING failed is failing and actionable', () => {
    const s = summarizeIngestionCycle(
      [fail('linkedin', 'needs_reauth'), fail('linkedin', 'needs_reauth'), fail('x', 'not_found')],
      0,
    );
    expect(s.health).toBe('failing');
    expect(s.actionable).toBe(true);
    expect(s.failed).toBe(3);
    expect(s.succeeded).toBe(0);
  });

  it('CRITICAL: a partial failure is degraded but NOT actionable', () => {
    // One bad connection among several must not page anyone.
    const s = summarizeIngestionCycle([ok('x'), fail('linkedin', 'needs_reauth')], 4);
    expect(s.health).toBe('degraded');
    expect(s.actionable).toBe(false);
  });

  it('all succeeded is healthy', () => {
    const s = summarizeIngestionCycle([ok('x'), ok('linkedin')], 7);
    expect(s.health).toBe('healthy');
    expect(s.actionable).toBe(false);
    expect(s.failed).toBe(0);
  });

  it('CRITICAL: success with zero comments is healthy, not a failure', () => {
    // A provider request that legitimately finds no replies is a success.
    // Conflating it with failure would make every quiet post look broken.
    const s = summarizeIngestionCycle([ok('x'), ok('x')], 0);
    expect(s.health).toBe('healthy');
    expect(s.totalIngested).toBe(0);
    expect(s.actionable).toBe(false);
  });
});

describe('B — failures are attributable', () => {
  const s = summarizeIngestionCycle(
    [
      fail('linkedin', 'needs_reauth'),
      fail('LinkedIn', 'needs_reauth'),
      fail('x', 'not_found'),
      ok('x'),
    ],
    2,
  );

  it('CRITICAL: counts failures by provider', () => {
    // Case-normalised, so 'LinkedIn' and 'linkedin' are one provider.
    expect(s.byProvider).toEqual({ linkedin: 2, x: 1 });
  });

  it('CRITICAL: counts failures by typed reason', () => {
    expect(s.byFailureKind).toEqual({ needs_reauth: 2, not_found: 1 });
  });

  it('CRITICAL: surfaces the count a human must act on', () => {
    // needs_reauth is the one reason no retry can fix.
    expect(s.needsReauth).toBe(2);
  });

  it('successes are not attributed — the breakdown is "what went wrong"', () => {
    const total = Object.values(s.byProvider).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.failed);
    expect(total).not.toBe(s.processed);
  });

  it('an untyped failure lands in the provider catch-all, still attributed', () => {
    const u = summarizeIngestionCycle([{ platform: 'x', success: false }], 0);
    expect(u.byFailureKind).toEqual({ provider: 1 });
    expect(u.byProvider).toEqual({ x: 1 });
  });

  it('a missing platform is attributed to unknown rather than dropped', () => {
    const u = summarizeIngestionCycle([{ platform: null, success: false, failure: 'provider' }], 0);
    expect(u.byProvider).toEqual({ unknown: 1 });
    expect(u.failed).toBe(1);
  });
});

describe('C — the log payload leaks nothing', () => {
  const payload = ingestionCycleLogPayload(summarizeIngestionCycle(
    [fail('linkedin', 'needs_reauth'), fail('x', 'auth')], 0,
  ));
  const serialized = JSON.stringify(payload);

  it('CRITICAL: carries no ids, URLs, tokens or provider bodies', () => {
    for (const forbidden of ['Bearer', 'access_token', 'refresh_token', 'https://', 'scheduled_post_id', 'social_account_id']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('carries exactly the operator-facing fields', () => {
    expect(payload).toMatchObject({
      health: 'failing',
      actionable: true,
      processed: 2,
      succeeded: 0,
      failed: 2,
      total_ingested: 0,
      needs_reauth: 1,
    });
    expect(payload.by_provider).toEqual({ linkedin: 1, x: 1 });
    expect(payload.by_failure_kind).toEqual({ needs_reauth: 1, auth: 1 });
  });

  it('an idle cycle reports as such rather than as a failure', () => {
    const p = ingestionCycleLogPayload(summarizeIngestionCycle([], 0));
    expect(p.health).toBe('idle');
    expect(p.actionable).toBe(false);
    expect(p.by_provider).toEqual({});
  });
});
