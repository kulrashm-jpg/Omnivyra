/**
 * Campaign Health Monitor — runs every 6 hours via cron.
 *
 * Evaluates live engagement_rate trends from performance_feedback.
 * Marks campaigns AT_RISK → CRITICAL → auto-pauses when thresholds are breached.
 *
 * Thresholds:
 *   AT_RISK  : engagement_rate < 0.01 for 2 consecutive evaluation windows
 *   CRITICAL : AT_RISK persists OR engagement drops > 40% vs previous window
 *   AUTO-PAUSE: CRITICAL for 2 consecutive runs
 *
 * Stores status in campaign_health_reports (reuses existing table).
 */

import { supabase } from '../db/supabaseClient';
import { getDecisionConfig } from './configService';
import { tryAutoScale } from './campaignAutoScalingService';
import { generateRecoveryCampaign } from './campaignRecoveryService';
import { logDecision } from './autonomousDecisionLogger';

export type CampaignHealthStatus = 'HEALTHY' | 'AT_RISK' | 'CRITICAL' | 'PAUSED';

export type CampaignHealthMonitorResult = {
  campaigns_evaluated: number;
  paused: string[];
  critical: string[];
  at_risk: string[];
  optimized: string[];
  scaled: string[];
  recovered: string[];
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
  const { data, error } = await supabase
    .from('performance_feedback')
    .select('campaign_id, engagement_rate, collected_at')
    .gte('collected_at', since)
    .order('collected_at', { ascending: true });

  if (error || !data) return new Map();

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
  const { data } = await supabase
    .from('campaign_health_reports')
    .select('report')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.report) return null;
  const r = data.report as Record<string, unknown>;
  return {
    status: (r.health_status as CampaignHealthStatus) ?? 'HEALTHY',
    critical_run_count: Number(r.critical_run_count ?? 0),
  };
}

/** Pause a campaign and record the action. */
async function pauseCampaign(campaignId: string): Promise<void> {
  await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', campaignId);
}

/** Trigger an in-app notification for a paused campaign. */
async function triggerNotification(campaignId: string, reason: string): Promise<void> {
  try {
    // Resolve company_id for the notification
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('company_id, name')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign?.company_id) return;

    await supabase.from('notifications').insert({
      company_id: campaign.company_id,
      type: 'campaign_auto_paused',
      title: 'Campaign auto-paused',
      body: `"${campaign.name ?? campaignId}" was automatically paused: ${reason}`,
      metadata: { campaign_id: campaignId, reason },
      created_at: new Date().toISOString(),
      read: false,
    });
  } catch (_) { /* non-blocking */ }
}

/**
 * Live optimization adjustments for an AT_RISK campaign.
 * Changes platform priority and reduces posting frequency to conserve reach.
 */
async function triggerOptimizationAdjustments(
  campaignId: string,
  reason: string,
  companyId: string,
): Promise<void> {
  try {
    // Load current posting frequency
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('posting_frequency, platforms')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign) return;

    const currentFreq = ((campaign as any).posting_frequency ?? {}) as Record<string, number>;
    const platforms   = ((campaign as any).platforms ?? []) as string[];

    // Reduce all frequencies by 20% (reduce noise, focus on quality)
    const adjustedFreq: Record<string, number> = {};
    for (const [p, freq] of Object.entries(currentFreq)) {
      adjustedFreq[p] = Math.max(1, Math.round(freq * 0.8));
    }

    await supabase.from('campaigns')
      .update({
        posting_frequency: adjustedFreq,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', campaignId);

    await logDecision({
      company_id:    companyId,
      campaign_id:   campaignId,
      decision_type: 'optimize',
      reason:        `AT_RISK: ${reason} — reduced posting frequency to focus on content quality`,
      metrics_used:  { previous_frequency: currentFreq, adjusted_frequency: adjustedFreq, platforms },
      outcome:       `Posting frequency reduced 20% across ${platforms.length} platform(s)`,
    });
  } catch (err) {
    console.warn('[campaignHealthMonitor] triggerOptimizationAdjustments failed', err);
  }
}

/**
 * Evaluate all active campaigns and update health status.
 * Called by the 6-hour cron job.
 */
export async function runCampaignHealthMonitor(): Promise<CampaignHealthMonitorResult> {
  const result: CampaignHealthMonitorResult = {
    campaigns_evaluated: 0,
    paused: [],
    critical: [],
    at_risk: [],
    optimized: [],
    scaled: [],
    recovered: [],
    errors: [],
  };

  try {
    const { data: activeCampaigns } = await supabase
      .from('campaigns')
      .select('id, company_id')
      .in('status', ['active', 'scheduled', 'execution_ready', 'twelve_week_plan']);

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

        // ── AT_RISK: trigger live optimization adjustments ───────────────────
        if (newStatus === 'AT_RISK') {
          result.at_risk.push(campaignId);
          // Non-blocking optimization: adjust platform priority + frequency
          triggerOptimizationAdjustments(campaignId, statusReason, companyIdForLog).catch(() => {});
          result.optimized.push(campaignId);
        }

        // ── Auto-pause ───────────────────────────────────────────────────────
        if (newStatus === 'CRITICAL' && newCriticalRunCount >= cfg.critical_runs_for_pause) {
          await pauseCampaign(campaignId);
          await triggerNotification(campaignId, statusReason);
          newStatus = 'PAUSED';
          result.paused.push(campaignId);
          // Generate recovery campaign (non-blocking)
          generateRecoveryCampaign(campaignId, statusReason).catch(() => {});
          result.recovered.push(campaignId);
        } else if (newStatus === 'CRITICAL') {
          result.critical.push(campaignId);
        }

        // ── HEALTHY: attempt auto-scaling ────────────────────────────────────
        if (newStatus === 'HEALTHY') {
          const scaleResult = await tryAutoScale(campaignId).catch(() => null);
          if (scaleResult?.scaled) result.scaled.push(campaignId);
        }

        // ── Persist report ───────────────────────────────────────────────────
        await supabase.from('campaign_health_reports').insert({
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
      } catch (err: unknown) {
        result.errors.push(`${campaignId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`Monitor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
