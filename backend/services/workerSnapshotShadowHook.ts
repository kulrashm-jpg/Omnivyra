// Env-Gated Worker Shadow Snapshot Hook
//
// Runs alongside the real publish worker AFTER live draft resolution. When
// WORKER_SNAPSHOT_SHADOW_ENABLED is 'true' it simulates frozen-snapshot
// consumption, verifies compatibility, and emits advisory telemetry.
//
// SAFETY GUARD: this hook NEVER throws into the live publish path, never
// mutates worker behavior, never changes queue/scheduler outcomes, and never
// alters publish success/failure or retries. Every failure becomes advisory
// telemetry only. The live worker continues publishing from live drafts.

import { ownedDbTable } from '../db/writeOwner';
import type { ContentPublishSnapshotRow } from '../../lib/publishing/publishSnapshotRecord';
import type { BlogContentSource } from '../../lib/publishing/publishSnapshotMapper';
import { simulateWorkerShadowConsumption } from '../../lib/publishing/workerShadowSnapshotConsumption';
import { verifyWorkerSnapshotCompatibility } from '../../lib/publishing/workerSnapshotCompatibilityVerification';
import {
  buildWorkerSnapshotRuntimeTelemetry,
  type WorkerSnapshotRuntimeTelemetry,
} from '../../lib/publishing/workerSnapshotRuntimeTelemetry';
import { currentSoakCycleId } from '../../lib/publishing/workerSnapshotShadowSoakCycle';
import type { WorkerSnapshotPersistenceEvent } from '../../lib/publishing/workerSnapshotPersistenceObservability';
import { buildRuntimeTelemetryRow, persistShadowTelemetryRecords } from './workerSnapshotShadowTelemetryStore';

const TABLE = 'content_publish_snapshots';

export function isWorkerSnapshotShadowEnabled(): boolean {
  return process.env.WORKER_SNAPSHOT_SHADOW_ENABLED === 'true';
}

export interface WorkerShadowTelemetryCoreInput {
  jobId: string;
  blogId: string;
  companyId: string;
  liveDraft: BlogContentSource;
  liveDraftRenderedHtml: string;
}

