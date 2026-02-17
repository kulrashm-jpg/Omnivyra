/**
 * Stage 31 — Governance Tamper-Evident Event Ledger.
 * Deterministic hash for cryptographically chained governance events.
 */

import crypto from 'crypto';

export interface ComputeGovernanceEventHashParams {
  campaignId: string;
  eventType: string;
  eventStatus: string;
  metadata: any;
  policyVersion: string;
  policyHash: string;
  previousEventHash: string | null;
}

/**
 * Deterministic JSON stringify with sorted keys.
 */
function stringifySorted(obj: any): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stringifySorted).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + stringifySorted(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute deterministic SHA256 hash for a governance event.
 * Stable across environments. Used for tamper-evident chaining.
 */
export function computeGovernanceEventHash(params: ComputeGovernanceEventHashParams): string {
  const payload = stringifySorted({
    campaignId: params.campaignId,
    eventType: params.eventType,
    eventStatus: params.eventStatus,
    metadata: params.metadata ?? {},
    policyVersion: params.policyVersion,
    policyHash: params.policyHash,
    previousEventHash: params.previousEventHash ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
