import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import { mapBlogToPublishSnapshotInput, type BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import { buildPublishSnapshotRow, type ContentPublishSnapshotRow } from '../../../lib/publishing/publishSnapshotRecord';
import { verifyShadowPublishSnapshot } from '../../../lib/publishing/shadowPublishSnapshotVerification';
import {
  verifyRowOwnershipConsistency,
  verifyCrossCompanyIsolation,
} from '../../../lib/publishing/publishSnapshotIsolationVerification';
import { verifyScheduledEditImmutability } from '../../../lib/publishing/scheduledEditImmutabilityVerification';
import { summarizeShadowVerifications } from '../../../lib/publishing/publishSnapshotShadowObservability';
import {
  deriveVerificationStatus,
  worstVerificationStatus,
} from '../../../lib/publishing/publishVerificationStatus';

function buildRow(companyId: string): ContentPublishSnapshotRow {
  const blog: BlogContentSource = {
    id: `blog-${companyId}`,
    company_id: companyId,
    title: 'AI content operations',
    slug: 'ai-content-operations',
    excerpt: 'How operating teams run AI content.',
    content: 'Body.',
    content_blocks: [{ type: 'heading', text: 'Diagnose' }],
    featured_image_url: 'https://cdn.example/featured.png',
    category: 'operations',
    tags: ['ai', 'content'],
    seo_meta_title: 'AI content operations',
    seo_meta_description: 'How operating teams run AI content.',
    website_id: `website-${companyId}`,
    integration_id: `integration-${companyId}`,
    external_id: '',
    scheduled_publish_at: '2026-06-01T09:00:00.000Z',
  };
  const snapshot = createUniversalPublishSnapshot(mapBlogToPublishSnapshotInput(blog, {
    renderedHtml: '<h2>Diagnose</h2><p>Body.</p>',
    contentType: 'blog',
    publishIntent: 'schedule',
    publishTargetType: 'wordpress',
    canonicalUrl: 'https://acme.example/blog/ai-content-operations',
    focusKeyword: 'ai content operations',
    author: { authorId: 'user-1', authorName: 'Editorial Team' },
    generationMetadata: { engine: 'unified-long-form' },
  }));
  const contract = buildUniversalPublishingContract({
    snapshot,
    publishTargetType: 'wordpress',
    publishMode: 'schedule',
    publishIntent: 'scheduled website publish',
  });
  const audit = buildPublishingAuditContract({ snapshot, contract });
  return buildPublishSnapshotRow({ snapshot, contract, audit, blogId: blog.id });
}

describe('publishVerificationStatus', () => {
  it('derives status deterministically (worst severity wins)', () => {
    expect(deriveVerificationStatus([])).toBe('verification_clean');
    expect(deriveVerificationStatus([{ code: 'a', severity: 'warning', message: 'm' }])).toBe('verification_warning');
    expect(deriveVerificationStatus([
      { code: 'a', severity: 'warning', message: 'm' },
      { code: 'b', severity: 'invalid', message: 'm' },
    ])).toBe('verification_invalid');
    expect(worstVerificationStatus(['verification_clean', 'verification_risk', 'verification_warning']))
      .toBe('verification_risk');
  });
});

describe('shadowPublishSnapshotVerification', () => {
  it('verifies a clean persisted row and is deterministic', () => {
    const row = buildRow('company-1');
    const first = verifyShadowPublishSnapshot(row);
    const second = verifyShadowPublishSnapshot(row);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.status).toBe('verification_clean');
    expect(first.checks.persistedSnapshotCorrect).toBe(true);
    expect(first.checks.persistedContractCorrect).toBe(true);
    expect(first.checks.persistedAuditReferencesCorrect).toBe(true);
    expect(first.checks.persistedIdempotencyCorrect).toBe(true);
    expect(first.checks.persistedCompanyIsolationCorrect).toBe(true);
  });

  it('detects a tampered hash as verification_invalid', () => {
    const row = buildRow('company-1');
    const tampered: ContentPublishSnapshotRow = { ...row, publish_version_hash: 'deadbeef'.repeat(8) };
    const verification = verifyShadowPublishSnapshot(tampered);

    expect(verification.status).toBe('verification_invalid');
    expect(verification.checks.persistedSnapshotCorrect).toBe(false);
  });

  it('detects an audit reference mismatch as verification_risk', () => {
    const row = buildRow('company-1');
    const tampered: ContentPublishSnapshotRow = {
      ...row,
      audit_payload: {
        ...row.audit_payload,
        contractAuditReference: { ...row.audit_payload.contractAuditReference, publishIdempotencyKey: 'pidem_wrong' },
      },
    };
    const verification = verifyShadowPublishSnapshot(tampered);

    expect(verification.checks.persistedAuditReferencesCorrect).toBe(false);
    expect(verification.status).toBe('verification_risk');
  });
});

