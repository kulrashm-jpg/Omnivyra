/**
 * Wave 6 + Foundation Batch E — scale-structure contracts.
 */
import fs from 'fs';
import path from 'path';
import { acquireLease, withLease, lockInstanceId } from '../../../lib/platform/distributedLock';
import { listRolloutFlags, resolveRolloutSync } from '../../../lib/platform/rollout';
import { LIFECYCLE_POLICIES, runLifecycleSweep } from '../../services/dataLifecycle';
import { getDbConnectionDiagnostics } from '../../db/supabaseClient';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cronSrc = read('backend/scheduler/cron.ts');
const mainSrc = read('backend/workers/main.ts');

// Redis availability probe (Windows dev boxes run Memurai; CI may not).
async function redisReachable(): Promise<boolean> {
  try {
    const { getRedisHealthSnapshot } = await import('../../../lib/redis/canonicalClient');
    return (await getRedisHealthSnapshot(1_000)).reachable;
  } catch {
    return false;
  }
}

describe('Wave 6 flags: registered and OFF by default', () => {
  test('data-lifecycle (runtime-registered via imported service)', () => {
    const flag = listRolloutFlags().find((f) => f.key === 'data-lifecycle');
    expect(flag).toBeDefined();
    expect(resolveRolloutSync(flag!).mode).toBe('off');
  });
  test('boot-module flags declared at their seams (source — cron/main cannot be imported in jest)', () => {
    expect(cronSrc).toContain("key: 'distributed-timer-locks'");
    expect(cronSrc).toContain("key: 'replica-canary-detector'");
    expect(mainSrc).toContain("key: 'publish-poll-backoff'");
  });
});

describe('F-15 distributed lock framework', () => {
  test('kill switch = loud pass-through (single-replica only)', async () => {
    process.env.DISTRIBUTED_LOCKS_KILL = '1';
    const lease = await acquireLease('unit-killed', 10);
    expect(lease.acquired).toBe(true);
    expect(lease.reason).toBe('killed');
    delete process.env.DISTRIBUTED_LOCKS_KILL;
  });

  test('unavailable Redis → skip by default, run under FAIL_OPEN', async () => {
    if (await redisReachable()) return; // covered by the live test below instead
    const skipped = await withLease('unit-unavail', 5, async () => 'x');
    expect(skipped.ran).toBe(false);
    expect(skipped.reason).toBe('unavailable');
    process.env.DISTRIBUTED_LOCKS_FAIL_OPEN = '1';
    const ran = await withLease('unit-unavail', 5, async () => 'y');
    expect(ran).toMatchObject({ ran: true, value: 'y' });
    delete process.env.DISTRIBUTED_LOCKS_FAIL_OPEN;
  });

  test('live: acquire excludes second holder; fencing monotonic; release frees', async () => {
    if (!(await redisReachable())) return; // environment without Redis
    const name = `unit-live-${Date.now()}`;
    const a = await acquireLease(name, 10);
    expect(a.acquired).toBe(true);
    expect(typeof a.fencingToken).toBe('number');
    const b = await acquireLease(name, 10);
    expect(b.acquired).toBe(false);
    expect(b.reason).toBe('held');
    await a.release();
    const c = await acquireLease(name, 10);
    expect(c.acquired).toBe(true);
    expect(c.fencingToken!).toBeGreaterThan(a.fencingToken!);
    expect(await c.renew(20)).toBe(true);
    await c.release();
    // Released lock: renew must fail (ownership verification).
    expect(await c.renew(20)).toBe(false);
  });

  test('instance identity is stable and process-scoped', () => {
    expect(lockInstanceId()).toBe(lockInstanceId());
    expect(lockInstanceId()).toContain(String(process.pid));
  });
});

describe('W6-1/W6-3 timer safety', () => {
  test('every scheduleWorker tick routes through the lease/detector guard', () => {
    expect(cronSrc).toContain('const guardedFn = async ()');
    expect(cronSrc).toMatch(/withLease\(`timer:\$\{label\}`/);
    expect(cronSrc).toContain('detectDuplicateTick(label, intervalMs)');
    expect(cronSrc).toMatch(/const result = await guardedFn\(\);/);
    expect(cronSrc).not.toMatch(/const result = await fn\(\);\s*\n\s*const hasActivity/);
  });
  test('duplicate detection is the canary rollback trigger', () => {
    expect(cronSrc).toContain("recordRawCounter('replica.duplicate_execution', 1, { label })");
  });
});

describe('W6-2 cron service separation', () => {
  test('worker-only mode skips startCron and reports healthy external cron', () => {
    expect(mainSrc).toContain("cronServiceMode === 'worker-only'");
    expect(mainSrc).toContain("setCronStatus('ok', 'external cron service");
    // Standalone scheduler entry exists (Dockerfile.cron path).
    expect(cronSrc).toContain('require.main === module');
    expect(read('package.json')).toContain('"worker:cron"');
  });
});

describe('W6-4 pooler readiness', () => {
  test('default = direct URL; pooler env routes; diagnostics exported', () => {
    expect(getDbConnectionDiagnostics()).toEqual({ mode: 'direct', poolerConfigured: false });
    const src = read('backend/db/supabaseClient.ts');
    expect(src).toContain('SUPABASE_POOLER_URL');
    expect(src).toContain('createClient(poolerUrl || url, key');
  });
});

describe('W6-5 cadence rationalization', () => {
  test('publish poll: idle backoff flag-gated; instant snap-back on work', () => {
    expect(mainSrc).toContain("key: 'publish-poll-backoff'");
    expect(mainSrc).toContain('idleCycles >= 10');
    expect(mainSrc).toMatch(/idleCycles = result\.claimed > 0 \|\| processed > 0 \? 0 : idleCycles \+ 1;/);
  });
});

describe('W6-6 data lifecycle', () => {
  test('flag off → sweep is a total no-op (no policy runs)', async () => {
    expect(await runLifecycleSweep()).toEqual({ policies: 0, pruned: 0 });
  });
  test('the one approved policy is metadata-only and bounded', () => {
    expect(LIFECYCLE_POLICIES).toHaveLength(1);
    expect(LIFECYCLE_POLICIES[0].name).toBe('resume-result-retention');
    expect(LIFECYCLE_POLICIES[0].batchLimit).toBe(200);
    const src = read('backend/services/dataLifecycle.ts');
    expect(src).toContain('delete metadata.ai_result; // metadata-only');
    expect(src).not.toMatch(/\.delete\(\)/); // prunes a key, never rows
    expect(src).toContain("update({ metadata })");
  });
  test('sweep registered as a standard timer (lease-guarded like all timers)', () => {
    expect(cronSrc).toContain("LIFECYCLE_SWEEP_INTERVAL_MS, 'dataLifecycleSweep'");
  });
});
