import {
  buildPublishCaptureBundle,
  extractCaptureReferences,
  type PublishCaptureInput,
} from '../../../lib/publishing/publishSnapshotCapture';
import {
  canCapturePublishSnapshot,
  derivePublishCaptureIntent,
  derivePublishCaptureMode,
} from '../../../lib/publishing/publishSnapshotCaptureEligibility';
import { buildPublishCaptureAuditReference } from '../../../lib/publishing/publishCaptureAuditReference';
import { verifyCaptureBeforePersistence } from '../../../lib/publishing/publishCaptureIntegrityHook';
import { applyEditToLockedSchedule } from '../../../lib/publishing/scheduledPublishLock';
import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract, type PublishTargetType } from '../../../lib/publishing/universalPublishingContract';
import type { BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import type { PublishCaptureLifecyclePhase } from '../../../lib/publishing/publishSnapshotCaptureEligibility';
import { extractSnapshotInput } from '../../../lib/publishing/publishSnapshotRecord';

function buildBlog(overrides: Partial<BlogContentSource> = {}): BlogContentSource {
  return {
    id: 'blog-1',
    company_id: 'company-1',
    title: 'AI content operations',
    slug: 'ai-content-operations',
    excerpt: 'How operating teams run AI content.',
    content: 'Long-form body.',
    content_blocks: [{ type: 'heading', text: 'Diagnose' }, { type: 'paragraph', text: 'Body.' }],
    featured_image_url: 'https://cdn.example/featured.png',
    category: 'operations',
    tags: ['ai', 'content'],
    seo_meta_title: 'AI content operations',
    seo_meta_description: 'How operating teams run AI content.',
    website_id: 'website-1',
    integration_id: 'integration-1',
    external_id: '',
    scheduled_publish_at: '2026-06-01T09:00:00.000Z',
    ...overrides,
  };
}

function buildCaptureInput(overrides: Partial<PublishCaptureInput> = {}): PublishCaptureInput {
  return {
    blog: buildBlog(),
    renderedHtml: '<h2>Diagnose</h2><p>Body.</p>',
    contentType: 'blog',
    publishTargetType: 'wordpress',
    canonicalUrl: 'https://acme.example/blog/ai-content-operations',
    focusKeyword: 'ai content operations',
    author: { authorId: 'user-1', authorName: 'Editorial Team' },
    generationMetadata: { engine: 'unified-long-form' },
    captureSource: 'blog_publish_lifecycle',
    lifecyclePhase: 'scheduling',
    blogStatus: 'scheduled',
    ...overrides,
  };
}

describe('publishSnapshotCaptureEligibility', () => {
  it('derives capture intent and mode deterministically', () => {
    expect(derivePublishCaptureIntent({ lifecyclePhase: 'scheduling', scheduledTimestamp: '2026-06-01T09:00:00.000Z', blogStatus: 'scheduled' }))
      .toBe('scheduled_capture');
    expect(derivePublishCaptureIntent({ lifecyclePhase: 'finalization', scheduledTimestamp: null, blogStatus: 'draft' }))
      .toBe('publish_ready_capture');
    expect(derivePublishCaptureIntent({ lifecyclePhase: 'manual_publish', scheduledTimestamp: null, blogStatus: 'draft' }))
      .toBe('manual_publish_capture');

    expect(derivePublishCaptureMode({ scheduledTimestamp: '2026-06-01T09:00:00.000Z', captureIntent: 'scheduled_capture' }))
      .toBe('schedule');
    expect(derivePublishCaptureMode({ scheduledTimestamp: null, captureIntent: 'publish_ready_capture' }))
      .toBe('publish_now');
  });

  it('reports eligibility advisory-only', () => {
    expect(canCapturePublishSnapshot({ companyId: 'c1', renderedHtml: '<p>x</p>', contentBlockCount: 1, title: 'T', slug: 's' }).eligible)
      .toBe(true);
    const ineligible = canCapturePublishSnapshot({ companyId: '', renderedHtml: '', contentBlockCount: 0, title: '', slug: '' });
    expect(ineligible.eligible).toBe(false);
    expect(ineligible.reasons.length).toBeGreaterThan(0);
  });
});

describe('publishSnapshotCapture — bundle building', () => {
  it('builds a deterministic capture bundle', () => {
    const first = buildPublishCaptureBundle(buildCaptureInput());
    const second = buildPublishCaptureBundle(buildCaptureInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('publish-snapshot-capture-v1');
    expect(first.integrity.valid).toBe(true);
  });

  it('captures at the scheduling boundary with a frozen version lock', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput({ lifecyclePhase: 'scheduling' }));

    expect(bundle.captureIntent).toBe('scheduled_capture');
    expect(bundle.captureMode).toBe('schedule');
    expect(bundle.snapshot.publishIntent).toBe('schedule');
    expect(bundle.scheduledLock).not.toBeNull();
    expect(bundle.scheduledLock?.lockState).toBe('locked');
    expect(bundle.scheduledLock?.lockedSnapshotHash).toBe(bundle.snapshot.publishVersionHash);
  });

  it('captures at the finalization boundary without a schedule lock', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput({
      blog: buildBlog({ scheduled_publish_at: null }),
      lifecyclePhase: 'finalization',
    }));

    expect(bundle.captureIntent).toBe('publish_ready_capture');
    expect(bundle.captureMode).toBe('publish_now');
    expect(bundle.scheduledLock).toBeNull();
    expect(bundle.snapshot.immutable).toBe(true);
    expect(Object.isFrozen(bundle.snapshot)).toBe(true);
  });

  it('flags an ineligible capture without throwing', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput({
      blog: buildBlog({ title: '', slug: '' }),
    }));
    expect(bundle.eligibility.eligible).toBe(false);
    expect(bundle.eligibility.reasons.length).toBeGreaterThan(0);
  });
});

