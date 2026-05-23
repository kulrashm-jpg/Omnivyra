import {
  resolveSoakCycleId,
  resolveSoakCycleWindowStartMs,
  currentSoakCycleId,
} from '../../../lib/publishing/workerSnapshotShadowSoakCycle';
import {
  derivePersistenceStatus,
  worstPersistenceStatus,
} from '../../../lib/publishing/workerSnapshotPersistenceStatus';
import {
  summarizeWorkerSnapshotPersistence,
  type WorkerSnapshotPersistenceEvent,
} from '../../../lib/publishing/workerSnapshotPersistenceObservability';
import { buildRuntimeTelemetryRow } from '../../../backend/services/workerSnapshotShadowTelemetryStore';
import {
  isWorkerSnapshotShadowEnabled,
  runWorkerSnapshotShadowHook,
  buildPersistenceEventFromHookResult,
  type WorkerShadowHookResult,
} from '../../../backend/services/workerSnapshotShadowHook';
import { createUniversalPublishSnapshot } from '../../../lib/publishing/universalPublishSnapshot';
import { buildUniversalPublishingContract } from '../../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract } from '../../../lib/publishing/publishingAuditContracts';
import { mapBlogToPublishSnapshotInput, type BlogContentSource } from '../../../lib/publishing/publishSnapshotMapper';
import { buildPublishSnapshotRow, type ContentPublishSnapshotRow } from '../../../lib/publishing/publishSnapshotRecord';
import { buildWorkerShadowTelemetryFromRows } from '../../../backend/services/workerSnapshotShadowHook';

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

describe('workerSnapshotShadowSoakCycle — stable soakCycleId', () => {
  it('derives a stable soakCycleId for the same environment + worker group + window', () => {
    const a = resolveSoakCycleId({ environment: 'staging', workerGroup: 'shared', nowIso: '2026-06-01T09:14:00.000Z' });
    const b = resolveSoakCycleId({ environment: 'staging', workerGroup: 'shared', nowIso: '2026-06-01T11:59:00.000Z' });
    // Same 6h window → same soak cycle.
    expect(a).toBe(b);
    expect(a.startsWith('soak_staging_shared_w')).toBe(true);
  });

  it('derives a different soakCycleId for a different window or environment', () => {
    const base = resolveSoakCycleId({ environment: 'staging', workerGroup: 'shared', nowIso: '2026-06-01T09:00:00.000Z' });
    const laterWindow = resolveSoakCycleId({ environment: 'staging', workerGroup: 'shared', nowIso: '2026-06-01T20:00:00.000Z' });
    const otherEnv = resolveSoakCycleId({ environment: 'production', workerGroup: 'shared', nowIso: '2026-06-01T09:00:00.000Z' });
    expect(laterWindow).not.toBe(base);
    expect(otherEnv).not.toBe(base);
  });

  it('floors timestamps to the window start deterministically', () => {
    const start = resolveSoakCycleWindowStartMs('2026-06-01T09:14:00.000Z', 6);
    expect(start).toBe(resolveSoakCycleWindowStartMs('2026-06-01T11:00:00.000Z', 6));
    expect(typeof currentSoakCycleId()).toBe('string');
  });
});

describe('workerSnapshotPersistenceStatus', () => {
  it('derives persistence status worst-wins', () => {
    expect(derivePersistenceStatus({ successCount: 3, failureCount: 0, runtimeInvalidPersistenceCount: 0, ownershipDriftPersistenceCount: 0 }))
      .toBe('persistence_clean');
    expect(derivePersistenceStatus({ successCount: 2, failureCount: 1, runtimeInvalidPersistenceCount: 0, ownershipDriftPersistenceCount: 0 }))
      .toBe('persistence_warning');
    expect(derivePersistenceStatus({ successCount: 1, failureCount: 0, runtimeInvalidPersistenceCount: 1, ownershipDriftPersistenceCount: 0 }))
      .toBe('persistence_risk');
    expect(derivePersistenceStatus({ successCount: 1, failureCount: 0, runtimeInvalidPersistenceCount: 0, ownershipDriftPersistenceCount: 1 }))
      .toBe('persistence_invalid');
    expect(worstPersistenceStatus(['persistence_clean', 'persistence_warning'])).toBe('persistence_warning');
  });
});

