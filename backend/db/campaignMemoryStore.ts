import { supabase } from './supabaseClient';

export async function saveCampaignMemorySnapshot(input: {
  companyId: string;
  memory: any;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    memory_json: input.memory,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('campaign_memory_snapshots').insert(payload);
  if (error) {
    throw new Error(`Failed to save campaign memory snapshot: ${error.message}`);
  }
}

export async function getLatestCampaignMemory(companyId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('campaign_memory_snapshots')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function saveContentSimilarityCheck(input: {
  companyId: string;
  newContent: any;
  similarityScore: number;
  result: string;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    new_content: input.newContent,
    similarity_score: input.similarityScore,
    result: input.result,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('content_similarity_checks').insert(payload);
  if (error) {
    throw new Error(`Failed to save similarity check: ${error.message}`);
  }
}
