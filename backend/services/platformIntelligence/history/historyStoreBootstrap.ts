/**
 * History store bootstrap (Phase 39). Activates the durable store via setSnapshotStore() ONLY
 * when PLATFORM_HISTORY_DURABLE=1 (and the migration is applied). Default stays in-memory so
 * nothing breaks pre-migration. Idempotent. No repository/interface change.
 */
import { setSnapshotStore } from './platformSnapshotRepository';
import { SupabaseSnapshotStore } from './supabaseSnapshotStore';

let activated = false;

/** Wire the durable Supabase store when enabled. Safe to call repeatedly. */
export function ensureHistoryStore(): void {
  if (activated) return;
  if (process.env.PLATFORM_HISTORY_DURABLE === '1') {
    setSnapshotStore(new SupabaseSnapshotStore());
    activated = true;
  }
}
