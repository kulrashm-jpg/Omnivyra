/**
 * Enterprise Governance — End-to-End Lifecycle Regression Matrix
 * (Phase 1 + Phase 2 combined).
 *
 * Exhaustively walks every legal lifecycle path through the governance
 * facade. A regression here means a transition that USED to work no
 * longer does, OR an illegal transition that USED to be blocked is now
 * accepted. Either direction is a hard-stop CI failure.
 *
 * All tests run in-process with Redis disabled. Idempotency falls back
 * to the local Map; locking falls back to the local Map.
 */

process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';
process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'false';

import {
  onAssetGenerated,
  onQaResult,
  onGovernanceResult,
  onApprovalDecision,
  onPublished,
} from '../../services/creator/enterpriseGovernanceIntegration';
import {
  getReviewRecord,
  clearAllReviewRecords,
} from '../../services/creator/creativeReviewStateMachine';
import { clearAllEscalations } from '../../services/creator/creativeEscalationPipeline';
import {
  clearGovernanceEventsForTests,
  clearSubscribersForTests,
  listRecentGovernanceEvents,
} from '../../services/creator/enterpriseGovernanceEvents';
import { resetLockingForTests } from '../../services/creator/enterpriseGovernanceLocking';
import { buildAssetLifecycleEnvelope } from '../../services/creator/enterpriseGovernanceObservability';

beforeEach(() => {
  clearAllReviewRecords();
  clearAllEscalations();
  clearGovernanceEventsForTests();
  clearSubscribersForTests();
  resetLockingForTests();
});

describe('Lifecycle: happy path (generation → QA → governance → approval → publish)', () => {
  test('drives the full canonical lifecycle', async () => {
    const assetId = 'lifecycle-happy-001';
    const companyId = 'omnivyra';

    await onAssetGenerated({ assetId, companyId, campaignId: 'c1' });
    expect(getReviewRecord(assetId)?.currentState).toBe('generated');

    await onQaResult({ assetId, companyId, qaSeverity: 'pass', qaScore: 92 });
    expect(getReviewRecord(assetId)?.currentState).toBe('governance_review');

    await onGovernanceResult({ assetId, companyId, passed: true, governanceScore: 88 });
    expect(getReviewRecord(assetId)?.currentState).toBe('brand_review');

    const approve = await onApprovalDecision({
      assetId, to: 'approved', actorUserId: 'u-brand', actorRole: 'brand_manager',
    });
    expect(approve.skipped).toBe(false);
    expect(approve.result?.currentState).toBe('approved');

    const pub = await onPublished({ assetId, actorUserId: 'u-cm', actorRole: 'campaign_manager' });
    expect(pub.skipped).toBe(false);
    expect(pub.result?.currentState).toBe('published');
  });
});