// Pure core — builds shadow telemetry from a row set. No DB, no execution.
export function buildWorkerShadowTelemetryFromRows(
  rows: readonly ContentPublishSnapshotRow[],
  input: WorkerShadowTelemetryCoreInput,
): WorkerSnapshotRuntimeTelemetry {
  const consumption = simulateWorkerShadowConsumption({
    rows,
    resolutionKey: { kind: 'blog_id', value: input.blogId },
    liveDraft: input.liveDraft,
    liveDraftRenderedHtml: input.liveDraftRenderedHtml,
  });
  const compatibility = verifyWorkerSnapshotCompatibility({
    snapshot: consumption.resolution.snapshot,
    contract: consumption.resolution.contract,
    audit: consumption.resolution.audit,
    resolution: consumption.resolution,
  });
  return buildWorkerSnapshotRuntimeTelemetry({
    jobId: input.jobId,
    blogId: input.blogId,
    companyId: input.companyId,
    shadowEnabled: true,
    consumption,
    compatibility,
  });
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toBlogContentSource(blog: Record<string, unknown>): BlogContentSource {
  return {
    id: String(blog.id ?? ''),
    company_id: String(blog.company_id ?? ''),
    title: String(blog.title ?? ''),
    slug: String(blog.slug ?? ''),
    excerpt: str(blog.excerpt),
    content: str(blog.content),
    content_blocks: Array.isArray(blog.content_blocks) ? blog.content_blocks : null,
    featured_image_url: str(blog.featured_image_url),
    category: str(blog.category),
    tags: Array.isArray(blog.tags) ? blog.tags.map((tag) => String(tag)) : null,
    seo_meta_title: str(blog.seo_meta_title),
    seo_meta_description: str(blog.seo_meta_description),
    website_id: str(blog.website_id),
    integration_id: str(blog.integration_id),
    external_id: str(blog.external_id),
    scheduled_publish_at: str(blog.scheduled_publish_at),
  };
}

function emitShadowTelemetry(telemetry: WorkerSnapshotRuntimeTelemetry): void {
  try {
    // eslint-disable-next-line no-console
    console.info('[worker-snapshot-shadow]', JSON.stringify({
      jobId: telemetry.jobId,
      blogId: telemetry.blogId,
      runtimeStatus: telemetry.runtimeStatus,
      resolved: telemetry.resolutionTelemetry.resolved,
      hasDrift: telemetry.driftTelemetry.hasDrift,
      driftKinds: telemetry.driftTelemetry.driftKinds,
      compatibility: telemetry.compatibilityTelemetry.status,
      ownershipDrift: telemetry.ownershipTelemetry.ownershipDrift,
    }));
  } catch {
    /* telemetry emission is advisory-only — swallow */
  }
}

export interface WorkerShadowHookInput {
  jobId: string;
  blogId: string | null;
  companyId: string;
  liveDraft: Record<string, unknown>;
  liveDraftRenderedHtml: string;
  integrationType: string | null;
}

export interface WorkerShadowHookPersistence {
  attempted: boolean;
  persisted: boolean;
  soakCycleId: string | null;
  reasons: readonly string[];
}

export interface WorkerShadowHookResult {
  shadowEnabled: boolean;
  executed: boolean;
  telemetry: WorkerSnapshotRuntimeTelemetry | null;
  persistence: WorkerShadowHookPersistence;
  reasons: readonly string[];
}

const NO_PERSISTENCE: WorkerShadowHookPersistence = {
  attempted: false,
  persisted: false,
  soakCycleId: null,
  reasons: [],
};

// Best-effort append-only persistence of one runtime telemetry record.
// NEVER throws — any failure becomes an advisory persistence warning.
async function persistTelemetryBestEffort(
  telemetry: WorkerSnapshotRuntimeTelemetry,
): Promise<WorkerShadowHookPersistence> {
  const soakCycleId = currentSoakCycleId();
  try {
    await persistShadowTelemetryRecords([buildRuntimeTelemetryRow(soakCycleId, telemetry)]);
    return { attempted: true, persisted: true, soakCycleId, reasons: [] };
  } catch (error) {
    return {
      attempted: true,
      persisted: false,
      soakCycleId,
      reasons: [`telemetry persistence failed: ${error instanceof Error ? error.message : 'unknown error'}`],
    };
  }
}

// Projects a hook result into a persistence observability event.
export function buildPersistenceEventFromHookResult(
  result: WorkerShadowHookResult,
): WorkerSnapshotPersistenceEvent {
  return {
    persisted: result.persistence.persisted,
    runtimeStatus: result.telemetry ? result.telemetry.runtimeStatus : null,
    ownershipDrift: result.telemetry ? result.telemetry.ownershipTelemetry.ownershipDrift : false,
    unresolved: result.telemetry ? !result.telemetry.resolutionTelemetry.resolved : false,
  };
}

// The hook entry point. NEVER throws — the entire body is guarded; any failure
// is returned as an advisory result so the live publish path is unaffected.
export async function runWorkerSnapshotShadowHook(
  input: WorkerShadowHookInput,
): Promise<WorkerShadowHookResult> {
  if (!isWorkerSnapshotShadowEnabled()) {
    return { shadowEnabled: false, executed: false, telemetry: null, persistence: NO_PERSISTENCE, reasons: ['shadow hook disabled'] };
  }
  try {
    if (!input.blogId) {
      return { shadowEnabled: true, executed: false, telemetry: null, persistence: NO_PERSISTENCE, reasons: ['no blog id on job'] };
    }
    const { data, error } = await ownedDbTable(TABLE)
      .select('*')
      .eq('blog_id', input.blogId)
      .eq('company_id', input.companyId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ContentPublishSnapshotRow[];

    const telemetry = buildWorkerShadowTelemetryFromRows(rows, {
      jobId: input.jobId,
      blogId: input.blogId,
      companyId: input.companyId,
      liveDraft: toBlogContentSource(input.liveDraft),
      liveDraftRenderedHtml: input.liveDraftRenderedHtml,
    });
    emitShadowTelemetry(telemetry);
    // Best-effort append-only telemetry persistence — non-blocking, never
    // throws into the worker flow. A failure is an advisory warning only.
    const persistence = await persistTelemetryBestEffort(telemetry);
    return { shadowEnabled: true, executed: true, telemetry, persistence, reasons: [] };
  } catch (error) {
    return {
      shadowEnabled: true,
      executed: false,
      telemetry: null,
      persistence: NO_PERSISTENCE,
      reasons: [`shadow hook error: ${error instanceof Error ? error.message : 'unknown error'}`],
    };
  }
}
