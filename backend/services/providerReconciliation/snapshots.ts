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

export async function appendReconciliationSnapshot(
  rowId: string,
  snapshot: ReconciliationSnapshot,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('scheduled_posts')
      .select('creator_attachment_metadata')
      .eq('id', rowId)
      .maybeSingle();
    const existing = (row as { creator_attachment_metadata?: unknown } | null)?.creator_attachment_metadata;
    const metadata: Record<string, unknown> = existing && typeof existing === 'object'
      ? { ...(existing as object) }
      : {};
    const prior = Array.isArray(metadata.reconciliation_snapshots)
      ? (metadata.reconciliation_snapshots as ReconciliationSnapshot[])
      : [];
    const next = [...prior, snapshot].slice(-MAX_SNAPSHOTS_PER_ROW);
    metadata.reconciliation_snapshots = next;
    await supabase
      .from('scheduled_posts')
      .update({ creator_attachment_metadata: metadata, updated_at: new Date().toISOString() })
      .eq('id', rowId);
  } catch (err) {
    console.warn('[reconciliation.snapshots] append failed (non-fatal):', (err as Error).message);
  }
}
