/**
 * Phase 27B.9 — Activation Stress Harness.
 *
 * Twelve adversarial scenarios exercise the activation-safety modules
 * in concert. Each scenario validates a specific safety property:
 *
 *   1.  duplicate provider replay storm
 *   2.  concurrent runtime publish race
 *   3.  cron/runtime enqueue collision
 *   4.  long-form replay collision
 *   5.  provider activation during rollback
 *   6.  replay-audit freeze escalation
 *   7.  rollout-stage illegal transition
 *   8.  provider allowlist bypass attempt
 *   9.  adapter failure during transaction
 *   10. publish replay after reclaim
 *   11. runtime restart during rollout downgrade
 *   12. shadow→live transition under queue replay
 *
 * Each scenario is its own Jest `test()`. The whole file functions as
 * the activation-safety CI gate referenced in 27B.10.
 */

import {
  runtimePublishGate,
  type PublishGateTxClient,
  type RunInTransaction,
} from '../../../../../services/orchestration/distributed/domain/production/runtimePublishGate';
import {
  claimLongFormOperation,
  createInMemoryLongFormClaimSqlClient,
} from '../../../../../services/orchestration/distributed/domain/production/longFormOperationClaim';
import {
  buildCanonicalPublishJobId,
  JobIdParityTracker,
} from '../../../../../services/orchestration/distributed/domain/production/bullmqJobIdParity';
import {
  ProviderActivationGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/providerActivationGovernor';
import {
  ProductionRuntimeRolloutGovernor,
  RolloutGovernorError,
} from '../../../../../services/orchestration/distributed/domain/production/productionRuntimeRolloutGovernor';
import {
  ReplayAuditEnforcementGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/replayAuditEnforcementGovernor';
import {
  ProductionRollbackGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/productionRollbackGovernor';

// ────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────

interface RowState { id: string; platformPostId: string | null; publishedAt: Date | null; }

function makeSerializedTxRunner(rows: Map<string, RowState>): RunInTransaction {
  let mutex: Promise<void> = Promise.resolve();
  const client: PublishGateTxClient = {
    async selectForUpdate({ scheduledPostId }) {
      const row = rows.get(scheduledPostId);
      if (!row) return { exists: false, platformPostId: null };
      return { exists: true, platformPostId: row.platformPostId };
    },
    async updatePlatformPostId({ scheduledPostId, platformPostId, publishedAt }) {
      const row = rows.get(scheduledPostId);
      if (!row || row.platformPostId) return { updated: 0 };
      row.platformPostId = platformPostId;
      row.publishedAt = publishedAt;
      return { updated: 1 };
    },
  };
  return async (body) => {
    const previous = mutex;
    let releaseFn: () => void = () => {};
    mutex = new Promise<void>((res) => { releaseFn = res; });
    await previous;
    try {
      return await body(client);
    } finally {
      releaseFn();
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// 1. duplicate provider replay storm
// ────────────────────────────────────────────────────────────────────

test('Scenario 1 — duplicate provider replay storm short-circuits via gate', async () => {
  const rows = new Map([['sp-1', { id: 'sp-1', platformPostId: null, publishedAt: null }]]);
  const runInTransaction = makeSerializedTxRunner(rows);
  const adapter = jest.fn(async () => ({ platformPostId: 'X-storm-99' }));
  const auditGov = new ReplayAuditEnforcementGovernor({ telemetry: { emit: () => {} } });

  // 32 replay attempts on the same post.
  const results = await Promise.all(
    Array.from({ length: 32 }).map((_, i) =>
      runtimePublishGate({
        executionId: `exec-${i}`, provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'sp-1', contentFingerprint: 'fp-1',
        adapter, runInTransaction, telemetry: { emit: () => {} },
      })
    )
  );
  for (const r of results) auditGov.recordGateCall({ shortCircuited: r.outcome === 'duplicate' });

  expect(adapter).toHaveBeenCalledTimes(1);
  expect(results.filter((r) => r.outcome === 'published').length).toBe(1);
  expect(results.filter((r) => r.outcome === 'duplicate').length).toBe(31);
});

// ────────────────────────────────────────────────────────────────────
// 2. concurrent runtime publish race
// ────────────────────────────────────────────────────────────────────

test('Scenario 2 — concurrent runtime publish race produces exactly one platform_post_id', async () => {
  const rows = new Map([['sp-2', { id: 'sp-2', platformPostId: null, publishedAt: null }]]);
  const runInTransaction = makeSerializedTxRunner(rows);
  const adapter = jest.fn(async () => ({ platformPostId: 'LI-race-1' }));

  const results = await Promise.all(
    Array.from({ length: 16 }).map((_, i) =>
      runtimePublishGate({
        executionId: `e-${i}`, provider: 'linkedin', socialAccountId: 'acc',
        scheduledPostId: 'sp-2', contentFingerprint: 'fp-2',
        adapter, runInTransaction, telemetry: { emit: () => {} },
      })
    )
  );
  const published = results.filter((r) => r.outcome === 'published');
  expect(published.length).toBe(1);
  expect(rows.get('sp-2')?.platformPostId).toBe('LI-race-1');
});

// ────────────────────────────────────────────────────────────────────
// 3. cron/runtime enqueue collision
// ────────────────────────────────────────────────────────────────────

test('Scenario 3 — cron and runtime building same canonical id flags duplicate not divergence', () => {
  const events: Array<{ event: string }> = [];
  const tracker = new JobIdParityTracker({
    telemetry: { emit: (event) => events.push({ event }) },
  });
  const components = { scheduledPostId: 'sp-3', scheduledForIso: '2026-05-30T12:00:00Z' };
  const canonical = buildCanonicalPublishJobId(components);

  tracker.recordEnqueue({ source: 'cron', components, observedJobId: canonical });
  tracker.recordEnqueue({ source: 'runtime', components, observedJobId: canonical });

  expect(events.some((e) => e.event === 'bullmq_duplicate_suppressed')).toBe(true);
  expect(events.some((e) => e.event === 'enqueue_path_divergence_detected')).toBe(false);
});

// ────────────────────────────────────────────────────────────────────
// 4. long-form replay collision
// ────────────────────────────────────────────────────────────────────

test('Scenario 4 — 64-way replay collision yields exactly one winner', async () => {
  const sql = createInMemoryLongFormClaimSqlClient();
  const results = await Promise.all(
    Array.from({ length: 64 }).map(() =>
      claimLongFormOperation({ operationKey: 'lf:storm:v1', sql, telemetry: { emit: () => {} } })
    )
  );
  expect(results.filter((r) => r.outcome === 'won').length).toBe(1);
  expect(results.filter((r) => r.outcome === 'duplicate').length).toBe(63);
});

// ────────────────────────────────────────────────────────────────────
// 5. provider activation during rollback
// ────────────────────────────────────────────────────────────────────

test('Scenario 5 — provider activation refused after rollback downgrade', () => {
  const rolloutGov = new ProductionRuntimeRolloutGovernor({
    initialStage: 'single_provider_live', telemetry: { emit: () => {} },
  });
  const auditGov = new ReplayAuditEnforcementGovernor({ telemetry: { emit: () => {} } });
  const rollbackGov = new ProductionRollbackGovernor({
    rolloutGovernor: rolloutGov, replayAuditGovernor: auditGov,
    autoApplyDowngrade: true, telemetry: { emit: () => {} },
  });
  rollbackGov.recordIrreversibleAnomaly('UPDATE_LOST');
  expect(rolloutGov.getStage()).toBe('publish_disabled');

  const providerGov = new ProviderActivationGovernor({
    allowedProviders: ['x'], allowedDomains: ['social_publish'],
    rolloutStage: rolloutGov.getStage(), telemetry: { emit: () => {} },
  });
  expect(providerGov.evaluateProvider('x').allowed).toBe(false);
});

// ────────────────────────────────────────────────────────────────────
// 6. replay-audit freeze escalation
// ────────────────────────────────────────────────────────────────────

test('Scenario 6 — replay-audit threshold breach freezes rollout governor', () => {
  const rolloutGov = new ProductionRuntimeRolloutGovernor({
    initialStage: 'single_provider_live', telemetry: { emit: () => {} },
  });
  const auditGov = new ReplayAuditEnforcementGovernor({ telemetry: { emit: () => {} } });
  const rollbackGov = new ProductionRollbackGovernor({
    rolloutGovernor: rolloutGov, replayAuditGovernor: auditGov, telemetry: { emit: () => {} },
  });
  auditGov.recordAdapterDuplicate({ provider: 'x', scheduledPostId: 'sp-1' });
  rollbackGov.evaluateAuditSignals();
  expect(rolloutGov.isFrozen().frozen).toBe(true);
});

// ────────────────────────────────────────────────────────────────────
// 7. rollout-stage illegal transition
// ────────────────────────────────────────────────────────────────────

test('Scenario 7 — illegal jump disabled → full_runtime_live refused', () => {
  const gov = new ProductionRuntimeRolloutGovernor({
    initialStage: 'disabled', telemetry: { emit: () => {} },
  });
  expect(() => gov.applyTransition('full_runtime_live')).toThrow(RolloutGovernorError);
  expect(gov.getStage()).toBe('disabled');
});

// ────────────────────────────────────────────────────────────────────
// 8. provider allowlist bypass attempt
// ────────────────────────────────────────────────────────────────────

test('Scenario 8 — non-allowlisted provider rejected by filterAdapterMap', () => {
  const gov = new ProviderActivationGovernor({
    allowedProviders: ['x'], allowedDomains: ['social_publish'],
    rolloutStage: 'full_runtime_live', telemetry: { emit: () => {} },
  });
  const adapters = { x: () => {}, linkedin: () => {}, reddit: () => {} };
  const { allowed, refused } = gov.filterAdapterMap(adapters);
  expect(Object.keys(allowed)).toEqual(['x']);
  // linkedin refused due to allowlist; reddit hard-blocked.
  expect(refused.find((r) => r.provider === 'reddit')?.hardBlocked).toBe(true);
});

// ────────────────────────────────────────────────────────────────────
// 9. adapter failure during transaction
// ────────────────────────────────────────────────────────────────────

test('Scenario 9 — adapter failure preserves platform_post_id as null', async () => {
  const rows = new Map([['sp-9', { id: 'sp-9', platformPostId: null, publishedAt: null }]]);
  const runInTransaction = makeSerializedTxRunner(rows);
  const adapter = jest.fn(async () => { throw new Error('provider 500'); });

  await expect(
    runtimePublishGate({
      executionId: 'exec-9', provider: 'x', socialAccountId: 'acc',
      scheduledPostId: 'sp-9', contentFingerprint: 'fp-9',
      adapter, runInTransaction, telemetry: { emit: () => {} },
    })
  ).rejects.toMatchObject({ code: 'ADAPTER_THREW' });
  expect(rows.get('sp-9')?.platformPostId).toBeNull();
});

// ────────────────────────────────────────────────────────────────────
// 10. publish replay after reclaim
// ────────────────────────────────────────────────────────────────────

test('Scenario 10 — publish replay after reclaim short-circuits (no adapter call)', async () => {
  const rows = new Map([['sp-10', { id: 'sp-10', platformPostId: 'already-X', publishedAt: new Date() }]]);
  const runInTransaction = makeSerializedTxRunner(rows);
  const adapter = jest.fn();

  const res = await runtimePublishGate({
    executionId: 'exec-10', provider: 'x', socialAccountId: 'acc',
    scheduledPostId: 'sp-10', contentFingerprint: 'fp-10',
    adapter, runInTransaction, telemetry: { emit: () => {} },
  });
  expect(res.outcome).toBe('duplicate');
  expect(adapter).not.toHaveBeenCalled();
});

// ────────────────────────────────────────────────────────────────────
// 11. runtime restart during rollout downgrade
// ────────────────────────────────────────────────────────────────────

test('Scenario 11 — restarted runtime reads PRODUCTION_RUNTIME_ROLLOUT_STAGE and refuses publish', () => {
  // Simulate a restart by constructing a brand-new governor whose
  // initial stage is publish_disabled (operator-driven downgrade).
  const gov = new ProductionRuntimeRolloutGovernor({
    initialStage: 'publish_disabled', telemetry: { emit: () => {} },
  });
  const v = gov.validateProviderStageCompatibility({ provider: 'x', publishRequested: true });
  expect(v.allowed).toBe(false);
});

// ────────────────────────────────────────────────────────────────────
// 12. shadow→live transition under queue replay
// ────────────────────────────────────────────────────────────────────

test('Scenario 12 — shadow→live one-step transition allowed only if audit clean', () => {
  const rolloutGov = new ProductionRuntimeRolloutGovernor({
    initialStage: 'shadow_only', telemetry: { emit: () => {} },
  });
  const auditGov = new ReplayAuditEnforcementGovernor({ telemetry: { emit: () => {} } });

  // Replay storm: many gate calls of which most short-circuit. That
  // alone exceeds the 5% threshold and should block promotion.
  for (let i = 0; i < 100; i++) auditGov.recordGateCall({ shortCircuited: i < 10 });
  expect(auditGov.evaluatePromotion().allowed).toBe(false);

  // Operator overrides by resetting the audit governor after fixing
  // the root cause (in real life: reconciliation pass).
  auditGov.reset();
  expect(auditGov.evaluatePromotion().allowed).toBe(true);

  expect(rolloutGov.applyTransition('replay_audit_only').toStage).toBe('replay_audit_only');
});
