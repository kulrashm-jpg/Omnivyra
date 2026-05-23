import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import { mapBlogToPublishSnapshotInput, type BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import { buildPublishSnapshotRow, type ContentPublishSnapshotRow } from '../../../lib/publishing/publishSnapshotRecord';
import { buildWorkerShadowTelemetryFromRows } from '../../../backend/services/workerSnapshotShadowHook';
import { verifyWorkerSnapshotRuntimeStability } from '../../../lib/publishing/workerSnapshotRuntimeStabilityVerifier';
import {
  worstShadowSoakStatus,
  shadowSoakStatusFromRuntime,
} from '../../../lib/publishing/workerSnapshotShadowSoakStatus';
import { buildShadowTelemetryRow, buildRuntimeTelemetryRow } from '../../../backend/services/workerSnapshotShadowTelemetryStore';
import {
  buildShadowSoakReport,
  buildShadowSoakSummaryRows,
  runWorkerSnapshotShadowSoakCycle,
} from '../../../backend/services/workerSnapshotShadowSoakRunner';

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

function cleanTelemetry(companyId: string) {
  return buildWorkerShadowTelemetryFromRows([buildRow(companyId)], {
    jobId: `job-${companyId}`,
    blogId: `blog-${companyId}`,
    companyId,
    liveDraft: buildBlog(companyId),
    liveDraftRenderedHtml: RENDERED_HTML,
  });
}

function ownershipDriftTelemetry() {
  return buildWorkerShadowTelemetryFromRows([buildRow('company-2')], {
    jobId: 'job-x',
    blogId: 'blog-company-2',
    companyId: 'company-2',
    liveDraft: buildBlog('company-1'),
    liveDraftRenderedHtml: RENDERED_HTML,
  });
}

describe('workerSnapshotShadowSoakStatus', () => {
  it('maps runtime status to soak status and aggregates worst-wins', () => {
    expect(shadowSoakStatusFromRuntime('snapshot_runtime_clean')).toBe('shadow_soak_clean');
    expect(shadowSoakStatusFromRuntime('snapshot_runtime_invalid')).toBe('shadow_soak_invalid');
    expect(worstShadowSoakStatus(['shadow_soak_clean', 'shadow_soak_risk', 'shadow_soak_warning']))
      .toBe('shadow_soak_risk');
    expect(worstShadowSoakStatus([])).toBe('shadow_soak_clean');
  });
});

describe('workerSnapshotShadowTelemetryStore — codec', () => {
  it('builds telemetry rows deterministically with a stable fingerprint', () => {
    const telemetry = cleanTelemetry('company-1');
    const first = buildRuntimeTelemetryRow('soak-1', telemetry);
    const second = buildRuntimeTelemetryRow('soak-1', telemetry);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.record_kind).toBe('runtime_telemetry');
    expect(first.telemetry_fingerprint).toBe(second.telemetry_fingerprint);
    expect(first.company_id).toBe('company-1');
  });

  it('produces a different fingerprint for different payloads (append-only integrity)', () => {
    const a = buildShadowTelemetryRow({ soakCycleId: 's', recordKind: 'metrics_snapshot', payload: { a: 1 } });
    const b = buildShadowTelemetryRow({ soakCycleId: 's', recordKind: 'metrics_snapshot', payload: { a: 2 } });
    expect(a.telemetry_fingerprint).not.toBe(b.telemetry_fingerprint);
  });
});

describe('workerSnapshotRuntimeStabilityVerifier', () => {
  it('reports clean stability for a clean telemetry set', () => {
    const report = verifyWorkerSnapshotRuntimeStability([cleanTelemetry('company-1'), cleanTelemetry('company-2')]);
    expect(report.status).toBe('shadow_soak_clean');
    expect(report.ownershipDriftCount).toBe(0);
    expect(report.runtimeStatusDistribution.snapshot_runtime_clean).toBe(2);
    expect(report.findings).toEqual([]);
  });

  it('escalates to shadow_soak_invalid on ownership drift', () => {
    const report = verifyWorkerSnapshotRuntimeStability([cleanTelemetry('company-1'), ownershipDriftTelemetry()]);
    expect(report.status).toBe('shadow_soak_invalid');
    expect(report.ownershipDriftCount).toBe(1);
    expect(report.rates.ownershipDriftRate).toBeCloseTo(0.5);
  });

  it('is deterministic across runs', () => {
    const telemetries = [cleanTelemetry('company-1'), ownershipDriftTelemetry()];
    expect(JSON.stringify(verifyWorkerSnapshotRuntimeStability(telemetries)))
      .toBe(JSON.stringify(verifyWorkerSnapshotRuntimeStability(telemetries)));
  });
});

describe('workerSnapshotShadowSoakRunner — soak report', () => {
  it('builds a deterministic clean soak report and aggregates runtime status', () => {
    const telemetries = [cleanTelemetry('company-1'), cleanTelemetry('company-2')];
    const first = buildShadowSoakReport('soak-1', telemetries);
    const second = buildShadowSoakReport('soak-1', telemetries);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.shadowSoakStatus).toBe('shadow_soak_clean');
    expect(first.telemetryCount).toBe(2);
    expect(first.metrics.shadowConsumptionCount).toBe(2);
    expect(first.operationalReport.soakHealth).toBe('shadow_soak_clean');
  });

  it('escalates the soak report on ownership drift', () => {
    const report = buildShadowSoakReport('soak-2', [cleanTelemetry('company-1'), ownershipDriftTelemetry()]);
    expect(report.shadowSoakStatus).toBe('shadow_soak_invalid');
    expect(report.metrics.crossCompanyOwnershipDriftCount).toBe(1);
    expect(report.operationalReport.ownershipDrift.clean).toBe(false);
  });

  it('builds deterministic append-only summary rows for a soak report', () => {
    const report = buildShadowSoakReport('soak-3', [cleanTelemetry('company-1')]);
    const first = buildShadowSoakSummaryRows(report);
    const second = buildShadowSoakSummaryRows(report);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map((row) => row.record_kind).sort()).toEqual(
      ['compatibility_summary', 'drift_summary', 'metrics_snapshot', 'ownership_summary', 'risk_summary'],
    );
  });

  it('runs a non-throwing soak cycle against in-memory telemetry without persistence', async () => {
    const result = await runWorkerSnapshotShadowSoakCycle({
      soakCycleId: 'soak-mem',
      telemetries: [cleanTelemetry('company-1')],
      persistSummaries: false,
    });
    expect(result.executed).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.report?.shadowSoakStatus).toBe('shadow_soak_clean');
  });

  it('reports an empty soak cycle without throwing', async () => {
    const result = await runWorkerSnapshotShadowSoakCycle({ soakCycleId: 'soak-empty', telemetries: [] });
    expect(result.executed).toBe(true);
    expect(result.report?.telemetryCount).toBe(0);
    expect(result.report?.operationalReport.telemetryGaps.length).toBeGreaterThan(0);
  });
});
