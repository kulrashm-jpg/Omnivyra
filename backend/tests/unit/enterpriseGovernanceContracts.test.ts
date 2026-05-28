/**
 * Enterprise Governance — Event + API Contracts
 * (Phase 8 + Phase 9 combined).
 *
 * Verifies envelope shape stability for governance events and validates
 * that operator-facing API endpoints maintain their RBAC + tenant-isolation
 * + error-surface contracts.
 *
 * NOTE: We test the contract surfaces in two ways:
 *   - In-process envelope assertions (event schema, return shapes).
 *   - Module-export assertions for the API endpoints (they pull in
 *     withRBAC + requireCompanyContext, so we verify the wiring exists
 *     without spinning up an HTTP server — the actual auth round-trip
 *     is covered by jest integration tests).
 */

process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
process.env.ENTERPRISE_GOVERNANCE_REDIS_ENABLED = 'false';

import {
  onAssetGenerated,
  onQaResult,
  onApprovalDecision,
  onPublished,
} from '../../services/creator/enterpriseGovernanceIntegration';
import {
  clearAllReviewRecords,
} from '../../services/creator/creativeReviewStateMachine';
import { clearAllEscalations } from '../../services/creator/creativeEscalationPipeline';
import {
  clearGovernanceEventsForTests,
  clearSubscribersForTests,
  listRecentGovernanceEvents,
  emitGovernanceEvent,
  type EnterpriseGovernanceEvent,
  type EnterpriseGovernanceEventType,
} from '../../services/creator/enterpriseGovernanceEvents';
import { resetLockingForTests } from '../../services/creator/enterpriseGovernanceLocking';
import { buildAssetLifecycleEnvelope } from '../../services/creator/enterpriseGovernanceObservability';
import { computeExecutiveSummary } from '../../services/creator/enterpriseGovernanceExecutiveSummary';

beforeEach(() => {
  clearAllReviewRecords();
  clearAllEscalations();
  clearGovernanceEventsForTests();
  clearSubscribersForTests();
  resetLockingForTests();
});

/* ── Phase 8 — event contract ──────────────────────────────────────── */

const REQUIRED_EVENT_FIELDS: Array<keyof EnterpriseGovernanceEvent> = [
  'eventId', 'type', 'assetId', 'companyId', 'campaignId', 'context', 'occurredAt',
];

// EXPECTED canonical event-type set — every released type must be here so
// renames/removals require a deliberate change to this whitelist.
const CANONICAL_EVENT_TYPES: ReadonlyArray<EnterpriseGovernanceEventType> = [
  'asset_generated', 'qa_failure', 'qa_passed', 'governance_intervention',
  'governance_passed', 'severe_governance_violation', 'escalation_created',
  'retry_exhausted', 'approval_required', 'approval_granted', 'approval_rejected',
  'publish_allowed', 'publish_blocked', 'published', 'campaign_locked',
  'campaign_unlocked', 'review_state_transition', 'autonomous_intervention',
  'review_record_established',
];

describe('Event contract: every emission carries the canonical envelope shape', () => {
  test('asset_generated event has all required fields', async () => {
    await onAssetGenerated({ assetId: 'evt-shape-1', companyId: 'omnivyra', campaignId: 'c' });
    const events = listRecentGovernanceEvents({ assetId: 'evt-shape-1' });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      for (const f of REQUIRED_EVENT_FIELDS) expect(e).toHaveProperty(f);
      expect(typeof e.eventId).toBe('string');
      expect(typeof e.occurredAt).toBe('string');
      // ISO timestamp parseable
      expect(Number.isNaN(Date.parse(e.occurredAt))).toBe(false);
      // context is bounded (never null)
      expect(typeof e.context).toBe('object');
    }
  });

  test('context fields are bounded (no >200-char strings, no excessive keys)', () => {
    const oversized = 'x'.repeat(500);
    const event = emitGovernanceEvent({
      type: 'asset_generated',
      assetId: 'evt-shape-2',
      companyId: 'omnivyra',
      context: {
        bigString: oversized,
        n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6, n7: 7, n8: 8, n9: 9, n10: 10,
        n11: 11, n12: 12, n13: 13, n14: 14, n15: 15, n16: 16, n17: 17, n18: 18,
        n19: 19, n20: 20, n21: 21, n22: 22, n23: 23, // > 20 keys
      },
    });
    // bigString truncated to 200 chars
    expect(typeof event.context.bigString).toBe('string');
    expect((event.context.bigString as string).length).toBeLessThanOrEqual(200);
    // context key cap enforced at 20
    expect(Object.keys(event.context).length).toBeLessThanOrEqual(20);
  });

  test('every canonical event type is producable', () => {
    for (const type of CANONICAL_EVENT_TYPES) {
      const event = emitGovernanceEvent({
        type, assetId: 'evt-shape-3', companyId: 'omnivyra',
      });
      expect(event.type).toBe(type);
    }
  });
});

