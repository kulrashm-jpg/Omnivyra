/**
 * billingApiResponse — normalized billing-mutation response contract
 * (HOTFIX-001 Phase E/G).
 *
 * Guarantees:
 *   - success/failure always carry correlationId
 *   - 42P10 / ON CONFLICT classified as APPROVAL_CONSTRAINT (the
 *     hotfix-001 class), non-retryable, actionable
 *   - schema-cache + replay + ledger classification
 *   - legacy keys (ok / error / code) preserved (no consumer breakage)
 */

jest.mock('../../services/billing/billingCorrelationService', () => ({
  getBillingCorrelation: () => ({
    correlationId: 'corr-test-123',
    operationId: 'op-test-456',
    module: 'billing_api',
  }),
}));

import {
  billingOk,
  billingFail,
  classifyBillingError,
} from '../../services/billing/billingApiResponse';

type Res = { status: jest.Mock; json: jest.Mock };
function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('classifyBillingError', () => {
  it('42P10 / ON CONFLICT → APPROVAL_CONSTRAINT, non-retryable, actionable', () => {
    const c = classifyBillingError('there is no unique or exclusion constraint matching the ON CONFLICT specification');
    expect(c.errorCode).toBe('APPROVAL_CONSTRAINT');
    expect(c.retryable).toBe(false);
    expect(c.actionableMessage).toMatch(/hotfix-001/i);
  });

  it('schema-cache miss → SCHEMA_NOT_READY', () => {
    expect(classifyBillingError("Could not find the table 'public.x' in the schema cache").errorCode)
      .toBe('SCHEMA_NOT_READY');
  });

  it('idempotency in-progress → REPLAY_BLOCKED non-retryable', () => {
    const c = classifyBillingError('Idempotency-Key is already in progress');
    expect(c.errorCode).toBe('REPLAY_BLOCKED');
    expect(c.retryable).toBe(false);
  });

  it('legacy GRANT_LIMIT_EXCEEDED → retryable', () => {
    const c = classifyBillingError(undefined, 'GRANT_LIMIT_EXCEEDED');
    expect(c.errorCode).toBe('GRANT_LIMIT_EXCEEDED');
    expect(c.retryable).toBe(true);
  });

  it('unknown → INTERNAL retryable', () => {
    expect(classifyBillingError('something weird').errorCode).toBe('INTERNAL');
  });
});

describe('billingOk', () => {
  it('always includes success+correlationId+operationId and preserves legacy', () => {
    const res = makeRes();
    billingOk(res as never, 200, {
      status: 'succeeded',
      message: 'Credits granted successfully.',
      legacy: { ok: true, credits: 5000, idempotencyKey: 'k1' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.ok).toBe(true);                 // legacy preserved
    expect(body.credits).toBe(5000);            // legacy passthrough
    expect(body.status).toBe('succeeded');
    expect(body.correlationId).toBe('corr-test-123');
    expect(body.operationId).toBe('op-test-456');
  });

  it('202 pending_approval terminal shape', () => {
    const res = makeRes();
    billingOk(res as never, 202, {
      status: 'pending_approval',
      message: 'Awaiting signatures',
      legacy: { status: 'pending_approval', approvalId: 'a1', requiredApprovals: 2 },
    });
    expect(res.status).toHaveBeenCalledWith(202);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('pending_approval');
    expect(body.approvalId).toBe('a1');
    expect(body.correlationId).toBe('corr-test-123');
  });
});

describe('billingFail', () => {
  it('42P10 path → success:false, APPROVAL_CONSTRAINT, correlationId, legacy keys', () => {
    const res = makeRes();
    billingFail(res as never, 500, {
      rawMessage: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    });
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.ok).toBe(false);                       // legacy
    expect(body.error).toMatch(/ON CONFLICT/);         // legacy
    expect(body.errorCode).toBe('APPROVAL_CONSTRAINT');
    expect(body.retryable).toBe(false);
    expect(body.actionableMessage).toMatch(/hotfix-001/i);
    expect(body.correlationId).toBe('corr-test-123');
    expect(body.status).toBe('failed');
  });

  it('explicit override wins over classification', () => {
    const res = makeRes();
    billingFail(res as never, 400, {
      rawMessage: 'whatever',
      errorCode: 'VALIDATION',
      retryable: false,
      actionableMessage: 'Fix the inputs.',
      legacyCode: 'INVALID_PAYLOAD',
    });
    const body = res.json.mock.calls[0][0];
    expect(body.errorCode).toBe('VALIDATION');
    expect(body.code).toBe('INVALID_PAYLOAD');         // legacy preserved
    expect(body.actionableMessage).toBe('Fix the inputs.');
  });
});
