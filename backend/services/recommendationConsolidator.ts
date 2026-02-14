/**
 * LLM consolidation for multi-region recommendation signals.
 * Placeholder implementation: no external API calls from LLM.
 * Input: structured summary of normalized trends per region + optional company profile + goal.
 * Output: unified recommendation, region-wise differences, divergence_score, confidence_score, disclaimer.
 *
 * V2: consolidateRegionalResults for Trend Strategic Theme multi-region jobs (hybrid rule + LLM).
 */

import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';
import type { TrendRegionRecommendation } from './opportunityGenerators';
import { runDiagnosticPrompt } from './llm/openaiAdapter';

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

// --- V2: Trend multi-region consolidation ---

export type ConsolidatedV2Result = {
  global_opportunities: { title: string; summary?: string; rationale?: string; regions?: string[] }[];
  region_specific_insights: Record<string, { cultural_considerations: string; competitive_pressure: string }>;
  execution_priority_order: string[];
  consolidated_risks: string[];
  strategic_summary: string;
  confidence_index: number;
};

/**
 * Hybrid consolidation: rule-based merge (common opportunities, rank regions, merge risks) + LLM refinement for strategic_summary.
 */
export async function consolidateRegionalResults(
  regionResults: Record<string, TrendRegionRecommendation>
): Promise<ConsolidatedV2Result> {
  const regions = Object.keys(regionResults).filter(Boolean);

  // Rule-based: collect all opportunities with normalized title for dedup
  const opportunityByTitle = new Map<string, { title: string; summary?: string; rationale?: string; regions: string[] }>();
  const allRisks = new Set<string>();
  const regionInsights: Record<string, { cultural_considerations: string; competitive_pressure: string }> = {};

  for (const region of regions) {
    const r = regionResults[region];
    if (!r) continue;
    regionInsights[region] = {
      cultural_considerations: r.cultural_considerations || '',
      competitive_pressure: r.competitive_pressure || '',
    };
    for (const risk of r.risks ?? []) {
      if (risk && typeof risk === 'string') allRisks.add(risk.trim());
    }
    for (const opp of r.opportunities ?? []) {
      const title = (opp?.title ?? '').trim();
      if (!title) continue;
      const existing = opportunityByTitle.get(title);
      if (existing) {
        if (!existing.regions.includes(region)) existing.regions.push(region);
      } else {
        opportunityByTitle.set(title, {
          title,
          summary: opp.summary,
          rationale: opp.rationale,
          regions: [region],
        });
      }
    }
  }

  // Execution order: regions sorted by descending priority_score
  const execution_priority_order = [...regions].sort((a, b) => {
    const scoreA = regionResults[a]?.priority_score ?? 0;
    const scoreB = regionResults[b]?.priority_score ?? 0;
    return scoreB - scoreA;
  });

  const global_opportunities = Array.from(opportunityByTitle.values()).map((o) => ({
    title: o.title,
    summary: o.summary,
    rationale: o.rationale,
    regions: o.regions.length > 0 ? o.regions : undefined,
  }));

  const consolidated_risks = Array.from(allRisks);

  let confidence = 0;
  if (global_opportunities.length > 0) confidence += 30;
  const scores = regions.map(
    (r) => (regionResults[r] as TrendRegionRecommendation)?.priority_score ?? 0
  );
  const scoreRange =
    scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : 0;
  const variancePct = scoreRange * 100;
  if (variancePct < 30) confidence += 30;
  if (consolidated_risks.length < 5) confidence += 40;
  confidence = Math.min(confidence, 100);

  // LLM refinement: produce strategic_summary from merged data
  let strategic_summary = '';
  try {
    const { data } = await runDiagnosticPrompt<{ strategic_summary: string }>(
      'You are a global campaign strategist. Given consolidated regional opportunities, risks, and region-specific insights, write a single executive strategic summary (2-4 sentences). Focus on cross-region alignment and execution priority. Output valid JSON only: { "strategic_summary": string }',
      JSON.stringify(
        {
          global_opportunities: global_opportunities.slice(0, 10),
          consolidated_risks: consolidated_risks.slice(0, 10),
          region_specific_insights: regionInsights,
          execution_priority_order,
        },
        null,
        2
      )
    );
    strategic_summary = typeof data?.strategic_summary === 'string' ? data.strategic_summary : '';
  } catch {
    strategic_summary =
      global_opportunities.length > 0
        ? `Prioritize ${global_opportunities.slice(0, 3).map((o) => o.title).join(', ')} across ${execution_priority_order.join(', ')}.`
        : 'No unified opportunities identified; review region-specific insights.';
  }

  return {
    global_opportunities,
    region_specific_insights: regionInsights,
    execution_priority_order,
    consolidated_risks,
    strategic_summary: strategic_summary || 'Review regional results and prioritize by execution order.',
    confidence_index: confidence,
  };
}
