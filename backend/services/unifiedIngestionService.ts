import { csvSourceAdapter } from './csvSourceAdapter';
import {
  beginIngestionRun,
  buildIngestionIdempotencyKey,
  completeIngestionRun,
  setDataSourceStatus,
  type IngestionSource,
} from './ingestionRunService';
import { logger } from './logger';
import { normalizeSource, type UnifiedSource } from './sourceNormalizationService';
import type { SourceAdapter } from './sourceAdapter';

export interface UnifiedIngestionPayload {
  companyId: string;
  source: string;
  sourceType: 'file' | 'integration' | 'internal';
  records: any[];
  metadata?: Record<string, any>;
  ingestionTimestamp?: string;
}

export interface UnifiedIngestionContext {
  runId: string;
  companyId: string;
  source: string;
  sourceType: UnifiedIngestionPayload['sourceType'];
  metadata: Record<string, any>;
  ingestionTimestamp: string;
  adapter: string;
  unifiedSource: UnifiedSource;
  loadRecords?: (records: any[], context: UnifiedIngestionContext) => Promise<unknown>;
  loadResult?: unknown;
  [key: string]: any;
}

export interface UnifiedIngestionResult {
  source: string;
  sourceType: UnifiedIngestionPayload['sourceType'];
  ingestionRunId: string;
  adapter: string;
  recordsReceived: number;
  recordsTransformed: number;
  status: 'completed' | 'failed';
  errors: string[];
  unifiedSource: UnifiedSource;
  loadResult?: unknown;
}

export interface UnifiedIngestionOptions {
  adapters?: SourceAdapter[];
  idempotencyKey?: string;
  context?: Record<string, any>;
}

// Mirrors data_source_status.source (post-20260904 migration includes 'reviews'). NOTE: the unified
// ingestion path deliberately does NOT accept 'reviews' at runtime (see SUPPORTED_RUN_SOURCES) — reviews
// flow through the canonical ingestionScheduler dispatch. This union only keeps the status-mapper's
// return type consistent with the widened IngestionSource.
type DataSourceStatusSource = 'crawler' | 'ga' | 'gsc' | 'crm' | 'ads' | 'reviews';

const DEFAULT_ADAPTERS: SourceAdapter[] = [csvSourceAdapter];
const SUPPORTED_RUN_SOURCES = new Set(['crawler', 'ga4', 'gsc', 'crm', 'ads']);
const VALID_SOURCE_TYPES = new Set(['file', 'integration', 'internal']);

