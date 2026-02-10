/**
 * LLM consolidation for multi-region recommendation signals.
 * Placeholder implementation: no external API calls from LLM.
 * Input: structured summary of normalized trends per region + optional company profile + goal.
 * Output: unified recommendation, region-wise differences, divergence_score, confidence_score, disclaimer.
 */

import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';

const DIVERGENCE_DISCLAIMER_THRESHOLD = 0.35;

export type RawSignalRow = {
  id: string;
  job_id: string;
  region_code: string;
  api_id: string;
  normalized_trends_json: unknown;
  raw_payload_json: unknown;
  latency_ms: number | null;
  status: string;
  created_at: string;
};

export type ConsolidationOutput = {
  unified_recommendation: string;
  region_wise_differences: Record<string, string>;
  divergence_score: number;
  confidence_score: number;
  disclaimer_text: string | null;
  campaign_ready_summary?: string;
};

/**
 * Placeholder LLM: builds consolidation from structured input without calling any external APIs.
 * Replace this with Omnivyra/Mnevara later without changing the orchestration contract.
 */
function placeholderConsolidate(input: {
  summaryPerRegion: Record<string, { topics: string[]; sourceCount: number }>;
  goal: string | null;
  companyProfileSummary: string | null;
  failedRegionsOrApis: string[];
}): ConsolidationOutput {
  const { summaryPerRegion, goal, companyProfileSummary, failedRegionsOrApis } = input;
  const regions = Object.keys(summaryPerRegion);
  const allTopics = new Set<string>();
  regions.forEach((r) => (summaryPerRegion[r]?.topics ?? []).forEach((t) => allTopics.add(t)));
  const topicList = Array.from(allTopics);
  const perRegionTopics: Record<string, string[]> = {};
  regions.forEach((r) => {
    perRegionTopics[r] = summaryPerRegion[r]?.topics ?? [];
  });

  let divergenceScore = 0;
  if (regions.length >= 2) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) pairs.push([regions[i], regions[j]]);
    }
    let totalDiff = 0;
    for (const [a, b] of pairs) {
      const setA = new Set(perRegionTopics[a] ?? []);
      const setB = new Set(perRegionTopics[b] ?? []);
      const union = new Set([...setA, ...setB]);
      const intersect = [...setA].filter((x) => setB.has(x));
      const jaccard = union.size > 0 ? 1 - intersect.length / union.size : 0;
      totalDiff += jaccard;
    }
    divergenceScore = pairs.length > 0 ? Math.min(1, totalDiff / pairs.length) : 0;
  }

  const confidenceScore = failedRegionsOrApis.length > 0
    ? Math.max(0.3, 0.9 - failedRegionsOrApis.length * 0.1)
    : 0.9;

  const regionWiseDifferences: Record<string, string> = {};
  regions.forEach((r) => {
    const topics = perRegionTopics[r] ?? [];
    regionWiseDifferences[r] = topics.length > 0
      ? `Top themes: ${topics.slice(0, 5).join(', ')}${topics.length > 5 ? '…' : ''}`
      : 'No trends captured';
  });

  const goalLine = goal ? `Goal: ${goal}. ` : '';
  const profileLine = companyProfileSummary ? `Company context: ${companyProfileSummary.slice(0, 200)}. ` : '';
  const unifiedRecommendation = `${goalLine}${profileLine}Unified themes across regions: ${topicList.slice(0, 10).join(', ') || 'None'}. Use these for campaign planning.`;
  const disclaimerText =
    divergenceScore > DIVERGENCE_DISCLAIMER_THRESHOLD
      ? 'Recommendations vary by region. Consider tailoring content or messaging per market.'
      : null;

  return {
    unified_recommendation: unifiedRecommendation,
    region_wise_differences: regionWiseDifferences,
    divergence_score: divergenceScore,
    confidence_score: confidenceScore,
    disclaimer_text: disclaimerText,
    campaign_ready_summary: topicList.length > 0
      ? `Campaign-ready themes: ${topicList.slice(0, 8).join(', ')}`
      : undefined,
  };
}

/**
 * Load job and raw signals, build summary, run consolidation (placeholder LLM), persist analysis, set job COMPLETED.
 */
export async function consolidateMultiRegionSignals(jobId: string): Promise<void> {
  const { data: job, error: jobError } = await supabase
    .from('recommendation_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const { data: signals, error: sigError } = await supabase
    .from('recommendation_raw_signals')
    .select('*')
    .eq('job_id', jobId);

  if (sigError) throw new Error('Failed to load raw signals');
  const rows = (signals ?? []) as RawSignalRow[];

  const summaryPerRegion: Record<string, { topics: string[]; sourceCount: number }> = {};
  const failedRegionsOrApis: string[] = [];

  for (const r of rows) {
    const region = r.region_code;
    if (!summaryPerRegion[region]) {
      summaryPerRegion[region] = { topics: [], sourceCount: 0 };
    }
    if (r.status === 'FAILED') {
      failedRegionsOrApis.push(`${region}:${r.api_id}`);
      continue;
    }
    summaryPerRegion[region].sourceCount += 1;
    const trends = Array.isArray(r.normalized_trends_json) ? r.normalized_trends_json : [];
    for (const t of trends) {
      const title = (t as { title?: string }).title ?? (t as { topic?: string }).topic;
      if (title && typeof title === 'string') {
        summaryPerRegion[region].topics.push(title.trim());
      }
    }
  }

  for (const r of Object.keys(summaryPerRegion)) {
    summaryPerRegion[r].topics = [...new Set(summaryPerRegion[r].topics)];
  }

  let companyProfileSummary: string | null = null;
  if (job.use_company_profile && job.company_id) {
    const profile = await getProfile(job.company_id);
    if (profile) {
      const p = profile as { industry?: string; category?: string; geography_list?: string[]; content_themes_list?: string[] };
      const parts = [
        p.industry,
        p.category,
        (p.geography_list ?? []).slice(0, 3).join(','),
        (p.content_themes_list ?? []).slice(0, 3).join(','),
      ].filter(Boolean);
      companyProfileSummary = parts.join(' | ') || null;
    }
  }

  const output = placeholderConsolidate({
    summaryPerRegion,
    goal: job.goal ?? null,
    companyProfileSummary,
    failedRegionsOrApis,
  });

  const consolidatedJson = {
    unified_recommendation: output.unified_recommendation,
    region_wise_differences: output.region_wise_differences,
    campaign_ready_summary: output.campaign_ready_summary,
    failed_regions_or_apis: failedRegionsOrApis,
  };

  await supabase.from('recommendation_analysis').upsert(
    {
      job_id: jobId,
      consolidated_recommendation_json: consolidatedJson,
      divergence_score: output.divergence_score,
      disclaimer_text: output.disclaimer_text,
      confidence_score: output.confidence_score,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' }
  );

  await supabase
    .from('recommendation_jobs')
    .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
    .eq('id', jobId);
}
