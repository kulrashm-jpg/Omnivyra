/**
 * Validation — Step-R6 enterprise render governance + analytics.
 *
 *   1  governance quota enforcement
 *   2  emergency stop enforcement (org + global dominance)
 *   3  provider allowlist / disable enforcement
 *   4  queue pause behavior
 *   5  analytics aggregation correctness
 *   6  operational-health analytics shape
 *   7  worker/queue metric aggregation
 *   8  scheduler isolation (structural)
 *   9  R3/R4/R5 compatibility (no core modified — regression elsewhere)
 *   10 backward compatibility (no row ⇒ capped defaults; coerce garbage)
 *
 * Pure modules — no network. LIVE micro-check: governance row mutable +
 * sentinel present (tx + rollback).
 */

import {
  evaluateRenderGovernance, defaultGovernance, coerceGovernanceRow,
  aggregateRenderAnalytics, GLOBAL_GOVERNANCE_SENTINEL,
  type RenderGovernanceState,
} from '../../services/creator/rendering';
import * as fs from 'fs';

const ORG = 'org-1';
const base = (): RenderGovernanceState => defaultGovernance(ORG);
const ctx = (o: Partial<{ provider: string; assetFamily: string; daily: number; conc: number }> = {}) => ({
  provider: o.provider ?? 'openai',
  assetFamily: o.assetFamily ?? 'image',
  dailyRenderCount: o.daily ?? 0,
  concurrentRenderCount: o.conc ?? 0,
});

describe('Validation-1/2/3/4 — governance enforcement (fail-closed)', () => {
  it('allows under defaults; quota / concurrency / provider / family blocks', () => {
    expect(evaluateRenderGovernance(base(), null, ctx()).allowed).toBe(true);

    expect(evaluateRenderGovernance({ ...base(), max_daily_renders: 5 }, null, ctx({ daily: 5 })))
      .toMatchObject({ allowed: false, event: 'quota_exceeded' });

    expect(evaluateRenderGovernance({ ...base(), max_concurrent_renders: 2 }, null, ctx({ conc: 2 })))
      .toMatchObject({ allowed: false, event: 'provider_rate_limited' });

    expect(evaluateRenderGovernance({ ...base(), disabled_providers: ['openai'] }, null, ctx()))
      .toMatchObject({ allowed: false, event: 'provider_disabled' });

    expect(evaluateRenderGovernance({ ...base(), allowed_providers: ['runway'] }, null, ctx({ provider: 'openai' })))
      .toMatchObject({ allowed: false, event: 'provider_disabled' });

    expect(evaluateRenderGovernance({ ...base(), allowed_asset_families: ['video'] }, null, ctx({ assetFamily: 'image' })))
      .toMatchObject({ allowed: false, event: 'governance_blocked' });

    expect(evaluateRenderGovernance({ ...base(), rendering_enabled: false }, null, ctx()))
      .toMatchObject({ allowed: false, event: 'governance_blocked' });
  });

  it('emergency stop + queue pause; GLOBAL sentinel dominates org', () => {
    expect(evaluateRenderGovernance({ ...base(), emergency_stop: true }, null, ctx()))
      .toMatchObject({ allowed: false, event: 'emergency_stop_active' });
    expect(evaluateRenderGovernance({ ...base(), queue_paused: true }, null, ctx()))
      .toMatchObject({ allowed: false, event: 'queue_paused' });
    // org healthy but GLOBAL emergency stop ⇒ still blocked (dominates)
    const globalStop = { ...defaultGovernance(GLOBAL_GOVERNANCE_SENTINEL), emergency_stop: true };
    expect(evaluateRenderGovernance(base(), globalStop, ctx()))
      .toMatchObject({ allowed: false, event: 'emergency_stop_active' });
    const globalPause = { ...defaultGovernance(GLOBAL_GOVERNANCE_SENTINEL), queue_paused: true };
    expect(evaluateRenderGovernance(base(), globalPause, ctx()))
      .toMatchObject({ allowed: false, event: 'queue_paused' });
  });
});