describe('Lifecycle: blocked path (illegal publish before approval)', () => {
  test('publish from generated is blocked + emits publish_blocked', async () => {
    await onAssetGenerated({ assetId: 'lifecycle-illegal-001', companyId: 'omnivyra' });
    const pub = await onPublished({
      assetId: 'lifecycle-illegal-001',
      actorUserId: 'u-bad',
      actorRole: 'campaign_manager',
    });
    expect(pub.skipped).toBe(true);
    expect(pub.errorMessage).toContain('publish blocked');
    const events = listRecentGovernanceEvents({ assetId: 'lifecycle-illegal-001', type: 'publish_blocked' });
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('Lifecycle: degraded path (QA fail → escalation → no auto-advance)', () => {
  test('severe QA fail emits qa_failure + escalation and leaves state at generated', async () => {
    const assetId = 'lifecycle-degraded-001';
    await onAssetGenerated({ assetId, companyId: 'omnivyra' });
    const qa = await onQaResult({
      assetId, companyId: 'omnivyra',
      qaSeverity: 'reject', qaScore: 10, governanceScore: 12, governanceRejected: true, retryCount: 4,
    });
    expect(qa.result?.escalationId).toBeTruthy();
    expect(qa.result?.escalationLevel).toBe('critical');
    // State did not advance on fail.
    expect(getReviewRecord(assetId)?.currentState).toBe('generated');
  });
});

describe('Lifecycle: escalation path (governance reject → governance_intervention)', () => {
  test('governance reject emits governance_intervention without state advancement', async () => {
    const assetId = 'lifecycle-esc-001';
    await onAssetGenerated({ assetId, companyId: 'omnivyra' });
    await onQaResult({ assetId, companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 80 });
    expect(getReviewRecord(assetId)?.currentState).toBe('governance_review');

    await onGovernanceResult({
      assetId, companyId: 'omnivyra', passed: false,
      governanceScore: 30, rejectionReason: 'palette_violation',
    });
    // State stays in governance_review on reject.
    expect(getReviewRecord(assetId)?.currentState).toBe('governance_review');
    const interventions = listRecentGovernanceEvents({ assetId, type: 'governance_intervention' });
    expect(interventions.length).toBeGreaterThan(0);
  });
});

describe('Lifecycle: rollback path (approved → brand_review → approved again)', () => {
  test('approved state can be rolled back to brand_review and re-approved', async () => {
    const assetId = 'lifecycle-rollback-001';
    await onAssetGenerated({ assetId, companyId: 'omnivyra' });
    await onQaResult({ assetId, companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    await onGovernanceResult({ assetId, companyId: 'omnivyra', passed: true, governanceScore: 85 });
    const r1 = await onApprovalDecision({
      assetId, to: 'approved', actorUserId: 'u-brand', actorRole: 'brand_manager',
    });
    expect(r1.result?.currentState).toBe('approved');

    // Roll back to brand_review via request_regeneration action.
    const r2 = await onApprovalDecision({
      assetId, to: 'brand_review',
      actorUserId: 'u-cd', actorRole: 'creative_director',
    });
    expect(r2.result?.currentState).toBe('brand_review');

    // Re-approve.
    const r3 = await onApprovalDecision({
      assetId, to: 'approved', actorUserId: 'u-brand', actorRole: 'brand_manager',
    });
    expect(r3.result?.currentState).toBe('approved');
    expect(r3.result?.overrideCount).toBeGreaterThan(0);
  });
});

describe('Lifecycle: recovery path (rejected → draft → re-submission)', () => {
  test('rejected asset can transition back to draft', async () => {
    const assetId = 'lifecycle-recovery-001';
    await onAssetGenerated({ assetId, companyId: 'omnivyra' });
    await onQaResult({ assetId, companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 80 });
    // governance_review → rejected via brand_manager
    const r1 = await onApprovalDecision({
      assetId, to: 'rejected', actorUserId: 'u-brand', actorRole: 'brand_manager',
    });
    expect(r1.result?.currentState).toBe('rejected');

    // rejected → draft
    const r2 = await onApprovalDecision({
      assetId, to: 'draft', actorUserId: 'u-op', actorRole: 'creative_operator',
    });
    expect(r2.result?.currentState).toBe('draft');
  });
});

describe('Lifecycle: feature-flag-off path (every entry point no-ops)', () => {
  beforeAll(() => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
  });
  afterAll(() => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
  });

  test('all 5 entry points skip with reason=flag_off when runtime disabled', async () => {
    const r1 = await onAssetGenerated({ assetId: 'flagoff-1', companyId: 'omnivyra' });
    expect(r1.skipped).toBe(true);
    expect(r1.reason).toBe('flag_off');

    const r2 = await onQaResult({ assetId: 'flagoff-1', companyId: 'omnivyra', qaSeverity: 'pass' });
    expect(r2.skipped).toBe(true);
    expect(r2.reason).toBe('flag_off');

    const r3 = await onGovernanceResult({ assetId: 'flagoff-1', companyId: 'omnivyra', passed: true });
    expect(r3.skipped).toBe(true);
    expect(r3.reason).toBe('flag_off');

    const r4 = await onApprovalDecision({
      assetId: 'flagoff-1', to: 'approved',
      actorUserId: 'u', actorRole: 'brand_manager',
    });
    expect(r4.skipped).toBe(true);
    expect(r4.reason).toBe('flag_off');

    const r5 = await onPublished({
      assetId: 'flagoff-1', actorUserId: 'u', actorRole: 'campaign_manager',
    });
    expect(r5.skipped).toBe(true);
    expect(r5.reason).toBe('flag_off');
  });
});

describe('Cross-flow orchestration (Phase 2): event continuity through full lifecycle', () => {
  test('event sequence contains every required transition + lifecycle envelope reconstructs', async () => {
    const assetId = 'cross-flow-001';
    const companyId = 'omnivyra';

    await onAssetGenerated({ assetId, companyId, campaignId: 'c-cf' });
    await onQaResult({ assetId, companyId, qaSeverity: 'pass', qaScore: 90 });
    await onGovernanceResult({ assetId, companyId, passed: true });
    await onApprovalDecision({ assetId, to: 'approved', actorUserId: 'u', actorRole: 'brand_manager' });
    await onPublished({ assetId, actorUserId: 'u', actorRole: 'campaign_manager' });

    const envelope = buildAssetLifecycleEnvelope(assetId);
    expect(envelope.currentState).toBe('published');
    expect(envelope.stateHistory.length).toBeGreaterThanOrEqual(5);

    // Required event types
    const eventTypes = envelope.recentEvents.map((e) => e.type);
    expect(eventTypes).toContain('review_record_established');
    expect(eventTypes).toContain('qa_passed');
    expect(eventTypes).toContain('governance_passed');
    expect(eventTypes).toContain('approval_granted');
    expect(eventTypes).toContain('published');

    // Envelope companyId / campaignId propagated correctly
    expect(envelope.companyId).toBe(companyId);
    expect(envelope.campaignId).toBe('c-cf');
  });

  test('every state-transition event carries from/to context', async () => {
    const assetId = 'cross-flow-002';
    await onAssetGenerated({ assetId, companyId: 'omnivyra' });
    await onQaResult({ assetId, companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 92 });
    const transitions = listRecentGovernanceEvents({ assetId, type: 'review_state_transition' });
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      expect(t.context.from).toBeTruthy();
      expect(t.context.to).toBeTruthy();
    }
  });
});
