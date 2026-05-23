import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import { mapBlogToPublishSnapshotInput, type BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import { buildPublishSnapshotRow, type ContentPublishSnapshotRow } from '../../../lib/publishing/publishSnapshotRecord';
import { resolveWorkerSnapshot } from '../../../lib/publishing/workerSnapshotResolver';
import { verifyDraftVsSnapshotDrift } from '../../../lib/publishing/workerSnapshotDriftVerification';
import { verifyWorkerSnapshotCompatibility } from '../../../lib/publishing/workerSnapshotCompatibilityVerification';
import { simulateWorkerShadowConsumption } from '../../../lib/publishing/workerShadowSnapshotConsumption';
import { summarizeWorkerSnapshotRuntime } from '../../../lib/publishing/workerSnapshotRuntimeObservability';
import {
  deriveSnapshotRuntimeStatus,
  worstSnapshotRuntimeStatus,
} from '../../../lib/publishing/workerSnapshotRuntimeStatus';

const RENDERED_HTML = '<h2>Diagnose</h2><p>Body.</p>';

function buildBlog(companyId: string): BlogContentSource {
  return {
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
}

function buildRow(companyId: string): ContentPublishSnapshotRow {
  const blog = buildBlog(companyId);
  const snapshot = createUniversalPublishSnapshot(mapBlogToPublishSnapshotInput(blog, {
    renderedHtml: RENDERED_HTML,
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

describe('workerSnapshotRuntimeStatus', () => {
  it('derives runtime status deterministically (worst severity wins)', () => {
    expect(deriveSnapshotRuntimeStatus([])).toBe('snapshot_runtime_clean');
    expect(deriveSnapshotRuntimeStatus([{ severity: 'warning' }, { severity: 'risk' }])).toBe('snapshot_runtime_risk');
    expect(deriveSnapshotRuntimeStatus([{ severity: 'invalid' }])).toBe('snapshot_runtime_invalid');
    expect(worstSnapshotRuntimeStatus(['snapshot_runtime_clean', 'snapshot_runtime_warning'])).toBe('snapshot_runtime_warning');
  });
});

describe('workerSnapshotResolver', () => {
  it('resolves a snapshot by every supported key, deterministically', () => {
    const rows = [buildRow('company-1')];
    const row = rows[0];

    for (const key of [
      { kind: 'publish_contract_id' as const, value: row.publish_contract_id },
      { kind: 'idempotency_key' as const, value: row.idempotency_key },
      { kind: 'blog_id' as const, value: row.blog_id! },
      { kind: 'scheduled_publish_reference' as const, value: row.snapshot_id },
    ]) {
      const first = resolveWorkerSnapshot(rows, key);
      const second = resolveWorkerSnapshot(rows, key);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.resolved).toBe(true);
      expect(first.snapshot?.snapshotId).toBe(row.snapshot_id);
      expect(first.contract?.publishContractId).toBe(row.publish_contract_id);
    }
  });

  it('reports an unresolved key without throwing', () => {
    const resolution = resolveWorkerSnapshot([buildRow('company-1')], { kind: 'blog_id', value: 'missing' });
    expect(resolution.resolved).toBe(false);
    expect(resolution.snapshot).toBeNull();
    expect(resolution.reasons.length).toBeGreaterThan(0);
  });
});

describe('workerSnapshotDriftVerification', () => {
  it('reports no drift when the live draft matches the frozen snapshot', () => {
    const row = buildRow('company-1');
    const report = verifyDraftVsSnapshotDrift({
      draft: buildBlog('company-1'),
      draftRenderedHtml: RENDERED_HTML,
      snapshot: row.snapshot_payload,
    });
    expect(report.hasDrift).toBe(false);
    expect(report.status).toBe('snapshot_runtime_clean');
  });

  it('detects content, slug, and company-ownership drift', () => {
    const row = buildRow('company-1');
    const report = verifyDraftVsSnapshotDrift({
      draft: { ...buildBlog('company-1'), slug: 'changed-slug', company_id: 'company-2' },
      draftRenderedHtml: '<p>Edited body.</p>',
      snapshot: row.snapshot_payload,
    });
    expect(report.hasDrift).toBe(true);
    expect(report.driftKinds).toEqual(expect.arrayContaining(['content', 'slug', 'company_ownership']));
    expect(report.status).toBe('snapshot_runtime_invalid');
  });

  it('classifies seo-only drift as a warning', () => {
    const row = buildRow('company-1');
    const report = verifyDraftVsSnapshotDrift({
      draft: { ...buildBlog('company-1'), seo_meta_title: 'A different title' },
      draftRenderedHtml: RENDERED_HTML,
      snapshot: row.snapshot_payload,
    });
    expect(report.hasDrift).toBe(true);
    expect(report.driftKinds).toEqual(['seo']);
    expect(report.status).toBe('snapshot_runtime_warning');
  });
});

describe('workerShadowSnapshotConsumption', () => {
  it('simulates a clean shadow consumption deterministically', () => {
    const rows = [buildRow('company-1')];
    const input = {
      rows,
      resolutionKey: { kind: 'publish_contract_id' as const, value: rows[0].publish_contract_id },
      liveDraft: buildBlog('company-1'),
      liveDraftRenderedHtml: RENDERED_HTML,
    };
    const first = simulateWorkerShadowConsumption(input);
    const second = simulateWorkerShadowConsumption(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.snapshotLoaded).toBe(true);
    expect(first.contractResolved).toBe(true);
    expect(first.publishTargetResolved).toBe(true);
    expect(first.idempotencyResolved).toBe(true);
    expect(first.driftReport?.hasDrift).toBe(false);
    expect(first.status).toBe('snapshot_runtime_clean');
  });

  it('surfaces drift during shadow consumption without blocking', () => {
    const rows = [buildRow('company-1')];
    const result = simulateWorkerShadowConsumption({
      rows,
      resolutionKey: { kind: 'publish_contract_id', value: rows[0].publish_contract_id },
      liveDraft: { ...buildBlog('company-1'), company_id: 'company-2' },
      liveDraftRenderedHtml: RENDERED_HTML,
    });
    expect(result.snapshotLoaded).toBe(true);
    expect(result.driftReport?.hasDrift).toBe(true);
    expect(result.status).toBe('snapshot_runtime_invalid');
  });

  it('reports an unresolved snapshot in shadow mode', () => {
    const result = simulateWorkerShadowConsumption({
      rows: [buildRow('company-1')],
      resolutionKey: { kind: 'idempotency_key', value: 'missing' },
      liveDraft: buildBlog('company-1'),
      liveDraftRenderedHtml: RENDERED_HTML,
    });
    expect(result.snapshotLoaded).toBe(false);
    expect(result.status).toBe('snapshot_runtime_risk');
  });
});

describe('workerSnapshotCompatibilityVerification', () => {
  it('verifies a resolved snapshot bundle as fully compatible', () => {
    const rows = [buildRow('company-1')];
    const resolution = resolveWorkerSnapshot(rows, { kind: 'publish_contract_id', value: rows[0].publish_contract_id });
    const verification = verifyWorkerSnapshotCompatibility({
      snapshot: resolution.snapshot,
      contract: resolution.contract,
      audit: resolution.audit,
      resolution,
    });
    expect(verification.status).toBe('snapshot_runtime_clean');
    expect(verification.checks.workerSnapshotCompatible).toBe(true);
    expect(verification.checks.publishTargetCompatible).toBe(true);
    expect(verification.checks.frozenSnapshotComplete).toBe(true);
    expect(verification.checks.contractComplete).toBe(true);
    expect(verification.checks.auditComplete).toBe(true);
    expect(verification.checks.workerResolutionComplete).toBe(true);
  });

  it('flags an unresolved bundle as incomplete', () => {
    const resolution = resolveWorkerSnapshot([buildRow('company-1')], { kind: 'blog_id', value: 'missing' });
    const verification = verifyWorkerSnapshotCompatibility({
      snapshot: null,
      contract: null,
      audit: null,
      resolution,
    });
    expect(verification.checks.workerResolutionComplete).toBe(false);
    expect(verification.status).not.toBe('snapshot_runtime_clean');
  });
});

describe('workerSnapshotRuntimeObservability + cross-company isolation', () => {
  it('summarizes shadow consumptions deterministically', () => {
    const rowsC1 = [buildRow('company-1')];
    const rowsC2 = [buildRow('company-2')];
    const results = [
      simulateWorkerShadowConsumption({
        rows: rowsC1,
        resolutionKey: { kind: 'publish_contract_id', value: rowsC1[0].publish_contract_id },
        liveDraft: buildBlog('company-1'),
        liveDraftRenderedHtml: RENDERED_HTML,
      }),
      simulateWorkerShadowConsumption({
        rows: rowsC2,
        resolutionKey: { kind: 'publish_contract_id', value: rowsC2[0].publish_contract_id },
        liveDraft: buildBlog('company-2'),
        liveDraftRenderedHtml: RENDERED_HTML,
      }),
    ];
    const first = summarizeWorkerSnapshotRuntime(results);
    const second = summarizeWorkerSnapshotRuntime(results);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.totalConsumptions).toBe(2);
    expect(first.overallStatus).toBe('snapshot_runtime_clean');
    expect(first.loadSummary.loaded).toBe(2);
    expect(first.driftSummary.clean).toBe(2);
  });

  it('isolates companies — a company-1 draft against a company-2 snapshot drifts on ownership', () => {
    const rowsC2 = [buildRow('company-2')];
    const result = simulateWorkerShadowConsumption({
      rows: rowsC2,
      resolutionKey: { kind: 'publish_contract_id', value: rowsC2[0].publish_contract_id },
      liveDraft: buildBlog('company-1'),
      liveDraftRenderedHtml: RENDERED_HTML,
    });
    expect(result.driftReport?.driftKinds).toContain('company_ownership');
    expect(result.status).toBe('snapshot_runtime_invalid');

    const summary = summarizeWorkerSnapshotRuntime([result]);
    expect(summary.overallStatus).toBe('snapshot_runtime_invalid');
    expect(summary.driftSummary.byKind.company_ownership).toBe(1);
    expect(summary.riskSummary.length).toBeGreaterThan(0);
  });
});