describe('Validation-10 — backward compatibility (defaults / coerce)', () => {
  it('no org row ⇒ capped defaults allow; garbage row coerces fail-closed', () => {
    const d = defaultGovernance(ORG);
    expect(d.rendering_enabled).toBe(true);
    expect(d.max_daily_renders).toBeGreaterThan(0); // capped, never unbounded
    expect(evaluateRenderGovernance(null, null, ctx()).allowed).toBe(true);
    const c = coerceGovernanceRow({ rendering_enabled: 'nope', max_daily_renders: 'x', emergency_stop: 1 }, ORG);
    expect(c.rendering_enabled).toBe(true);          // only explicit false disables
    expect(c.max_daily_renders).toBe(200);           // bad number → safe default
    expect(c.emergency_stop).toBe(false);            // only literal true
    expect(coerceGovernanceRow(null, ORG)).toEqual(defaultGovernance(ORG));
  });
});

describe('Validation-5/6/7 — analytics aggregation (no PII)', () => {
  it('computes rates / cost / reuse from operational rows', () => {
    const a = aggregateRenderAnalytics({
      queueRows: [
        { queue_state: 'completed', retry_count: 0, created_at: '2026-05-16T00:00:00Z', updated_at: '2026-05-16T00:00:10Z' },
        { queue_state: 'completed', retry_count: 1, created_at: '2026-05-16T00:00:00Z', updated_at: '2026-05-16T00:00:20Z' },
        { queue_state: 'failed', retry_count: 2 },
        { queue_state: 'queued', retry_count: 0 },
      ],
      attemptRows: [{ status: 'succeeded' }, { status: 'failed' }, { status: 'timed_out' }],
      jobStateRows: [{ current_state: 'attached' }, { current_state: 'failed_moderation_post' }],
      staleLeaseCount: 1,
      duplicateReuseCount: 2,
    });
    expect(a.total_jobs).toBe(4);
    expect(a.render_success_rate).toBe(0.5);          // 2/4
    expect(a.retry_rate).toBe(0.5);                   // 2/4 have retry_count>0
    expect(a.provider_failure_rate).toBeCloseTo(0.667, 2); // 2/3 attempts
    expect(a.avg_queue_latency_ms).toBe(15000);       // (10s+20s)/2
    expect(a.estimated_cost_credits).toBe(10);        // 2 completed * 5
    expect(a.reuse_savings_credits).toBe(10);         // 2 prevented * 5
    expect(a.prevented_duplicate_renders).toBe(2);
    expect(a.moderation_block_rate).toBeGreaterThan(0);
    // No PII: only numeric metrics in the output
    for (const v of Object.values(a)) expect(typeof v).toBe('number');
  });
  it('empty input ⇒ all-zero, no divide-by-zero', () => {
    const a = aggregateRenderAnalytics({ queueRows: [], attemptRows: [], jobStateRows: [] });
    expect(a.total_jobs).toBe(0);
    expect(a.render_success_rate).toBe(0);
    expect(a.estimated_cost_credits).toBe(0);
  });
});

describe('Validation-8 — scheduler isolation (structural)', () => {
  it('governance + analytics import nothing from scheduler / DB', () => {
    for (const f of [
      'backend/services/creator/rendering/governance/renderGovernance.ts',
      'backend/services/creator/rendering/governance/renderAnalytics.ts',
    ]) {
      const src = fs.readFileSync(f, 'utf8');
      expect(/backend\/scheduler|structuredPlanScheduler|schedulerService/.test(src)).toBe(false);
      expect(/supabaseClient|@\/backend\/db|node:|require\(/.test(src)).toBe(false); // pure
    }
  });
});

// ── LIVE — governance row mutable + global sentinel present ─────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;
liveDescribe('Validation LIVE — governance state mutable + sentinel', () => {
  it('sentinel exists; org row insert+update works (tx rolled back)', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const sentinel = (await c.query(
      `select emergency_stop, queue_paused from creator_render_governance_state where organization_id=$1`,
      [GLOBAL_GOVERNANCE_SENTINEL])).rows[0];
    expect(sentinel).toBeTruthy();
    await c.query('BEGIN');
    let updated = false;
    try {
      await c.query(
        `insert into creator_render_governance_state(organization_id,max_daily_renders) values('00000000-0000-0000-0000-0000000000ab',50)`);
      const u = await c.query(
        `update creator_render_governance_state set emergency_stop=true where organization_id='00000000-0000-0000-0000-0000000000ab' returning emergency_stop, updated_at`);
      updated = u.rows[0]?.emergency_stop === true;
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(updated).toBe(true); // governance is operationally MUTABLE
  }, 30000);
});
