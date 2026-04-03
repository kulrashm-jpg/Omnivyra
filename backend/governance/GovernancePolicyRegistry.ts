/**
 * Stage 26 — Governance Policy Evolution Framework.
 * Stage 27 — Policy Signature Freeze Guard.
 * Registry of governance policy versions. Enables multi-policy coexistence.
 */

import crypto from 'crypto';
import { getGovernancePolicyHash } from './GovernancePolicy';
import { BLUEPRINT_FREEZE_WINDOW_HOURS } from './GovernanceConfig';
import {
  GOVERNANCE_EVALUATION_ORDER,
  TRADE_OFF_PRIORITY_ORDER,
} from './GovernanceContract';

export type ConstraintType = (typeof GOVERNANCE_EVALUATION_ORDER)[number];

export interface GovernancePolicyDefinition {
  version: string;
  freezeWindowHours: number;
  evaluationOrder: ConstraintType[];
  tradeOffRanking: typeof TRADE_OFF_PRIORITY_ORDER;
  hash: string;
}

export class PolicyVersionNotFoundError extends Error {
  code = 'POLICY_VERSION_NOT_FOUND';
  constructor(version: string) {
    super(`Governance policy version "${version}" not found`);
    this.name = 'PolicyVersionNotFoundError';
  }
}

const CURRENT_VERSION = '1.0.0';

function buildPolicyDefinition(version: string): GovernancePolicyDefinition {
  const evaluationOrder = [...GOVERNANCE_EVALUATION_ORDER] as ConstraintType[];
  const tradeOffRanking = { ...TRADE_OFF_PRIORITY_ORDER };
  const payload = JSON.stringify({
    version,
    freezeWindowHours: BLUEPRINT_FREEZE_WINDOW_HOURS,
    evaluationOrder: GOVERNANCE_EVALUATION_ORDER,
    tradeOffRanking: TRADE_OFF_PRIORITY_ORDER,
  });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return {
    version,
    freezeWindowHours: BLUEPRINT_FREEZE_WINDOW_HOURS,
    evaluationOrder,
    tradeOffRanking,
    hash,
  };
}

const POLICY_V1 = buildPolicyDefinition('1.0.0');

const REGISTRY: Record<string, GovernancePolicyDefinition> = {
  '1.0.0': POLICY_V1,
};

/**
 * Get governance policy by version.
 * If version omitted → returns current policy.
 * If version specified → returns that policy.
 * @throws PolicyVersionNotFoundError if unknown version
 */
export function getGovernancePolicy(version?: string): GovernancePolicyDefinition {
  const key = version && version.trim() ? version.trim() : CURRENT_VERSION;
  const policy = REGISTRY[key];
  if (!policy) {
    throw new PolicyVersionNotFoundError(key);
  }
  return policy;
}

/** Current policy version string. */
export function getCurrentPolicyVersion(): string {
  return CURRENT_VERSION;
}

export class PolicySignatureMismatchError extends Error {
  code = 'POLICY_SIGNATURE_MISMATCH';
  constructor(expected: string, actual: string) {
    super(`Governance policy signature mismatch: expected ${expected}, actual ${actual}`);
    this.name = 'PolicySignatureMismatchError';
  }
}

let policySignatureAssertionRun = false;

import { config } from '@/config';

/**
 * Stage 27: Assert that current policy hash matches GOVERNANCE_POLICY_EXPECTED_HASH when env is set.
 * Call once at app bootstrap. Prevents silent evaluation order changes in production.
 * When env is set, always validates (allows tests to verify). When env unset, no-op once.
 */
export function assertPolicySignatureUnchanged(): void {
  const expected = config.GOVERNANCE_POLICY_EXPECTED_HASH?.trim();
  if (!expected) {
    policySignatureAssertionRun = true;
    return;
  }
  const actual = getGovernancePolicyHash();
  if (actual !== expected) {
    throw new PolicySignatureMismatchError(expected, actual);
  }
  policySignatureAssertionRun = true;
}
