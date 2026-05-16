import {
  validateTransition,
  isTerminal,
  isNonTerminal,
  billingOperationStatusToState,
  jobRegistryStatusToState,
  approvalStatusToState,
  IDEMPOTENCY_STATES,
} from '../../services/billing/idempotency/idempotencyStateMachine';

describe('idempotencyStateMachine', () => {
  it('classifies terminal vs non-terminal correctly', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('EXPIRED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('PENDING')).toBe(false);
    expect(isTerminal('IN_PROGRESS')).toBe(false);
    expect(isNonTerminal('PENDING')).toBe(true);
    expect(isNonTerminal('COMPLETED')).toBe(false);
  });

  it('PENDING → IN_PROGRESS allowed', () => {
    expect(validateTransition('PENDING', 'IN_PROGRESS').ok).toBe(true);
  });

  it('IN_PROGRESS → COMPLETED allowed', () => {
    expect(validateTransition('IN_PROGRESS', 'COMPLETED').ok).toBe(true);
  });

  it('IN_PROGRESS → EXPIRED allowed', () => {
    expect(validateTransition('IN_PROGRESS', 'EXPIRED').ok).toBe(true);
  });

  it('PENDING → COMPLETED rejected (must pass through IN_PROGRESS)', () => {
    const r = validateTransition('PENDING', 'COMPLETED');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INVALID_TRANSITION');
  });

  it('COMPLETED → anything is rejected (terminal)', () => {
    for (const target of IDEMPOTENCY_STATES) {
      const r = validateTransition('COMPLETED', target);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('TERMINAL_STATE');
    }
  });

  it('EXPIRED is terminal and cannot transition', () => {
    expect(validateTransition('EXPIRED', 'IN_PROGRESS').ok).toBe(false);
    expect(validateTransition('EXPIRED', 'COMPLETED').ok).toBe(false);
  });

  it('unknown states rejected', () => {
    const r = validateTransition('PENDING', 'WHATEVER' as never);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('UNKNOWN_STATE');
  });

  describe('surface mappers', () => {
    it('billing_operations maps correctly', () => {
      expect(billingOperationStatusToState('initiated')).toBe('IN_PROGRESS');
      expect(billingOperationStatusToState('held')).toBe('IN_PROGRESS');
      expect(billingOperationStatusToState('confirmed')).toBe('COMPLETED');
      expect(billingOperationStatusToState('released')).toBe('CANCELLED');
      expect(billingOperationStatusToState('insufficient')).toBe('FAILED');
      expect(billingOperationStatusToState('error')).toBe('FAILED');
      expect(billingOperationStatusToState('duplicate')).toBe('COMPLETED');
      expect(billingOperationStatusToState(null)).toBe('PENDING');
    });

    it('job_execution_registry maps correctly', () => {
      expect(jobRegistryStatusToState('reserved')).toBe('IN_PROGRESS');
      expect(jobRegistryStatusToState('in_progress')).toBe('IN_PROGRESS');
      expect(jobRegistryStatusToState('completed')).toBe('COMPLETED');
      expect(jobRegistryStatusToState('orphan_reaped')).toBe('CANCELLED');
      expect(jobRegistryStatusToState('released')).toBe('CANCELLED');
      expect(jobRegistryStatusToState('duplicate_blocked')).toBe('CANCELLED');
    });

    it('credit_action_approvals maps correctly', () => {
      expect(approvalStatusToState('pending')).toBe('PENDING');
      expect(approvalStatusToState('approved')).toBe('IN_PROGRESS');
      expect(approvalStatusToState('executed')).toBe('COMPLETED');
      expect(approvalStatusToState('rejected')).toBe('FAILED');
      expect(approvalStatusToState('cancelled')).toBe('CANCELLED');
      expect(approvalStatusToState('expired')).toBe('EXPIRED');
    });
  });
});
