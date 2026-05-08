import { supabase } from '../db/supabaseClient';

export interface IntelligenceSignalLookupRow {
  id: string;
  topic: string | null;
  signal_type: string | null;
}

export interface CampaignLearningRow {
  performance: unknown;
  metrics: unknown;
  created_at: string;
}

export interface EnhancementLogRow {
  confidence_score: number | null;
  created_at: string;
}

export interface TrackingClickRow {
  metadata: unknown;
  created_at: string;
}

export interface RecommendationTopicSnapshotRow {
  trend_topic: string | null;
  final_score: number | null;
}

export async function loadIntelligenceSignalLookupRows(companyId: string, topics: readonly string[]): Promise<IntelligenceSignalLookupRow[]> {
  if (topics.length === 0) return [];

  const { data: rows } = await supabase
    .from('intelligence_signals')
    .select('id, topic, signal_type')
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order('detected_at', { ascending: false })
    .limit(200);

  return (rows ?? []) as IntelligenceSignalLookupRow[];
}

export async function loadLatestCampaignLearning(campaignId: string): Promise<CampaignLearningRow | null> {
  const { data } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as CampaignLearningRow | null;
}

export async function loadLatestEnhancementLog(campaignId: string): Promise<EnhancementLogRow | null> {
  const { data } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as EnhancementLogRow | null;
}

export async function loadTrackingClickRows(campaignId: string, lookbackWindow: string): Promise<TrackingClickRow[]> {
  const { data } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', lookbackWindow)
    .filter('metadata->>campaign_id', 'eq', campaignId);

  return (data ?? []) as TrackingClickRow[];
}

export async function campaignCompanyLinkExists(companyId: string, campaignId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('id')
    .eq('company_id', companyId)
    .eq('campaign_id', campaignId);

  if (error) {
    throw new Error(`Failed to verify campaign link: ${error.message}`);
  }

  return Boolean(data?.length);
}

export async function loadRecommendedTopicSnapshotRows(companyId: string, since: string): Promise<RecommendationTopicSnapshotRow[]> {
  const { data, error } = await supabase
    .from('recommendation_snapshots')
    .select('trend_topic, final_score')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .not('trend_topic', 'is', null);

  if (error) return [];
  return (data ?? []) as RecommendationTopicSnapshotRow[];
}
