/**
 * Trend Campaign multi-region recommendation job processor (v2).
 * Loads recommendation_jobs_v2, runs per-region generation, then consolidation.
 */

import { supabase } from '../db/supabaseClient';
import {
  generateTrendRecommendationForRegion,
  type StrategicPayload,
  type PillarSummary,
  type TrendRegionRecommendation,
} from './opportunityGenerators';
import { consolidateRegionalResults } from './recommendationConsolidator';

type JobV2Row = {
  id: string;
  company_id: string;
  status: string;
  strategic_payload: StrategicPayload | null;
  selected_pillars: string[];
  regions: string[];
  region_results: Record<string, unknown>;
  consolidated_result: unknown;
  error: string | null;
  updated_at: string;
};

export async function processRecommendationJobV2(jobId: string): Promise<void> {
  const now = new Date().toISOString();

  const { data: job, error: fetchError } = await supabase
    .from('recommendation_jobs_v2')
    .select('id, company_id, status, strategic_payload, selected_pillars, regions, region_results')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    return;
  }

  const row = job as JobV2Row;
  if (row.status !== 'PENDING') {
    return;
  }

  await supabase
    .from('recommendation_jobs_v2')
    .update({ status: 'RUNNING', progress_stage: 'INITIALIZING', updated_at: now })
    .eq('id', jobId);

  try {
    const companyId = row.company_id;
    const strategicPayload = row.strategic_payload ?? null;
    const pillarIds = Array.isArray(row.selected_pillars) ? row.selected_pillars : [];
    const regions = Array.isArray(row.regions) && row.regions.length > 0 ? row.regions : ['GLOBAL'];

    let pillarSummaries: PillarSummary[] = [];
    if (pillarIds.length > 0) {
      const { data: items } = await supabase
        .from('opportunity_items')
        .select('id, title, summary')
        .eq('company_id', companyId)
        .in('id', pillarIds);
      const list = (items ?? []) as { id: string; title: string; summary: string | null }[];
      pillarSummaries = list.map((p) => ({ id: p.id, title: p.title ?? '', summary: p.summary ?? null }));
    }

    const regionResults: Record<string, TrendRegionRecommendation | { error: true; message: string }> = {};

    for (const region of regions) {
      await supabase.from('recommendation_jobs_v2').update({ progress_stage: 'SCANNING', updated_at: new Date().toISOString() }).eq('id', jobId);
      const start = Date.now();
      try {
        const result = await generateTrendRecommendationForRegion(
          companyId,
          strategicPayload,
          region,
          pillarSummaries
        );
        regionResults[region] = result;
        const duration_ms = Date.now() - start;
        console.info({
          jobId,
          region,
          duration_ms,
          priority_score: result?.priority_score,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Region analysis failed';
        regionResults[region] = { error: true, message };
      }

      await supabase
        .from('recommendation_jobs_v2')
        .update({
          region_results: regionResults,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }

    const successfulResults = Object.fromEntries(
      Object.entries(regionResults).filter(
        (e): e is [string, TrendRegionRecommendation] => !('error' in e[1] && e[1].error)
      )
    ) as Record<string, TrendRegionRecommendation>;
    const successCount = Object.keys(successfulResults).length;
    const failCount = regions.length - successCount;

    let finalStatus: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
    let finalError: string | null = null;

    if (successCount === 0) {
      finalStatus = 'FAILED';
      finalError = 'All regions failed.';
    } else if (failCount > 0) {
      finalStatus = 'COMPLETED_WITH_WARNINGS';
    } else {
      finalStatus = 'COMPLETED';
    }

    await supabase.from('recommendation_jobs_v2').update({ progress_stage: 'CONSOLIDATING', updated_at: new Date().toISOString() }).eq('id', jobId);
    const consolidated =
      successCount > 0
        ? await consolidateRegionalResults(successfulResults)
        : { global_opportunities: [], region_specific_insights: {}, execution_priority_order: [], consolidated_risks: [], strategic_summary: '', confidence_index: 0 };

    await supabase
      .from('recommendation_jobs_v2')
      .update({
        progress_stage: 'FINISHED',
        status: finalStatus,
        consolidated_result: consolidated,
        error: finalError,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Job failed';
    await supabase
      .from('recommendation_jobs_v2')
      .update({
        status: 'FAILED',
        error: message,
        progress_stage: 'FINISHED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}
