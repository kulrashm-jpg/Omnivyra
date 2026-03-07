/**
 * Strategic Intelligence Memory Service
 * Phase 4: Stores long-term intelligence signals in strategic_memory.
 */

import { supabase } from '../db/supabaseClient';

export type MemoryType =
  | 'opportunity'
  | 'theme'
  | 'market_pulse'
  | 'competitive_signal'
  | 'playbook';

export type StrategicMemoryEntry = {
  id: string;
  company_id: string;
  theme_id: string | null;
  memory_type: string;
  confidence: number | null;
  created_at: string;
};

/**
 * Store a strategic memory entry.
 * Phase 5: Uses ON CONFLICT DO NOTHING when theme_id is set (deduplication).
 */
export async function storeStrategicMemory(
  companyId: string,
  memoryType: MemoryType,
  options?: { themeId?: string | null; confidence?: number | null }
): Promise<StrategicMemoryEntry | null> {
  const themeId = options?.themeId ?? null;

  if (themeId) {
    const { data, error } = await supabase
      .from('strategic_memory')
      .upsert(
        {
          company_id: companyId,
          theme_id: themeId,
          memory_type: memoryType,
          confidence: options?.confidence ?? null,
        },
        { onConflict: 'company_id,theme_id_effective,memory_type', ignoreDuplicates: true }
      )
      .select('id, company_id, theme_id, memory_type, confidence, created_at')
      .single();

    if (error) throw new Error(`strategic_memory insert failed: ${error.message}`);
    return data as StrategicMemoryEntry;
  }

  const { data, error } = await supabase
    .from('strategic_memory')
    .insert({
      company_id: companyId,
      theme_id: null,
      memory_type: memoryType,
      confidence: options?.confidence ?? null,
    })
    .select('id, company_id, theme_id, memory_type, confidence, created_at')
    .single();

  if (error) throw new Error(`strategic_memory insert failed: ${error.message}`);
  return data as StrategicMemoryEntry;
}

/**
 * Fetch recent strategic memory for a company.
 */
export async function getStrategicMemoryForCompany(
  companyId: string,
  options?: { limit?: number; memoryType?: MemoryType }
): Promise<StrategicMemoryEntry[]> {
  let query = supabase
    .from('strategic_memory')
    .select('id, company_id, theme_id, memory_type, confidence, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.memoryType) {
    query = query.eq('memory_type', options.memoryType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch strategic memory: ${error.message}`);
  return (data ?? []) as StrategicMemoryEntry[];
}
