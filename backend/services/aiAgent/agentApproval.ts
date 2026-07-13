/**
 * agentApproval.ts — human approval framework (AIA-001 §7).
 *
 * ONE approval model for every agent gate. Deterministic: given the current
 * approval records + clock, the gate decision is reproducible. Supports approved,
 * rejected, timeout, and resubmit. No wall-clock in the decision except the
 * injected `nowMs`/`requestedAtMs` comparison for timeout.
 */

import type { ApprovalDecision, ApprovalRecord } from './agentContracts';

export type GateOutcome = 'proceed' | 'wait' | 'reject' | 'resubmit';

export interface GateInput {
  stepId: string;
  approvals: ApprovalRecord[];
  requestedAtMs: number | null;
  nowMs: number;
  timeoutMs: number;
}

/**
 * Decide an approval gate deterministically:
 *   latest record for the step wins;
 *   approved → proceed; rejected → reject; resubmit → resubmit;
 *   no record + within timeout → wait; no record + past timeout → resubmit (timeout).
 */
export function decideApprovalGate(input: GateInput): { outcome: GateOutcome; decision: ApprovalDecision | null } {
  const forStep = input.approvals.filter((a) => a.stepId === input.stepId);
  const latest = forStep.length ? forStep[forStep.length - 1] : null;

  if (latest) {
    switch (latest.decision) {
      case 'approved': return { outcome: 'proceed', decision: 'approved' };
      case 'rejected': return { outcome: 'reject', decision: 'rejected' };
      case 'resubmit': return { outcome: 'resubmit', decision: 'resubmit' };
      case 'timeout':  return { outcome: 'resubmit', decision: 'timeout' };
    }
  }

  // No decision yet.
  if (input.requestedAtMs != null && Number.isFinite(input.requestedAtMs)) {
    const elapsed = input.nowMs - input.requestedAtMs;
    if (elapsed >= input.timeoutMs) return { outcome: 'resubmit', decision: 'timeout' };
  }
  return { outcome: 'wait', decision: null };
}

/** Build a normalized approval record. Pure. */
export function makeApprovalRecord(stepId: string, decision: ApprovalDecision, at: string, by?: string | null, note?: string | null): ApprovalRecord {
  return { stepId, decision, at, by: by ?? null, note: note ?? null };
}
