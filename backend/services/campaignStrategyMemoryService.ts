/**
 * Campaign Strategy Memory Service
 * Lightweight company-level strategic preferences: brand voice, tone, platforms, content types.
 * No LLM calls.
 */

import { supabase } from '../db/supabaseClient';
import { invalidateStrategyProfileCache } from './strategyProfileCache';

export type StrategyMemory = {
  id?: string;
  company_id: string;
  preferred_tone?: string | null;
  preferred_platforms?: string[];
  preferred_content_types?: string[];
  last_updated?: string;
};

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v) => typeof v === 'string').map(String);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.filter((v: unknown) => typeof v === 'string').map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Get strategy memory for a company.
 */
export async function getStrategyMemory(companyId: string): Promise<StrategyMemory | null> {
  if (!companyId?.trim()) return null;
  const { data, error } = await supabase
    .from('campaign_strategy_memory')
    .select('id, company_id, preferred_tone, preferred_platforms, preferred_content_types, last_updated')
    .eq('company_id', companyId.trim())
    .maybeSingle();

  if (error) {
    console.warn('[campaignStrategyMemory] getStrategyMemory failed:', error.message);
    return null;
  }

  if (!data) return null;

  return {
    id: (data as any).id,
    company_id: (data as any).company_id,
    preferred_tone: (data as any).preferred_tone ?? null,
    preferred_platforms: parseJsonArray((data as any).preferred_platforms),
    preferred_content_types: parseJsonArray((data as any).preferred_content_types),
    last_updated: (data as any).last_updated,
  };
}

export type UpdateStrategyMemoryInput = {
  preferred_tone?: string | null;
  preferred_platforms?: string[];
  preferred_content_types?: string[];
};

/**
 * Update strategy memory for a company. Upserts on company_id.
 */
export async function updateStrategyMemory(
  companyId: string,
  memory: UpdateStrategyMemoryInput
): Promise<StrategyMemory | null> {
  if (!companyId?.trim()) return null;

  const row = {
    company_id: companyId.trim(),
    preferred_tone: memory.preferred_tone ?? null,
    preferred_platforms: memory.preferred_platforms ?? [],
    preferred_content_types: memory.preferred_content_types ?? [],
    last_updated: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('campaign_strategy_memory')
    .upsert(row, { onConflict: 'company_id', ignoreDuplicates: false })
    .select('id, company_id, preferred_tone, preferred_platforms, preferred_content_types, last_updated')
    .single();

  if (error) {
    console.warn('[campaignStrategyMemory] updateStrategyMemory failed:', error.message);
    return null;
  }

  return {
    id: (data as any).id,
    company_id: (data as any).company_id,
    preferred_tone: (data as any).preferred_tone ?? null,
    preferred_platforms: parseJsonArray((data as any).preferred_platforms),
    preferred_content_types: parseJsonArray((data as any).preferred_content_types),
    last_updated: (data as any).last_updated,
  };
}

const MIN_SIGNALS_TO_UPDATE = 3;
const TOP_PLATFORMS_LIMIT = 3;
const TOP_CONTENT_TYPES_LIMIT = 3;

/**
 * Update strategy memory from campaign performance signals.
 * Called when BOLT execution / campaign completes. If linkedin repeatedly performs best, add to preferred_platforms.
 */
export async function updateStrategyMemoryFromSignals(
  companyId: string,
  campaignId?: string | null
): Promise<void> {
  if (!companyId?.trim()) return;

  try {
    let query = supabase
      .from('campaign_performance_signals')
      .select('platform, content_type, engagement, impressions')
      .eq('company_id', companyId.trim());

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, error } = await query;

    if (error || !data?.length) return;

    const byPlatform = new Map<string, { engagement: number[]; impressions: number[] }>();
    const byContentType = new Map<string, { engagement: number[]; impressions: number[] }>();

    for (const row of data as Array<{ platform?: string; content_type?: string; engagement?: number; impressions?: number }>) {
      const eng = Number(row.engagement ?? 0) || 0;
      const imp = Number(row.impressions ?? 0) || 0;
      if (row.platform) {
        const c = byPlatform.get(row.platform) ?? { engagement: [], impressions: [] };
        c.engagement.push(eng);
        c.impressions.push(imp);
        byPlatform.set(row.platform, c);
      }
      if (row.content_type) {
        const c = byContentType.get(row.content_type) ?? { engagement: [], impressions: [] };
        c.engagement.push(eng);
        c.impressions.push(imp);
        byContentType.set(row.content_type, c);
      }
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const score = (eng: number[], imp: number[]) =>
      avg(eng) * 0.6 + Math.min(avg(imp) / 100, 100) * 0.4;

    const platforms = Array.from(byPlatform.entries())
      .filter(([, v]) => v.engagement.length >= MIN_SIGNALS_TO_UPDATE)
      .map(([p, v]) => ({ value: p, score: score(v.engagement, v.impressions) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_PLATFORMS_LIMIT)
      .map((x) => x.value.toLowerCase().replace(/^twitter$/, 'x'));

    const contentTypes = Array.from(byContentType.entries())
      .filter(([, v]) => v.engagement.length >= MIN_SIGNALS_TO_UPDATE)
      .map(([c, v]) => ({ value: c, score: score(v.engagement, v.impressions) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_CONTENT_TYPES_LIMIT)
      .map((x) => x.value.toLowerCase());

    if (platforms.length === 0 && contentTypes.length === 0) return;

    const existing = await getStrategyMemory(companyId);
    const mergedPlatforms = [
      ...new Set([...(existing?.preferred_platforms ?? []), ...platforms]),
    ].slice(0, TOP_PLATFORMS_LIMIT);
    const mergedContentTypes = [
      ...new Set([...(existing?.preferred_content_types ?? []), ...contentTypes]),
    ].slice(0, TOP_CONTENT_TYPES_LIMIT);

    await updateStrategyMemory(companyId, {
      preferred_platforms: mergedPlatforms.length > 0 ? mergedPlatforms : undefined,
      preferred_content_types: mergedContentTypes.length > 0 ? mergedContentTypes : undefined,
    });

    invalidateStrategyProfileCache(companyId);
  } catch (err) {
    console.warn('[campaignStrategyMemory] updateStrategyMemoryFromSignals failed:', err);
  }
}
