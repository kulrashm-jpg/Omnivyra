/**
 * Read-only access to platform_metrics_snapshots.
 * Supports baseline conditioning — only latest snapshot per platform is used.
 */

import { supabase } from './supabaseClient';

export interface PlatformSnapshot {
  platform: string;
  followers: number;
  engagement_rate: number | null;
  captured_at: string;
}

/**
 * Fetch the latest snapshot per platform for a company.
 * Uses index on (company_id, platform, captured_at DESC) for efficiency.
 */
export async function getLatestSnapshotsPerPlatform(
  companyId: string
): Promise<PlatformSnapshot[]> {
  const { data, error } = await supabase
    .from('platform_metrics_snapshots')
    .select('platform, followers, engagement_rate, captured_at')
    .eq('company_id', companyId)
    .order('captured_at', { ascending: false });

  if (error) return [];

  // Dedupe by platform — first (latest) wins
  const seen = new Set<string>();
  const out: PlatformSnapshot[] = [];
  for (const row of data || []) {
    const platform = String(row.platform || '').toLowerCase();
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    out.push({
      platform,
      followers: Number(row.followers) || 0,
      engagement_rate: row.engagement_rate != null ? Number(row.engagement_rate) : null,
      captured_at: String(row.captured_at || ''),
    });
  }
  return out;
}
