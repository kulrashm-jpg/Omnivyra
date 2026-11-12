/**
 * Reconciliation snapshot storage.
 *
 * Stores per-row reconciliation history in the existing
 * `scheduled_posts.creator_attachment_metadata` JSONB column under the
 * `reconciliation_snapshots` sub-key. Additive — no new column, no schema
 * change. Bounded to the most recent N entries so a long-lived row doesn't
 * accumulate unbounded history.
 *
 * Read/write is best-effort: failures are logged but never propagate to the
 * caller. Reconciliation telemetry is the source of truth; snapshots are a
 * forensic convenience.
 */

import { supabase } from '../../db/supabaseClient';
import type { ReconciliationSnapshot } from './types';

const MAX_SNAPSHOTS_PER_ROW = 25;

export async function loadReconciliationSnapshots(
  rowId: string,
): Promise<ReconciliationSnapshot[]> {
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('creator_attachment_metadata')
      .eq('id', rowId)
      .maybeSingle();
    if (error || !data) return [];
    const metadata = (data as { creator_attachment_metadata?: unknown }).creator_attachment_metadata;
    if (!metadata || typeof metadata !== 'object') return [];
    const list = (metadata as Record<string, unknown>).reconciliation_snapshots;
    return Array.isArray(list) ? (list as ReconciliationSnapshot[]) : [];
  } catch {
    return [];
  }
}

/** Optimistic attempts before an append gives up (each re-reads the row). */
const APPEND_ATTEMPTS = 3;

/**
 * Append one snapshot (best-effort, logged, never thrown).
 *
 * CLASS-2 (e9 sweep): this was a blind read-modify-write of the WHOLE JSONB value. Two concurrent
 * appends (the reconcile cron and a manual reconcile) lost one snapshot; a writer of another sub-key
 * between the read and the write (the LinkedIn URN cache) was erased. Worse, an UNREAD failed read
 * produced `{}` and the write then replaced the entire column with just the snapshots. Now:
 *   - an unreadable row is not written (nothing is lost);
 *   - the write is a compare-and-set on the updated_at that was read (both writers of this column
 *     set it), row count checked, and retried on a miss;
 *   - a column holding an ARRAY (creator attachments, read as such elsewhere) is never turned into
 *     an object: the snapshot is skipped and logged.
 */
export async function appendReconciliationSnapshot(
  rowId: string,
  snapshot: ReconciliationSnapshot,
): Promise<void> {
  try {
    for (let attempt = 1; attempt <= APPEND_ATTEMPTS; attempt += 1) {
      const { data: row, error: readError } = await supabase
        .from('scheduled_posts')
        .select('creator_attachment_metadata, updated_at')
        .eq('id', rowId)
        .maybeSingle();
      if (readError) {
        console.warn('[reconciliation.snapshots] row unreadable; snapshot not written (nothing overwritten)', { row_id: rowId, error: readError.message });
        return;
      }
      if (!row) return;
      const existing = (row as { creator_attachment_metadata?: unknown }).creator_attachment_metadata;
      if (Array.isArray(existing)) {
        console.warn('[reconciliation.snapshots] creator_attachment_metadata is an array (creator attachments); snapshot skipped so the array is not rewritten as an object', { row_id: rowId });
        return;
      }
      const metadata: Record<string, unknown> = existing && typeof existing === 'object'
        ? { ...(existing as object) }
        : {};
      const prior = Array.isArray(metadata.reconciliation_snapshots)
        ? (metadata.reconciliation_snapshots as ReconciliationSnapshot[])
        : [];
      metadata.reconciliation_snapshots = [...prior, snapshot].slice(-MAX_SNAPSHOTS_PER_ROW);

      const readAt = (row as { updated_at?: string | null }).updated_at ?? null;
      const write = supabase
        .from('scheduled_posts')
        .update({ creator_attachment_metadata: metadata, updated_at: new Date().toISOString() })
        .eq('id', rowId);
      const { data: moved, error: writeError } = await (readAt === null ? write.is('updated_at', null) : write.eq('updated_at', readAt))
        .select('id');
      if (writeError) {
        console.warn('[reconciliation.snapshots] snapshot not written', { row_id: rowId, error: writeError.message });
        return;
      }
      if (Array.isArray(moved) && moved.length === 1) return;
      // The row changed since the read: re-read and re-apply on the current value.
    }
    console.warn('[reconciliation.snapshots] snapshot not written: the row kept changing', { row_id: rowId, attempts: APPEND_ATTEMPTS });
  } catch (err) {
    console.warn('[reconciliation.snapshots] append failed (non-fatal):', (err as Error).message);
  }
}
