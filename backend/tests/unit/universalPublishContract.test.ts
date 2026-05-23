import {
  createUniversalPublishSnapshot,
  serializeUniversalPublishSnapshot,
  computeSnapshotHash,
  type UniversalPublishSnapshotInput,
} from '../../../lib/publishing/universalPublishSnapshot';
import {
  buildUniversalPublishingContract,
  serializeUniversalPublishingContract,
} from '../../../lib/publishing/universalPublishingContract';
import {
  createScheduledPublishLock,
  applyEditToLockedSchedule,
  verifyScheduledLockIntact,
} from '../../../lib/publishing/scheduledPublishLock';
import {
  generateSnapshotHash,
  verifySnapshotIntegrity,
  verifySnapshotImmutability,
  validateSnapshotReference,
  verifyPublishContract,
} from '../../../lib/publishing/publishSnapshotIntegrity';
import {
  getPublishTargetCompatibility,
  isPublishModeSupported,
  serializePublishTargetCompatibility,
  PUBLISH_TARGET_TYPES,
  PUBLISH_TARGET_COMPATIBILITY,
} from '../../../lib/publishing/publishTargetCompatibility';
import {
  buildPublishingAuditContract,
  serializePublishingAuditContract,
} from '../../../lib/publishing/publishingAuditContracts';

function buildSnapshotInput(overrides: Partial<UniversalPublishSnapshotInput> = {}): UniversalPublishSnapshotInput {
  return {
    renderedHtml: '<h2>Diagnose</h2><p>Long-form content body.</p>',
    contentBlocks: [{ type: 'heading', text: 'Diagnose' }, { type: 'paragraph', text: 'Long-form content body.' }],
    seoMetadata: {
      metaTitle: 'AI content operations',
      metaDescription: 'How operating teams run AI content.',
      focusKeyword: 'ai content operations',
    },
    slug: 'ai-content-operations',
    canonicalFields: { canonicalUrl: 'https://acme.example/blog/ai-content-operations', slugLocked: true },
    mediaReferences: {
      featuredImageUrl: 'https://cdn.example/featured.png',
      media: [{ ref: 'media-1', role: 'featured', alt: 'cover' }],
    },
    taxonomy: { category: 'operations', tags: ['ai', 'content'] },
    authorAttribution: { authorId: 'user-1', authorName: 'Editorial Team' },
    companyContext: { companyId: 'company-1', websiteId: 'website-1', integrationId: 'integration-1' },
    contentType: 'blog',
    generationMetadata: { engine: 'unified-long-form', revision: 1 },
    publishTargetMetadata: { publishTargetType: 'wordpress', externalId: '' },
    scheduledTimestamp: '2026-06-01T09:00:00.000Z',
    publishIntent: 'schedule',
    ...overrides,
  };
}

