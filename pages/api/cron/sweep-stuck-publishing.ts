import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
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
 * STUCK_PUBLISHING_THRESHOLD_MS and transitions them to 'failed': with
 * PUBLISH_NOT_ATTEMPTED when the row still carries a pre-call claim token
 * (no platform call started — and replacing the token fences the holder out of
 * ever starting one), otherwise with PUBLISH_OUTCOME_UNCERTAIN. The age only
 * selects candidates; what the row proves decides the label. The state
 * machine permits 'publishing → failed', so this is a legal terminal transition.
 *
 * We do NOT auto-resume here. A row stuck in 'publishing' may have a
 * platform-side post that was never recorded (split-brain), and its
 * platform_post_id is null exactly then — so per-row platform_post_id
 * idempotency does NOT protect a resumed run from publishing it twice. The
 * uncertain code does: the queue worker, thread re-delivery and the operator
 * resume endpoint all refuse to publish such a row (backend/queue/
 * publishOutcome.ts). An operator checks the platform and reconciles the row
 * (POST /api/super-admin/publish/reconcile) — recording the post id if it is
 * live, or marking it not published — and only then retries or resumes.
 *
 * Protected by CRON_SECRET. Idempotent: re-running scans for any rows that
 * have since become stuck again.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import {
  isPreCallClaim,
  PUBLISH_NOT_ATTEMPTED,
  PUBLISH_OUTCOME_UNCERTAIN,
} from '../../../backend/queue/publishOutcome';

const DEFAULT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const BATCH_SIZE = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/sweep-stuck-publishing] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!bearerTokenMatches(req.headers['authorization'], cronSecret)) {
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
      .select('id, platform, parent_post_id, is_thread_start, updated_at, error_code')
      .eq('status', 'publishing')
      .lt('updated_at', cutoffIso)
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!stuck?.length) {
      return res.status(200).json({ ...results, message: 'No stuck publishing rows' });
    }

    results.scanned = stuck.length;

    for (const row of stuck as Array<{ id: string; updated_at: string; is_thread_start: boolean | null; parent_post_id: string | null; error_code: string | null }>) {
      // What the row itself proves (backend/queue/publishOutcome.ts):
      //   PUBLISH_CLAIMED:<token> — claimed by the current protocol and NO
      //     platform call started. Replacing the token fences the holder out
      //     of its marker write, so it can never start one: a plain,
      //     retryable PUBLISH_NOT_ATTEMPTED is safe — by evidence, not by age.
      //   anything else (PUBLISH_CALL_STARTED, or a legacy row with no token)
      //     — a call may have reached the platform: PUBLISH_OUTCOME_UNCERTAIN,
      //     which the worker, the thread orchestrator, publish-now, manual
      //     retry and the blueprint guard all treat as possibly live.
      const preCall = isPreCallClaim({ status: 'publishing', error_code: row.error_code });
      // Compare-and-set on 'publishing' AND the exact error_code read: a
      // holder that recorded its call start (or finished) in between wins, and
      // the row is left for the next sweep to judge on what it then says.
      let sweep = supabase
        .from('scheduled_posts')
        .update({
          status: 'failed',
          error_code: preCall ? PUBLISH_NOT_ATTEMPTED : PUBLISH_OUTCOME_UNCERTAIN,
          error_message: preCall
            ? `Stuck in publishing state for >= ${Math.round(thresholdMs / 1000)}s before any platform call — swept, safe to retry`
            : `Stuck in publishing state for >= ${Math.round(thresholdMs / 1000)}s — swept; the platform call may have succeeded`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'publishing');
      sweep = row.error_code === null || row.error_code === undefined
        ? sweep.is('error_code', null)
        : sweep.eq('error_code', row.error_code);
      const { data: updated, error: updateErr } = await sweep.select('id');

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/sweep-stuck-publishing' });
