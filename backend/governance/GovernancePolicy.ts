/**
 * Stage 23 — Governance Policy Versioning.
 * Immutable policy signature and deterministic hash for audit traceability.
 */

import crypto from 'crypto';
import { BLUEPRINT_FREEZE_WINDOW_HOURS } from './GovernanceConfig';
import {
  GOVERNANCE_EVALUATION_ORDER,
  TRADE_OFF_PRIORITY_ORDER,
} from './GovernanceContract';

export const GOVERNANCE_POLICY_VERSION = '1.0.0';

export interface GovernancePolicySignature {
  version: string;
  freezeWindowHours: number;
  evaluationOrder: readonly string[];
  tradeOffRanking: typeof TRADE_OFF_PRIORITY_ORDER;
}

export function getGovernancePolicySignature(): GovernancePolicySignature {
  return {
    version: GOVERNANCE_POLICY_VERSION,
    freezeWindowHours: BLUEPRINT_FREEZE_WINDOW_HOURS,
    evaluationOrder: GOVERNANCE_EVALUATION_ORDER,
    tradeOffRanking: TRADE_OFF_PRIORITY_ORDER,
  };
}

/**
 * Deterministic SHA256 hash of the policy signature. Used for audit anchoring.
 */
export function getGovernancePolicyHash(): string {
  const payload = JSON.stringify(getGovernancePolicySignature());
  return crypto.createHash('sha256').update(payload).digest('hex');
}
