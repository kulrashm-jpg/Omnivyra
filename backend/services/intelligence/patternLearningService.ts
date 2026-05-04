import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  extractPatternTypes,
  siblingPatterns,
  type PatternType,
} from './patternFeatures';

/**
 * Pattern-learning worker. Periodic aggregation over the last 7 days
 * of community_ai_actions per organization:
 *
 *   1. For each executed / sent_unverified / failed reply row, extract
 *      its pattern labels (length / question / emoji) from the final
 *      text. Rows with no text contribute no pattern.
 *   2. Tally success (executed + sent_unverified) vs failure per
 *      (org, platform, action_type, pattern_type).
 *   3. For each pair of sibling patterns (short_reply / long_reply,
 *      has_question / no_question, has_emoji / no_emoji) compute
 *      baseline_rate + uplift_ratio so the API can emit comparisons
 *      without re-computing.
 *   4. Upsert intelligence_patterns on conflict (org, platform,
 *      action_type, pattern_type).
 *
 * No ML. No heavy joins. One table scan per org with a 500-row LIMIT.
 */

type Tally = {
  organization_id: string;
  platform: string;
  action_type: string;
  pattern_type: PatternType;
  success: number;
  failure: number;
};

const WINDOW_DAYS = 7;
const ROW_LIMIT_PER_ORG = 500;

function tallyKey(t: Omit<Tally, 'success' | 'failure'>): string {
  return [t.organization_id, t.platform, t.action_type, t.pattern_type].join('|');
}

/**
 * Enumerate orgs that had terminal action activity in the last window.
 * Used by the scheduler-driven `learnAllOrgs()` so idle tenants don't
 * trigger wasted scans.
 */
async function listActiveOrgs(): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('organization_id')
      .in('status', ['executed', 'sent_unverified', 'failed'])
      .gte('updated_at', since)
      .limit(5000);
    const seen = new Set<string>();
    for (const row of (data || []) as Array<{ organization_id: string }>) {
      if (row.organization_id) seen.add(row.organization_id);
    }
    return Array.from(seen);
  } catch {
    return [];
  }
}

async function tallyPatternsForOrg(orgId: string): Promise<Map<string, Tally>> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const tallies = new Map<string, Tally>();
  try {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('platform, action_type, status, final_text, suggested_text')
      .eq('organization_id', orgId)
      .in('status', ['executed', 'sent_unverified', 'failed'])
      .gte('updated_at', since)
      .limit(ROW_LIMIT_PER_ORG);

    for (const row of (data || []) as Array<{
      platform: string | null;
      action_type: string | null;
      status: string | null;
      final_text: string | null;
      suggested_text: string | null;
    }>) {
      const platform = String(row.platform || '').toLowerCase().trim();
      const action_type = String(row.action_type || '').toLowerCase().trim();
      if (!platform || !action_type) continue;
      // Pattern learning is currently only meaningful for text-bearing
      // actions. Like / follow carry no body; skip them.
      if (action_type !== 'reply' && action_type !== 'dm') continue;
      const text = row.final_text ?? row.suggested_text ?? '';
      const patterns = extractPatternTypes(text);
      if (patterns.length === 0) continue;

      const isSuccess = row.status === 'executed' || row.status === 'sent_unverified';
      for (const pattern_type of patterns) {
        const k = tallyKey({ organization_id: orgId, platform, action_type, pattern_type });
        const existing = tallies.get(k) ?? {
          organization_id: orgId,
          platform,
          action_type,
          pattern_type,
          success: 0,
          failure: 0,
        };
        if (isSuccess) existing.success += 1;
        else existing.failure += 1;
        tallies.set(k, existing);
      }
    }
  } catch (err: any) {
    console.warn('[patternLearning] tally failed:', orgId, err?.message || err);
  }
  return tallies;
}

/**
 * Compute baseline_rate + uplift_ratio for a row using its sibling's
 * success_rate. Returns null when the sibling has zero samples in
 * which case uplift is undefined and consumers should ignore.
 */
function siblingStats(
  tallies: Map<string, Tally>,
  row: Tally,
): { baseline_rate: number | null; uplift_ratio: number | null } {
  const siblings = siblingPatterns(row.pattern_type);
  const siblingType = siblings[0] === row.pattern_type ? siblings[1] : siblings[0];
  const siblingKey = tallyKey({ ...row, pattern_type: siblingType });
  const sibling = tallies.get(siblingKey);
  if (!sibling) return { baseline_rate: null, uplift_ratio: null };
  const siblingTotal = sibling.success + sibling.failure;
  if (siblingTotal === 0) return { baseline_rate: null, uplift_ratio: null };
  const siblingRate = sibling.success / siblingTotal;
  if (siblingRate === 0) return { baseline_rate: 0, uplift_ratio: null };
  const rowTotal = row.success + row.failure;
  const rowRate = rowTotal === 0 ? 0 : row.success / rowTotal;
  return {
    baseline_rate: Number(siblingRate.toFixed(4)),
    uplift_ratio: Number((rowRate / siblingRate).toFixed(4)),
  };
}

async function upsertPatterns(tallies: Map<string, Tally>): Promise<number> {
  if (tallies.size === 0) return 0;
  const rows: Record<string, unknown>[] = [];
  for (const row of tallies.values()) {
    const sample = row.success + row.failure;
    const rate = sample === 0 ? 0 : row.success / sample;
    const { baseline_rate, uplift_ratio } = siblingStats(tallies, row);
    rows.push({
      organization_id: row.organization_id,
      platform: row.platform,
      action_type: row.action_type,
      pattern_type: row.pattern_type,
      success_count: row.success,
      failure_count: row.failure,
      sample_size: sample,
      success_rate: Number(rate.toFixed(4)),
      baseline_rate,
      uplift_ratio,
      last_updated_at: new Date().toISOString(),
    });
  }
  try {
    const { error } = await supabase
      .from('intelligence_patterns')
      .upsert(rows, { onConflict: 'organization_id,platform,action_type,pattern_type' });
    if (error) {
      console.warn('[patternLearning] upsert failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err: any) {
    console.warn('[patternLearning] upsert exception:', err?.message || err);
    return 0;
  }
}

export async function learnPatternsForOrg(orgId: string): Promise<{
  organization_id: string;
  scope_rows_scanned: number;
  patterns_upserted: number;
}> {
  const tallies = await tallyPatternsForOrg(orgId);
  const scanned = Array.from(tallies.values()).reduce((n, t) => n + t.success + t.failure, 0);
  const upserted = await upsertPatterns(tallies);
  return { organization_id: orgId, scope_rows_scanned: scanned, patterns_upserted: upserted };
}

/**
 * Scheduler entry point. Enumerates active orgs and runs the per-org
 * learner sequentially. Returns aggregate counters for the cron log.
 */
export async function learnAllOrgs(): Promise<{
  orgs: number;
  patterns_upserted: number;
  errors: number;
}> {
  const orgs = await listActiveOrgs();
  let patterns_upserted = 0;
  let errors = 0;
  for (const orgId of orgs) {
    try {
      const result = await learnPatternsForOrg(orgId);
      patterns_upserted += result.patterns_upserted;
    } catch (err: any) {
      errors += 1;
      console.warn('[patternLearning] org error:', orgId, err?.message || err);
    }
  }
  return { orgs: orgs.length, patterns_upserted, errors };
}
