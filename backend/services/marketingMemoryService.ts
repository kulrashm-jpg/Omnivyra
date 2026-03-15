/**
 * Marketing Memory Service
 * Persistent memory for AI learning from campaign performance.
 * Supports save, get, and search operations.
 */

import { supabase } from '../db/supabaseClient';

export type MemoryType =
  | 'campaign_outcome'
  | 'content_performance'
  | 'narrative_performance'
  | 'audience_pattern'
  | 'engagement_pattern';

export interface MarketingMemoryEntry {
  id?: string;
  company_id: string;
  memory_type: MemoryType;
  memory_key: string;
  memory_value: Record<string, unknown>;
  confidence?: number;
  source?: string;
  created_at?: string;
}

const VALID_MEMORY_TYPES: Set<string> = new Set([
  'campaign_outcome',
  'content_performance',
  'narrative_performance',
  'audience_pattern',
  'engagement_pattern',
]);

const RETENTION_LIMIT = 1000;

function validateMemoryType(t: string): t is MemoryType {
  return VALID_MEMORY_TYPES.has(t);
}

/**
 * Save a marketing memory entry.
 */
export async function saveMarketingMemory(memory: MarketingMemoryEntry): Promise<string | null> {
  const { company_id, memory_type, memory_key, memory_value, confidence = 0.8, source } = memory;
  if (!company_id || !memory_key || !validateMemoryType(memory_type)) return null;

  const { data, error } = await supabase
    .from('marketing_memory')
    .insert({
      company_id,
      memory_type,
      memory_key,
      memory_value: memory_value ?? {},
      confidence: Math.min(1, Math.max(0, confidence)),
      source: source ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[marketingMemoryService] saveMarketingMemory', error);
    return null;
  }
  enforceRetention(company_id).catch((e) =>
    console.warn('[marketingMemoryService] enforceRetention failed:', e)
  );
  return data?.id ?? null;
}

/**
 * Get a single memory entry by company and key.
 */
export async function getMarketingMemory(
  companyId: string,
  memoryKey: string
): Promise<MarketingMemoryEntry | null> {
  const { data, error } = await supabase
    .from('marketing_memory')
    .select('id, company_id, memory_type, memory_key, memory_value, confidence, source, created_at')
    .eq('company_id', companyId)
    .eq('memory_key', memoryKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    company_id: data.company_id,
    memory_type: data.memory_type as MemoryType,
    memory_key: data.memory_key,
    memory_value: (data.memory_value as Record<string, unknown>) ?? {},
    confidence: data.confidence,
    source: data.source,
    created_at: data.created_at,
  };
}

/**
 * Search marketing memory by company and query string (matches memory_key and memory_value).
 */
export async function searchMarketingMemory(
  companyId: string,
  query: string
): Promise<MarketingMemoryEntry[]> {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [];

  const { data, error } = await supabase
    .from('marketing_memory')
    .select('id, company_id, memory_type, memory_key, memory_value, confidence, source, created_at')
    .eq('company_id', companyId)
    .ilike('memory_key', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    company_id: row.company_id,
    memory_type: row.memory_type as MemoryType,
    memory_key: row.memory_key,
    memory_value: (row.memory_value as Record<string, unknown>) ?? {},
    confidence: row.confidence,
    source: row.source,
    created_at: row.created_at,
  }));
}

/**
 * Get memories by type for a company.
 */
export async function getMarketingMemoriesByType(
  companyId: string,
  memoryType: MemoryType,
  limit = 20
): Promise<MarketingMemoryEntry[]> {
  const { data, error } = await supabase
    .from('marketing_memory')
    .select('id, company_id, memory_type, memory_key, memory_value, confidence, source, created_at')
    .eq('company_id', companyId)
    .eq('memory_type', memoryType)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id,
    company_id: row.company_id,
    memory_type: row.memory_type as MemoryType,
    memory_key: row.memory_key,
    memory_value: (row.memory_value as Record<string, unknown>) ?? {},
    confidence: row.confidence,
    source: row.source,
    created_at: row.created_at,
  }));
}

async function enforceRetention(companyId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from('marketing_memory')
    .select('id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error || !rows?.length || rows.length <= RETENTION_LIMIT) return;

  const idsToDelete = rows.slice(RETENTION_LIMIT).map((r) => r.id).filter(Boolean);
  if (idsToDelete.length > 0) {
    await supabase.from('marketing_memory').delete().in('id', idsToDelete);
  }
}