describe('publishSnapshotCapture — version-lock + post-edit stability', () => {
  it('preserves the locked snapshot when an edit forks a new working draft', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput({ lifecyclePhase: 'scheduling' }));
    const lockedSnapshot = bundle.snapshot;
    const lock = bundle.scheduledLock!;

    const editedInput = {
      ...extractSnapshotInput(lockedSnapshot),
      renderedHtml: '<h2>Diagnose</h2><p>Edited after scheduling.</p>',
    };
    const result = applyEditToLockedSchedule(lock, lockedSnapshot, editedInput);

    expect(result.lockedSnapshotUnchanged).toBe(true);
    expect(result.lockedSnapshot.publishVersionHash).toBe(lock.lockedSnapshotHash);
    expect(result.workingDraftSnapshot.publishVersionHash).not.toBe(lockedSnapshot.publishVersionHash);
  });

  it('keeps the original capture snapshot hash stable after a re-capture with edited content', () => {
    const original = buildPublishCaptureBundle(buildCaptureInput());
    const edited = buildPublishCaptureBundle(buildCaptureInput({ renderedHtml: '<p>Different body.</p>' }));

    expect(edited.snapshot.publishVersionHash).not.toBe(original.snapshot.publishVersionHash);
    // Re-building the original input still yields the original hash.
    const rebuilt = buildPublishCaptureBundle(buildCaptureInput());
    expect(rebuilt.snapshot.publishVersionHash).toBe(original.snapshot.publishVersionHash);
  });

  it('keeps idempotency key and contract id stable across captures', () => {
    const a = buildPublishCaptureBundle(buildCaptureInput());
    const b = buildPublishCaptureBundle(buildCaptureInput());

    expect(a.contract.publishIdempotencyKey).toBe(b.contract.publishIdempotencyKey);
    expect(a.contract.publishContractId).toBe(b.contract.publishContractId);
    expect(a.captureAuditReference.captureReferenceId).toBe(b.captureAuditReference.captureReferenceId);
  });
});