describe('universalPublishSnapshot', () => {
  it('creates an immutable, deeply-frozen, hash-addressed snapshot', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());

    expect(snapshot.version).toBe('universal-publish-snapshot-v1');
    expect(snapshot.immutable).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.seoMetadata)).toBe(true);
    expect(Object.isFrozen(snapshot.taxonomy.tags)).toBe(true);
    expect(snapshot.snapshotId).toBe(`snap_${snapshot.publishVersionHash.slice(0, 24)}`);
  });

  it('rejects mutation of a frozen snapshot', () => {
    'use strict';
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    expect(() => {
      (snapshot as { slug: string }).slug = 'mutated';
    }).toThrow();
    expect(snapshot.slug).toBe('ai-content-operations');
  });

  it('produces a deterministic hash for identical content', () => {
    const first = createUniversalPublishSnapshot(buildSnapshotInput());
    const second = createUniversalPublishSnapshot(buildSnapshotInput());

    expect(first.publishVersionHash).toBe(second.publishVersionHash);
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('produces a different hash when content changes', () => {
    const base = createUniversalPublishSnapshot(buildSnapshotInput());
    const changed = createUniversalPublishSnapshot(buildSnapshotInput({ slug: 'changed-slug' }));

    expect(changed.publishVersionHash).not.toBe(base.publishVersionHash);
  });

  it('serializes compactly', () => {
    const serialized = serializeUniversalPublishSnapshot(createUniversalPublishSnapshot(buildSnapshotInput()));
    expect(serialized).toContain('## UNIVERSAL PUBLISH SNAPSHOT');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('universalPublishingContract', () => {
  it('builds a deterministic platform-agnostic contract bound to a snapshot', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const first = buildUniversalPublishingContract({
      snapshot,
      publishTargetType: 'wordpress',
      publishMode: 'schedule',
      publishIntent: 'scheduled website publish',
    });
    const second = buildUniversalPublishingContract({
      snapshot,
      publishTargetType: 'wordpress',
      publishMode: 'schedule',
      publishIntent: 'scheduled website publish',
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.snapshotReference.publishVersionHash).toBe(snapshot.publishVersionHash);
    expect(first.publishState).toBe('contract_prepared');
    expect(first.publishContractId.startsWith('pubc_')).toBe(true);
  });

  it('derives a deterministic idempotency key', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const a = buildUniversalPublishingContract({ snapshot, publishTargetType: 'ghost', publishMode: 'schedule', publishIntent: 'x' });
    const b = buildUniversalPublishingContract({ snapshot, publishTargetType: 'ghost', publishMode: 'schedule', publishIntent: 'x' });

    expect(a.publishIdempotencyKey).toBe(b.publishIdempotencyKey);
    expect(a.publishIdempotencyKey.startsWith('pidem_')).toBe(true);
  });

  it('raises risk signals and contract_attention for incomplete context', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput({
      companyContext: { companyId: 'company-1', websiteId: '', integrationId: '' },
    }));
    const contract = buildUniversalPublishingContract({
      snapshot,
      publishTargetType: 'wordpress',
      publishMode: 'schedule',
      publishIntent: 'scheduled publish',
    });

    expect(contract.publishRiskSignals).toContain('missing website id');
    expect(contract.publishRiskSignals).toContain('missing integration id');
    expect(contract.publishState).toBe('contract_attention');
  });

  it('serializes compactly', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const serialized = serializeUniversalPublishingContract(contract);

    expect(serialized).toContain('## UNIVERSAL PUBLISHING CONTRACT');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('scheduledPublishLock', () => {
  it('locks the snapshot once scheduled', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const lock = createScheduledPublishLock(snapshot, contract);

    expect(lock.lockState).toBe('locked');
    expect(lock.lockedSnapshotHash).toBe(snapshot.publishVersionHash);
    expect(verifyScheduledLockIntact(lock, snapshot).intact).toBe(true);
  });

  it('preserves the locked version when an edit is applied — edit forks a new working draft', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const lock = createScheduledPublishLock(snapshot, contract);

    const result = applyEditToLockedSchedule(lock, snapshot, buildSnapshotInput({
      renderedHtml: '<h2>Diagnose</h2><p>Edited body after scheduling.</p>',
    }));

    // Locked snapshot is unchanged and still frozen.
    expect(result.lockedSnapshotUnchanged).toBe(true);
    expect(result.lockedSnapshot.publishVersionHash).toBe(lock.lockedSnapshotHash);
    expect(Object.isFrozen(result.lockedSnapshot)).toBe(true);
    // The edit produced a brand-new working draft with a different hash.
    expect(result.workingDraftSnapshot.publishVersionHash).not.toBe(snapshot.publishVersionHash);
    expect(verifyScheduledLockIntact(lock, snapshot).intact).toBe(true);
  });

  it('is deterministic across runs', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });

    expect(JSON.stringify(createScheduledPublishLock(snapshot, contract)))
      .toBe(JSON.stringify(createScheduledPublishLock(snapshot, contract)));
  });
});

