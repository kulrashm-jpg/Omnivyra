import {
  createUniversalPublishSnapshot,
  type UniversalPublishSnapshotInput,
} from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import {
  mapBlogToPublishSnapshotInput,
  type BlogContentSource,
  type PublishSnapshotMappingContext,
} from '../../../lib/publishing/publishSnapshotMapper';
import {
  buildPublishSnapshotRow,
  hydratePublishSnapshotRow,
} from '../../../lib/publishing/publishSnapshotRecord';
import {
  deriveInitialSnapshotStatus,
  isTerminalSnapshotStatus,
  isAdvisedLifecycleTransition,
  SNAPSHOT_LIFECYCLE_STATUSES,
} from '../../../lib/publishing/publishSnapshotLifecycle';
import {
  resolveRowsBySnapshotId,
  resolveRowByContractId,
  resolveRowByIdempotencyKey,
  resolveRowsByPublishVersionHash,
  resolveAuditByContractId,
  buildSnapshotReferenceIndex,
} from '../../../lib/publishing/publishSnapshotReferences';
import {
  verifyPersistedSnapshotRow,
  verifyPersistedHashConsistency,
  verifyPersistedReferenceConsistency,
} from '../../../lib/publishing/persistedSnapshotIntegrity';
import type { PublishTargetType } from '../../../lib/publishing/universalPublishingContract';

function buildBlog(): BlogContentSource {
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
  };
}

function buildContext(): PublishSnapshotMappingContext {
  return {
    renderedHtml: '<h2>Diagnose</h2><p>Body.</p>',
    contentType: 'blog',
    publishIntent: 'schedule',
    publishTargetType: 'wordpress',
    canonicalUrl: 'https://acme.example/blog/ai-content-operations',
    focusKeyword: 'ai content operations',
    author: { authorId: 'user-1', authorName: 'Editorial Team' },
    generationMetadata: { engine: 'unified-long-form', revision: 1 },
  };
}

function buildPersistedTriple(
  targetType: PublishTargetType = 'wordpress',
  inputOverride?: Partial<UniversalPublishSnapshotInput>,
) {
  const mapped = mapBlogToPublishSnapshotInput(buildBlog(), buildContext());
  const snapshot = createUniversalPublishSnapshot({ ...mapped, ...inputOverride });
  const contract = buildUniversalPublishingContract({
    snapshot,
    publishTargetType: targetType,
    publishMode: 'schedule',
    publishIntent: 'scheduled website publish',
  });
  const audit = buildPublishingAuditContract({ snapshot, contract });
  return { snapshot, contract, audit };
}

describe('publishSnapshotMapper', () => {
  it('maps a real blog row deterministically into a snapshot input', () => {
    const first = mapBlogToPublishSnapshotInput(buildBlog(), buildContext());
    const second = mapBlogToPublishSnapshotInput(buildBlog(), buildContext());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.slug).toBe('ai-content-operations');
    expect(first.companyContext.companyId).toBe('company-1');
    expect(first.taxonomy.tags).toEqual(['ai', 'content']);
    expect(first.mediaReferences.media).toHaveLength(1);
  });

  it('produces a deterministic snapshot hash from a mapped blog', () => {
    const a = createUniversalPublishSnapshot(mapBlogToPublishSnapshotInput(buildBlog(), buildContext()));
    const b = createUniversalPublishSnapshot(mapBlogToPublishSnapshotInput(buildBlog(), buildContext()));

    expect(a.publishVersionHash).toBe(b.publishVersionHash);
  });

  it('normalizes null blog fields without throwing', () => {
    const blog = { ...buildBlog(), excerpt: null, tags: null, featured_image_url: null, content_blocks: null };
    const mapped = mapBlogToPublishSnapshotInput(blog, buildContext());

    expect(mapped.taxonomy.tags).toEqual([]);
    expect(mapped.contentBlocks).toEqual([]);
    expect(mapped.mediaReferences.media).toEqual([]);
  });
});

describe('publishSnapshotRecord codec', () => {
  it('builds a deterministic persistence row', () => {
    const a = buildPersistedTriple();
    const b = buildPersistedTriple();
    const rowA = buildPublishSnapshotRow({ ...a, blogId: 'blog-1' });
    const rowB = buildPublishSnapshotRow({ ...b, blogId: 'blog-1' });

    expect(JSON.stringify(rowA)).toBe(JSON.stringify(rowB));
    expect(rowA.snapshot_id).toBe(a.snapshot.snapshotId);
    expect(rowA.publish_version_hash).toBe(a.snapshot.publishVersionHash);
    expect(rowA.idempotency_key).toBe(a.contract.publishIdempotencyKey);
    expect(rowA.snapshot_status).toBe('scheduled_snapshot');
  });

  it('round-trips: hydration re-freezes and preserves the hash', () => {
    const triple = buildPersistedTriple();
    const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });
    const hydrated = hydratePublishSnapshotRow(row);

    expect(hydrated.hashConsistent).toBe(true);
    expect(hydrated.snapshot.publishVersionHash).toBe(triple.snapshot.publishVersionHash);
    expect(Object.isFrozen(hydrated.snapshot)).toBe(true);
    expect(Object.isFrozen(hydrated.snapshot.seoMetadata)).toBe(true);
    expect(Object.isFrozen(hydrated.contract)).toBe(true);
  });

  it('preserves snapshot immutability after hydration', () => {
    'use strict';
    const triple = buildPersistedTriple();
    const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });
    const hydrated = hydratePublishSnapshotRow(row);
    expect(() => {
      (hydrated.snapshot as { slug: string }).slug = 'mutated';
    }).toThrow();
  });
});

