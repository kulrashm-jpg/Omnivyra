/**
 * Operational safety guards (Round-5 item 6) — deterministic,
 * read-only, operator-visible health checks. Lightweight; never throws.
 *
 *  - getMigrationReadiness()  : is the additive 20260677 column live?
 *  - getPublishPathHealth()   : guard mode + flag posture
 *  - getQueueHealthSummary()  : wraps queueHealth
 *  - getCreatorFlowIntegrity(): orphan-pending vs scheduled counts
 *  - getOperationalReadinessSummary(): aggregate + structured log
 *
 * Pure observability/diagnostics — changes no state.
 */

import { getQueueHealth } from './queueHealth';
import { logPipelineEvent } from '../../lib/shared/observability';

export interface MigrationReadiness {
  migration: string;
  column: string;
  applied: boolean;
  detail: string;
}

/** Probe whether scheduled_posts.media_storage_refs (20260677) exists. */
export async function getMigrationReadiness(): Promise<MigrationReadiness> {
  const base: MigrationReadiness = {
    migration: '20260677_durable_media_refs',
    column: 'scheduled_posts.media_storage_refs',
    applied: false,
    detail: 'unknown',
  };
  try {
    const { supabase } = await import('../db/supabaseClient');
    const { error } = await supabase
      .from('scheduled_posts')
      .select('media_storage_refs')
      .limit(1);
    if (!error) return { ...base, applied: true, detail: 'column_present' };
    // 42703 = undefined_column → migration not applied (expected pre-apply).
    const code = (error as { code?: string })?.code;
    return {
      ...base,
      applied: code === '42703' ? false : false,
      detail: code === '42703' ? 'column_absent (migration not applied)' : `probe_error:${code ?? 'unknown'}`,
    };
  } catch (e) {
    return { ...base, detail: `probe_crashed:${(e as Error)?.message}` };
  }
}

export interface PublishPathHealth {
  guardMode: string;
  mediaAccessibilityCheck: boolean;
  durableMediaRefs: boolean;
  calendarPendingVisibility: boolean;
}
export function getPublishPathHealth(): PublishPathHealth {
  return {
    guardMode: String(process.env.PUBLISH_GUARD_MODE ?? 'enforce'),
    mediaAccessibilityCheck: String(process.env.PUBLISH_MEDIA_ACCESSIBILITY_CHECK ?? '1') !== '0',
    durableMediaRefs: String(process.env.DURABLE_MEDIA_REFS ?? '0') === '1',
    calendarPendingVisibility: String(process.env.CALENDAR_PENDING_VISIBILITY ?? '1') !== '0',
  };
}

export async function getQueueHealthSummary() {
  return getQueueHealth();
}

export interface CreatorFlowIntegrity {
  pendingCreator: number;
  scheduledLinked: number;
  ok: boolean;
  detail: string;
}
export async function getCreatorFlowIntegrity(): Promise<CreatorFlowIntegrity> {
  try {
    const { supabase } = await import('../db/supabaseClient');
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { count: pendingCreator } = await supabase
      .from('daily_content_plans')
      .select('id', { count: 'exact', head: true })
      .is('scheduled_post_id', null)
      .in('content_status', ['awaiting_media_upload', 'upload_failed', 'guidance_ready'])
      .lt('updated_at', cutoff);
    const { count: scheduledLinked } = await supabase
      .from('daily_content_plans')
      .select('id', { count: 'exact', head: true })
      .not('scheduled_post_id', 'is', null);
    const p = pendingCreator ?? 0;
    return {
      pendingCreator: p,
      scheduledLinked: scheduledLinked ?? 0,
      ok: p === 0,
      detail: p === 0 ? 'no_stale_pending' : `${p} pending creator rows stale >14d`,
    };
  } catch (e) {
    return { pendingCreator: -1, scheduledLinked: -1, ok: false, detail: `probe_error:${(e as Error)?.message}` };
  }
}

export async function getOperationalReadinessSummary() {
  const [migration, queue, creator] = await Promise.all([
    getMigrationReadiness(),
    getQueueHealthSummary(),
    getCreatorFlowIntegrity(),
  ]);
  const publish = getPublishPathHealth();
  const summary = { migration, publish, queue, creator };
  logPipelineEvent('publish.health', queue.operational && creator.ok ? 'info' : 'warn', {
    migration_applied: migration.applied,
    guard_mode: publish.guardMode,
    durable_media: publish.durableMediaRefs,
    queue_ok: queue.operational,
    creator_ok: creator.ok,
    stale_pending: creator.pendingCreator,
  }, { dedupeKey: 'op_readiness', throttleMs: 300_000 });
  return summary;
}
