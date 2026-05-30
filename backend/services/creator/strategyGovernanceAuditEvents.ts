/**
 * Strategy Governance Audit Events (Creator Compliance-Aware
 * Strategy Governance — P6).
 *
 * Thin wrapper over the existing `recordAuditEvent` infrastructure.
 * Used when an operator selects a strategy that the resolved
 * governance policy classified as restricted. This is GUIDANCE, NOT
 * ENFORCEMENT — the selection is allowed; the audit trail is the
 * compliance record.
 *
 * Fire-and-forget — never blocks the caller. Mirrors the
 * variantAuditEvents.ts pattern.
 */

import { recordAuditEvent } from '../auditEventService';
import type { GovernedIndustry, GovernanceRiskLevel } from './strategyGovernancePolicyRegistry';

const RESOURCE_TYPE = 'strategy_governance';

function safeAudit(input: Parameters<typeof recordAuditEvent>[0]): void {
  void (async () => {
    try {
      await recordAuditEvent(input);
    } catch {
      // recordAuditEvent already swallows DB failures with a
      // console.warn; this catch covers anything stranger.
    }
  })();
}

/**
 * Fire an audit event when an operator selects a strategy that the
 * governance policy classified as restricted. Records the exact
 * restriction reason so the audit row is self-contained for
 * compliance review.
 */
export function auditRestrictedStrategySelected(input: {
  companyId: string;
  industry: GovernedIndustry;
  riskLevel: GovernanceRiskLevel;
  strategyId: string;
  contentType: string;
  restrictionReason: string;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'strategy_governance.restricted_selected',
    resourceType: RESOURCE_TYPE,
    resourceId: input.strategyId,
    severity: input.riskLevel === 'high' ? 'warning' : 'info',
    metadata: {
      industry: input.industry,
      risk_level: input.riskLevel,
      content_type: input.contentType,
      restriction_reason: input.restrictionReason,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Fire an audit event when an operator toggles the picker's
 * "show restricted strategies" reveal. Records who opened it so the
 * compliance trail captures the unhide as well as the selection.
 */
export function auditRestrictedStrategiesRevealed(input: {
  companyId: string;
  industry: GovernedIndustry;
  riskLevel: GovernanceRiskLevel;
  contentType: string;
  actorUserId?: string | null;
}): void {
  safeAudit({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'strategy_governance.restricted_revealed',
    resourceType: RESOURCE_TYPE,
    resourceId: input.companyId,
    severity: 'info',
    metadata: {
      industry: input.industry,
      risk_level: input.riskLevel,
      content_type: input.contentType,
      timestamp: new Date().toISOString(),
    },
  });
}
