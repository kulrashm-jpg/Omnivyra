/**
 * Intelligence Event Retention Cleanup
 * Deletes intelligence_events older than 180 days to prevent unbounded growth.
 * Uses batched deletes (5000 rows per batch) to avoid long table locks.
 * Resumes from last_processed_created_at to avoid rescanning entire retention range.
 * Run daily via cron.
 */

import { supabase } from '../db/supabaseClient';

const JOB_NAME = 'intelligence_event_cleanup';
const RETENTION_DAYS = 180;
const BATCH_SIZE = 5000;
/** Max ids per .in() call to avoid URI length limits */
const DELETE_CHUNK_SIZE = 100;
/** Max runtime 5 minutes; stop loop to prevent excessive run time */
const MAX_CLEANUP_RUNTIME_MS = 300000;

export type IntelligenceEventCleanupResult = {
  events_deleted: number;
  batches_processed: number;
  runtime_ms: number;
  cutoff_timestamp: string;
  errors: string[];
};

type ProgressCursor = { last_processed_created_at: string; last_processed_id: string };

async function getLastProcessedCursor(): Promise<ProgressCursor | null> {
  const { data, error } = await supabase
    .from('intelligence_cleanup_progress')
    .select('last_processed_created_at, last_processed_id')
    .eq('job_name', JOB_NAME)
    .maybeSingle();
  if (error || !data?.last_processed_created_at || !data?.last_processed_id) return null;
  return {
    last_processed_created_at: data.last_processed_created_at as string,
    last_processed_id: data.last_processed_id as string,
  };
}

async function updateProgress(cursor: ProgressCursor): Promise<void> {
  await supabase.from('intelligence_cleanup_progress').upsert(
    {
      job_name: JOB_NAME,
      last_processed_created_at: cursor.last_processed_created_at,
      last_processed_id: cursor.last_processed_id,
    },
    { onConflict: 'job_name' }
  );
}

/**
 * Delete intelligence events older than 180 days in batches of 5000.
 * Resumes from (last_processed_created_at, last_processed_id); updates both after each batch.
 * Uses composite cursor to prevent skipping events with identical created_at.
 */
export async function runIntelligenceEventCleanup(): Promise<IntelligenceEventCleanupResult> {
  const errors: string[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffTimestamp = cutoff.toISOString();
  let totalDeleted = 0;
  let batchesProcessed = 0;
  const startTime = Date.now();
  let cursor: ProgressCursor | null = await getLastProcessedCursor();

  try {
    for (;;) {
      if (Date.now() - startTime > MAX_CLEANUP_RUNTIME_MS) break;

      let query = supabase
        .from('intelligence_events')
        .select('id, created_at')
        .lt('created_at', cutoffTimestamp)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      if (cursor) {
        const createdAt = cursor.last_processed_created_at.replace(/"/g, '');
        const idVal = cursor.last_processed_id.replace(/"/g, '');
        query = query.or(
          `created_at.gt."${createdAt}",and(created_at.eq."${createdAt}",id.gt."${idVal}")`
        );
      }

      const { data: rowsToDelete, error: selectError } = await query;

      if (selectError) {
        errors.push(selectError.message);
        console.error('[intelligenceEventCleanup] select error', selectError);
        break;
      }

      const rows = rowsToDelete ?? [];
      const ids = rows.map((r) => r?.id).filter(Boolean) as string[];
      if (ids.length === 0) break;

      const lastRow = rows[rows.length - 1] as { created_at?: string; id?: string };
      const batchLastCreatedAt = lastRow?.created_at;
      const batchLastId = lastRow?.id;
      if (!batchLastCreatedAt || !batchLastId) break;

      batchesProcessed += 1;
      let deleteFailed = false;
      for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
        const { error: deleteError } = await supabase
          .from('intelligence_events')
          .delete()
          .in('id', chunk);

        if (deleteError) {
          errors.push(deleteError.message);
          console.error('[intelligenceEventCleanup] delete error', deleteError);
          deleteFailed = true;
          break;
        }
        totalDeleted += chunk.length;
      }
      if (deleteFailed) break;

      cursor = {
        last_processed_created_at: batchLastCreatedAt,
        last_processed_id: batchLastId,
      };
      await updateProgress(cursor);
      if (ids.length < BATCH_SIZE) break;
    }

    const runtime_ms = Date.now() - startTime;
    const result: IntelligenceEventCleanupResult = {
      events_deleted: totalDeleted,
      batches_processed: batchesProcessed,
      runtime_ms,
      cutoff_timestamp: cutoffTimestamp,
      errors,
    };
    console.log(
      `[intelligenceEventCleanup] metrics: events_deleted=${result.events_deleted} batches_processed=${result.batches_processed} runtime_ms=${result.runtime_ms} cutoff_timestamp=${result.cutoff_timestamp}`
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error('[intelligenceEventCleanup]', err);
    const runtime_ms = Date.now() - startTime;
    return {
      events_deleted: totalDeleted,
      batches_processed: batchesProcessed,
      runtime_ms,
      cutoff_timestamp: cutoffTimestamp,
      errors,
    };
  }
}
