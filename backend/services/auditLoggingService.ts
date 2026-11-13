import { ownedDbTable } from '../db/writeOwner';
/**
 * Audit Logging Service
 *
 * Tracks all data access operations for compliance and security.
 * Logs WHO accessed WHAT data and WHEN (with context).
 *
 * Usage:
 *   import { logAuditEvent } from '@/backend/services/auditLoggingService';
 *   await logAuditEvent({
 *     operation: 'SELECT',
 *     table: 'campaigns',
 *     companyId: '<company uuid>',
 *     userId: '<user uuid>',
 *     recordIds: ['<campaign uuid>'],
 *     success: true,
 *   });
 */

import { supabase } from '../db/supabaseClient';
import { config } from '../../config';
import { logger } from './logger';
import { recordRawCounter } from '../observability';

export type AuditOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';

export interface AuditEvent {
  operation: AuditOperation;
  table: string;
  companyId: string;
  userId: string;
  recordIds?: string[]; // IDs of affected records
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface StoredAuditLog {
  id?: string;
  operation: AuditOperation;
  table_name: string;
  company_id: string | null;
  user_id: string | null;
  record_ids?: string[] | null;
  success: boolean;
  error_message?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

/**
 * AUDIT-WRITER FIX (e9 BLOCKING, 2026-11-13; C86: this writer had NEVER landed a row).
 * Callers pass non-UUID strings ('SYSTEM', 'unknown', '', 'system:dispatch-recovery', ...) into the uuid columns
 * company_id / user_id / record_ids. Postgres rejects the WHOLE multi-row insert (22P02), the batch was requeued
 * with the bad row in it, and the error was only console-printed - so after a process's first bad event, nothing it
 * logged ever landed. Three layers, each tested:
 *   1. VALUES: a non-UUID id is stored as NULL in its uuid column and the raw value is kept in metadata
 *      (`raw_company_id` / `raw_user_id` / `raw_record_ids`), so nothing is lost and the row is valid.
 *   2. ISOLATION: a failed batch is retried ROW BY ROW, so one bad row can never sink the others.
 *   3. BOUND + DEAD LETTER: a row that fails on its own is dead-lettered at once when the error is a data error
 *      (SQLSTATE class 22 / 23 - retrying cannot help) and after MAX_ROW_ATTEMPTS otherwise. A dead-lettered row is
 *      written to the structured log (`audit_log_dead_letter`, Loki keeps it) and counted - never requeued forever.
 * Every write error is SURFACED: logger.error plus `audit_log_write_failed{stage}`; dead letters count
 * `audit_log_dead_lettered{reason}` (bounded labels only).
 * PRECONDITION (05): the dead letter is a log line, so it is DURABLE only once log ingestion (Loki / Grafana) is
 * live - until then (C54: no metrics/log backend in prod) a dead letter is local-only and may rotate away. The counter
 * is what keeps the log-only choice honest: a real volume before ingestion lands brings a DB dead-letter table back.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ROW_ATTEMPTS = 3;

type QueuedAuditLog = StoredAuditLog & { _attempts?: number };

function uuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

/** Column-correct values: uuid columns get a UUID or NULL; any non-UUID raw value is preserved in metadata. */
export function sanitizeAuditRow(row: StoredAuditLog): StoredAuditLog {
  const extra: Record<string, unknown> = {};
  const companyId = uuidOrNull(row.company_id);
  if (companyId === null && row.company_id != null && row.company_id !== '') extra.raw_company_id = String(row.company_id);
  const userId = uuidOrNull(row.user_id);
  if (userId === null && row.user_id != null && row.user_id !== '') extra.raw_user_id = String(row.user_id);
  let recordIds: string[] | null = null;
  if (Array.isArray(row.record_ids)) {
    const good = row.record_ids.filter((r) => uuidOrNull(r) !== null);
    const bad = row.record_ids.filter((r) => uuidOrNull(r) === null).map(String);
    recordIds = good.length ? good : null;
    if (bad.length) extra.raw_record_ids = bad.slice(0, 50);
  }
  return {
    ...row,
    company_id: companyId,
    user_id: userId,
    record_ids: recordIds,
    metadata: Object.keys(extra).length ? { ...(row.metadata ?? {}), ...extra } : (row.metadata ?? null),
  };
}

function isDataError(code: unknown): boolean {
  return typeof code === 'string' && /^2[23]/.test(code);
}

function deadLetter(row: QueuedAuditLog, reason: 'data_error' | 'retry_exhausted', err: { message?: string; code?: string }): void {
  const { _attempts, ...stored } = row;
  logger.error('audit_log_dead_letter', {
    reason, attempts: _attempts ?? 0, code: err.code ?? null, message: err.message ?? null,
    // the row itself, so the event is recoverable from the log store
    operation: stored.operation, table_name: stored.table_name, company_id: stored.company_id, user_id: stored.user_id,
    success: stored.success, timestamp: stored.timestamp, metadata: stored.metadata ?? null,
  });
  try { recordRawCounter('audit_log_dead_lettered', 1, { reason }); } catch { /* metrics never break the writer */ }
}

function surfaceWriteError(stage: 'batch' | 'row', err: { message?: string; code?: string }, count: number): void {
  logger.error('audit_log_write_failed', { stage, count, code: err.code ?? null, message: err.message ?? null });
  try { recordRawCounter('audit_log_write_failed', 1, { stage }); } catch { /* metrics never break the writer */ }
}

// Queue for batching (store up to 50 events, flush every 5s)
const _queue: QueuedAuditLog[] = [];
let _flushTimer: NodeJS.Timeout | null = null;
const MAX_QUEUE = 50;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Log a single audit event
 * Queues for batching to reduce DB load
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  // Skip if audit logging disabled
  if (config.DISABLE_AUDIT_LOGGING === 'true') {
    return;
  }

  const auditLog: StoredAuditLog = sanitizeAuditRow({
    operation: event.operation,
    table_name: event.table,
    company_id: event.companyId,
    user_id: event.userId,
    record_ids: event.recordIds,
    success: event.success,
    error_message: event.errorMessage ?? null,
    duration_ms: event.durationMs ?? null,
    metadata: event.metadata ?? null,
    timestamp: new Date().toISOString(),
  });

  _queue.push(auditLog);

  // Flush if queue is full
  if (_queue.length >= MAX_QUEUE) {
    await flushAuditQueue();
  } else if (!_flushTimer) {
    // Start timer if not already running
    _flushTimer = setTimeout(() => flushAuditQueue(), FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush queued audit logs to database
 * Called automatically or manually when needed
 */
export async function flushAuditQueue(): Promise<void> {
  if (_queue.length === 0) {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    return;
  }

  const toInsert = [..._queue];
  _queue.length = 0; // Clear queue immediately

  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }

  // Insert in batches; a failed batch falls back to ROW-BY-ROW so one bad row cannot sink the others.
  const BATCH_SIZE = 50;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    let batchErr: { message?: string; code?: string } | null = null;
    try {
      const { error } = await ownedDbTable('audit_logs').insert(batch.map(({ _attempts, ...r }) => r));
      batchErr = error ?? null;
    } catch (err) {
      batchErr = { message: err instanceof Error ? err.message : String(err) };
    }
    if (!batchErr) continue;
    surfaceWriteError('batch', batchErr, batch.length);
    for (const row of batch) {
      let rowErr: { message?: string; code?: string } | null = null;
      try {
        const { _attempts, ...stored } = row;
        const { error } = await ownedDbTable('audit_logs').insert(stored);
        rowErr = error ?? null;
      } catch (err) {
        rowErr = { message: err instanceof Error ? err.message : String(err) };
      }
      if (!rowErr) continue;
      surfaceWriteError('row', rowErr, 1);
      row._attempts = (row._attempts ?? 0) + 1;
      if (isDataError(rowErr.code)) deadLetter(row, 'data_error', rowErr);
      else if (row._attempts >= MAX_ROW_ATTEMPTS) deadLetter(row, 'retry_exhausted', rowErr);
      else _queue.push(row); // transient: retried on a later flush, at most MAX_ROW_ATTEMPTS times
    }
  }
  // A transient row requeued above must not wait for the next event to arrive - schedule its retry.
  if (_queue.length > 0 && !_flushTimer) {
    _flushTimer = setTimeout(() => { void flushAuditQueue(); }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Query audit logs by company
 * For compliance and security investigations
 */
export async function getAuditLogs(
  companyId: string,
  options?: {
    userId?: string;
    table?: string;
    operation?: AuditOperation;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }
): Promise<StoredAuditLog[]> {
  let query = ownedDbTable('audit_logs')
    .select('*')
    .eq('company_id', companyId);

  // Apply optional filters
  if (options?.userId) {
    query = query.eq('user_id', options.userId);
  }
  if (options?.table) {
    query = query.eq('table_name', options.table);
  }
  if (options?.operation) {
    query = query.eq('operation', options.operation);
  }
  if (options?.startDate) {
    query = query.gte('timestamp', options.startDate.toISOString());
  }
  if (options?.endDate) {
    query = query.lte('timestamp', options.endDate.toISOString());
  }

  // Default to last 30 days if no date range specified
  if (!options?.startDate) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    query = query.gte('timestamp', thirtyDaysAgo.toISOString());
  }

  query = query
    .order('timestamp', { ascending: false })
    .limit(options?.limit ?? 100);

  const { data, error } = await query;

  if (error) {
    console.error('[auditLogging] Failed to query audit logs:', error);
    return [];
  }

  return data || [];
}

/**
 * Detect suspicious access patterns
 * Returns flags for manual review
 */
export async function detectAnomalousAccess(
  companyId: string,
  lookbackMinutes: number = 60
): Promise<{ flagged: boolean; reason?: string; details: Record<string, unknown> }> {
  const now = new Date();
  const since = new Date(now.getTime() - lookbackMinutes * 60 * 1000);

  const logs = await getAuditLogs(companyId, {
    startDate: since,
    endDate: now,
    limit: 1000,
  });

  const details: Record<string, unknown> = {
    period: `${lookbackMinutes} minutes`,
    totalOperations: logs.length,
  };

  // Flag: Multiple failed access attempts
  const failures = logs.filter((l) => !l.success);
  if (failures.length > 10) {
    details.failureCount = failures.length;
    return { flagged: true, reason: 'High failure rate', details };
  }

  // Flag: Unusual user activity (accessing many records in short time)
  const userOps = new Map<string, number>();
  logs.forEach((l) => {
    userOps.set(l.user_id, (userOps.get(l.user_id) ?? 0) + 1);
  });

  const anomalousUser = Array.from(userOps.entries()).find(([_, count]) => count > 100);
  if (anomalousUser) {
    details.suspiciousUser = anomalousUser[0];
    details.operationCount = anomalousUser[1];
    return { flagged: true, reason: 'Unusually high operation count by single user', details };
  }

  // Flag: Bulk delete operations
  const deletes = logs.filter((l) => l.operation === 'DELETE');
  if (deletes.length > 5) {
    details.deleteCount = deletes.length;
    return { flagged: true, reason: 'Multiple delete operations detected', details };
  }

  return { flagged: false, details };
}

/**
 * Ensure audit logs table exists (one-time initialization)
 * Run during startup verification
 */
export async function ensureAuditLogsTable(): Promise<void> {
  try {
    // Test query to see if table exists
    const { error } = await ownedDbTable('audit_logs')
      .select('id')
      .limit(1);

    if (error) {
      console.warn('[auditLogging] audit_logs table may not exist:', error.message);
      console.warn('[auditLogging] Create it with: CREATE TABLE audit_logs (id uuid, operation text, table_name text, company_id uuid, user_id uuid, record_ids uuid[], success boolean, error_message text, duration_ms integer, metadata jsonb, timestamp timestamptz)');
    }
  } catch (err) {
    console.error('[auditLogging] Failed to verify audit_logs table:', err);
  }
}
