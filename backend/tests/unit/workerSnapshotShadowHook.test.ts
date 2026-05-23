import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import { mapBlogToPublishSnapshotInput, type BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import { buildPublishSnapshotRow, type ContentPublishSnapshotRow } from '../../../lib/publishing/publishSnapshotRecord';
import { buildWorkerSnapshotShadowMetrics } from '../../../lib/publishing/workerSnapshotShadowMetrics';
import { summarizeWorkerSnapshotShadowRisk } from '../../../lib/publishing/workerSnapshotShadowRiskSummary';
import {
  isWorkerSnapshotShadowEnabled,
  runWorkerSnapshotShadowHook,
  buildWorkerShadowTelemetryFromRows,
} from '../../../backend/services/workerSnapshotShadowHook';

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

function coreInput(companyId: string, draftOverride: Partial<BlogContentSource> = {}) {
  return {
    jobId: `job-${companyId}`,
    blogId: `blog-${companyId}`,
    companyId,
    liveDraft: { ...buildBlog(companyId), ...draftOverride },
    liveDraftRenderedHtml: RENDERED_HTML,
  };
}

describe('workerSnapshotShadowHook — env gating', () => {
  const original = process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
    else process.env.WORKER_SNAPSHOT_SHADOW_ENABLED = original;
  });

  it('is disabled by default', () => {
    delete process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
    expect(isWorkerSnapshotShadowEnabled()).toBe(false);
  });

  it('activates only when explicitly set to true', () => {
    process.env.WORKER_SNAPSHOT_SHADOW_ENABLED = 'false';
    expect(isWorkerSnapshotShadowEnabled()).toBe(false);
    process.env.WORKER_SNAPSHOT_SHADOW_ENABLED = 'true';
    expect(isWorkerSnapshotShadowEnabled()).toBe(true);
  });

  it('is a clean non-throwing no-op when disabled (no DB access, live path isolated)', async () => {
    delete process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
    const result = await runWorkerSnapshotShadowHook({
      jobId: 'job-1',
      blogId: 'blog-1',
      companyId: 'company-1',
      liveDraft: buildBlog('company-1') as unknown as Record<string, unknown>,
      liveDraftRenderedHtml: RENDERED_HTML,
      integrationType: 'wordpress',
    });
    expect(result.shadowEnabled).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.telemetry).toBeNull();
  });
});

describe('workerSnapshotShadowHook — telemetry core', () => {
  it('builds clean shadow telemetry deterministically when draft matches the snapshot', () => {
    const rows = [buildRow('company-1')];
    const first = buildWorkerShadowTelemetryFromRows(rows, coreInput('company-1'));
    const second = buildWorkerShadowTelemetryFromRows(rows, coreInput('company-1'));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('worker-snapshot-runtime-telemetry-v1');
    expect(first.runtimeStatus).toBe('snapshot_runtime_clean');
    expect(first.resolutionTelemetry.resolved).toBe(true);
    expect(first.driftTelemetry.hasDrift).toBe(false);
    expect(first.compatibilityTelemetry.status).toBe('snapshot_runtime_clean');
    expect(first.advisoryNote).toContain('shadow-only');
  });

  it('emits drift telemetry when the live draft differs from the snapshot', () => {
    const rows = [buildRow('company-1')];
    const telemetry = buildWorkerShadowTelemetryFromRows(rows, coreInput('company-1', { slug: 'changed-slug' }));

    expect(telemetry.driftTelemetry.hasDrift).toBe(true);
    expect(telemetry.driftTelemetry.driftKinds).toContain('slug');
    expect(telemetry.runtimeStatus).toBe('snapshot_runtime_risk');
  });

  it('emits cross-company ownership drift telemetry', () => {
    const rows = [buildRow('company-2')];
    // A company-1 draft resolved against company-2's snapshot is impossible by
    // blog_id, so simulate by resolving company-2 rows with a company-1 draft.
    const telemetry = buildWorkerShadowTelemetryFromRows(rows, {
      jobId: 'job-x',
      blogId: 'blog-company-2',
      companyId: 'company-2',
      liveDraft: buildBlog('company-1'),
      liveDraftRenderedHtml: RENDERED_HTML,
    });
    expect(telemetry.ownershipTelemetry.ownershipDrift).toBe(true);
    expect(telemetry.runtimeStatus).toBe('snapshot_runtime_invalid');
  });

  it('emits compatibility + unresolved telemetry without throwing on empty rows', () => {
    const telemetry = buildWorkerShadowTelemetryFromRows([], coreInput('company-1'));
    expect(telemetry.resolutionTelemetry.resolved).toBe(false);
    expect(telemetry.integrityTelemetry.snapshotLoaded).toBe(false);
    expect(telemetry.compatibilityTelemetry.status).not.toBe('snapshot_runtime_clean');
  });
});

describe('workerSnapshotShadowMetrics + risk summary', () => {
  it('aggregates shadow metrics deterministically', () => {
    const cleanTelemetry = buildWorkerShadowTelemetryFromRows([buildRow('company-1')], coreInput('company-1'));
    const driftTelemetry = buildWorkerShadowTelemetryFromRows(
      [buildRow('company-1')],
      coreInput('company-1', { slug: 'changed-slug' }),
    );
    const unresolvedTelemetry = buildWorkerShadowTelemetryFromRows([], coreInput('company-1'));
    const telemetries = [cleanTelemetry, driftTelemetry, unresolvedTelemetry];

    const first = buildWorkerSnapshotShadowMetrics(telemetries);
    const second = buildWorkerSnapshotShadowMetrics(telemetries);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.shadowConsumptionCount).toBe(3);
    expect(first.snapshotResolutionFailures).toBe(1);
    expect(first.draftSnapshotDriftCount).toBe(1);
  });

  it('summarizes shadow risk deterministically with company-isolation buckets', () => {
    const ownershipTelemetry = buildWorkerShadowTelemetryFromRows([buildRow('company-2')], {
      jobId: 'job-x',
      blogId: 'blog-company-2',
      companyId: 'company-2',
      liveDraft: buildBlog('company-1'),
      liveDraftRenderedHtml: RENDERED_HTML,
    });
    const first = summarizeWorkerSnapshotShadowRisk([ownershipTelemetry]);
    const second = summarizeWorkerSnapshotShadowRisk([ownershipTelemetry]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.overallStatus).toBe('snapshot_runtime_invalid');
    expect(first.ownershipRisks.length).toBeGreaterThan(0);
  });

  it('produces empty risk buckets for a clean telemetry set', () => {
    const summary = summarizeWorkerSnapshotShadowRisk([
      buildWorkerShadowTelemetryFromRows([buildRow('company-1')], coreInput('company-1')),
    ]);
    expect(summary.overallStatus).toBe('snapshot_runtime_clean');
    expect(summary.runtimeDriftRisks).toEqual([]);
    expect(summary.ownershipRisks).toEqual([]);
    expect(summary.unresolvedSnapshotRisks).toEqual([]);
  });
});
