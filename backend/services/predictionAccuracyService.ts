/**
 * Prediction Accuracy Service — closes the predict → execute → learn loop.
 *
 * After a campaign completes (or reaches enough performance data), compares
 * predicted vs actual metrics and stores the delta in `prediction_accuracy_log`.
 *
 * Accuracy score formula:
 *   1 – mean absolute percentage error across (engagement, reach, leads)
 *   Clamped to [0, 1]. Score of 1.0 = perfect prediction.
 *
 * Called by: cron job or campaign completion webhook.
 */

import { supabase } from '../db/supabaseClient';
import { aggregateCampaignPerformance } from './performanceFeedbackService';

export type PredictionAccuracyResult = {
  campaign_id: string;
  prediction_id: string;
  predicted_engagement_rate: number;
  actual_engagement_rate: number;
  predicted_reach: number;
  actual_reach: number;
  predicted_leads: number;
  actual_leads: number;
  engagement_delta: number;
  reach_delta: number;
  leads_delta: number;
  accuracy_score: number;
};

/** Retrieve the most recent prediction for a campaign. */
async function getLatestPrediction(campaignId: string): Promise<{
  id: string;
  predicted_engagement_rate: number;
  predicted_reach: number;
  predicted_leads: number;
} | null> {
  const { data } = await supabase
    .from('campaign_predictions')
    .select('id, predicted_engagement_rate, predicted_reach, predicted_leads')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as typeof data & { id: string } | null;
}

/** Compute MAPE-based accuracy score. 1 = perfect, 0 = completely wrong. */
function computeAccuracyScore(
  predicted: number[],
  actual: number[],
): number {
  const errors: number[] = [];
  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i];
    const a = actual[i];
    if (a === 0 && p === 0) { errors.push(0); continue; }
    if (a === 0) { errors.push(1); continue; }
    errors.push(Math.min(1, Math.abs(p - a) / Math.abs(a)));
  }
  const mape = errors.reduce((s, e) => s + e, 0) / errors.length;
  return parseFloat(Math.max(0, 1 - mape).toFixed(3));
}

/**
 * Evaluate prediction accuracy for a completed campaign.
 * Stores result in `prediction_accuracy_log` and returns the accuracy result.
 * Returns null if no prediction or performance data exists.
 */
export async function evaluatePredictionAccuracy(
  campaignId: string,
): Promise<PredictionAccuracyResult | null> {
  try {
    const [prediction, perf] = await Promise.all([
      getLatestPrediction(campaignId),
      aggregateCampaignPerformance(campaignId),
    ]);

    if (!prediction || !perf) return null;

    const actualEngagement = perf.engagement_rate ?? 0;
    const actualReach      = perf.impressions    ?? 0;
    const actualLeads      = perf.clicks         ?? 0; // clicks as proxy for leads

    const engagementDelta = actualEngagement - prediction.predicted_engagement_rate;
    const reachDelta      = actualReach      - prediction.predicted_reach;
    const leadsDelta      = actualLeads      - prediction.predicted_leads;

    const accuracyScore = computeAccuracyScore(
      [prediction.predicted_engagement_rate, prediction.predicted_reach, prediction.predicted_leads],
      [actualEngagement, actualReach, actualLeads],
    );

    const logEntry: PredictionAccuracyResult = {
      campaign_id:               campaignId,
      prediction_id:             prediction.id,
      predicted_engagement_rate: prediction.predicted_engagement_rate,
      actual_engagement_rate:    actualEngagement,
      predicted_reach:           prediction.predicted_reach,
      actual_reach:              actualReach,
      predicted_leads:           prediction.predicted_leads,
      actual_leads:              actualLeads,
      engagement_delta:          parseFloat(engagementDelta.toFixed(4)),
      reach_delta:               reachDelta,
      leads_delta:               leadsDelta,
      accuracy_score:            accuracyScore,
    };

    await supabase.from('prediction_accuracy_log').insert({
      ...logEntry,
      evaluated_at: new Date().toISOString(),
    });

    return logEntry;
  } catch (err) {
    console.warn('[predictionAccuracyService] Failed to evaluate accuracy', err);
    return null;
  }
}

/**
 * Compute average prediction accuracy across all evaluated campaigns for a company.
 * Used to surface model quality in the admin dashboard.
 */
export async function getAveragePredictionAccuracy(companyId: string): Promise<{
  avg_accuracy_score: number;
  sample_count: number;
} | null> {
  try {
    // Join via campaigns table to scope to company
    const { data: campaignIds } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId);

    if (!campaignIds?.length) return null;
    const ids = campaignIds.map((c: { id: string }) => c.id);

    const { data: logs } = await supabase
      .from('prediction_accuracy_log')
      .select('accuracy_score')
      .in('campaign_id', ids);

    if (!logs?.length) return null;

    const avg = logs.reduce((s: number, l: { accuracy_score: number }) => s + l.accuracy_score, 0) / logs.length;
    return {
      avg_accuracy_score: parseFloat(avg.toFixed(3)),
      sample_count: logs.length,
    };
  } catch (err) {
    console.warn('[predictionAccuracyService] Failed to get accuracy stats', err);
    return null;
  }
}
