/**
 * Validation — Step-R7 enterprise render operations console.
 *
 *   1  governance management correctness
 *   2  queue-operation correctness
 *   3  failed-render recovery correctness
 *   4  provider control correctness
 *   5  analytics visualization correctness (shape)
 *   6  worker-health correctness (metrics present)
 *   7  immutable-lineage preservation (no lineage keys in any patch)
 *   8  scheduler isolation (structural)
 *   9  R3–R6 compatibility (cores untouched — regression elsewhere)
 *   10 internal-only access enforcement (endpoint super-admin gate)
 *
 * Pure builders — no network. LIVE micro: ops-audit immutable +
 * governance upsert round-trip (tx + rollback).
 */

import {
  buildGovernancePatch, buildProviderPatch, classifyQueueAction, buildOpsAuditRow,
  aggregateRenderAnalytics,
} from '../../services/creator/rendering';
import * as fs from 'fs';

const LINEAGE_KEYS = [
  'render_spec_snapshot', 'deterministic_input_hash', 'content_sha256',
  'attempt_id', 'render_job_id', 'storage_ref',
];

describe('Validation-1 — governance management', () => {
  it('valid patch applied; bad types rejected; unknown keys dropped; noop', () => {
    expect(buildGovernancePatch({ rendering_enabled: false, max_daily_renders: 10 }))
      .toMatchObject({ ok: true, outcome: 'applied', patch: { rendering_enabled: false, max_daily_renders: 10 } });
    expect(buildGovernancePatch({ emergency_stop: 'yes' }))
      .toMatchObject({ ok: false, outcome: 'rejected', reason: 'emergency_stop_not_boolean' });
    expect(buildGovernancePatch({ max_concurrent_renders: -3 }))
      .toMatchObject({ ok: false, reason: 'max_concurrent_renders_invalid' });
    expect(buildGovernancePatch({ moderation_mode: 'banana' }))
      .toMatchObject({ ok: false, reason: 'moderation_mode_invalid' });
    expect(buildGovernancePatch({ allowed_providers: 'openai' }))
      .toMatchObject({ ok: false, reason: 'allowed_providers_not_array' });
    expect(buildGovernancePatch({ allowed_providers: ['openai', 1] }).patch)
      .toMatchObject({ allowed_providers: ['openai', '1'] });
    expect(buildGovernancePatch({ unknown_field: 1 })).toMatchObject({ outcome: 'noop' });
    expect(buildGovernancePatch(null)).toMatchObject({ ok: false, reason: 'invalid_input' });
  });
});

describe('Validation-2/3 — queue ops + failed recovery (fail-closed)', () => {
  it('retry ONLY from failed; cancel only non-terminal; no lineage keys', () => {
    const retry = classifyQueueAction('queue.retry', 'failed', '2026-05-16T00:00:00Z');
    expect(retry).toMatchObject({ ok: true, outcome: 'applied' });
    expect(retry.patch).toEqual({ queue_state: 'retry_scheduled', next_retry_at: '2026-05-16T00:00:00Z', last_error: null });
    expect(classifyQueueAction('queue.retry', 'rendering', 'n')).toMatchObject({ ok: false, reason: 'not_retryable_rendering' });
    expect(classifyQueueAction('queue.cancel', 'queued', 'n')).toMatchObject({ ok: true, patch: { queue_state: 'cancelled', lease_owner: null } });
    expect(classifyQueueAction('queue.cancel', 'completed', 'n')).toMatchObject({ ok: false, reason: 'terminal_completed' });
    expect(classifyQueueAction('queue.cancel', 'cancelled', 'n')).toMatchObject({ ok: false, reason: 'terminal_cancelled' });
    // Validation-7: patches NEVER touch immutable lineage
    for (const d of [retry, classifyQueueAction('queue.cancel', 'queued', 'n')]) {
      for (const k of Object.keys(d.patch ?? {})) expect(LINEAGE_KEYS).not.toContain(k);
    }
  });
});

describe('Validation-4 — provider control', () => {
  it('disable / maintenance / priority builders fail-closed', () => {
    expect(buildProviderPatch('provider.disable', { provider_key: 'openai' }))
      .toMatchObject({ ok: true, patch: { health_state: 'circuit_open' } });
    expect(buildProviderPatch('provider.maintenance', { provider_key: 'openai' }))
      .toMatchObject({ ok: true, patch: { health_state: 'maintenance' } });
    expect(buildProviderPatch('provider.priority', { provider_key: 'openai', priority_weight: 250 }))
      .toMatchObject({ ok: true, patch: { priority_weight: 250 } });
    expect(buildProviderPatch('provider.priority', { provider_key: 'openai', priority_weight: 99999 }))
      .toMatchObject({ ok: false, reason: 'priority_weight_invalid' });
    expect(buildProviderPatch('provider.disable', {} as any))
      .toMatchObject({ ok: false, reason: 'provider_required' });
  });
});