function validatePayload(payload: UnifiedIngestionPayload): void {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    throw new Error('Unified ingestion payload must be an object');
  }

  if (!payload.companyId || typeof payload.companyId !== 'string' || !payload.companyId.trim()) {
    errors.push('companyId is required');
  }

  if (!payload.source || typeof payload.source !== 'string' || !payload.source.trim()) {
    errors.push('source is required');
  }

  if (!VALID_SOURCE_TYPES.has(payload.sourceType)) {
    errors.push('sourceType must be file, integration, or internal');
  }

  if (!Array.isArray(payload.records)) {
    errors.push('records must be an array');
  }

  if (
    payload.metadata !== undefined &&
    (typeof payload.metadata !== 'object' || payload.metadata === null || Array.isArray(payload.metadata))
  ) {
    errors.push('metadata must be an object when provided');
  }

  if (payload.ingestionTimestamp && Number.isNaN(Date.parse(payload.ingestionTimestamp))) {
    errors.push('ingestionTimestamp must be a valid ISO timestamp when provided');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid unified ingestion payload: ${errors.join('; ')}`);
  }
}

function normalizeIngestionSource(source: string): IngestionSource {
  const normalized = source.trim().toLowerCase() === 'ga' ? 'ga4' : source.trim().toLowerCase();

  if (!SUPPORTED_RUN_SOURCES.has(normalized)) {
    throw new Error(`Unsupported ingestion source "${source}" for current ingestion_runs schema`);
  }

  return normalized as IngestionSource;
}

function statusSourceForRunSource(source: IngestionSource): DataSourceStatusSource {
  return source === 'ga4' ? 'ga' : source;
}

function resolveAdapter(payload: UnifiedIngestionPayload, adapters: SourceAdapter[]): SourceAdapter {
  const metadata = payload.metadata ?? {};
  const candidates = [
    typeof metadata.adapter === 'string' ? metadata.adapter : '',
    typeof metadata.format === 'string' ? metadata.format : '',
    payload.source,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const adapter = adapters.find((item) => item.canHandle(candidate));
    if (adapter) {
      return adapter;
    }
  }

  throw new Error(`No source adapter registered for source "${payload.source}"`);
}

function buildUnifiedRunKey(payload: UnifiedIngestionPayload): string {
  return buildIngestionIdempotencyKey({
    companyId: payload.companyId,
    source: payload.source,
    sourceType: payload.sourceType,
    recordCount: payload.records.length,
    metadata: payload.metadata ?? {},
    ingestionTimestamp: payload.ingestionTimestamp ?? null,
  });
}

function numericField(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const parsed = Number(record[key]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export async function ingestUnifiedData(
  payload: UnifiedIngestionPayload,
  options: UnifiedIngestionOptions = {}
): Promise<UnifiedIngestionResult> {
  validatePayload(payload);

  const runSource = normalizeIngestionSource(payload.source);
  const statusSource = statusSourceForRunSource(runSource);
  const adapter = resolveAdapter(payload, options.adapters ?? DEFAULT_ADAPTERS);
  const ingestionTimestamp = payload.ingestionTimestamp ?? new Date().toISOString();
  const metadata = payload.metadata ?? {};
  const unifiedSource = normalizeSource(payload.source, {
    sourceType: payload.sourceType,
    adapter: adapter.source,
    metadata,
  });
  const idempotencyKey = options.idempotencyKey ?? buildUnifiedRunKey(payload);

  const run = await beginIngestionRun({
    companyId: payload.companyId,
    source: runSource,
    idempotencyKey,
    unifiedSource,
    cursorPayload: {
      unified: true,
      source: payload.source,
      sourceType: payload.sourceType,
      unified_source: unifiedSource,
      adapter: adapter.source,
      ingestionTimestamp,
      metadata,
    },
  });

  await setDataSourceStatus({
    companyId: payload.companyId,
    source: statusSource,
    status: 'syncing',
    errorMessage: null,
    unifiedSource,
  });

  const context: UnifiedIngestionContext = {
    ...(options.context ?? {}),
    runId: run.id,
    companyId: payload.companyId,
    source: payload.source,
    sourceType: payload.sourceType,
    metadata,
    ingestionTimestamp,
    adapter: adapter.source,
    unifiedSource,
  };

  try {
    logger.info('unified_ingestion_started', {
      companyId: payload.companyId,
      source: payload.source,
      sourceType: payload.sourceType,
      unifiedSource,
      adapter: adapter.source,
      ingestionRunId: run.id,
      recordCount: payload.records.length,
    });

    const transformedRecords = await adapter.transform(payload.records, metadata);
    await adapter.load(transformedRecords, context);

    const processed = numericField(context.loadResult, [
      'recordsProcessed',
      'leadsProcessed',
      'eventsProcessed',
      'sessionsProcessed',
      'pagesProcessed',
      'keywordsProcessed',
      'campaignsProcessed',
    ]) ?? payload.records.length;
    const inserted = numericField(context.loadResult, [
      'recordsInserted',
      'leadsInserted',
      'eventsInserted',
      'sessionsInserted',
      'pagesInserted',
      'keywordsInserted',
      'campaignsInserted',
    ]) ?? 0;
    const updated = numericField(context.loadResult, [
      'recordsUpdated',
      'leadsUpdated',
      'eventsUpdated',
      'sessionsUpdated',
      'pagesUpdated',
      'keywordsUpdated',
      'campaignsUpdated',
    ]) ?? 0;

    await completeIngestionRun({
      runId: run.id,
      status: 'completed',
      counts: {
        processed,
        inserted,
        updated,
      },
    });

    await setDataSourceStatus({
      companyId: payload.companyId,
      source: statusSource,
      status: 'connected',
      lastSyncedAt: new Date().toISOString(),
      errorMessage: null,
      unifiedSource,
    });

    logger.info('unified_ingestion_completed', {
      companyId: payload.companyId,
      source: payload.source,
      sourceType: payload.sourceType,
      unifiedSource,
      adapter: adapter.source,
      ingestionRunId: run.id,
      recordsReceived: payload.records.length,
      recordsTransformed: transformedRecords.length,
      recordsProcessed: processed,
      recordsInserted: inserted,
      recordsUpdated: updated,
    });

    return {
      source: payload.source,
      sourceType: payload.sourceType,
      ingestionRunId: run.id,
      adapter: adapter.source,
      recordsReceived: payload.records.length,
      recordsTransformed: transformedRecords.length,
      status: 'completed',
      errors: [],
      unifiedSource,
      loadResult: context.loadResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error('unified_ingestion_failed', {
      companyId: payload.companyId,
      source: payload.source,
      sourceType: payload.sourceType,
      unifiedSource,
      adapter: adapter.source,
      ingestionRunId: run.id,
      recordCount: payload.records.length,
      message,
    });

    try {
      await completeIngestionRun({
        runId: run.id,
        status: 'failed',
        counts: {
          processed: payload.records.length,
          inserted: 0,
          updated: 0,
        },
        errorMessage: message,
      });

      await setDataSourceStatus({
        companyId: payload.companyId,
        source: statusSource,
        status: 'error',
        errorMessage: message,
        unifiedSource,
      });
    } catch (statusError) {
      logger.error('unified_ingestion_failure_status_update_failed', {
        companyId: payload.companyId,
        source: payload.source,
        ingestionRunId: run.id,
        message: statusError instanceof Error ? statusError.message : String(statusError),
      });
    }

    throw new Error(`Unified ingestion failed for ${payload.source}: ${message}`);
  }
}