describe('publishSnapshotIntegrity', () => {
  it('verifies integrity, immutability, and reference consistency', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });

    expect(generateSnapshotHash(snapshot)).toBe(snapshot.publishVersionHash);
    expect(verifySnapshotIntegrity(snapshot).valid).toBe(true);
    expect(verifySnapshotImmutability(snapshot).valid).toBe(true);
    expect(validateSnapshotReference(contract.snapshotReference, snapshot).valid).toBe(true);
    expect(verifyPublishContract(contract, snapshot).valid).toBe(true);
  });

  it('detects a tampered hash and a mismatched reference', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const tampered = { ...snapshot, publishVersionHash: 'deadbeef'.repeat(8) };
    expect(verifySnapshotIntegrity(tampered).valid).toBe(false);

    const otherSnapshot = createUniversalPublishSnapshot(buildSnapshotInput({ slug: 'other-slug' }));
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    expect(validateSnapshotReference(contract.snapshotReference, otherSnapshot).valid).toBe(false);
  });
});

describe('publishTargetCompatibility', () => {
  it('exposes a capability entry for every publish target type', () => {
    for (const targetType of PUBLISH_TARGET_TYPES) {
      const capability = PUBLISH_TARGET_COMPATIBILITY[targetType];
      expect(capability.targetType).toBe(targetType);
      expect(capability.supportedPublishModes.length).toBeGreaterThan(0);
      expect(capability.supportedMetadata.length).toBeGreaterThan(0);
    }
  });

  it('reports publish-mode compatibility per target', () => {
    expect(isPublishModeSupported('wordpress', 'schedule')).toBe(true);
    expect(isPublishModeSupported('webflow', 'schedule')).toBe(false);
    expect(isPublishModeSupported('generic_website', 'publish_now')).toBe(true);
  });

  it('is deterministic and stable per target', () => {
    expect(JSON.stringify(getPublishTargetCompatibility('shopify')))
      .toBe(JSON.stringify(getPublishTargetCompatibility('shopify')));
  });

  it('serializes compactly', () => {
    const serialized = serializePublishTargetCompatibility(getPublishTargetCompatibility('hubspot'));
    expect(serialized).toContain('## PUBLISH TARGET COMPATIBILITY');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('publishingAuditContracts', () => {
  it('builds a deterministic audit contract bound to snapshot and contract', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const first = buildPublishingAuditContract({ snapshot, contract });
    const second = buildPublishingAuditContract({ snapshot, contract });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.auditContractId.startsWith('pauc_')).toBe(true);
    expect(first.snapshotAuditReference.publishVersionHash).toBe(snapshot.publishVersionHash);
    expect(first.contractAuditReference.publishIdempotencyKey).toBe(contract.publishIdempotencyKey);
  });

  it('reserves reconciliation, retry, and rollback references for future layers', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const audit = buildPublishingAuditContract({ snapshot, contract });

    expect(audit.reconciliationReferences).toEqual([]);
    expect(audit.retryReferences).toEqual([]);
    expect(audit.rollbackReferences).toEqual([]);
    expect(audit.publishLifecycleReferences.length).toBeGreaterThan(0);
  });

  it('serializes compactly', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const serialized = serializePublishingAuditContract(buildPublishingAuditContract({ snapshot, contract }));

    expect(serialized).toContain('## PUBLISHING AUDIT CONTRACT');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('publishing layer — cross-module serialization stability', () => {
  it('keeps fixed-epoch timestamps with no nondeterministic drift', () => {
    const epoch = new Date(0).toISOString();
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    expect(snapshot.generatedAt).toBe(epoch);
    expect(contract.generatedAt).toBe(epoch);
    expect(createScheduledPublishLock(snapshot, contract).generatedAt).toBe(epoch);
    expect(buildPublishingAuditContract({ snapshot, contract }).generatedAt).toBe(epoch);
  });

  it('keeps snapshot hash, contract id, and idempotency key consistent end to end', () => {
    const snapshot = createUniversalPublishSnapshot(buildSnapshotInput());
    const contract = buildUniversalPublishingContract({ snapshot, publishTargetType: 'wordpress', publishMode: 'schedule', publishIntent: 'x' });
    const audit = buildPublishingAuditContract({ snapshot, contract });

    expect(computeSnapshotHash(snapshot)).toBe(snapshot.publishVersionHash);
    expect(contract.snapshotReference.snapshotId).toBe(snapshot.snapshotId);
    expect(audit.contractAuditReference.publishContractId).toBe(contract.publishContractId);
  });
});
