/**
 * Normalized billing-mutation API responses (HOTFIX-001 Phase E).
 *
 * Every billing mutation endpoint should terminate through one of these
 * so the operator UI always receives an explicit, actionable terminal
 * shape with a correlation ID. This is ADDITIVE: legacy keys
 * (`ok`, `error`, `code`, plus any caller-supplied data) are preserved
 * so existing consumers/tests keep working — we only add fields.
 */

import type { NextApiResponse } from 'next';
import { getBillingCorrelation } from './billingCorrelationService';

export type BillingTerminalStatus =
  | 'succeeded'
  | 'pending_approval'
  | 'queued'
  | 'rejected'
  | 'failed';

export type BillingErrorCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'APPROVAL_CONSTRAINT'   // 42P10 ON CONFLICT arbiter — hotfix-001 class
  | 'REPLAY_BLOCKED'
  | 'SCHEMA_NOT_READY'
  | 'LEDGER_FAILED'
  | 'APPROVAL_REJECTED'
  | 'GRANT_LIMIT_EXCEEDED'
  | 'INTERNAL';

/** Map a low-level error message/code to a normalized, actionable shape. */
export function classifyBillingError(raw: string | undefined, legacyCode?: string): {
  errorCode: BillingErrorCode;
  retryable: boolean;
  actionableMessage: string;
} {
  const m = (raw ?? '').toLowerCase();
  if (m.includes('on conflict') || m.includes('42p10')) {
    return {
      errorCode: 'APPROVAL_CONSTRAINT',
      retryable: false,
      actionableMessage:
        'Approval index misconfigured (ON CONFLICT arbiter). Apply docs/audit/billing-hotfix-001-caa-client-request-index.sql, then retry.',
    };
  }
  if (m.includes('schema cache') || m.includes('pgrst205') || legacyCode === 'BILLING_SCHEMA_NOT_READY') {
    return { errorCode: 'SCHEMA_NOT_READY', retryable: false,
      actionableMessage: 'Billing schema not ready — apply pending billing migrations, then retry.' };
  }
  if (m.includes('idempotency') && (m.includes('in progress') || m.includes('already'))) {
    return { errorCode: 'REPLAY_BLOCKED', retryable: false,
      actionableMessage: 'Duplicate request blocked by replay protection. The original request is authoritative — do not resubmit.' };
  }
  if (legacyCode === 'GRANT_LIMIT_EXCEEDED' || m.includes('limit exceeded')) {
    return { errorCode: 'GRANT_LIMIT_EXCEEDED', retryable: true,
      actionableMessage: 'Grant rate limit exceeded. Wait for the window to reset or use the escalation override.' };
  }
  if (legacyCode === 'LEDGER_FAILED' || m.includes('ledger')) {
    return { errorCode: 'LEDGER_FAILED', retryable: true,
      actionableMessage: 'Ledger write failed. Safe to retry with the same Idempotency-Key (exactly-once protected).' };
  }
  return { errorCode: 'INTERNAL', retryable: true,
    actionableMessage: raw?.trim() ? raw : 'Unexpected error. Retry with the same Idempotency-Key; if it persists, check the billing health endpoint.' };
}

export function billingOk(
  res: NextApiResponse,
  httpStatus: number,
  args: {
    status: BillingTerminalStatus;
    message: string;
    /** Preserved verbatim for backward compatibility (e.g. {ok,credits,...}). */
    legacy?: Record<string, unknown>;
  },
): void {
  const { correlationId, operationId } = getBillingCorrelation({ module: 'billing_api' });
  res.status(httpStatus).json({
    success:       true,
    ok:            true,                 // legacy
    status:        args.status,
    message:       args.message,
    operationId,
    correlationId,
    ...(args.legacy ?? {}),
  });
}

export function billingFail(
  res: NextApiResponse,
  httpStatus: number,
  args: {
    rawMessage?: string;
    legacyCode?: string;
    /** Override classification when the caller already knows the code. */
    errorCode?: BillingErrorCode;
    retryable?: boolean;
    actionableMessage?: string;
  },
): void {
  const c = classifyBillingError(args.rawMessage, args.legacyCode);
  const errorCode = args.errorCode ?? c.errorCode;
  const retryable = args.retryable ?? c.retryable;
  const actionableMessage = args.actionableMessage ?? c.actionableMessage;
  const { correlationId } = getBillingCorrelation({ module: 'billing_api' });
  res.status(httpStatus).json({
    success:           false,
    ok:                false,                                  // legacy
    error:             args.rawMessage ?? actionableMessage,   // legacy
    code:              args.legacyCode ?? errorCode,           // legacy
    errorCode,
    retryable,
    actionableMessage,
    status:            'failed' as BillingTerminalStatus,
    correlationId,
  });
}
