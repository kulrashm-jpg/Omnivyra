// Multi-Company Isolation Verification
//
// Deterministic, detect-only verification of company/website/integration
// ownership consistency for persisted publish snapshots. It NEVER blocks —
// cross-company leakage would be catastrophic for a publish-to-website
// feature, so this layer surfaces it as advisory findings.

import type { ContentPublishSnapshotRow } from './publishSnapshotRecord';
import type { PublishVerificationFinding } from './publishVerificationStatus';

export interface IsolationVerification {
  consistent: boolean;
  findings: readonly PublishVerificationFinding[];
}

// Internal ownership consistency of a single persisted row: the row's scalar
// company/website/integration columns must agree with the embedded snapshot,
// contract, and audit payloads.
export function verifyRowOwnershipConsistency(row: ContentPublishSnapshotRow): IsolationVerification {
  const findings: PublishVerificationFinding[] = [];
  const snapshot = row.snapshot_payload;
  const contract = row.contract_payload;
  const audit = row.audit_payload;
  const rowWebsite = row.website_id ?? '';
  const rowIntegration = row.integration_id ?? '';

  if (snapshot.companyContext.companyId !== row.company_id) {
    findings.push({ code: 'snapshot_company_mismatch', severity: 'invalid', message: 'snapshot company_id does not match row company_id' });
  }
  if (contract.companyId !== row.company_id) {
    findings.push({ code: 'contract_company_mismatch', severity: 'invalid', message: 'contract companyId does not match row company_id' });
  }
  if (audit.companyId !== row.company_id) {
    findings.push({ code: 'audit_company_mismatch', severity: 'invalid', message: 'audit companyId does not match row company_id' });
  }
  if (rowWebsite !== snapshot.companyContext.websiteId) {
    findings.push({ code: 'website_mismatch', severity: 'risk', message: 'row website_id drifts from snapshot website context' });
  }
  if (contract.websiteId !== snapshot.companyContext.websiteId) {
    findings.push({ code: 'contract_website_mismatch', severity: 'risk', message: 'contract websiteId drifts from snapshot website context' });
  }
  if (rowIntegration !== snapshot.companyContext.integrationId) {
    findings.push({ code: 'integration_mismatch', severity: 'risk', message: 'row integration_id drifts from snapshot integration context' });
  }
  if (contract.integrationId !== snapshot.companyContext.integrationId) {
    findings.push({ code: 'contract_integration_mismatch', severity: 'risk', message: 'contract integrationId drifts from snapshot integration context' });
  }

  return { consistent: findings.length === 0, findings };
}

function addToBucket(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.add(value);
  else map.set(key, new Set([value]));
}

// Cross-row isolation: a content-addressed snapshot id, publish contract id,
// or idempotency key must never appear under more than one company. A
// snapshot id embeds the company, so any collision indicates leakage/tamper.
export function verifyCrossCompanyIsolation(
  rows: readonly ContentPublishSnapshotRow[],
): IsolationVerification {
  const companyBySnapshot = new Map<string, Set<string>>();
  const companyByContract = new Map<string, Set<string>>();
  const companyByIdempotency = new Map<string, Set<string>>();

  for (const row of rows) {
    addToBucket(companyBySnapshot, row.snapshot_id, row.company_id);
    addToBucket(companyByContract, row.publish_contract_id, row.company_id);
    addToBucket(companyByIdempotency, row.idempotency_key, row.company_id);
  }

  const findings: PublishVerificationFinding[] = [];
  for (const [snapshotId, companies] of companyBySnapshot) {
    if (companies.size > 1) {
      findings.push({ code: 'cross_company_snapshot_leak', severity: 'invalid', message: `snapshot ${snapshotId} appears under multiple companies` });
    }
  }
  for (const [contractId, companies] of companyByContract) {
    if (companies.size > 1) {
      findings.push({ code: 'cross_company_contract_leak', severity: 'invalid', message: `publish contract ${contractId} appears under multiple companies` });
    }
  }
  for (const [key, companies] of companyByIdempotency) {
    if (companies.size > 1) {
      findings.push({ code: 'cross_company_idempotency_leak', severity: 'invalid', message: `idempotency key ${key} appears under multiple companies` });
    }
  }

  // Deterministic ordering.
  findings.sort((a, b) => (a.code + a.message).localeCompare(b.code + b.message));
  return { consistent: findings.length === 0, findings };
}
