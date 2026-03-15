/**
 * Campaign Duplicate Guard
 * Before creating campaign from opportunity: check if similar topic exists within 30 days.
 */

import { supabase } from '../db/supabaseClient';

const DAYS_LOOKBACK = 30;

function tokenize(s: string): Set<string> {
  return new Set(
    String(s ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export interface DuplicateGuardResult {
  allowed: boolean;
  warning?: string;
  similar_campaign?: { id: string; name: string };
}

/**
 * Check if a similar campaign (by topic) exists within the last 30 days.
 * Returns warning if similar topic found.
 */
export async function checkCampaignDuplicate(
  companyId: string,
  topic: string,
  excludeCampaignId?: string | null
): Promise<DuplicateGuardResult> {
  const topicTokens = tokenize(topic);
  if (topicTokens.size === 0) {
    return { allowed: true };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_LOOKBACK);

  const { data: versionRows } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId)
    .gte('created_at', cutoff.toISOString());

  const campaignIds = [
    ...new Set(
      (versionRows ?? [])
        .map((r) => r?.campaign_id)
        .filter((id): id is string => Boolean(id) && id !== excludeCampaignId)
    ),
  ];

  if (campaignIds.length === 0) return { allowed: true };

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, description, created_at')
    .in('id', campaignIds)
    .gte('created_at', cutoff.toISOString());

  for (const camp of campaigns ?? []) {
    const name = String(camp?.name ?? '');
    const desc = String(camp?.description ?? '');
    const combined = `${name} ${desc}`;
    const campTokens = tokenize(combined);
    const sim = jaccardSimilarity(topicTokens, campTokens);
    if (sim >= 0.6) {
      return {
        allowed: false,
        warning: `Similar campaign "${name}" exists (created within ${DAYS_LOOKBACK} days). Consider reviewing before creating.`,
        similar_campaign: { id: camp.id, name },
      };
    }
  }

  return { allowed: true };
}
