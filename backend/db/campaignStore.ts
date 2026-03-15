/**
 * Campaign store — shared queries for campaigns table.
 * Consolidates duplicate campaign loading across services.
 */

import { supabase } from './supabaseClient';

/**
 * Get campaign status by id. Returns null if not found.
 */
export async function getCampaignStatus(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('status')
    .eq('id', campaignId)
    .single();
  if (error || !data) return null;
  return (data as { status?: string }).status ?? null;
}

/**
 * Get campaign row by id with optional field selection.
 * Returns null if not found.
 */
export async function getCampaignById<T = Record<string, unknown>>(
  campaignId: string,
  fields: string = '*'
): Promise<T | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select(fields)
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) return null;
  return data as T;
}

/**
 * Get multiple campaigns by ids. Returns empty array on error.
 */
export async function getCampaignsByIds<T = Record<string, unknown>>(
  campaignIds: string[],
  fields: string = 'id, execution_status, blueprint_status, last_preempted_at, priority_level'
): Promise<T[]> {
  if (!campaignIds.length) return [];
  const { data, error } = await supabase
    .from('campaigns')
    .select(fields)
    .in('id', campaignIds);
  if (error) return [];
  return (data || []) as T[];
}

/**
 * Get total campaign count. Returns 0 on error.
 */
export async function getCampaignCount(): Promise<number> {
  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true });
  if (error) return 0;
  return count ?? 0;
}