describe('multi-company isolation verification', () => {
  it('confirms ownership consistency on a clean row', () => {
    expect(verifyRowOwnershipConsistency(buildRow('company-1')).consistent).toBe(true);
  });

  it('detects a company-id mismatch between row column and payload', () => {
    const row = buildRow('company-1');
    const tampered: ContentPublishSnapshotRow = { ...row, company_id: 'company-2' };
    const isolation = verifyRowOwnershipConsistency(tampered);

    expect(isolation.consistent).toBe(false);
    expect(isolation.findings.some((finding) => finding.code === 'snapshot_company_mismatch')).toBe(true);
  });

  it('isolates two genuinely separate companies with no leakage', () => {
    const isolation = verifyCrossCompanyIsolation([buildRow('company-1'), buildRow('company-2')]);
    expect(isolation.consistent).toBe(true);
  });

  it('detects a cross-company snapshot leak', () => {
    const row = buildRow('company-1');
    const leaked: ContentPublishSnapshotRow = { ...row, company_id: 'company-2' };
    const isolation = verifyCrossCompanyIsolation([row, leaked]);

    expect(isolation.consistent).toBe(false);
    expect(isolation.findings.some((finding) => finding.code === 'cross_company_snapshot_leak')).toBe(true);
  });
});

describe('scheduled edit immutability verification', () => {
  it('confirms an untouched scheduled row is fully immutable', () => {
    const before = buildRow('company-1');
    const after = buildRow('company-1');
    const verification = verifyScheduledEditImmutability({ persistedRowBefore: before, persistedRowAfter: after });

    expect(verification.status).toBe('verification_clean');
    expect(verification.checks.persistedSnapshotUnchanged).toBe(true);
    expect(verification.checks.persistedHashUnchanged).toBe(true);
    expect(verification.checks.persistedContractUnchanged).toBe(true);
    expect(verification.checks.persistedIdempotencyUnchanged).toBe(true);
  });

  it('detects a mutated persisted scheduled snapshot', () => {
    const before = buildRow('company-1');
    const after: ContentPublishSnapshotRow = { ...before, publish_version_hash: 'deadbeef'.repeat(8) };
    const verification = verifyScheduledEditImmutability({ persistedRowBefore: before, persistedRowAfter: after });

    expect(verification.status).toBe('verification_invalid');
    expect(verification.checks.persistedHashUnchanged).toBe(false);
  });

  it('confirms an edit forks a new working draft', () => {
    const before = buildRow('company-1');
    const editedDraft = createUniversalPublishSnapshot(mapBlogToPublishSnapshotInput(
      {
        id: 'blog-company-1',
        company_id: 'company-1',
        title: 'AI content operations',
        slug: 'ai-content-operations',
        excerpt: 'Edited.',
        content: 'Edited body.',
        content_blocks: [{ type: 'heading', text: 'Diagnose' }],
        featured_image_url: 'https://cdn.example/featured.png',
        category: 'operations',
        tags: ['ai', 'content'],
        seo_meta_title: 'AI content operations',
        seo_meta_description: 'Edited.',
        website_id: 'website-company-1',
        integration_id: 'integration-company-1',
        external_id: '',
        scheduled_publish_at: '2026-06-01T09:00:00.000Z',
      },
      {
        renderedHtml: '<p>Edited after scheduling.</p>',
        contentType: 'blog',
        publishIntent: 'schedule',
        publishTargetType: 'wordpress',
        canonicalUrl: 'https://acme.example/blog/ai-content-operations',
        focusKeyword: 'ai content operations',
        author: { authorId: 'user-1', authorName: 'Editorial Team' },
        generationMetadata: { engine: 'unified-long-form' },
      },
    ));
    const verification = verifyScheduledEditImmutability({
      persistedRowBefore: before,
      persistedRowAfter: buildRow('company-1'),
      workingDraftSnapshot: editedDraft,
    });

    expect(verification.checks.editForkedNewDraft).toBe(true);
    expect(editedDraft.publishVersionHash).not.toBe(before.publish_version_hash);
    expect(verification.status).toBe('verification_clean');
  });
});

describe('repeated capture + idempotency + observability stability', () => {
  it('keeps repeated captures byte-stable (hash, contract, idempotency)', () => {
    const first = buildRow('company-1');
    const second = buildRow('company-1');

    expect(first.publish_version_hash).toBe(second.publish_version_hash);
    expect(JSON.stringify(first.contract_payload)).toBe(JSON.stringify(second.contract_payload));
    expect(first.idempotency_key).toBe(second.idempotency_key);
  });

  it('summarizes shadow verifications deterministically', () => {
    const rows = [buildRow('company-1'), buildRow('company-2')];
    const verifications = rows.map(verifyShadowPublishSnapshot);
    const crossCompany = verifyCrossCompanyIsolation(rows);
    const first = summarizeShadowVerifications(verifications, crossCompany);
    const second = summarizeShadowVerifications(verifications, crossCompany);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.totalSnapshots).toBe(2);
    expect(first.overallStatus).toBe('verification_clean');
    expect(first.verificationSummary.verification_clean).toBe(2);
    expect(first.isolationSummary.crossCompanyLeaks).toBe(0);
  });

  it('escalates the observability overall status on a cross-company leak', () => {
    const row = buildRow('company-1');
    const leaked: ContentPublishSnapshotRow = { ...row, company_id: 'company-2' };
    const rows = [row, leaked];
    const verifications = rows.map(verifyShadowPublishSnapshot);
    const summary = summarizeShadowVerifications(verifications, verifyCrossCompanyIsolation(rows));

    expect(summary.overallStatus).toBe('verification_invalid');
    expect(summary.isolationSummary.crossCompanyLeaks).toBeGreaterThan(0);
    expect(summary.riskSummary.length).toBeGreaterThan(0);
  });
});
