/**
 * POST /api/cron/sweep-stuck-publishing
 *
 * G13 — recovers rows stranded in `status='publishing'`.
 *
 * A row enters 'publishing' inside the thread orchestrator (or any future
 * code path that uses the 'publishing' intermediate state) BEFORE the
 * platform call. On normal completion the row transitions to 'published'
 * or 'failed' within seconds. If the worker crashes between the transition
 * and the terminal write, the row is stranded — the cron's
 * `status='scheduled'` filter ignores it, the orchestrator's
 * `publishing → publishing` transition is invalid (so a future orchestrator
 * run on the same row would throw), and nothing automatically reaps it.
 *
 * This endpoint finds rows that have been 'publishing' for longer than
 * STUCK_PUBLISHING_THRESHOLD_MS and transitions them to 'failed' with a
 * marker error message. The state machine permits 'publishing → failed', so
 * this is a legal terminal transition. Operators can then resume affected
 * threads via the resume endpoint, which transitions 'failed → publishing'
 * and replays through the orchestrator (skipping already-published siblings).
 *
 * We do NOT auto-resume here. A row stuck in 'publishing' may have a
 * platform-side post that the orchestrator never recorded (split-brain).
 * Flipping back to 'scheduled' would risk a duplicate publish; flipping to
 * 'failed' parks the row and forces the operator to acknowledge the
 * recovery path. The orchestrator's per-row platform_post_id idempotency
 * still protects the resumed run from double-publishing the same node.
 *
 * Protected by CRON_SECRET. Idempotent: re-running scans for any rows that
 * have since become stuck again.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

const DEFAULT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const BATCH_SIZE = 100;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/sweep-stuck-publishing] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const thresholdMs = (() => {
    const raw = process.env.STUCK_PUBLISHING_THRESHOLD_MS;
    if (!raw) return DEFAULT_THRESHOLD_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_MS;
  })();

  const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();

  const results = {
    scanned: 0,
    swept: 0,
    skipped: 0,
    errors: [] as string[],
    threshold_ms: thresholdMs,
    cutoff: cutoffIso,
  };

  try {
    const { data: stuck, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, platform, parent_post_id, is_thread_start, updated_at')
      .eq('status', 'publishing')
      .lt('updated_at', cutoffIso)
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!stuck?.length) {
      return res.status(200).json({ ...results, message: 'No stuck publishing rows' });
    }

    results.scanned = stuck.length;

    for (const row of stuck as Array<{ id: string; updated_at: string; is_thread_start: boolean | null; parent_post_id: string | null }>) {
      // CAS-style guard: only transition rows still at 'publishing'. A
      // concurrent orchestrator run that just finished would have already
      // flipped the row to 'published'/'failed'; we must not overwrite.
      const { data: updated, error: updateErr } = await supabase
        .from('scheduled_posts')
        .update({
          status: 'failed',
          error_message: `Stuck in publishing state for >= ${Math.round(thresholdMs / 1000)}s — swept`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'publishing')
        .select('id');

      if (updateErr) {
        results.errors.push(`[${row.id}] update failed: ${updateErr.message}`);
        continue;
      }

      if (Array.isArray(updated) && updated.length > 0) {
        results.swept++;
      } else {
        results.skipped++;
      }
    }

    console.log('[cron/sweep-stuck-publishing]', results);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('[cron/sweep-stuck-publishing] fatal:', err?.message);
    return res.status(500).json({ error: err?.message, partial: results });
  }
}
