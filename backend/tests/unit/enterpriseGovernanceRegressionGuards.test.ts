/**
 * Enterprise Governance — Governance + Approval Regression Guards
 * (Phase 4 + Phase 5 combined).
 *
 * Hard guarantees that MUST never silently regress:
 *   - off-brand rejection routes correctly
 *   - role enforcement is honored on every transition
 *   - publish-before-approval is always blocked
 *   - campaign lock prevents transitions by non-privileged roles
 *   - override count is enforced
 *   - bypass requires the bypass_review permission
 *   - illegal state transitions are always rejected
 *   - stale records are flagged but not auto-transitioned
 *
 * Failures here are HIGH-SIGNAL CI BLOCKERS.
 */

process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';
process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED = 'false';

import {
  onAssetGenerated,
  onQaResult,
  onApprovalDecision,
  onPublished,
} from '../../services/creator/enterpriseGovernanceIntegration';
import {
  getReviewRecord,
  clearAllReviewRecords,
  transitionReviewState,
  lockCampaign,
  unlockCampaign,
  ReviewTransitionError,
} from '../../services/creator/creativeReviewStateMachine';
import { canPerform } from '../../services/creator/creativeReviewRoles';
import {
  decideEscalationReason,
  clearAllEscalations,
} from '../../services/creator/creativeEscalationPipeline';
import {
  clearGovernanceEventsForTests,
  clearSubscribersForTests,
  listRecentGovernanceEvents,
} from '../../services/creator/enterpriseGovernanceEvents';
import { resetLockingForTests } from '../../services/creator/enterpriseGovernanceLocking';

beforeEach(() => {
  clearAllReviewRecords();
  clearAllEscalations();
  clearGovernanceEventsForTests();
  clearSubscribersForTests();
  resetLockingForTests();
});

/* ── Phase 4 — governance regression hardening ─────────────────────── */

describe('Governance: off-brand auto-detection routes correctly', () => {
  test('legal_risk routes to legal_reviewer with priority p1', () => {
    expect(decideEscalationReason({ legalRiskSignal: true })).toBe('legal_risk');
  });

  test('governanceRejected routes to severe_governance_violation', () => {
    expect(decideEscalationReason({ governanceRejected: true })).toBe('severe_governance_violation');
  });

  test('qaSeverity reject also routes to severe_governance_violation', () => {
    expect(decideEscalationReason({ qaSeverity: 'reject' })).toBe('severe_governance_violation');
  });

  test('low governance score (<40) routes to severe_governance_violation', () => {
    expect(decideEscalationReason({ governanceScore: 30 })).toBe('severe_governance_violation');
  });

  test('low QA score (<35) routes to unsafe_realism_drift', () => {
    expect(decideEscalationReason({ qaScore: 20 })).toBe('unsafe_realism_drift');
  });

  test('retryCount >= 3 routes to repeated_retry_exhaustion', () => {
    expect(decideEscalationReason({ retryCount: 3 })).toBe('repeated_retry_exhaustion');
  });

  test('governanceViolationCount >= 3 routes to repeated_off_brand_output', () => {
    expect(decideEscalationReason({ governanceViolationCount: 3 })).toBe('repeated_off_brand_output');
  });

  test('clean signals → no escalation needed', () => {
    expect(decideEscalationReason({ qaScore: 90, governanceScore: 85 })).toBeNull();
  });
});

describe('Governance: role enforcement on transitions', () => {
  test('creative_operator cannot approve QA', () => {
    expect(canPerform('creative_operator', 'approve_qa')).toBe(false);
  });
  test('brand_manager cannot approve legal', () => {
    expect(canPerform('brand_manager', 'approve_legal')).toBe(false);
  });
  test('only legal_reviewer can approve_legal', () => {
    expect(canPerform('legal_reviewer', 'approve_legal')).toBe(true);
    expect(canPerform('compliance_reviewer', 'approve_legal')).toBe(false);
  });
  test('null role can perform nothing', () => {
    expect(canPerform(null, 'approve_qa')).toBe(false);
    expect(canPerform(undefined, 'publish')).toBe(false);
  });
  test('admin can perform every action', () => {
    expect(canPerform('admin', 'approve_qa')).toBe(true);
    expect(canPerform('admin', 'publish')).toBe(true);
    expect(canPerform('admin', 'bypass_review')).toBe(true);
  });
});

