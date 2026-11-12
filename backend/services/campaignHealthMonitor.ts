import { ownedDbTable } from '../db/writeOwner';
/**
 * Campaign Health Monitor — runs every 6 hours via cron.
 *
 * Evaluates live engagement_rate trends from performance_feedback.
 * Marks campaigns AT_RISK → CRITICAL and RECOMMENDS action when thresholds are breached.
 *
 * SUGGEST-ONLY (owner ruling, e9, 2026-11-12): the monitor NEVER writes to a customer's campaign. It
 * used to lower posting_frequency on AT_RISK and set status 'paused' after two CRITICAL runs (and then
 * generate a recovery campaign whose notification said "was paused"). Now:
 *   AT_RISK            : an 'optimize' decision records the PROPOSED lower frequency (not applied)
 *   CRITICAL x N (once): a 'pause' decision + a notification "we recommend pausing" (nothing changed)
 *
 * Thresholds:
 *   AT_RISK  : engagement_rate < 0.01 for 2 consecutive evaluation windows
 *   CRITICAL : AT_RISK persists OR engagement drops > 40% vs previous window
 *   PAUSE RECOMMENDED: the run on which CRITICAL first reaches critical_runs_for_pause
 *
 * Stores status in campaign_health_reports (reuses existing table).
 */

import { supabase } from '../db/supabaseClient';
import { getDecisionConfig } from './configService';
import { tryAutoScale } from './campaignAutoScalingService';
import { logDecision } from './autonomousDecisionLogger';

/** 'PAUSED' is kept for reports written before the suggest-only change; the monitor no longer sets it. */
export type CampaignHealthStatus = 'HEALTHY' | 'AT_RISK' | 'CRITICAL' | 'PAUSED';

export type CampaignHealthMonitorResult = {
  campaigns_evaluated: number;
  /** A pause was RECOMMENDED (decision + notification). The campaign was not changed. */
  pause_recommended: string[];
  critical: string[];
  at_risk: string[];
  /** A lower posting frequency was RECOMMENDED (decision). The campaign was not changed. */
  optimization_recommended: string[];
  scaled: string[];
  errors: string[];
};

type WindowRow = {
  campaign_id: string;
  avg_rate: number;
  window_start: string;
};

/** Retrieve the two most recent 6-hour engagement windows for all active campaigns. */
async function getRecentEngagementWindows(): Promise<Map<string, WindowRow[]>> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // last 48 h
  const { data, error } = await ownedDbTable('performance_feedback')
    .select('campaign_id, engagement_rate, collected_at')
    .gte('collected_at', since)
    .order('collected_at', { ascending: true });

  // unread-error pkg 2: a failed read is not "no engagement data" (which silently skipped every
  // campaign). The run fails loudly instead.
  if (error) throw new Error(`engagement windows unreadable: ${error.message}`);
  if (!data) return new Map();

  // Bucket rows into 6-hour windows per campaign
  const windowsByCampaign = new Map<string, WindowRow[]>();
  for (const row of data as Array<{ campaign_id: string; engagement_rate: number; collected_at: string }>) {
    const cid = row.campaign_id;
    const ts = new Date(row.collected_at).getTime();
    const windowStart = new Date(Math.floor(ts / (6 * 3_600_000)) * 6 * 3_600_000).toISOString();

    if (!windowsByCampaign.has(cid)) windowsByCampaign.set(cid, []);
    const windows = windowsByCampaign.get(cid)!;
    let w = windows.find((x) => x.window_start === windowStart);
    if (!w) {
      w = { campaign_id: cid, avg_rate: 0, window_start: windowStart };
      windows.push(w);
    }
    // Running mean update
    const existing = windows.filter((x) => x.window_start === windowStart);
    w.avg_rate = (w.avg_rate * (existing.length - 1) + row.engagement_rate) / existing.length;
  }

  return windowsByCampaign;
}

/** Load previous health report status for a campaign. */
async function getPreviousHealthStatus(campaignId: string): Promise<{ status: CampaignHealthStatus; critical_run_count: number } | null> {
  const { data, error } = await ownedDbTable('campaign_health_reports')
    .select('report')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed read is not "previously HEALTHY": it would reset the AT_RISK -> CRITICAL -> pause chain
  // and write a report on that false basis (unread-error pkg 2).
  if (error) throw new Error(`previous health report unreadable: ${error.message}`);

  if (!data?.report) return null;
  const r = data.report as Record<string, unknown>;
  return {
    status: (r.health_status as CampaignHealthStatus) ?? 'HEALTHY',
    critical_run_count: Number(r.critical_run_count ?? 0),
  };
}