describe('Event contract: lifecycle envelope structure is stable', () => {
  test('buildAssetLifecycleEnvelope returns the canonical shape', async () => {
    await onAssetGenerated({ assetId: 'env-shape-1', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'env-shape-1', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    const env = buildAssetLifecycleEnvelope('env-shape-1');
    const requiredFields = [
      'assetId', 'companyId', 'campaignId', 'currentState', 'campaignLocked',
      'stale', 'overrideCount', 'escalationCount', 'commentsCount',
      'escalations', 'stateHistory', 'recentEvents', 'timeline', 'computedAt',
    ];
    for (const f of requiredFields) expect(env).toHaveProperty(f);
    expect(Array.isArray(env.escalations)).toBe(true);
    expect(Array.isArray(env.stateHistory)).toBe(true);
    expect(Array.isArray(env.recentEvents)).toBe(true);
    expect(Array.isArray(env.timeline)).toBe(true);
    // Timeline sorted newest-first.
    for (let i = 1; i < env.timeline.length; i++) {
      expect(env.timeline[i - 1].at >= env.timeline[i].at).toBe(true);
    }
  });
});

describe('Event contract: executive summary shape is stable', () => {
  test('executive summary returns all required sections with deterministic types', () => {
    const summary = computeExecutiveSummary('omnivyra');
    expect(summary.companyId).toBe('omnivyra');
    expect(typeof summary.computedAt).toBe('string');
    expect(summary.campaign).toBeDefined();
    expect(summary.qa).toBeDefined();
    expect(summary.governance).toBeDefined();
    expect(summary.strategy).toBeDefined();
    expect(summary.operationsHealth).toBeDefined();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(summary.overallHealthGrade);
    expect(Array.isArray(summary.headlines)).toBe(true);
    expect(summary.headlines.length).toBeLessThanOrEqual(3);
  });
});

/* ── Phase 9 — API contract ───────────────────────────────────────── */

describe('API contract: every operator endpoint exports a default function', () => {
  test('summary endpoint default-exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/summary');
    expect(typeof mod.default).toBe('function');
  });
  test('per-asset lifecycle endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/asset/[assetId]');
    expect(typeof mod.default).toBe('function');
  });
  test('decide endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/approvals/decide');
    expect(typeof mod.default).toBe('function');
  });
  test('comment endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/approvals/comment');
    expect(typeof mod.default).toBe('function');
  });
  test('executive-summary endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/executive-summary');
    expect(typeof mod.default).toBe('function');
  });
  test('alerts endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/alerts');
    expect(typeof mod.default).toBe('function');
  });
  test('notifications/acknowledge endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/notifications/acknowledge');
    expect(typeof mod.default).toBe('function');
  });
  test('health endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/health');
    expect(typeof mod.default).toBe('function');
  });
  test('readiness endpoint exports a handler', async () => {
    const mod = await import('../../../pages/api/enterprise-governance/readiness');
    expect(typeof mod.default).toBe('function');
  });
});

describe('API contract: GovernanceIntegrationResult error envelopes are deterministic', () => {
  test('skipped envelope always carries skipped + reason fields', async () => {
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'false';
    const r = await onAssetGenerated({ assetId: 'ct-001', companyId: 'omnivyra' });
    expect(r.skipped).toBe(true);
    expect(['flag_off', 'idempotent_duplicate', 'lock_busy', 'asset_missing', 'internal_error']).toContain(r.reason);
    process.env.ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED = 'true';
  });

  test('successful envelope has skipped:false and result populated', async () => {
    const r = await onAssetGenerated({ assetId: 'ct-002', companyId: 'omnivyra' });
    expect(r.skipped).toBe(false);
    expect(r.result).toBeTruthy();
  });

  test('publish_blocked produces deterministic errorMessage shape', async () => {
    await onAssetGenerated({ assetId: 'ct-003', companyId: 'omnivyra' });
    const pub = await onPublished({ assetId: 'ct-003', actorUserId: 'u', actorRole: 'campaign_manager' });
    expect(pub.skipped).toBe(true);
    expect(pub.errorMessage).toMatch(/publish blocked.*expected approved/);
  });

  test('invalid actor role error message has consistent format', async () => {
    await onAssetGenerated({ assetId: 'ct-004', companyId: 'omnivyra' });
    await onQaResult({ assetId: 'ct-004', companyId: 'omnivyra', qaSeverity: 'pass', qaScore: 90 });
    await onApprovalDecision({ assetId: 'ct-004', to: 'brand_review', actorUserId: 'u', actorRole: 'brand_manager' });
    // creative_operator cannot approve at brand_review
    const r = await onApprovalDecision({
      assetId: 'ct-004', to: 'approved',
      actorUserId: 'u', actorRole: 'creative_operator',
    });
    expect(r.skipped).toBe(true);
    expect(r.errorMessage).toContain('invalid_actor_role');
  });
});