describe('workerSnapshotShadowTelemetryStore — runtime telemetry row', () => {
  it('builds an append-only runtime telemetry row deterministically', () => {
    const telemetry = cleanTelemetry('company-1');
    const first = buildRuntimeTelemetryRow('soak_staging_shared_w0', telemetry);
    const second = buildRuntimeTelemetryRow('soak_staging_shared_w0', telemetry);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.record_kind).toBe('runtime_telemetry');
    expect(first.soak_cycle_id).toBe('soak_staging_shared_w0');
    expect(first.runtime_status).toBe('snapshot_runtime_clean');
    expect(first.telemetry_fingerprint).toBe(second.telemetry_fingerprint);
  });
});

describe('workerSnapshotPersistenceObservability', () => {
  it('summarizes persistence events deterministically', () => {
    const events: WorkerSnapshotPersistenceEvent[] = [
      { persisted: true, runtimeStatus: 'snapshot_runtime_clean', ownershipDrift: false, unresolved: false },
      { persisted: false, runtimeStatus: null, ownershipDrift: false, unresolved: false },
    ];
    const first = summarizeWorkerSnapshotPersistence(events);
    const second = summarizeWorkerSnapshotPersistence(events);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.attempts).toBe(2);
    expect(first.persistenceSuccessCount).toBe(1);
    expect(first.persistenceFailureCount).toBe(1);
    expect(first.status).toBe('persistence_warning');
  });

  it('escalates to persistence_invalid when ownership drift is persisted', () => {
    const observability = summarizeWorkerSnapshotPersistence([
      { persisted: true, runtimeStatus: 'snapshot_runtime_invalid', ownershipDrift: true, unresolved: false },
    ]);
    expect(observability.status).toBe('persistence_invalid');
    expect(observability.ownershipDriftPersistenceCount).toBe(1);
    expect(observability.runtimeInvalidPersistenceCount).toBe(1);
  });

  it('reports a clean persistence rate of 1 for all-success events', () => {
    const observability = summarizeWorkerSnapshotPersistence([
      { persisted: true, runtimeStatus: 'snapshot_runtime_clean', ownershipDrift: false, unresolved: false },
    ]);
    expect(observability.status).toBe('persistence_clean');
    expect(observability.runtimeTelemetryPersistenceRate).toBe(1);
  });
});

describe('workerSnapshotShadowHook — persistence wiring', () => {
  const original = process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
    else process.env.WORKER_SNAPSHOT_SHADOW_ENABLED = original;
  });

  it('does not attempt persistence when the shadow hook is disabled (live publish isolation)', async () => {
    delete process.env.WORKER_SNAPSHOT_SHADOW_ENABLED;
    expect(isWorkerSnapshotShadowEnabled()).toBe(false);
    const result = await runWorkerSnapshotShadowHook({
      jobId: 'job-1',
      blogId: 'blog-1',
      companyId: 'company-1',
      liveDraft: buildBlog('company-1') as unknown as Record<string, unknown>,
      liveDraftRenderedHtml: RENDERED_HTML,
      integrationType: 'wordpress',
    });
    expect(result.persistence.attempted).toBe(false);
    expect(result.persistence.persisted).toBe(false);
    expect(result.executed).toBe(false);
  });

  it('projects a hook result into a persistence observability event', () => {
    const ownershipResult: WorkerShadowHookResult = {
      shadowEnabled: true,
      executed: true,
      telemetry: ownershipDriftTelemetry(),
      persistence: { attempted: true, persisted: true, soakCycleId: 'soak_test_shared_w0', reasons: [] },
      reasons: [],
    };
    const event = buildPersistenceEventFromHookResult(ownershipResult);
    expect(event.persisted).toBe(true);
    expect(event.ownershipDrift).toBe(true);
    expect(event.runtimeStatus).toBe('snapshot_runtime_invalid');

    const summary = summarizeWorkerSnapshotPersistence([event]);
    expect(summary.status).toBe('persistence_invalid');
  });
});