/**
 * RECOMMEND pausing a CRITICAL campaign: a 'pause' decision and an in-app notification. Nothing is
 * changed (suggest-only). Returns why the notification failed, or null, so the run reports a failure
 * instead of swallowing it (unread-error pkg 2).
 */
async function recommendPause(campaignId: string, reason: string, companyId: string, criticalRunCount: number): Promise<string | null> {
  await logDecision({
    company_id:    companyId,
    campaign_id:   campaignId,
    decision_type: 'pause',
    reason:        `CRITICAL: ${reason}. Pausing is RECOMMENDED; the campaign was not changed.`,
    metrics_used:  { critical_run_count: criticalRunCount },
    outcome:       'RECOMMENDED (not applied): pause this campaign',
  });
  try {
    // Resolve company_id for the notification
    const { data: campaign, error: readError } = await ownedDbTable('campaigns')
      .select('company_id, name')
      .eq('id', campaignId)
      .maybeSingle();
    if (readError) return `pause recommendation not sent: campaign unreadable: ${readError.message}`;

    if (!campaign?.company_id) return 'pause recommendation not sent: campaign has no company';

    const { error: insertError } = await ownedDbTable('notifications').insert({
      company_id: campaign.company_id,
      type: 'campaign_pause_recommended',
      title: 'We recommend pausing this campaign',
      body: `"${campaign.name ?? campaignId}" is underperforming: ${reason}. We recommend pausing it. Nothing was changed.`,
      metadata: { campaign_id: campaignId, reason, recommendation: 'pause' },
      created_at: new Date().toISOString(),
      read: false,
    });
    if (insertError) return `pause recommendation not sent: ${insertError.message}`;
    return null;
  } catch (err) {
    return `pause recommendation not sent: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * RECOMMEND a lower posting frequency for an AT_RISK campaign: an 'optimize' decision carrying the
 * proposed frequency. Nothing is changed (suggest-only).
 *
 * Returns whether a recommendation was recorded; THROWS when the campaign read fails (unread-error
 * pkg 2: it used to be fire-and-forget, every failure swallowed, and reported before it had run).
 */
async function recommendOptimization(
  campaignId: string,
  reason: string,
  companyId: string,
): Promise<boolean> {
  // Load current posting frequency
  const { data: campaign, error: readError } = await ownedDbTable('campaigns')
    .select('posting_frequency, platforms')
    .eq('id', campaignId)
    .maybeSingle();
  if (readError) throw new Error(`optimization: campaign unreadable: ${readError.message}`);

  if (!campaign) return false;

  const currentFreq = ((campaign as any).posting_frequency ?? {}) as Record<string, number>;
  const platforms   = ((campaign as any).platforms ?? []) as string[];

  // Propose 20% lower frequencies (reduce noise, focus on quality). PROPOSED only, never written.
  const proposedFreq: Record<string, number> = {};
  for (const [p, freq] of Object.entries(currentFreq)) {
    proposedFreq[p] = Math.max(1, Math.round(freq * 0.8));
  }

  await logDecision({
    company_id:    companyId,
    campaign_id:   campaignId,
    decision_type: 'optimize',
    reason:        `AT_RISK: ${reason}. A lower posting frequency is RECOMMENDED to focus on content quality; the campaign was not changed.`,
    metrics_used:  { current_frequency: currentFreq, proposed_frequency: proposedFreq, platforms },
    outcome:       `RECOMMENDED (not applied): reduce posting frequency 20% across ${platforms.length} platform(s)`,
  });
  return true;
}

/**
 * Evaluate all active campaigns and update health status.
 * Called by the 6-hour cron job.
 */
export async function runCampaignHealthMonitor(): Promise<CampaignHealthMonitorResult> {
  const result: CampaignHealthMonitorResult = {
    campaigns_evaluated: 0,
    pause_recommended: [],
    critical: [],
    at_risk: [],
    optimization_recommended: [],
    scaled: [],
    errors: [],
  };

  try {
    const { data: activeCampaigns, error: activeError } = await ownedDbTable('campaigns')
      .select('id, company_id')
      .in('status', ['active', 'scheduled', 'execution_ready', 'campaign_week_plan']);
    // unread-error pkg 2: a failed read was "no active campaigns", a silent no-op run.
    if (activeError) throw new Error(`active campaigns unreadable: ${activeError.message}`);

    if (!activeCampaigns?.length) return result;

    const [windowsByCampaign, cfg] = await Promise.all([
      getRecentEngagementWindows(),
      getDecisionConfig(),
    ]);

    for (const { id: campaignId, company_id: companyIdForLog } of activeCampaigns as Array<{ id: string; company_id: string }>) {
      try {
        result.campaigns_evaluated++;

        const windows = (windowsByCampaign.get(campaignId) ?? [])
          .sort((a, b) => a.window_start.localeCompare(b.window_start))
          .slice(-cfg.at_risk_windows);

        if (windows.length === 0) continue; // no data yet

        const prev = await getPreviousHealthStatus(campaignId);
        const prevStatus = prev?.status ?? 'HEALTHY';
        const criticalRunCount = prev?.critical_run_count ?? 0;

        // ── Determine new status (all thresholds from DB config) ─────────────
        let newStatus: CampaignHealthStatus = 'HEALTHY';
        let statusReason = '';

        const allBelowThreshold = windows.every((w) => w.avg_rate < cfg.min_engagement_threshold);
        const latestRate = windows[windows.length - 1]?.avg_rate ?? 0;
        const previousRate = windows.length >= 2 ? windows[windows.length - 2].avg_rate : latestRate;
        const dropPct = previousRate > 0 ? (previousRate - latestRate) / previousRate : 0;

        if (allBelowThreshold && windows.length >= cfg.at_risk_windows) {
          newStatus = 'AT_RISK';
          statusReason = `Engagement < ${(cfg.min_engagement_threshold * 100).toFixed(1)}% for ${windows.length} consecutive windows`;
        }
        if ((newStatus === 'AT_RISK' && prevStatus === 'AT_RISK') || dropPct > cfg.critical_drop_percent) {
          newStatus = 'CRITICAL';
          statusReason = dropPct > cfg.critical_drop_percent
            ? `Engagement dropped ${(dropPct * 100).toFixed(0)}% in last window`
            : 'AT_RISK persisted across consecutive evaluations';
        }

        const newCriticalRunCount = newStatus === 'CRITICAL' ? criticalRunCount + 1 : 0;

        // SUGGEST-ONLY: nothing below writes to the campaign. unread-error pkg 2: each outcome is
        // reported only once it has happened; a failure is reported in result.errors, never swallowed.
        // A failed report write fails this campaign's evaluation (the next run retries from the same state).

        // ── AT_RISK: recommend a lower posting frequency ─────────────────────
        if (newStatus === 'AT_RISK') {
          result.at_risk.push(campaignId);
          try {
            if (await recommendOptimization(campaignId, statusReason, companyIdForLog)) result.optimization_recommended.push(campaignId);
          } catch (err: unknown) {
            result.errors.push(`${campaignId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // ── CRITICAL: recommend pausing, ONCE (the run that reaches the threshold) ──
        if (newStatus === 'CRITICAL') {
          result.critical.push(campaignId);
          if (newCriticalRunCount === cfg.critical_runs_for_pause) {
            const notificationFailure = await recommendPause(campaignId, statusReason, companyIdForLog, newCriticalRunCount);
            result.pause_recommended.push(campaignId);
            if (notificationFailure) result.errors.push(`${campaignId}: ${notificationFailure}`);
          }
        }

        // ── HEALTHY: attempt auto-scaling ────────────────────────────────────
        if (newStatus === 'HEALTHY') {
          try {
            const scaleResult = await tryAutoScale(campaignId);
            if (scaleResult.scaled) result.scaled.push(campaignId);
            for (const failed of scaleResult.failed_actions) result.errors.push(`${campaignId}: auto-scale: ${failed}`);
          } catch (err: unknown) {
            result.errors.push(`${campaignId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // ── Persist report ───────────────────────────────────────────────────
        const { error: reportError } = await ownedDbTable('campaign_health_reports').insert({
          campaign_id: campaignId,
          health_status: newStatus,
          status: newStatus.toLowerCase(),
          confidence: 1,
          issues: statusReason ? [statusReason] : [],
          scores: { engagement_rate: latestRate },
          report: {
            health_status: newStatus,
            critical_run_count: newCriticalRunCount,
            latest_engagement_rate: latestRate,
            status_reason: statusReason,
            windows_evaluated: windows.length,
          },
          evaluated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
        // The next run reads this report to continue the AT_RISK -> CRITICAL -> pause chain.
        if (reportError) throw new Error(`health report not written: ${reportError.message}`);
      } catch (err: unknown) {
        result.errors.push(`${campaignId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`Monitor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
