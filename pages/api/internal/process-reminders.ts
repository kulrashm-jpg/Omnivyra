import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET|POST /api/internal/process-reminders
 *
 * Internal cron endpoint that drains the domain_reminders queue.
 * Configured to run every 5 minutes via vercel.json.
 *
 * Protection:
 *   - Requires Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set
 *     (matches /api/cron/* convention).
 *   - Returns 401 otherwise.
 *
 * Algorithm:
 *   1. SELECT id, user_id, company_id, final_domain
 *      FROM domain_reminders
 *      WHERE sent = false AND scheduled_at <= now()
 *      LIMIT 50
 *   2. For each row:
 *        - resolve recipient email from auth.users (best-effort)
 *        - re-read company_domains.verification_status
 *        - if status IN ('verified','admin_override') â†’ mark sent=true, skip send
 *        - else â†’ call sendDomainVerificationReminder(); mark sent=true
 *      Each iteration is wrapped in try/catch so a single failure cannot
 *      stop the loop.
 *   3. Cleanup: delete rows where sent=true AND created_at < now() - 7d.
 *
 * Returns a small summary so the cron schedule can be observed via the
 * cron-runner logs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from '../../../backend/services/logger';
import { sendDomainVerificationReminder } from '../../../backend/services/domainReminderService';

const BATCH_SIZE = 50;
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type ReminderRow = {
  id: string;
  user_id: string | null;
  company_id: string | null;
  final_domain: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  // CRON_SECRET protection â€” matches /api/cron/* convention.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
  } else {
    // Fail closed in production â€” never run unauthenticated unless explicitly
    // allowed via env (e.g., local dev).
    if (process.env.NODE_ENV === 'production') {
      logger.error('process_reminders_no_secret_in_production');
      return res.status(401).json({ error: 'CRON_SECRET_NOT_CONFIGURED' });
    }
  }

  const startedAt = Date.now();

  // 1. Pull due batch
  const { data: due, error: selectErr } = await supabase
    .from('domain_reminders')
    .select('id, user_id, company_id, final_domain')
    .eq('sent', false)
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (selectErr) {
    logger.error('process_reminders_select_failed', { message: selectErr.message });
    return res.status(500).json({ error: 'SELECT_FAILED', details: selectErr.message });
  }
  const rows = (due || []) as ReminderRow[];

  let sent = 0;
  let skipped_already_verified = 0;
  let failed = 0;

  // 2. Process each row independently â€” failures NEVER stop the loop.
  for (const row of rows) {
    try {
      // Re-read verification status to skip rows whose domain has since
      // been verified (or admin-overridden) by the user.
      const final = (row.final_domain || '').toLowerCase();
      let status: string | null = null;
      if (final) {
        const { data: domainRow } = await supabase
          .from('company_domains')
          .select('verification_status')
          .eq('final_domain', final)
          .maybeSingle();
        status = (domainRow as any)?.verification_status ?? null;
      }
      if (status === 'verified' || status === 'admin_override') {
        await supabase
          .from('domain_reminders')
          .update({ sent: true })
          .eq('id', row.id);
        skipped_already_verified += 1;
        continue;
      }

      // Resolve recipient email. Best-effort â€” if missing, mark sent=true to
      // prevent re-attempt; log so it's visible.
      let recipientEmail: string | null = null;
      if (row.user_id) {
        const { data: userRow } = await supabase
          .from('users')
          .select('email')
          .eq('id', row.user_id)
          .maybeSingle();
        recipientEmail = (userRow as any)?.email ?? null;
      }
      if (!recipientEmail || !final) {
        logger.warn('process_reminders_skip_missing_recipient', {
          reminder_id: row.id,
          has_email: !!recipientEmail,
          has_domain: !!final,
        });
        await supabase
          .from('domain_reminders')
          .update({ sent: true })
          .eq('id', row.id);
        failed += 1;
        continue;
      }

      await sendDomainVerificationReminder({
        user_email:   recipientEmail,
        final_domain: final,
      });
      // sendDomainVerificationReminder swallows its own errors and logs;
      // we mark sent=true regardless so we never retry. Per spec: no retry.
      await supabase
        .from('domain_reminders')
        .update({ sent: true })
        .eq('id', row.id);
      sent += 1;
    } catch (err) {
      // Last-resort guard â€” should never reach here because all called
      // helpers are themselves try/catch'd. Log + advance.
      failed += 1;
      logger.warn('process_reminders_iteration_threw', {
        reminder_id: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
      // Mark sent so we don't infinite-loop on a poison-pill row. Per spec
      // 'DO NOT stop loop on failure / DO NOT retry'.
      await supabase.from('domain_reminders').update({ sent: true }).eq('id', row.id).then(() => {}, () => {});
    }
  }

  // 3. Cleanup: drop rows that are sent and older than the retention window.
  let cleaned = 0;
  try {
    const cutoff = new Date(Date.now() - CLEANUP_AGE_MS).toISOString();
    const { data: deleted, error: delErr } = await supabase
      .from('domain_reminders')
      .delete()
      .eq('sent', true)
      .lt('created_at', cutoff)
      .select('id');
    if (delErr) {
      logger.warn('process_reminders_cleanup_failed', { message: delErr.message });
    } else {
      cleaned = (deleted || []).length;
    }
  } catch (err) {
    logger.warn('process_reminders_cleanup_threw', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const duration_ms = Date.now() - startedAt;
  logger.info('process_reminders_run', {
    fetched: rows.length,
    sent,
    skipped_already_verified,
    failed,
    cleaned,
    duration_ms,
  });

  // Lightweight alert: a single tick with > 5 failures is an anomalous
  // signal â€” likely SES misconfiguration, Edge Function regression, or DB
  // outage. Emit a structured warn that monitoring can pattern-match.
  if (failed > 5) {
    logger.warn('REMINDER_FAILURE_SPIKE', {
      fetched: rows.length,
      failed,
      sent,
      duration_ms,
    });
  }

  return res.status(200).json({
    fetched: rows.length,
    sent,
    skipped_already_verified,
    failed,
    cleaned,
    duration_ms,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

