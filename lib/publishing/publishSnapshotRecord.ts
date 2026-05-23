// Publish Snapshot Persistence Record Codec
//
// Pure, deterministic transform between the in-memory publishing objects and
// the `content_publish_snapshots` table row shape. No DB access, no execution.
// Hydration re-applies immutability guarantees (the snapshot is re-frozen and
// re-hashed through createUniversalPublishSnapshot).

import {
  createUniversalPublishSnapshot,
  type UniversalPublishSnapshot,
  type UniversalPublishSnapshotInput,
} from './universalPublishSnapshot';
import type { UniversalPublishingContract } from './universalPublishingContract';
import type { PublishingAuditContract } from './publishingAuditContracts';
import { deriveInitialSnapshotStatus, type SnapshotLifecycleStatus } from './publishSnapshotLifecycle';

export interface ContentPublishSnapshotRow {
  snapshot_id: string;
  publish_contract_id: string;
  publish_version_hash: string;
  blog_id: string | null;
  content_id: string | null;
  company_id: string;
  website_id: string | null;
  integration_id: string | null;
  content_type: string;
  publish_target_type: string;
  publish_mode: string;
  publish_intent: string;
  scheduled_publish_at: string | null;
  snapshot_payload: UniversalPublishSnapshot;
  contract_payload: UniversalPublishingContract;
  audit_payload: PublishingAuditContract;
  idempotency_key: string;
  snapshot_status: SnapshotLifecycleStatus;
}

export interface BuildPublishSnapshotRowInput {
  snapshot: UniversalPublishSnapshot;
  contract: UniversalPublishingContract;
  audit: PublishingAuditContract;
  blogId?: string | null;
  contentId?: string | null;
  snapshotStatus?: SnapshotLifecycleStatus;
}

export interface HydratedPublishSnapshot {
  snapshot: UniversalPublishSnapshot;
  contract: UniversalPublishingContract;
  audit: PublishingAuditContract;
  hashConsistent: boolean;
}

function emptyToNull(value: string): string | null {
  return value && value.trim() ? value : null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function extractSnapshotInput(snapshot: UniversalPublishSnapshot): UniversalPublishSnapshotInput {
  return {
    renderedHtml: snapshot.renderedHtml,
    contentBlocks: snapshot.contentBlocks,
    seoMetadata: snapshot.seoMetadata,
    slug: snapshot.slug,
    canonicalFields: snapshot.canonicalFields,
    mediaReferences: snapshot.mediaReferences,
    taxonomy: snapshot.taxonomy,
    authorAttribution: snapshot.authorAttribution,
    companyContext: snapshot.companyContext,
    contentType: snapshot.contentType,
    generationMetadata: snapshot.generationMetadata,
    publishTargetMetadata: snapshot.publishTargetMetadata,
    scheduledTimestamp: snapshot.scheduledTimestamp,
    publishIntent: snapshot.publishIntent,
  };
}

// Deterministic: identical inputs always produce an identical row.
export function buildPublishSnapshotRow(input: BuildPublishSnapshotRowInput): ContentPublishSnapshotRow {
  const { snapshot, contract, audit } = input;
  return {
    snapshot_id: snapshot.snapshotId,
    publish_contract_id: contract.publishContractId,
    publish_version_hash: snapshot.publishVersionHash,
    blog_id: input.blogId ?? null,
    content_id: input.contentId ?? null,
    company_id: snapshot.companyContext.companyId,
    website_id: emptyToNull(snapshot.companyContext.websiteId),
    integration_id: emptyToNull(snapshot.companyContext.integrationId),
    content_type: snapshot.contentType,
    publish_target_type: contract.publishTargetType,
    publish_mode: contract.publishMode,
    publish_intent: snapshot.publishIntent,
    scheduled_publish_at: snapshot.scheduledTimestamp,
    snapshot_payload: snapshot,
    contract_payload: contract,
    audit_payload: audit,
    idempotency_key: contract.publishIdempotencyKey,
    snapshot_status: input.snapshotStatus ?? deriveInitialSnapshotStatus(snapshot),
  };
}

// Re-hydrate a persisted row. The snapshot is rebuilt through
// createUniversalPublishSnapshot so it is re-frozen and re-hashed; the
// contract/audit payloads are deep-frozen clones. `hashConsistent` reports
// whether the rebuilt hash still matches the persisted publish_version_hash.
export function hydratePublishSnapshotRow(row: ContentPublishSnapshotRow): HydratedPublishSnapshot {
  const snapshot = createUniversalPublishSnapshot(extractSnapshotInput(row.snapshot_payload));
  const contract = deepFreeze(
    JSON.parse(JSON.stringify(row.contract_payload)) as UniversalPublishingContract,
  );
  const audit = deepFreeze(
    JSON.parse(JSON.stringify(row.audit_payload)) as PublishingAuditContract,
  );
  return {
    snapshot,
    contract,
    audit,
    hashConsistent: snapshot.publishVersionHash === row.publish_version_hash,
  };
}