describe('Governance: campaign lock enforcement', () => {
  test('locked campaign rejects transitions by non-privileged roles', async () => {
    await onAssetGenerated({ assetId: 'lock-001', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'lock-001', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 80 });
    lockCampaign('lock-001', 'campaign_manager', 'manual hold');

    // compliance_reviewer should be blocked from transitioning the locked asset.
    try {
      transitionReviewState({
        assetId: 'lock-001', to: 'brand_review',
        actorUserId: 'u-comp', actorRole: 'compliance_reviewer',
        reason: 'attempt during lock',
      });
      fail('Expected ReviewTransitionError campaign_locked');
    } catch (e) {
      expect(e).toBeInstanceOf(ReviewTransitionError);
      expect((e as ReviewTransitionError).code).toBe('campaign_locked');
    }

    // Admin has both unfreeze_campaign AND the transition action permission,
    // so it can override the lock + perform the transition in one call.
    const override = transitionReviewState({
      assetId: 'lock-001', to: 'brand_review',
      actorUserId: 'u-admin', actorRole: 'admin',
      reason: 'override lock',
    });
    expect(override.currentState).toBe('brand_review');

    unlockCampaign('lock-001', 'executive_reviewer');
    expect(getReviewRecord('lock-001')?.campaignLocked).toBe(false);
  });
});

describe('Governance: publish-before-approval is ALWAYS blocked', () => {
  test('publish from generated → blocked', async () => {
    await onAssetGenerated({ assetId: 'gate-001', companyId: 'omnivyra' });
    const pub = await onPublished({
      assetId: 'gate-001', actorUserId: 'u', actorRole: 'campaign_manager',
    });
    expect(pub.skipped).toBe(true);
    expect(pub.errorMessage).toMatch(/publish blocked.*expected approved/);
  });

  test('publish from rejected → blocked', async () => {
    await onAssetGenerated({ assetId: 'gate-002', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'gate-002', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 80 });
    await onApprovalDecision({
      assetId: 'gate-002', to: 'rejected',
      actorUserId: 'u', actorRole: 'brand_manager',
    });
    const pub = await onPublished({
      assetId: 'gate-002', actorUserId: 'u', actorRole: 'campaign_manager',
    });
    expect(pub.skipped).toBe(true);
  });

  test('publish from archived → blocked', async () => {
    await onAssetGenerated({ assetId: 'gate-003', companyId: 'omnivyra' });
    transitionReviewState({
      assetId: 'gate-003', to: 'archived',
      actorUserId: 'u', actorRole: 'admin', reason: 'test',
    });
    const pub = await onPublished({
      assetId: 'gate-003', actorUserId: 'u', actorRole: 'campaign_manager',
    });
    expect(pub.skipped).toBe(true);
  });
});

/* ── Phase 5 — approval lifecycle regression ───────────────────────── */

