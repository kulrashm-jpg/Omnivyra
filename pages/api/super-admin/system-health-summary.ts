/**
 * GET /api/super-admin/system-health-summary?windowHours=24
 *
 * Single-pane-of-glass health snapshot computed from existing DB state
 * (scheduled_posts + queue_jobs + creator_attachment_metadata). Read-only.
 * Bounded windows. No external observability backend required.
 *
 * This is the operational endpoint for soak observation when a real
 * telemetry backend (DataDog / Grafana / etc.) isn't yet wired. For
 * production-grade dashboards, route the `logPipelineEvent` / `logger.*`
 * stream into your backend; this endpoint is the in-app safety net.
 *
 * Domains aggregated:
 *   - publish_status: status counts on scheduled_posts in the window
 *   - thread_orchestration: thread-publish outcomes (root rows with
 *     is_thread_start=true; success = all children published)
 *   - queue_jobs: status counts on queue_jobs (publish queue health)
 *   - stuck_publishing: rows in 'publishing' state older than the sweeper
 *     threshold — should be ~0 in steady state, spike = orchestrator crash
 *   - linkedin_media: rows targeting linkedin that carry media + how many
 *     have a cached LinkedIn URN (provider asset cache coverage)
 *
 * Read-only. No row mutation. Auth: requireCapability(CONTENT_PUBLISH).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 720;
const STUCK_PUBLISHING_AGE_MS = 10 * 60 * 1000; // mirrors sweep-stuck-publishing default

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:system-health-summary', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator reads system-health summary',
  });
  if (guard.ok !== true) return;

  const windowHoursRaw = Number(req.query.windowHours);
  const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0
    ? Math.min(MAX_WINDOW_HOURS, windowHoursRaw)
    : DEFAULT_WINDOW_HOURS;
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const stuckCutoffIso = new Date(Date.now() - STUCK_PUBLISHING_AGE_MS).toISOString();

  try {
    const [
      publishStatus,
      threadOutcomes,
      queueStatus,
      stuckPublishing,
      linkedinMedia,
    ] = await Promise.all([
      aggregatePublishStatus(sinceIso),
      aggregateThreadOutcomes(sinceIso),
      aggregateQueueStatus(sinceIso),
      countStuckPublishing(stuckCutoffIso),
      aggregateLinkedinMedia(sinceIso),
    ]);

    return res.status(200).json({
      window: { hours: windowHours, since_iso: sinceIso, stuck_cutoff_iso: stuckCutoffIso },
      publish_status: publishStatus,
      thread_orchestration: threadOutcomes,
      queue_jobs: queueStatus,
      stuck_publishing: stuckPublishing,
      linkedin_media: linkedinMedia,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'system health summary failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregators (single SELECT each; bounded row count)
// ─────────────────────────────────────────────────────────────────────────

async function aggregatePublishStatus(sinceIso: string) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('status, platform')
    .gt('updated_at', sinceIso);
  if (error) throw new Error(`publish_status: ${error.message}`);
  const rows = (data ?? []) as Array<{ status: string; platform: string }>;
  const byStatus: Record<string, number> = {};
  const byPlatform: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const p = byPlatform[r.platform] ?? (byPlatform[r.platform] = {});
    p[r.status] = (p[r.status] ?? 0) + 1;
  }
  const total = rows.length;
  const published = byStatus.published ?? 0;
  const failed = byStatus.failed ?? 0;
  return {
    total,
    by_status: byStatus,
    by_platform: byPlatform,
    publish_success_rate: total > 0 ? round3((published + failed) > 0 ? published / (published + failed) : 0) : null,
  };
}

async function aggregateThreadOutcomes(sinceIso: string) {
  const { data: roots, error } = await supabase
    .from('scheduled_posts')
    .select('id, status')
    .eq('is_thread_start', true)
    .gt('updated_at', sinceIso);
  if (error) throw new Error(`thread_orchestration: ${error.message}`);
  const list = (roots ?? []) as Array<{ id: string; status: string }>;
  const counts: Record<string, number> = {};
  for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const total = list.length;
  const published = counts.published ?? 0;
  const failed = counts.failed ?? 0;
  return {
    total_thread_roots: total,
    by_root_status: counts,
    thread_completion_rate: (published + failed) > 0 ? round3(published / (published + failed)) : null,
  };
}

async function aggregateQueueStatus(sinceIso: string) {
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('status, attempts, error_code')
    .gt('updated_at', sinceIso);
  if (error) throw new Error(`queue_jobs: ${error.message}`);
  const rows = (data ?? []) as Array<{ status: string; attempts: number | null; error_code: string | null }>;
  const byStatus: Record<string, number> = {};
  const byErrorCode: Record<string, number> = {};
  let attemptsSum = 0;
  let attemptsCount = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (typeof r.attempts === 'number' && Number.isFinite(r.attempts)) {
      attemptsSum += r.attempts;
      attemptsCount++;
    }
    if (r.error_code) byErrorCode[r.error_code] = (byErrorCode[r.error_code] ?? 0) + 1;
  }
  return {
    total: rows.length,
    by_status: byStatus,
    by_error_code: byErrorCode,
    avg_attempts: attemptsCount > 0 ? round3(attemptsSum / attemptsCount) : null,
  };
}

async function countStuckPublishing(cutoffIso: string) {
  const { count, error } = await supabase
    .from('scheduled_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'publishing')
    .lt('updated_at', cutoffIso);
  if (error) throw new Error(`stuck_publishing: ${error.message}`);
  return { count: count ?? 0, cutoff_iso: cutoffIso };
}

async function aggregateLinkedinMedia(sinceIso: string) {
  // Rows targeting LinkedIn with at least one media url in window.
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, media_urls, creator_attachment_metadata, status')
    .eq('platform', 'linkedin')
    .gt('updated_at', sinceIso);
  if (error) throw new Error(`linkedin_media: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: string;
    media_urls: string[] | null;
    creator_attachment_metadata: unknown;
    status: string;
  }>;
  let rowsTotal = 0;
  let rowsWithMedia = 0;
  let rowsWithCachedUrn = 0;
  let publishedWithMedia = 0;
  let failedWithMedia = 0;
  for (const r of rows) {
    rowsTotal++;
    const hasMedia = Array.isArray(r.media_urls) && r.media_urls.length > 0;
    if (!hasMedia) continue;
    rowsWithMedia++;
    if (r.status === 'published') publishedWithMedia++;
    if (r.status === 'failed') failedWithMedia++;
    const md = r.creator_attachment_metadata as Record<string, unknown> | null;
    const providerCache = md && typeof md === 'object' ? (md as Record<string, unknown>).provider_asset_urns : null;
    const linkedinCache = providerCache && typeof providerCache === 'object'
      ? (providerCache as Record<string, unknown>).linkedin
      : null;
    const cachedCount = linkedinCache && typeof linkedinCache === 'object' ? Object.keys(linkedinCache as object).length : 0;
    if (cachedCount > 0) rowsWithCachedUrn++;
  }
  return {
    total_linkedin_rows: rowsTotal,
    rows_with_media: rowsWithMedia,
    rows_with_cached_urn: rowsWithCachedUrn,
    media_cache_coverage_rate: rowsWithMedia > 0 ? round3(rowsWithCachedUrn / rowsWithMedia) : null,
    published_with_media: publishedWithMedia,
    failed_with_media: failedWithMedia,
    linkedin_media_success_rate: (publishedWithMedia + failedWithMedia) > 0
      ? round3(publishedWithMedia / (publishedWithMedia + failedWithMedia))
      : null,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