describe('Validation-5/6 — analytics/worker shape for the console', () => {
  it('aggregate exposes the console metrics (no PII)', () => {
    const a = aggregateRenderAnalytics({ queueRows: [{ queue_state: 'completed' }], attemptRows: [], jobStateRows: [] });
    for (const k of ['render_success_rate', 'avg_render_duration_ms', 'retry_rate',
      'provider_failure_rate', 'estimated_cost_credits', 'reuse_savings_credits']) {
      expect(typeof (a as any)[k]).toBe('number');
    }
  });
});

describe('Validation-7/8/10 — lineage/scheduler isolation + access gate', () => {
  it('audit row is non-mutating shape; builders pure of scheduler/DB', () => {
    const row = buildOpsAuditRow('admin', 'governance.set', 'org-1', 'applied', { x: 1 });
    expect(row).toMatchObject({ actor: 'admin', action: 'governance.set', target: 'org-1', outcome: 'applied' });
    for (const k of LINEAGE_KEYS) expect(k in row).toBe(false);
    const src = fs.readFileSync(
      'backend/services/creator/rendering/governance/renderOpsActions.ts', 'utf8');
    expect(/backend\/scheduler|structuredPlanScheduler|schedulerService/.test(src)).toBe(false);
    expect(/supabaseClient|@\/backend\/db|require\(/.test(src)).toBe(false); // pure
  });
  it('ops endpoint enforces super-admin (internal-only) + immutable audit', () => {
    const ep = fs.readFileSync('pages/api/internal/render-ops.ts', 'utf8');
    // SEC-001B: never a raw `=== '1'` comparison (that matched only a FORGED
    // cookie once Phase 2 began issuing signed values).
    // SEC-001C: the gate must be the LIFECYCLE-AWARE canonical helper, and the
    // route must also accept a canonical DB-backed super admin — without that
    // second arm it becomes permanently unreachable at the bridge hard expiry.
    expect(/getLegacySuperAdminSession\(req\)/.test(ep)).toBe(true);
    expect(/isPlatformSuperAdmin/.test(ep)).toBe(true);
    expect(/super_admin_session\s*===\s*'1'/.test(ep)).toBe(false);
    expect(/hasValidLegacySuperAdminCookie/.test(ep)).toBe(false);
    expect(/NOT_OPERATOR/.test(ep)).toBe(true);
    expect(/creator_render_ops_audit/.test(ep)).toBe(true);
    // never writes immutable render lineage tables
    expect(/ownedDbTable\('creator_render_job'\)|ownedDbTable\('creator_render_output'\)|ownedDbTable\('creator_render_attempt'\)/.test(ep)).toBe(false);
  });
});

// ── LIVE — ops audit immutable + governance round-trip ──────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;
liveDescribe('Validation LIVE — ops audit immutable; governance mutable', () => {
  it('audit append-only; governance upsert+update (tx rolled back)', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    const ok: string[] = []; const fail: string[] = [];
    const sp = async (n: string, fn: () => Promise<any>, exp?: string) => {
      await c.query('SAVEPOINT s');
      try { await fn(); await c.query('RELEASE SAVEPOINT s'); (exp ? fail : ok).push(n); }
      catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT s'); (exp && new RegExp(exp).test(e.message) ? ok : fail).push(n); }
    };
    try {
      const aid = (await c.query(
        `insert into creator_render_ops_audit(actor,action,target,outcome) values('t','governance.set','org','applied') returning id`)).rows[0].id;
      ok.push('audit insert');
      await sp('audit UPDATE blocked', () => c.query(`update creator_render_ops_audit set outcome='rejected' where id='${aid}'`), 'LEDGER_IMMUTABLE');
      await sp('audit DELETE blocked', () => c.query(`delete from creator_render_ops_audit where id='${aid}'`), 'LEDGER_IMMUTABLE');
      await c.query(
        `insert into creator_render_governance_state(organization_id,max_daily_renders) values('00000000-0000-0000-0000-0000000000ac',10)
         on conflict (organization_id) do update set max_daily_renders=excluded.max_daily_renders`);
      const u = await c.query(
        `update creator_render_governance_state set emergency_stop=true where organization_id='00000000-0000-0000-0000-0000000000ac' returning emergency_stop`);
      if (u.rows[0]?.emergency_stop === true) ok.push('governance mutable');
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(fail).toEqual([]);
    expect(ok).toEqual(expect.arrayContaining(['audit insert', 'audit UPDATE blocked', 'audit DELETE blocked', 'governance mutable']));
  }, 30000);
});