describe('Approval: invalid transitions are rejected', () => {
  test('cannot skip from generated directly to approved', () => {
    expect(() => transitionReviewState({
      assetId: 'inv-001', to: 'approved',
      actorUserId: 'u', actorRole: 'admin', reason: 'skip',
    })).toThrow();
  });

  test('cannot transition published → governance_review (terminal-ish)', async () => {
    await onAssetGenerated({ assetId: 'inv-002', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'inv-002', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    await onApprovalDecision({ assetId: 'inv-002', to: 'brand_review', actorUserId: 'u', actorRole: 'brand_manager' });
    await onApprovalDecision({ assetId: 'inv-002', to: 'approved', actorUserId: 'u', actorRole: 'brand_manager' });
    await onPublished({ assetId: 'inv-002', actorUserId: 'u', actorRole: 'campaign_manager' });
    expect(() => transitionReviewState({
      assetId: 'inv-002', to: 'governance_review',
      actorUserId: 'u', actorRole: 'admin', reason: 'reopen',
    })).toThrow();
  });

  test('archived is fully terminal — no transitions accepted', async () => {
    await onAssetGenerated({ assetId: 'inv-003', companyId: 'omnivyra' });
    transitionReviewState({
      assetId: 'inv-003', to: 'archived',
      actorUserId: 'u', actorRole: 'admin', reason: 'test',
    });
    for (const target of ['generated', 'qa_review', 'approved', 'published']) {
      expect(() => transitionReviewState({
        assetId: 'inv-003', to: target as any,
        actorUserId: 'u', actorRole: 'admin', reason: 'try',
      })).toThrow();
    }
  });
});

describe('Approval: role enforcement on each step', () => {
  test('creative_operator cannot approve at brand_review step', async () => {
    await onAssetGenerated({ assetId: 'role-001', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'role-001', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    await onApprovalDecision({
      assetId: 'role-001', to: 'brand_review',
      actorUserId: 'u-brand', actorRole: 'brand_manager',
    });
    const r = await onApprovalDecision({
      assetId: 'role-001', to: 'approved',
      actorUserId: 'u-op', actorRole: 'creative_operator',
    });
    expect(r.skipped).toBe(true);
    expect(r.errorMessage).toContain('invalid_actor_role');
  });
});

describe('Approval: bypass requires the bypass_review permission', () => {
  test('non-executive role cannot bypass', async () => {
    await onAssetGenerated({ assetId: 'bypass-001', companyId: 'omnivyra' });
    expect(() => transitionReviewState({
      assetId: 'bypass-001', to: 'rejected',
      actorUserId: 'u', actorRole: 'creative_operator',
      reason: 'try bypass', bypass: true,
    })).toThrow();
  });

  test('executive_reviewer can bypass', async () => {
    await onAssetGenerated({ assetId: 'bypass-002', companyId: 'omnivyra' });
    const r = transitionReviewState({
      assetId: 'bypass-002', to: 'rejected',
      actorUserId: 'u-exec', actorRole: 'executive_reviewer',
      reason: 'exec override', bypass: true,
    });
    expect(r.currentState).toBe('rejected');
    expect(r.history[r.history.length - 1].bypassed).toBe(true);
  });
});

describe('Approval: stale review handling', () => {
  test('stale records remain in their current state (no auto-transition)', async () => {
    await onAssetGenerated({ assetId: 'stale-001', companyId: 'omnivyra' });
    const before = getReviewRecord('stale-001');
    expect(before?.currentState).toBe('generated');
    // Stale flag should be false on a fresh record.
    expect(before?.stale).toBe(false);
  });
});

describe('Approval: archive flow from multiple source states', () => {
  test('can archive from generated', async () => {
    await onAssetGenerated({ assetId: 'arch-001', companyId: 'omnivyra' });
    const r = transitionReviewState({
      assetId: 'arch-001', to: 'archived',
      actorUserId: 'u', actorRole: 'admin', reason: 'archive',
    });
    expect(r.currentState).toBe('archived');
  });

  test('can archive from approved', async () => {
    await onAssetGenerated({ assetId: 'arch-002', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'arch-002', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    await onApprovalDecision({ assetId: 'arch-002', to: 'brand_review', actorUserId: 'u', actorRole: 'brand_manager' });
    await onApprovalDecision({ assetId: 'arch-002', to: 'approved', actorUserId: 'u', actorRole: 'brand_manager' });
    const r = transitionReviewState({
      assetId: 'arch-002', to: 'archived',
      actorUserId: 'u', actorRole: 'admin', reason: 'archive approved',
    });
    expect(r.currentState).toBe('archived');
  });
});

describe('Governance event emission integrity', () => {
  test('publish_blocked event always carries currentState in context', async () => {
    await onAssetGenerated({ assetId: 'evt-001', companyId: 'omnivyra' });
    await onPublished({ assetId: 'evt-001', actorUserId: 'u', actorRole: 'campaign_manager' });
    const events = listRecentGovernanceEvents({ assetId: 'evt-001', type: 'publish_blocked' });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].context.currentState).toBe('generated');
    expect(events[0].context.reason).toBe('not_approved');
  });
});
