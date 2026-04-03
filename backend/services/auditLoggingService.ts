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
 *     companyId: 'company-123',
 *     userId: 'user-456',
 *     recordIds: ['campaign-1', 'campaign-2'],
 *     success: true,
 *   });
 */

import { supabase } from '../db/supabaseClient';
import { config } from '../../config';

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
  company_id: string;
  user_id: string;
  record_ids?: string[];
  success: boolean;
  error_message?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

// Queue for batching (store up to 50 events, flush every 5s)
const _queue: StoredAuditLog[] = [];
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

  const auditLog: StoredAuditLog = {
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
  };

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

  try {
    // Insert in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('audit_logs')
        .insert(batch);

      if (error) {
        console.error('[auditLogging] Failed to flush batch:', {
          count: batch.length,
          error: error.message,
        });
        // Put failed records back in queue for retry
        _queue.push(...batch);
      }
    }
  } catch (err) {
    console.error('[auditLogging] Unexpected error during flush:', err);
    // Put records back in queue
    _queue.push(...toInsert);
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
  let query = supabase
    .from('audit_logs')
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
    const { error } = await supabase
      .from('audit_logs')
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
