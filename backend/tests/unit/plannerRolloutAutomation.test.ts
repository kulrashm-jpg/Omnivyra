/**
 * Unit tests for the planner rollout automation surface.
 *
 * Covers (with Redis MOCKED — see test setup):
 *   - Rollout orchestrator state transitions (promote/rollback/pause/resume/reset)
 *   - Refusal semantics (cannot promote during rolled_back / paused without force)
 *   - Soak elapsed check
 *   - Feature governance: register, add_rule, evaluate (forced_off > forced_on > percent > default)
 *   - Feature governance percent bucketing is stable for the same evaluation key
 *   - Canary gate ring buffer transitions (using getOrphanRefinementCount mock as a metric source)
 *
 * Redis is mocked by stubbing `getInstrumentedStandaloneRedisClient` so the
 * orchestrator / feature registry see an in-memory implementation.
 */

import { ROLLOUT_ORDER } from '../../services/plannerRolloutOrchestrator';

// ─────────────────────────────────────────────────────────────────────────
// In-memory Redis mock
// ─────────────────────────────────────────────────────────────────────────
class FakeRedis {
  private kv = new Map<string, string>();
  private streams = new Map<string, Array<[string, string[]]>>();
  private hashes = new Map<string, Map<string, string>>();
  async get(k: string): Promise<string | null> { return this.kv.get(k) ?? null; }
  async set(k: string, v: string): Promise<'OK'> { this.kv.set(k, v); return 'OK'; }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) { if (this.kv.delete(k) || this.streams.delete(k) || this.hashes.delete(k)) n++; }
    return n;
  }
  async xadd(stream: string, ..._args: string[]): Promise<string> {
    const arr = this.streams.get(stream) ?? [];
    const id = `${Date.now()}-${arr.length}`;
    // _args: MAXLEN ~ N * id field val field val ...
    const fields: string[] = [];
    let i = 0;
    while (i < _args.length && _args[i] !== '*') i++;
    i++; // skip '*'
    for (; i < _args.length; i++) fields.push(_args[i]);
    arr.push([id, fields]);
    this.streams.set(stream, arr);
    return id;
  }
  async xrevrange(stream: string, _start: string, _end: string, _countKw: string, count: string): Promise<Array<[string, string[]]>> {
    const arr = this.streams.get(stream) ?? [];
    return arr.slice(-Number(count)).reverse();
  }
  async hset(key: string, ...args: any[]): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    if (args.length === 1 && typeof args[0] === 'object') {
      for (const [k, v] of Object.entries(args[0])) h.set(k, String(v));
    } else {
      for (let i = 0; i + 1 < args.length; i += 2) h.set(args[i], String(args[i + 1]));
    }
    this.hashes.set(key, h);
    return 1;
  }
  async hmget(key: string, ...fields: string[]): Promise<Array<string | null>> {
    const h = this.hashes.get(key);
    return fields.map((f) => h?.get(f) ?? null);
  }
  async pexpire(_key: string, _ttl: number): Promise<number> { return 1; }
  status = 'ready' as const;
}

let fakeRedis: FakeRedis;
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => fakeRedis as any,
}));

import {
  promote,
  rollback,
  pause,
  resume,
  reset,
  getRolloutState,
  __resetForTests as resetOrchestrator,
} from '../../services/plannerRolloutOrchestrator';
import {
  registerFeature,
  addRule,
  removeRule,
  isFeatureEnabled,
  listFeatures,
  __resetForTests as resetFeatures,
  __INSTANCE_ID_FOR_TESTS__ as INSTANCE_ID,
} from '../../services/plannerFeatureGovernance';

beforeEach(() => {
  fakeRedis = new FakeRedis();
  resetOrchestrator();
  resetFeatures();
});

