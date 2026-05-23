// Snapshot Capture Integration Layer
//
// Pure, deterministic, non-executing capture orchestration. At a finalization
// or scheduling boundary it maps real content into a UniversalPublishSnapshot,
// builds the publishing contract + audit contract + capture audit reference +
// scheduled version lock, and runs pre-persistence integrity verification.
//
// It does NOT persist, publish, call a CMS, or touch a queue/scheduler. The
// persistence step is performed by publishSnapshotCaptureService.

import {
  createUniversalPublishSnapshot,
  type UniversalPublishSnapshot,
} from './universalPublishSnapshot';
import {
  buildUniversalPublishingContract,
  type PublishTargetType,
  type PublishMode,
  type UniversalPublishingContract,
} from './universalPublishingContract';
import { buildPublishingAuditContract, type PublishingAuditContract } from './publishingAuditContracts';
import {
  createScheduledPublishLock,
  type ScheduledPublishLock,
} from './scheduledPublishLock';
import {
  mapBlogToPublishSnapshotInput,
  type BlogContentSource,
} from './publishSnapshotMapper';
import {
  canCapturePublishSnapshot,
  derivePublishCaptureIntent,
  derivePublishCaptureMode,
  type PublishCaptureEligibility,
  type PublishCaptureIntent,
  type PublishCaptureLifecyclePhase,
} from './publishSnapshotCaptureEligibility';
import {
  buildPublishCaptureAuditReference,
  type PublishCaptureAuditReference,
} from './publishCaptureAuditReference';
import {
  verifyCaptureBeforePersistence,
  type PublishCaptureIntegrityResult,
} from './publishCaptureIntegrityHook';

export interface PublishCaptureInput {
  blog: BlogContentSource;
  renderedHtml: string;
  contentType: string;
  publishTargetType: PublishTargetType;
  canonicalUrl: string;
  focusKeyword: string;
  author: { authorId: string; authorName: string };
  generationMetadata: Record<string, unknown>;
  captureSource: string;
  lifecyclePhase: PublishCaptureLifecyclePhase;
  blogStatus: string;
}

export interface PublishCaptureBundle {
  version: 'publish-snapshot-capture-v1';
  generatedAt: string;
  captureIntent: PublishCaptureIntent;
  captureMode: PublishMode;
  eligibility: PublishCaptureEligibility;
  snapshot: UniversalPublishSnapshot;
  contract: UniversalPublishingContract;
  audit: PublishingAuditContract;
  captureAuditReference: PublishCaptureAuditReference;
  scheduledLock: ScheduledPublishLock | null;
  integrity: PublishCaptureIntegrityResult;
}

// Builds the complete capture bundle. Pure and deterministic — identical input
// always yields a byte-identical bundle.
export function buildPublishCaptureBundle(input: PublishCaptureInput): PublishCaptureBundle {
  const scheduledTimestamp = input.blog.scheduled_publish_at ?? null;

  const captureIntent = derivePublishCaptureIntent({
    lifecyclePhase: input.lifecyclePhase,
    scheduledTimestamp,
    blogStatus: input.blogStatus,
  });
  const captureMode = derivePublishCaptureMode({ scheduledTimestamp, captureIntent });

  const eligibility = canCapturePublishSnapshot({
    companyId: input.blog.company_id,
    renderedHtml: input.renderedHtml,
    contentBlockCount: Array.isArray(input.blog.content_blocks) ? input.blog.content_blocks.length : 0,
    title: input.blog.title,
    slug: input.blog.slug,
  });

  const snapshotInput = mapBlogToPublishSnapshotInput(input.blog, {
    renderedHtml: input.renderedHtml,
    contentType: input.contentType,
    publishIntent: captureMode,
    publishTargetType: input.publishTargetType,
    canonicalUrl: input.canonicalUrl,
    focusKeyword: input.focusKeyword,
    author: input.author,
    generationMetadata: input.generationMetadata,
  });

  const snapshot = createUniversalPublishSnapshot(snapshotInput);
  const contract = buildUniversalPublishingContract({
    snapshot,
    publishTargetType: input.publishTargetType,
    publishMode: captureMode,
    publishIntent: captureIntent,
  });
  const audit = buildPublishingAuditContract({ snapshot, contract });
  const scheduledLock = captureMode === 'schedule'
    ? createScheduledPublishLock(snapshot, contract)
    : null;

  const integrity = verifyCaptureBeforePersistence(snapshot, contract, scheduledLock);

  const captureAuditReference = buildPublishCaptureAuditReference({
    captureSource: input.captureSource,
    captureLifecyclePhase: input.lifecyclePhase,
    captureIntent,
    captureIntegrityStatus: integrity.valid ? 'capture_integrity_ok' : 'capture_integrity_failed',
    snapshotId: snapshot.snapshotId,
    publishContractId: contract.publishContractId,
    publishVersionHash: snapshot.publishVersionHash,
    idempotencyKey: contract.publishIdempotencyKey,
    auditContractId: audit.auditContractId,
  });

  return {
    version: 'publish-snapshot-capture-v1',
    generatedAt: new Date(0).toISOString(),
    captureIntent,
    captureMode,
    eligibility,
    snapshot,
    contract,
    audit,
    captureAuditReference,
    scheduledLock,
    integrity,
  };
}

export interface PublishCaptureReferences {
  snapshotId: string;
  publishContractId: string;
  publishVersionHash: string;
  idempotencyKey: string;
  auditContractId: string;
  captureReferenceId: string;
}

export function extractCaptureReferences(bundle: PublishCaptureBundle): PublishCaptureReferences {
  return {
    snapshotId: bundle.snapshot.snapshotId,
    publishContractId: bundle.contract.publishContractId,
    publishVersionHash: bundle.snapshot.publishVersionHash,
    idempotencyKey: bundle.contract.publishIdempotencyKey,
    auditContractId: bundle.audit.auditContractId,
    captureReferenceId: bundle.captureAuditReference.captureReferenceId,
  };
}

export function serializePublishCaptureBundle(bundle: PublishCaptureBundle): string {
  return [
    '## PUBLISH SNAPSHOT CAPTURE BUNDLE',
    `Version: ${bundle.version}`,
    `Capture intent: ${bundle.captureIntent}`,
    `Capture mode: ${bundle.captureMode}`,
    `Eligible: ${bundle.eligibility.eligible}`,
    `Snapshot: ${bundle.snapshot.snapshotId} (${bundle.snapshot.publishVersionHash})`,
    `Contract: ${bundle.contract.publishContractId}`,
    `Scheduled lock: ${bundle.scheduledLock ? bundle.scheduledLock.lockId : 'none'}`,
    `Integrity valid: ${bundle.integrity.valid}`,
  ].join('\n');
}
