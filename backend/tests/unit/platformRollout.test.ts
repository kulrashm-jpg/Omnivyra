/**
 * Foundation Batch A (F-04) — Rollout Kit.
 *
 * Verifies mode resolution precedence (kill > admin > env > default), tenant
 * promotion semantics (shadow→enforce only), and the shadow-execution
 * contract: legacy is always authoritative in shadow; divergences and
 * candidate failures are counted, never surfaced.
 *
 * NODE_ENV === 'test' → the Redis admin-override path is skipped by design;
 * resolution here exercises env + defaults (the admin layer shares the exact
 * readKey/cache pattern proven in adminRuntimeConfig).
 */
import {
  defineRolloutFlag,
  resolveRollout,
  resolveRolloutSync,
  runWithRollout,
  listRolloutFlags,
  getRolloutFlag,
  applyRolloutPatch,
  __resetRolloutAdminCache,
  type RolloutAdminConfig,
} from '../../../lib/platform/rollout';
import { registry } from '../../../backend/observability/registry';

const ENV_KEYS = [
  'ROLLOUT_KILL_SWITCH',
  'ROLLOUT_BATCH_A_TEST_MODE',
  'ROLLOUT_BATCH_A_TEST_TENANTS',
  'ROLLOUT_BATCH_A_TEST_KILL',
];

const flag = defineRolloutFlag({
  key: 'batch-a-test',
  description: 'Batch A unit-test flag',
});

function shadowCount(result: string): number {
  const entry = registry
    .counterEntries()
    .find((c) => c.name === 'rollout.shadow' && c.labels?.flag === 'batch-a-test' && c.labels?.result === result);
  return entry?.value ?? 0;
}

describe('F-04 rollout kit — resolution', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    __resetRolloutAdminCache();
  });
  afterAll(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  test('derives env prefix from key and registers the flag', () => {
    expect(flag.envPrefix).toBe('ROLLOUT_BATCH_A_TEST');
    expect(listRolloutFlags().some((f) => f.key === 'batch-a-test')).toBe(true);
  });

  test('defaults to off', async () => {
    expect(await resolveRollout(flag)).toEqual({ mode: 'off', source: 'default' });
    expect(resolveRolloutSync(flag)).toEqual({ mode: 'off', source: 'default' });
  });

  test('env mode is re-read per call (live flip, no redeploy)', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    expect((await resolveRollout(flag)).mode).toBe('shadow');
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'enforce';
    expect((await resolveRollout(flag)).mode).toBe('enforce');
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'garbage';
    expect((await resolveRollout(flag)).mode).toBe('off'); // invalid → default
  });

  test('tenant promotion: shadow → enforce for listed tenants only, never from off', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    process.env.ROLLOUT_BATCH_A_TEST_TENANTS = 'org-1, org-2';
    expect(await resolveRollout(flag, { tenantId: 'org-1' }))
      .toEqual({ mode: 'enforce', source: 'tenant-promotion' });
    expect((await resolveRollout(flag, { tenantId: 'org-9' })).mode).toBe('shadow');

    process.env.ROLLOUT_BATCH_A_TEST_TENANTS = '*';
    expect((await resolveRollout(flag, { tenantId: 'anyone' })).mode).toBe('enforce');

    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'off';
    expect((await resolveRollout(flag, { tenantId: 'org-1' })).mode).toBe('off');
  });

  test('kill switches beat everything', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'enforce';
    process.env.ROLLOUT_BATCH_A_TEST_KILL = '1';
    expect(await resolveRollout(flag)).toEqual({ mode: 'off', source: 'env-kill' });

    delete process.env.ROLLOUT_BATCH_A_TEST_KILL;
    process.env.ROLLOUT_KILL_SWITCH = 'true';
    expect(await resolveRollout(flag)).toEqual({ mode: 'off', source: 'global-kill' });
  });
});