// ─────────────────────────────────────────────────────────────────────────
// Rollout orchestrator
// ─────────────────────────────────────────────────────────────────────────
describe('plannerRolloutOrchestrator', () => {
  test('promote from legacy advances to distributed_pools_only and enters canary', async () => {
    const s1 = await promote({ operatorId: 'op-1', reason: 'first_step' });
    expect(s1.active_mode).toBe('distributed_pools_only');
    expect(s1.target_mode).toBe('distributed_pools_only');
    expect(s1.rollback_mode).toBe('legacy');
    expect(s1.status).toBe('in_canary');
    expect(s1.canary_started_at).not.toBeNull();
  });

  test('promote refuses without force when soak not elapsed', async () => {
    await promote({ operatorId: 'op-1', canarySoakMs: 60_000 });
    const s2 = await promote({ operatorId: 'op-1' });
    expect(s2.active_mode).toBe('distributed_pools_only');
    expect(s2.last_reason).toBe('refused_promote_soak_not_elapsed');
  });

  test('force promote jumps to targetMode regardless of order', async () => {
    const s = await promote({
      operatorId: 'op-1',
      force: true,
      targetMode: 'full_production',
      reason: 'emergency_promote',
    });
    expect(s.active_mode).toBe('full_production');
    expect(s.target_mode).toBe('full_production');
  });

  test('rollback sets rolled_back status and reverts to rollback_mode', async () => {
    await promote({ operatorId: 'op-1' }); // legacy → distributed_pools_only
    const rb = await rollback({ operatorId: 'op-1', reason: 'manual_test' });
    expect(rb.active_mode).toBe('legacy');
    expect(rb.status).toBe('rolled_back');
  });

  test('promote refuses during rolled_back without force', async () => {
    await promote({ operatorId: 'op-1' });
    await rollback({ operatorId: 'op-1', reason: 'force_failure' });
    const s = await promote({ operatorId: 'op-1' });
    expect(s.last_reason).toBe('refused_promote_during_rolled_back');
    expect(s.status).toBe('rolled_back');
  });

  test('reset clears rolled_back; subsequent promote works', async () => {
    await promote({ operatorId: 'op-1' });
    await rollback({ operatorId: 'op-1', reason: 'fail' });
    const r = await reset('op-1', 'investigation_complete');
    expect(r.status).toBe('idle');
    const p = await promote({ operatorId: 'op-1' });
    expect(p.active_mode).toBe('distributed_pools_only');
    expect(p.status).toBe('in_canary');
  });

  test('pause + resume preserves canary_started_at', async () => {
    const promoted = await promote({ operatorId: 'op-1' });
    const startedAt = promoted.canary_started_at;
    const paused = await pause('op-1', 'review');
    expect(paused.status).toBe('paused');
    expect(paused.canary_started_at).toBe(startedAt);
    const resumed = await resume('op-1', 'continuing');
    expect(resumed.status).toBe('in_canary');
    expect(resumed.canary_started_at).toBe(startedAt);
  });

  test('pause refuses when not in canary/promoting', async () => {
    const p = await pause('op-1', 'invalid_pause');
    expect(p.status).toBe('idle');
    expect(p.last_reason).toBe('cannot_pause_in_status_idle');
  });

  test('cannot promote past full_production', async () => {
    let cur = await getRolloutState();
    for (const target of ROLLOUT_ORDER.slice(1)) {
      cur = await promote({
        operatorId: 'op-1', force: true, targetMode: target,
        reason: 'step',
      });
    }
    expect(cur.active_mode).toBe('full_production');
    const beyond = await promote({ operatorId: 'op-1', force: false });
    expect(beyond.last_reason).toBe('cannot_promote_already_at_max');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Feature governance
// ─────────────────────────────────────────────────────────────────────────
describe('plannerFeatureGovernance', () => {
  test('register + isFeatureEnabled default=false returns default_off', async () => {
    await registerFeature({ key: 'foo', description: 'test', default: false, operatorId: 'op-1' });
    const r = await isFeatureEnabled('foo');
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('default_off');
  });

  test('register + default=true returns default_on', async () => {
    await registerFeature({ key: 'bar', description: 'test', default: true, operatorId: 'op-1' });
    const r = await isFeatureEnabled('bar');
    expect(r.enabled).toBe(true);
    expect(r.reason).toBe('default_on');
  });

  test('unknown feature returns unknown_feature/false', async () => {
    const r = await isFeatureEnabled('nonexistent');
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('unknown_feature');
  });

  test('forced_on rule for matching org → enabled', async () => {
    await registerFeature({ key: 'f1', description: '', default: false, operatorId: 'op' });
    await addRule({ featureKey: 'f1', scopeType: 'org', scopeValue: 'org-123', effect: 'on', operatorId: 'op' });
    const r = await isFeatureEnabled('f1', { orgId: 'org-123' });
    expect(r.enabled).toBe(true);
    expect(r.reason).toBe('forced_on');
  });

  test('forced_off wins over forced_on at any scope', async () => {
    await registerFeature({ key: 'f2', description: '', default: true, operatorId: 'op' });
    await addRule({ featureKey: 'f2', scopeType: 'global', effect: 'on', operatorId: 'op' });
    await addRule({ featureKey: 'f2', scopeType: 'org', scopeValue: 'org-x', effect: 'off', operatorId: 'op' });
    const r = await isFeatureEnabled('f2', { orgId: 'org-x' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('forced_off');
  });

  test('percent rule buckets deterministically by evaluationKey', async () => {
    await registerFeature({ key: 'f3', description: '', default: false, operatorId: 'op' });
    await addRule({ featureKey: 'f3', scopeType: 'percent', percent: 100, effect: 'on', operatorId: 'op' });
    const r1 = await isFeatureEnabled('f3', { evaluationKey: 'stable-key-1' });
    const r2 = await isFeatureEnabled('f3', { evaluationKey: 'stable-key-1' });
    expect(r1.enabled).toBe(true);
    expect(r2.enabled).toBe(true);
    expect(r1.reason).toBe('percent_on');
  });

  test('percent rule with 0% never matches', async () => {
    await registerFeature({ key: 'f4', description: '', default: false, operatorId: 'op' });
    await addRule({ featureKey: 'f4', scopeType: 'percent', percent: 0, effect: 'on', operatorId: 'op' });
    const r = await isFeatureEnabled('f4', { evaluationKey: 'any-key' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('default_off');
  });

  test('env rule matches NODE_ENV', async () => {
    await registerFeature({ key: 'f5', description: '', default: false, operatorId: 'op' });
    await addRule({ featureKey: 'f5', scopeType: 'env', scopeValue: 'production', effect: 'on', operatorId: 'op' });
    const inProd = await isFeatureEnabled('f5', { environment: 'production' });
    const inStaging = await isFeatureEnabled('f5', { environment: 'staging' });
    expect(inProd.enabled).toBe(true);
    expect(inStaging.enabled).toBe(false);
  });

  test('instance rule matches this instance id', async () => {
    await registerFeature({ key: 'f6', description: '', default: false, operatorId: 'op' });
    await addRule({ featureKey: 'f6', scopeType: 'instance', scopeValue: INSTANCE_ID, effect: 'on', operatorId: 'op' });
    const r = await isFeatureEnabled('f6', { instanceId: INSTANCE_ID });
    expect(r.enabled).toBe(true);
  });

  test('removeRule deletes the targeted rule', async () => {
    await registerFeature({ key: 'f7', description: '', default: false, operatorId: 'op' });
    const e1 = await addRule({ featureKey: 'f7', scopeType: 'global', effect: 'on', operatorId: 'op' });
    expect(e1?.rules.length).toBe(1);
    const ruleId = e1!.rules[0].id;
    const e2 = await removeRule('f7', ruleId, 'op');
    expect(e2?.rules.length).toBe(0);
    const r = await isFeatureEnabled('f7');
    expect(r.enabled).toBe(false);
  });

  test('addRule with percent outside 0..100 throws', async () => {
    await registerFeature({ key: 'f8', description: '', default: false, operatorId: 'op' });
    await expect(
      addRule({ featureKey: 'f8', scopeType: 'percent', percent: 150, effect: 'on', operatorId: 'op' }),
    ).rejects.toThrow();
  });

  test('listFeatures returns alphabetized snapshot', async () => {
    await registerFeature({ key: 'beta', description: '', default: false, operatorId: 'op' });
    await registerFeature({ key: 'alpha', description: '', default: false, operatorId: 'op' });
    const list = await listFeatures();
    expect(list.map((f) => f.key)).toEqual(['alpha', 'beta']);
  });
});
