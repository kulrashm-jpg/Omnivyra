/**
 * Person erasure API — the transport mapping shared by the two erasure routes
 * (`pages/api/prospect-identity/erasure-requests/{index,[requestId]}.ts`).
 *
 * Pure HTTP translation plus the completion audit event. It decides nothing
 * about erasure: the status comes from the ledger via personErasureRequests.
 */
import type { NextApiRequest } from 'next';
import type { AuthenticatedPrincipal } from '../../../shared/contracts/security';
import { PROSPECT_PERSON_ERASE } from '../../../shared/contracts/security';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { getTrustedClientIpOrNull } from '../../../lib/security/clientIp';
import { logger } from '../../services/logger';
import type { ErasureOutcome, ErasureStatus } from '../../services/prospectIdentity/personErasureRequests';

/** HTTP status per derived erasure status. Only COMPLETED is a 200 on a write: no false success. */
const HTTP_FOR_STATUS: Record<ErasureStatus, number> = {
  COMPLETED: 200,
  IN_PROGRESS: 409,
  FAILED_REQUIRES_REVIEW: 409,
  REQUESTED: 503,
  PARTIALLY_COMPLETED: 503,
  RETRY_REQUIRED: 503,
};

const RETRYABLE: ReadonlySet<ErasureStatus> = new Set(['IN_PROGRESS', 'REQUESTED', 'PARTIALLY_COMPLETED', 'RETRY_REQUIRED']);

export function erasureHttpResponse(outcome: ErasureOutcome): { status: number; body: Record<string, unknown> } {
  switch (outcome.kind) {
    case 'subject_not_found':
      // Unknown and other-tenant persons are indistinguishable by design.
      return { status: 404, body: { error: 'subject_not_found' } };
    case 'request_not_found':
      return { status: 404, body: { error: 'request_not_found' } };
    case 'schema_not_ready':
      // Deploy-order gate (erasureSchemaReady): nothing was started.
      return { status: 503, body: { error: 'ERASURE_SCHEMA_NOT_READY', retryable: false } };
    case 'ledger_unavailable':
      return { status: 503, body: { error: 'erasure_unavailable', retryable: false } };
    case 'request': {
      const s = outcome.view.status;
      const error = s === 'COMPLETED' ? undefined
        : s === 'IN_PROGRESS' ? 'erasure_in_progress'
          : s === 'FAILED_REQUIRES_REVIEW' ? 'erasure_requires_review'
            : 'erasure_incomplete_retry';
      return {
        status: HTTP_FOR_STATUS[s],
        body: { ...(error ? { error } : {}), retryable: RETRYABLE.has(s), errorCode: outcome.errorCode, request: outcome.view },
      };
    }
  }
}

/** The ledger's `requested_by` is a role LABEL, never a personal identifier. */
export function requestedByLabel(tenant: { role: string | null; bypass: boolean }): string {
  if (tenant.bypass) return 'erasure-api:platform-super-admin';
  const role = String(tenant.role ?? 'member').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return `erasure-api:${role}`;
}

/**
 * The audit trail of an erasure attempt: capability_audit_log, keyed by the
 * REQUEST id (the person id must not outlive the person), with the derived
 * status and error code. requireCapability already audited the authorization
 * decision itself. Never throws (logSecurityEvent never does).
 */
export async function auditErasureOutcome(
  req: NextApiRequest, principal: AuthenticatedPrincipal, organizationId: string, outcome: ErasureOutcome,
): Promise<void> {
  const status = outcome.kind === 'request' ? outcome.view.status : outcome.kind;
  const errorCode = outcome.kind === 'request' ? outcome.errorCode : null;
  const requestId = outcome.kind === 'request' ? outcome.view.requestId : null;
  const ua = req.headers?.['user-agent'];
  await logSecurityEvent({
    capability: PROSPECT_PERSON_ERASE,
    decision: 'elevated_ui_action_completed',
    actorUserId: principal.userId,
    actorSessionId: principal.sessionId,
    principalUserId: principal.userId,
    principalSupabaseUid: principal.supabaseUid,
    organizationId,
    resourceId: requestId,
    reason: `person_erasure:${status}${errorCode ? `:${errorCode}` : ''}`,
    ip: getTrustedClientIpOrNull(req),
    userAgent: typeof ua === 'string' ? ua : null,
  });
  logger.info('person_erasure_request', { organizationId, requestId, status, errorCode });
}
