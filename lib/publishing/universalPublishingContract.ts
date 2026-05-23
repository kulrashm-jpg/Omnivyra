// Universal Publishing Contract Layer
//
// Platform-agnostic, adapter-safe, non-executing publishing contract. A contract
// references an immutable publish snapshot and declares everything an executor
// would later need — boundaries, preservation/verification requirements, retry
// and reconciliation requirements, and a deterministic idempotency key.
//
// This module does not publish, schedule, or execute. It prepares a governed
// contract only.

import {
  publishSha256,
  stablePublishStringify,
  type UniversalPublishSnapshot,
} from './universalPublishSnapshot';

export type UniversalPublishingContractVersion = 'universal-publishing-contract-v1';
export type PublishMode = 'publish_now' | 'schedule' | 'cms_draft';
export type PublishState = 'contract_prepared' | 'contract_attention';
export type PublishTargetType =
  | 'wordpress'
  | 'ghost'
  | 'webflow'
  | 'shopify'
  | 'hubspot'
  | 'custom_api'
  | 'headless_cms'
  | 'generic_website';

export interface PublishSnapshotReference {
  snapshotId: string;
  publishVersionHash: string;
  contentType: string;
}

export interface UniversalPublishingContract {
  version: UniversalPublishingContractVersion;
  publishContractId: string;
  publishVersion: string;
  snapshotReference: PublishSnapshotReference;
  companyId: string;
  websiteId: string;
  integrationId: string;
  publishTargetType: PublishTargetType;
  publishMode: PublishMode;
  publishIntent: string;
  publishState: PublishState;
  publishBoundaries: readonly string[];
  publishPreservationRequirements: readonly string[];
  publishVerificationRequirements: readonly string[];
  publishRiskSignals: readonly string[];
  publishExecutionConstraints: readonly string[];
  publishRetryConstraints: readonly string[];
  publishReconciliationRequirements: readonly string[];
  publishAuditRequirements: readonly string[];
  publishIdempotencyKey: string;
  generatedAt: string;
}

export interface UniversalPublishingContractInput {
  snapshot: UniversalPublishSnapshot;
  publishTargetType: PublishTargetType;
  publishMode: PublishMode;
  publishIntent: string;
}

function riskSignals(input: UniversalPublishingContractInput): string[] {
  const snapshot = input.snapshot;
  const signals: string[] = [];
  if (!snapshot.renderedHtml.trim()) signals.push('rendered html is empty');
  if (!snapshot.slug.trim()) signals.push('missing slug');
  if (!snapshot.canonicalFields.canonicalUrl.trim()) signals.push('missing canonical url');
  if (!snapshot.companyContext.companyId.trim()) signals.push('missing company id');
  if (!snapshot.companyContext.websiteId.trim()) signals.push('missing website id');
  if (!snapshot.companyContext.integrationId.trim()) signals.push('missing integration id');
  if (input.publishMode === 'schedule' && !snapshot.scheduledTimestamp) {
    signals.push('schedule mode without scheduled timestamp');
  }
  if (snapshot.publishIntent !== input.publishMode) {
    signals.push('publish mode does not match snapshot publish intent');
  }
  return signals;
}

export function buildUniversalPublishingContract(
  input: UniversalPublishingContractInput,
): UniversalPublishingContract {
  const snapshot = input.snapshot;
  const company = snapshot.companyContext;
  const publishRiskSignals = riskSignals(input);

  const publishContractId = `pubc_${publishSha256(stablePublishStringify([
    snapshot.snapshotId,
    snapshot.publishVersionHash,
    input.publishTargetType,
    input.publishMode,
  ])).slice(0, 24)}`;

  const publishIdempotencyKey = `pidem_${publishSha256(stablePublishStringify([
    company.companyId,
    company.websiteId,
    snapshot.publishVersionHash,
    input.publishMode,
    snapshot.scheduledTimestamp ?? 'none',
  ])).slice(0, 32)}`;

  return {
    version: 'universal-publishing-contract-v1',
    publishContractId,
    publishVersion: 'universal-publishing-contract-v1',
    snapshotReference: {
      snapshotId: snapshot.snapshotId,
      publishVersionHash: snapshot.publishVersionHash,
      contentType: snapshot.contentType,
    },
    companyId: company.companyId,
    websiteId: company.websiteId,
    integrationId: company.integrationId,
    publishTargetType: input.publishTargetType,
    publishMode: input.publishMode,
    publishIntent: input.publishIntent,
    publishState: publishRiskSignals.length > 0 ? 'contract_attention' : 'contract_prepared',
    publishBoundaries: [
      'publishing contract is non-executing and platform-agnostic',
      'publishing contract must not mutate the referenced snapshot',
      'publish target must be owned by the contract company',
      'contract is bound to exactly one immutable snapshot reference',
    ],
    publishPreservationRequirements: [
      'preserve frozen snapshot content exactly as referenced',
      `preserve slug: ${snapshot.slug || '(none)'}`,
      'preserve canonical url and slug-lock state',
      'preserve company, website, and integration context',
    ],
    publishVerificationRequirements: [
      'verify snapshot integrity hash before any future execution',
      'verify company ownership of website and integration',
      'verify publish idempotency key uniqueness before execution',
      'verify publish mode is supported by the publish target',
    ],
    publishRiskSignals,
    publishExecutionConstraints: [
      'execution is deferred — contract layer is non-executing',
      'execution must consume the frozen snapshot only',
      'execution must not re-render or regenerate content',
    ],
    publishRetryConstraints: [
      'retries must reuse the same publish idempotency key',
      'retries must reuse the same frozen snapshot reference',
      'retry execution is deferred to a future runtime layer',
    ],
    publishReconciliationRequirements: [
      'reconciliation must compare external state against the frozen snapshot hash',
      'external drift must never mutate the snapshot or contract',
      'reconciliation execution is deferred to a future runtime layer',
    ],
    publishAuditRequirements: [
      'record snapshot id and publish version hash',
      'record publish contract id and idempotency key',
      'record publish lifecycle transitions and risk signals',
    ],
    publishIdempotencyKey,
    generatedAt: new Date(0).toISOString(),
  };
}

export function serializeUniversalPublishingContract(contract: UniversalPublishingContract): string {
  return [
    '## UNIVERSAL PUBLISHING CONTRACT',
    `Version: ${contract.version}`,
    `Contract id: ${contract.publishContractId}`,
    `Snapshot: ${contract.snapshotReference.snapshotId} (${contract.snapshotReference.publishVersionHash})`,
    `Target: ${contract.publishTargetType}`,
    `Publish mode: ${contract.publishMode}`,
    `Publish state: ${contract.publishState}`,
    `Idempotency key: ${contract.publishIdempotencyKey}`,
    `Risk signals: ${contract.publishRiskSignals.join('; ') || 'none'}`,
  ].join('\n');
}
