/**
 * Response Pattern Service
 * Manages reusable response structure templates.
 */

import { supabase } from '../db/supabaseClient';

export type PatternStructure = {
  blocks?: Array<{ type: string; label: string; required?: boolean }>;
};

export async function createPattern(
  organizationId: string,
  patternCategory: string,
  patternStructure: PatternStructure
): Promise<string | null> {
  if (!organizationId || !patternCategory || !patternStructure) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('response_patterns')
    .insert({
      organization_id: organizationId,
      pattern_structure: patternStructure,
      pattern_category: patternCategory,
      usage_count: 0,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[responsePatternService] createPattern error', error.message);
    return null;
  }
  return (data as { id: string })?.id ?? null;
}

export async function listPatterns(organizationId: string): Promise<
  Array<{
    id: string;
    pattern_category: string;
    pattern_structure: PatternStructure;
    usage_count: number;
    success_score: number | null;
    created_at: string;
  }>
> {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('response_patterns')
    .select('id, pattern_category, pattern_structure, usage_count, success_score, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[responsePatternService] listPatterns error', error.message);
    return [];
  }
  return (data ?? []) as Array<{
    id: string;
    pattern_category: string;
    pattern_structure: PatternStructure;
    usage_count: number;
    success_score: number | null;
    created_at: string;
  }>;
}

export async function getPatternForCategory(
  organizationId: string,
  category: string
): Promise<{
  id: string;
  pattern_structure: PatternStructure;
} | null> {
  if (!organizationId || !category) return null;

  const { data, error } = await supabase
    .from('response_patterns')
    .select('id, pattern_structure')
    .eq('organization_id', organizationId)
    .eq('pattern_category', category)
    .order('usage_count', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as { id: string; pattern_structure: PatternStructure };
}

export async function incrementUsage(patternId: string): Promise<void> {
  if (!patternId) return;

  const { data, error: fetchError } = await supabase
    .from('response_patterns')
    .select('usage_count')
    .eq('id', patternId)
    .maybeSingle();

  if (fetchError || !data) return;

  const current = Number((data as { usage_count: number }).usage_count) || 0;
  await supabase
    .from('response_patterns')
    .update({
      usage_count: current + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', patternId);
}