describe('F-04 rollout kit — shadow execution contract', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    __resetRolloutAdminCache();
  });

  test('off: candidate never runs', async () => {
    let candidateRan = false;
    const result = await runWithRollout(flag, {
      legacy: async () => 'legacy',
      candidate: async () => { candidateRan = true; return 'candidate'; },
    });
    expect(result).toBe('legacy');
    expect(candidateRan).toBe(false);
  });

  test('enforce: candidate is authoritative', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'enforce';
    const result = await runWithRollout(flag, {
      legacy: async () => 'legacy',
      candidate: async () => 'candidate',
    });
    expect(result).toBe('candidate');
  });

  test('shadow: returns legacy, counts match on equivalence', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    const before = shadowCount('match');
    const result = await runWithRollout(flag, {
      legacy: async () => ({ v: 1 }),
      candidate: async () => ({ v: 1 }),
    });
    expect(result).toEqual({ v: 1 });
    expect(shadowCount('match')).toBe(before + 1);
  });

  test('shadow: divergence is counted + reported, legacy still returned', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    const before = shadowCount('divergence');
    let observed: unknown;
    const result = await runWithRollout(flag, {
      legacy: async () => ({ v: 1 }),
      candidate: async () => ({ v: 2 }),
      onDivergence: (info) => { observed = info; },
    });
    expect(result).toEqual({ v: 1 });
    expect(shadowCount('divergence')).toBe(before + 1);
    expect(observed).toEqual({ flag: 'batch-a-test', legacy: { v: 1 }, candidate: { v: 2 } });
  });

  test('shadow: candidate failure is swallowed and counted', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    const before = shadowCount('candidate_error');
    const result = await runWithRollout(flag, {
      legacy: async () => 'legacy',
      candidate: async () => { throw new Error('candidate exploded'); },
    });
    expect(result).toBe('legacy');
    expect(shadowCount('candidate_error')).toBe(before + 1);
  });

  test('shadow: legacy failure propagates exactly (candidate outcome only counted)', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    const before = shadowCount('legacy_error_candidate_ok');
    const boom = new Error('legacy exploded');
    await expect(
      runWithRollout(flag, {
        legacy: async () => { throw boom; },
        candidate: async () => 'candidate ok',
      }),
    ).rejects.toBe(boom);
    expect(shadowCount('legacy_error_candidate_ok')).toBe(before + 1);
  });

  test('shadow: comparator failure degrades to legacy with compare_error', async () => {
    process.env.ROLLOUT_BATCH_A_TEST_MODE = 'shadow';
    const before = shadowCount('compare_error');
    const result = await runWithRollout(flag, {
      legacy: async () => 'a',
      candidate: async () => 'b',
      isEquivalent: () => { throw new Error('comparator bug'); },
    });
    expect(result).toBe('a');
    expect(shadowCount('compare_error')).toBe(before + 1);
  });
});

// Operator write surface — the pure config transform behind setRolloutOverride.
// The async setRolloutOverride() only adds a Redis read/write around this and
// __resetRolloutAdminCache; the override SHAPE it persists is exactly what
// resolution already consumes (RolloutFlagOverride: mode / killed / enforceTenants).
describe('F-04 rollout kit — operator write surface (applyRolloutPatch)', () => {
  const empty = (): RolloutAdminConfig => ({ v: 1, flags: {} });

  test('getRolloutFlag looks up registered flags, undefined otherwise', () => {
    expect(getRolloutFlag('batch-a-test')?.key).toBe('batch-a-test');
    expect(getRolloutFlag('no-such-flag')).toBeUndefined();
  });

  test('set-mode writes the override and reports before/after for audit', () => {
    const r = applyRolloutPatch(empty(), 'batch-a-test', { mode: 'shadow' });
    expect(r.previous).toBeNull();
    expect(r.next).toEqual({ mode: 'shadow' });
    expect(r.config.flags['batch-a-test']).toEqual({ mode: 'shadow' });
  });

  test('mode change over an existing override preserves other fields + captures previous', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'shadow', enforceTenants: ['org-1'] } } };
    const r = applyRolloutPatch(seed, 'batch-a-test', { mode: 'enforce' });
    expect(r.previous).toEqual({ mode: 'shadow', enforceTenants: ['org-1'] });
    expect(r.next).toEqual({ mode: 'enforce', enforceTenants: ['org-1'] });
  });

  test('kill / unkill toggle the admin kill flag without dropping mode', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'enforce' } } };
    const killed = applyRolloutPatch(seed, 'batch-a-test', { killed: true });
    expect(killed.next).toEqual({ mode: 'enforce', killed: true });
    const unkilled = applyRolloutPatch(killed.config, 'batch-a-test', { killed: false });
    expect(unkilled.next).toEqual({ mode: 'enforce', killed: false });
  });

  test('set-tenants sets the canary allowlist; null clears it', () => {
    const set = applyRolloutPatch(empty(), 'batch-a-test', { mode: 'shadow', enforceTenants: ['org-1', 'org-2'] });
    expect(set.next).toEqual({ mode: 'shadow', enforceTenants: ['org-1', 'org-2'] });
    const cleared = applyRolloutPatch(set.config, 'batch-a-test', { enforceTenants: null });
    expect(cleared.next).toEqual({ mode: 'shadow' });
  });

  test('clear removes the whole override (reset to env/default)', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'enforce', killed: true } } };
    const r = applyRolloutPatch(seed, 'batch-a-test', { clear: true });
    expect(r.previous).toEqual({ mode: 'enforce', killed: true });
    expect(r.next).toBeNull();
    expect(r.config.flags['batch-a-test']).toBeUndefined();
  });

  test('an override emptied to nothing is dropped, not persisted as noise', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'shadow' } } };
    const r = applyRolloutPatch(seed, 'batch-a-test', { mode: null });
    expect(r.next).toBeNull();
    expect(r.config.flags['batch-a-test']).toBeUndefined();
  });

  test('is pure — never mutates the input config or its overrides', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'shadow' } } };
    const snapshot = JSON.stringify(seed);
    applyRolloutPatch(seed, 'batch-a-test', { mode: 'enforce', killed: true });
    expect(JSON.stringify(seed)).toBe(snapshot);
  });

  test('preserves unrelated flags untouched (no cross-flag bleed)', () => {
    const seed: RolloutAdminConfig = { v: 1, flags: { 'batch-a-test': { mode: 'shadow' }, other: { mode: 'enforce' } } };
    const r = applyRolloutPatch(seed, 'batch-a-test', { killed: true });
    expect(r.config.flags.other).toEqual({ mode: 'enforce' });
  });
});