describe('publishSnapshotLifecycle', () => {
  it('derives a deterministic initial status from publish intent', () => {
    const scheduled = buildPersistedTriple().snapshot;
    expect(deriveInitialSnapshotStatus(scheduled)).toBe('scheduled_snapshot');

    const draftSnapshot = createUniversalPublishSnapshot({
      ...mapBlogToPublishSnapshotInput(buildBlog(), { ...buildContext(), publishIntent: 'cms_draft' }),
    });
    expect(deriveInitialSnapshotStatus(draftSnapshot)).toBe('draft_snapshot');
  });

  it('classifies terminal statuses and advisory transitions deterministically', () => {
    expect(SNAPSHOT_LIFECYCLE_STATUSES).toHaveLength(5);
    expect(isTerminalSnapshotStatus('published_snapshot')).toBe(true);
    expect(isTerminalSnapshotStatus('draft_snapshot')).toBe(false);
    expect(isAdvisedLifecycleTransition('draft_snapshot', 'scheduled_snapshot')).toBe(true);
    expect(isAdvisedLifecycleTransition('published_snapshot', 'draft_snapshot')).toBe(false);
  });
});

describe('publishSnapshotReferences', () => {
  it('resolves snapshots, contracts, idempotency keys, and version hashes', () => {
    const wordpress = buildPersistedTriple('wordpress');
    const ghost = buildPersistedTriple('ghost');
    const rows = [
      buildPublishSnapshotRow({ ...wordpress, blogId: 'blog-1' }),
      buildPublishSnapshotRow({ ...ghost, blogId: 'blog-1' }),
    ];

    // Same content + schedule → same snapshot_id across two targets.
    expect(resolveRowsBySnapshotId(rows, wordpress.snapshot.snapshotId)).toHaveLength(2);
    expect(resolveRowByContractId(rows, ghost.contract.publishContractId)?.publish_target_type).toBe('ghost');
    expect(resolveRowByIdempotencyKey(rows, wordpress.contract.publishIdempotencyKey)).toBeDefined();
    expect(resolveRowsByPublishVersionHash(rows, wordpress.snapshot.publishVersionHash)).toHaveLength(2);
    expect(resolveAuditByContractId(rows, wordpress.contract.publishContractId)?.auditContractId)
      .toBe(wordpress.audit.auditContractId);
  });

  it('builds a deterministic reference index', () => {
    const triple = buildPersistedTriple();
    const rows = [buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' })];
    const index = buildSnapshotReferenceIndex(rows);

    expect(index.byContractId.get(triple.contract.publishContractId)).toBeDefined();
    expect(index.byIdempotencyKey.get(triple.contract.publishIdempotencyKey)).toBeDefined();
    expect(index.bySnapshotId.get(triple.snapshot.snapshotId)).toHaveLength(1);
  });
});

describe('persistedSnapshotIntegrity', () => {
  it('verifies an intact persisted row across all checks', () => {
    const triple = buildPersistedTriple();
    const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });

    expect(verifyPersistedHashConsistency(row).valid).toBe(true);
    expect(verifyPersistedReferenceConsistency(row).valid).toBe(true);
    expect(verifyPersistedSnapshotRow(row).valid).toBe(true);
  });

  it('detects a tampered hash column', () => {
    const triple = buildPersistedTriple();
    const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });
    const tampered = { ...row, publish_version_hash: 'deadbeef'.repeat(8) };

    expect(verifyPersistedHashConsistency(tampered).valid).toBe(false);
    expect(verifyPersistedSnapshotRow(tampered).valid).toBe(false);
  });

  it('detects a tampered scalar column drifting from the payload', () => {
    const triple = buildPersistedTriple();
    const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });
    const tampered = { ...row, publish_target_type: 'shopify' };

    expect(verifyPersistedReferenceConsistency(tampered).valid).toBe(false);
  });
});

describe('publish persistence — cross-platform + idempotency stability', () => {
  it('keeps idempotency key stable and rows consistent across platforms', () => {
    const wordpress = buildPersistedTriple('wordpress');
    const webflow = buildPersistedTriple('webflow');

    // Idempotency key is independent of target type (company/website/hash/mode/schedule).
    expect(wordpress.contract.publishIdempotencyKey).toBe(webflow.contract.publishIdempotencyKey);
    // Contract ids differ because they encode the target.
    expect(wordpress.contract.publishContractId).not.toBe(webflow.contract.publishContractId);

    for (const triple of [wordpress, webflow]) {
      const row = buildPublishSnapshotRow({ ...triple, blogId: 'blog-1' });
      expect(verifyPersistedSnapshotRow(row).valid).toBe(true);
    }
  });

  it('keeps persisted hashes stable across repeated builds', () => {
    const first = buildPublishSnapshotRow({ ...buildPersistedTriple(), blogId: 'blog-1' });
    const second = buildPublishSnapshotRow({ ...buildPersistedTriple(), blogId: 'blog-1' });

    expect(first.publish_version_hash).toBe(second.publish_version_hash);
    expect(first.idempotency_key).toBe(second.idempotency_key);
    expect(first.publish_contract_id).toBe(second.publish_contract_id);
  });
});