describe('publishSnapshotCapture — audit references + integrity', () => {
  it('builds a deterministic capture audit reference bound to the snapshot/contract', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput());
    const reference = bundle.captureAuditReference;

    expect(reference.version).toBe('publish-capture-audit-reference-v1');
    expect(reference.snapshotId).toBe(bundle.snapshot.snapshotId);
    expect(reference.publishContractId).toBe(bundle.contract.publishContractId);
    expect(reference.captureIntegrityStatus).toBe('capture_integrity_ok');
    expect(reference.captureLifecyclePhase).toBe('scheduling');

    const rebuilt = buildPublishCaptureAuditReference({
      captureSource: reference.captureSource,
      captureLifecyclePhase: reference.captureLifecyclePhase,
      captureIntent: reference.captureIntent,
      captureIntegrityStatus: reference.captureIntegrityStatus,
      snapshotId: reference.snapshotId,
      publishContractId: reference.publishContractId,
      publishVersionHash: reference.publishVersionHash,
      idempotencyKey: reference.idempotencyKey,
      auditContractId: reference.auditContractId,
    });
    expect(rebuilt.captureReferenceId).toBe(reference.captureReferenceId);
  });

  it('verifies pre-persistence integrity and detects a tampered snapshot', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput());
    expect(verifyCaptureBeforePersistence(bundle.snapshot, bundle.contract, bundle.scheduledLock).valid).toBe(true);

    const tampered = { ...bundle.snapshot, publishVersionHash: 'deadbeef'.repeat(8) };
    expect(verifyCaptureBeforePersistence(tampered, bundle.contract, bundle.scheduledLock).valid).toBe(false);
  });

  it('extracts a complete reference set from the bundle', () => {
    const references = extractCaptureReferences(buildPublishCaptureBundle(buildCaptureInput()));
    expect(references.snapshotId.startsWith('snap_')).toBe(true);
    expect(references.publishContractId.startsWith('pubc_')).toBe(true);
    expect(references.captureReferenceId.startsWith('capr_')).toBe(true);
  });
});

describe('publishSnapshotCapture — cross-platform compatibility', () => {
  it('captures a deterministic, valid, target-specific bundle for every publish target', () => {
    const targets: PublishTargetType[] = ['wordpress', 'ghost', 'webflow', 'shopify', 'hubspot', 'custom_api', 'headless_cms', 'generic_website'];
    const hashes = new Set<string>();
    for (const target of targets) {
      const bundle = buildPublishCaptureBundle(buildCaptureInput({ publishTargetType: target }));
      const rebuilt = buildPublishCaptureBundle(buildCaptureInput({ publishTargetType: target }));
      // Deterministic per target.
      expect(bundle.snapshot.publishVersionHash).toBe(rebuilt.snapshot.publishVersionHash);
      expect(bundle.contract.publishTargetType).toBe(target);
      expect(bundle.integrity.valid).toBe(true);
      hashes.add(bundle.snapshot.publishVersionHash);
    }
    // The snapshot embeds publish target metadata, so each target yields a
    // distinct snapshot — one deterministic snapshot per target.
    expect(hashes.size).toBe(targets.length);
  });

  it('keeps the capture snapshot aligned with a directly-built snapshot', () => {
    const bundle = buildPublishCaptureBundle(buildCaptureInput());
    const direct = createUniversalPublishSnapshot(extractSnapshotInput(bundle.snapshot));
    const contract = buildUniversalPublishingContract({
      snapshot: direct,
      publishTargetType: 'wordpress',
      publishMode: 'schedule',
      publishIntent: 'scheduled_capture',
    });
    expect(direct.publishVersionHash).toBe(bundle.snapshot.publishVersionHash);
    expect(contract.publishContractId).toBe(bundle.contract.publishContractId);
  });
});
