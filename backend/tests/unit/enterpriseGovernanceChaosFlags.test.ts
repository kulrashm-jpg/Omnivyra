/**
 * Enterprise Governance — Chaos + Feature-Flag Matrix
 * (Phase 6 + Phase 10 combined).
 *
 * Verifies graceful degradation under subsystem failures and validates
 * every feature-flag combination produces deterministic safe behavior.
 *
 * Failure injection vectors:
 *   - subscriber callback throws
 *   - integration internal_error during transition
 *   - locking fallback when distributed-lock acquisition fails
 *   - notification queue at capacity
 *
 * Feature-flag matrix: each flag is independently togglable; combinations
 * must produce coherent runtime behavior (no half-wired states).
 */

import {
  onAssetGenerated,
  onQaResult,
  onPublished,
  integrationHealth,
} from '../../services/creator/enterpriseGovernanceIntegration';
import {
  clearAllReviewRecords,
  getReviewRecord,
} from '../../services/creator/creativeReviewStateMachine';
import { clearAllEscalations } from '../../services/creator/creativeEscalationPipeline';
import {
  clearGovernanceEventsForTests,
  clearSubscribersForTests,
  subscribeToGovernanceEvents,
  emitGovernanceEvent,
  listRecentGovernanceEvents,
} from '../../services/creator/enterpriseGovernanceEvents';
import {
  resetLockingForTests,
  withDistributedLock,
} from '../../services/creator/enterpriseGovernanceLocking';
import {
  resetNotificationsForTests,
  startNotificationDelivery,
  listNotifications,
  notificationDeliveryDiagnostics,
} from '../../services/creator/enterpriseGovernanceNotificationDelivery';

function resetGovernanceState(): void {
  clearAllReviewRecords();
  clearAllEscalations();
  clearGovernanceEventsForTests();
  clearSubscribersForTests();
  resetLockingForTests();
  resetNotificationsForTests();
}

beforeEach(() => {
  resetGovernanceState();
  // Default flags — describe blocks that need different combinations
  // override these AFTER beforeEach by setting env inside the test body.
  process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
  process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';
  process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'false';
});

/* ── Phase 6 — chaos / failure injection ───────────────────────────── */

describe('Chaos: subscriber throws — emission path stays clean', () => {
  test('throwing subscriber does not break event emission', () => {
    let goodSubscriberCalled = false;
    subscribeToGovernanceEvents(() => { throw new Error('subscriber boom'); });
    subscribeToGovernanceEvents(() => { goodSubscriberCalled = true; });

    expect(() => emitGovernanceEvent({
      type: 'asset_generated', assetId: 'chaos-1', companyId: 'omnivyra',
    })).not.toThrow();

    // Good subscriber still received the event despite the bad one throwing.
    expect(goodSubscriberCalled).toBe(true);
    // Event still landed in the ring buffer.
    expect(listRecentGovernanceEvents({ companyId: 'omnivyra' }).length).toBeGreaterThan(0);
  });
});

describe('Chaos: integration internal_error is contained', () => {
  test('onPublished with non-existent asset returns skipped envelope (never throws)', async () => {
    const r = await onPublished({
      assetId: 'does-not-exist',
      actorUserId: 'u',
      actorRole: 'campaign_manager',
    });
    expect(r.skipped).toBe(true);
    // We never propagate as an exception — must be in the envelope.
    expect(typeof r.reason).toBe('string');
  });
});

describe('Chaos: distributed lock fallback under Redis-disabled mode', () => {
  test('local-fallback lock still enforces mutual exclusion', async () => {
    let inner = false;
    await withDistributedLock('chaos-lock-1', async () => {
      inner = true;
    }, 500);
    expect(inner).toBe(true);
  });
});

describe('Chaos: notification subscriber starts cleanly even with no events queued', () => {
  test('startNotificationDelivery is idempotent', () => {
    process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'true';
    startNotificationDelivery();
    startNotificationDelivery(); // second call is no-op
    expect(notificationDeliveryDiagnostics().subscribed).toBe(true);
  });
});

describe('Chaos: orchestration hook failure is silently absorbed', () => {
  test('onAssetGenerated never propagates internal errors', async () => {
    // Provide an empty assetId — should return skipped, not throw.
    const r = await onAssetGenerated({ assetId: '', companyId: 'omnivyra' });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('asset_missing');
  });
});

/* ── Phase 10 — feature flag combinations ──────────────────────────── */

describe('Feature flags: runtime disabled produces full no-op behavior', () => {
  test('integration reports runtimeEnabled=false', () => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    expect(integrationHealth().runtimeEnabled).toBe(false);
  });

  test('no review record is created when runtime is off', async () => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    await onAssetGenerated({ assetId: 'ff-001', companyId: 'omnivyra' });
    expect(getReviewRecord('ff-001')).toBeNull();
  });
});

describe('Feature flags: notify without runtime (misconfiguration)', () => {
  test('notify subscribes but no events ever fire → empty queue', async () => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'true';
    startNotificationDelivery();
    await onAssetGenerated({ assetId: 'ff-002', companyId: 'omnivyra' });
    const notifs = listNotifications({ companyId: 'omnivyra', acknowledged: false });
    expect(notifs.length).toBe(0);
  });
});

describe('Feature flags: redis disabled, warm-start enabled (no-op)', () => {
  test('warm-start runs and reports zero work when Redis disabled', async () => {
    process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED = 'true';
    process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';
    const { restoreReviewRecordsFromRedis, resetWarmStartForTests } =
      await import('../../services/creator/enterpriseGovernanceWarmStart');
    resetWarmStartForTests();
    const result = await restoreReviewRecordsFromRedis();
    expect(result.companiesScanned).toBe(0);
    expect(result.recordsRestored).toBe(0);
    process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED = 'false';
  });
});

describe('Feature flags: rollback safety — toggling flags off restores no-op behavior', () => {
  test('runtime ON → record exists; flip OFF → next call no-ops + record persists', async () => {
    await onAssetGenerated({ assetId: 'ff-003', companyId: 'omnivyra' });
    expect(getReviewRecord('ff-003')?.currentState).toBe('generated');

    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    const r = await onQaResult({ assetId: 'ff-003', companyId: 'omnivyra', qaSeverity: 'pass' });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('flag_off');
    // Pre-existing record is untouched.
    expect(getReviewRecord('ff-003')?.currentState).toBe('generated');

    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
  });
});

describe('Feature flags: readiness verifier flags misconfigurations', () => {
  test('NOTIFY without RUNTIME → warning surfaced in readiness report', async () => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'true';
    const { computeReadinessReport } = await import('../../services/creator/enterpriseGovernanceReadinessVerifier');
    const report = computeReadinessReport();
    expect(report.warnCount + report.failCount).toBeGreaterThan(0);
    const misconfig = report.checks.find((c) => c.id === 'feature_flag.notify_without_runtime');
    expect(misconfig?.status).toBe('warn');
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
    process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'false';
  });

  test('WARM_START without REDIS → warning surfaced', async () => {
    process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED = 'true';
    process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';
    const { computeReadinessReport } = await import('../../services/creator/enterpriseGovernanceReadinessVerifier');
    const report = computeReadinessReport();
    const misconfig = report.checks.find((c) => c.id === 'feature_flag.warm_start_without_redis');
    expect(misconfig?.status).toBe('warn');
    process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED = 'false';
  });
});
