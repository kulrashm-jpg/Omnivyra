import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

type ConsolidatedTopic = {
  topic: string;
  spike_reason: string;
  shelf_life_days: number;
  risk_level: string;
  priority_score: number;
  regions: string[];
  narrative_phase?: string;
  momentum_score?: number;
  velocity_score?: number;
  early_advantage?: boolean;
};

type TopicWithDecay = ConsolidatedTopic & {
  age_days: number;
  expired: boolean;
  decay_multiplier: number;
  effective_priority: number;
};

function getDecayMultiplier(ageDays: number): number {
  if (ageDays <= 2) return 1.0;
  if (ageDays <= 7) return 0.8;
  if (ageDays <= 14) return 0.6;
  return 0.4;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = (req.query.id ?? req.query.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const { data: job, error: jobError } = await supabase
    .from('market_pulse_jobs_v1')
    .select('id, company_id, status, progress_stage, confidence_index, consolidated_result, region_divergence_score, arbitrage_opportunities, localized_risk_pockets, error, created_at, completed_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: job.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const consolidated = (job.consolidated_result ?? {}) as {
    global_topics?: ConsolidatedTopic[];
    region_specific_insights?: Array<{ region: string; insight: string }>;
    risk_alerts?: string[];
    execution_priority_order?: string[];
    strategic_summary?: string;
    arbitrage_opportunities?: Array<{ topic: string; high_region: string; low_region: string; explanation: string }>;
    localized_risk_pockets?: Array<{ topic: string; region: string; risk_level: string; spike_reason: string }>;
  };

  const globalTopics = Array.isArray(consolidated.global_topics) ? consolidated.global_topics : [];

  const { data: items } = await supabase
    .from('market_pulse_items_v1')
    .select('topic, created_at')
    .eq('job_id', jobId);

  const topicToEarliestCreated = new Map<string, number>();
  for (const item of items ?? []) {
    const key = (item.topic ?? '').trim().toLowerCase();
    if (!key) continue;
    const ts = item.created_at ? new Date(item.created_at).getTime() : 0;
    const existing = topicToEarliestCreated.get(key);
    topicToEarliestCreated.set(key, existing == null ? ts : Math.min(existing, ts));
  }

  const jobCreatedAt = job.created_at ? new Date(job.created_at).getTime() : Date.now();

  const topicsWithDecay: TopicWithDecay[] = globalTopics.map((t) => {
    const topicKey = (t.topic ?? '').trim().toLowerCase();
    const topicCreatedAt = topicToEarliestCreated.get(topicKey) ?? jobCreatedAt;
    const ageDays = (Date.now() - topicCreatedAt) / (1000 * 60 * 60 * 24);
    const expired = ageDays > (t.shelf_life_days ?? 7);
    const decayMultiplier = getDecayMultiplier(ageDays);
    const effectivePriority = (t.priority_score ?? 0) * decayMultiplier;

    return {
      ...t,
      age_days: Math.floor(ageDays * 10) / 10,
      expired,
      decay_multiplier: decayMultiplier,
      effective_priority: effectivePriority,
    };
  });

  topicsWithDecay.sort((a, b) => b.effective_priority - a.effective_priority);

  return res.status(200).json({
    status: job.status,
    progress_stage: job.progress_stage ?? null,
    confidence_index: job.confidence_index ?? 0,
    region_divergence_score: job.region_divergence_score ?? 0,
    arbitrage_opportunities: job.arbitrage_opportunities ?? consolidated.arbitrage_opportunities ?? [],
    localized_risk_pockets: job.localized_risk_pockets ?? consolidated.localized_risk_pockets ?? [],
    consolidated_result: {
      ...consolidated,
      global_topics: topicsWithDecay,
      arbitrage_opportunities: job.arbitrage_opportunities ?? consolidated.arbitrage_opportunities ?? [],
      localized_risk_pockets: job.localized_risk_pockets ?? consolidated.localized_risk_pockets ?? [],
    },
    error: job.error ?? null,
    created_at: job.created_at,
    completed_at: job.completed_at,
  });
}
