import { supabase } from '../../db/supabaseClient';

/**
 * Minimal, bounded queries that feed the intelligence rules. Every
 * query filters on organization_id + time window and has a small
 * LIMIT so per-request latency is predictable (< ~200ms on warm index).
 *
 * Returning null (not throwing) on error — the intelligence service
 * treats missing signals as "no data", not as failure.
 */

export type PlatformActionStats = {
  executed_count: number;
  sent_unverified_count: number;
  failed_count: number;
  total_terminal: number;
  recent_failure_count: number;     // last 1h
  avg_reply_length: number | null;  // characters, over executed rows only
};

/**
 * Community-AI action outcomes for a (platform, action_type) over the
 * last 7 days. Drives: success rate, recent-failure count, avg reply
 * length (used for the "short replies perform better" insight).
 */
export async function getPlatformActionStats(input: {
  organization_id: string;
  platform: string;
  action_type: string;
}): Promise<PlatformActionStats | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('community_ai_actions')
      .select('status, final_text, suggested_text, updated_at')
      .eq('organization_id', input.organization_id)
      .eq('platform', input.platform)
      .eq('action_type', input.action_type)
      .in('status', ['executed', 'sent_unverified', 'failed'])
      .gte('updated_at', since)
      .limit(500);
    if (error || !data) return null;

    let executed_count = 0;
    let sent_unverified_count = 0;
    let failed_count = 0;
    let recent_failure_count = 0;
    let reply_length_sum = 0;
    let reply_length_n = 0;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const row of data) {
      const status = String((row as any).status || '');
      if (status === 'executed') {
        executed_count += 1;
      } else if (status === 'sent_unverified') {
        sent_unverified_count += 1;
      } else if (status === 'failed') {
        failed_count += 1;
        const updatedAt = Date.parse(String((row as any).updated_at || ''));
        if (Number.isFinite(updatedAt) && updatedAt >= oneHourAgo) {
          recent_failure_count += 1;
        }
      }
      const text = ((row as any).final_text || (row as any).suggested_text || '').toString();
      if (status === 'executed' && text) {
        reply_length_sum += text.length;
        reply_length_n += 1;
      }
    }

    const total_terminal = executed_count + sent_unverified_count + failed_count;
    const avg_reply_length = reply_length_n > 0 ? reply_length_sum / reply_length_n : null;

    return {
      executed_count,
      sent_unverified_count,
      failed_count,
      total_terminal,
      recent_failure_count,
      avg_reply_length,
    };
  } catch {
    return null;
  }
}

export type SuggestionStats = {
  shown_count: number;
  accepted_count: number;
  rejected_count: number;
  acceptance_rate: number | null;
};

/**
 * AI suggestion acceptance for a (platform, action_type) over 7 days.
 */
export async function getSuggestionStats(input: {
  organization_id: string;
  platform: string;
  action_type: string;
}): Promise<SuggestionStats | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('accepted_at, rejected_at')
      .eq('organization_id', input.organization_id)
      .eq('platform', input.platform)
      .eq('action_type', input.action_type)
      .gte('shown_at', since)
      .limit(500);
    if (error || !data) return null;

    let shown_count = 0;
    let accepted_count = 0;
    let rejected_count = 0;
    for (const row of data) {
      shown_count += 1;
      if ((row as any).accepted_at) accepted_count += 1;
      else if ((row as any).rejected_at) rejected_count += 1;
    }
    const acceptance_rate = shown_count > 0 ? accepted_count / shown_count : null;
    return { shown_count, accepted_count, rejected_count, acceptance_rate };
  } catch {
    return null;
  }
}

export type QueueStateSnapshot = {
  status: 'READY' | 'DEGRADED' | 'BLOCKED' | null;
  failure_rate: number | null;
};

/**
 * Per-org RPA queue state snapshot. Used as a trust signal — an
 * organization whose queue is DEGRADED / BLOCKED gets lower confidence
 * and no "Try This" recommendation.
 */
export async function getQueueState(organization_id: string): Promise<QueueStateSnapshot> {
  try {
    const { data } = await supabase
      .from('rpa_queue_state')
      .select('status, failure_rate')
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!data) return { status: null, failure_rate: null };
    return {
      status: ((data as any).status as QueueStateSnapshot['status']) ?? null,
      failure_rate: Number((data as any).failure_rate ?? null),
    };
  } catch {
    return { status: null, failure_rate: null };
  }
}

export type TargetContext = {
  /** Any prior action on this exact target (comment/thread) by this org. */
  prior_action_count: number;
  last_status: string | null;
  last_updated_at: string | null;
};

/**
 * What has this org done on this specific target before? Used to
 * detect "thread active" conditions (e.g. already replied → suggest
 * DM follow-up).
 */
export async function getTargetContext(input: {
  organization_id: string;
  platform: string;
  target_id: string;
}): Promise<TargetContext | null> {
  try {
    const { data, error } = await supabase
      .from('community_ai_actions')
      .select('status, updated_at')
      .eq('organization_id', input.organization_id)
      .eq('platform', input.platform)
      .eq('target_id', input.target_id)
      .order('updated_at', { ascending: false })
      .limit(25);
    if (error || !data) return null;
    const row0 = (data[0] || {}) as Record<string, unknown>;
    return {
      prior_action_count: data.length,
      last_status: (row0.status as string) ?? null,
      last_updated_at: (row0.updated_at as string) ?? null,
    };
  } catch {
    return null;
  }
}

export type LearnedPattern = {
  pattern_type: string;
  success_rate: number;
  sample_size: number;
  baseline_rate: number | null;
  uplift_ratio: number | null;
};

/**
 * Fetch learned patterns for the (org, platform, action_type) scope.
 * Ordered by sample_size DESC so callers can pick high-confidence
 * winners first. Patterns with sample_size < MIN_SAMPLES are filtered
 * out upstream by the service so this query stays trivial.
 */
export async function getLearnedPatterns(input: {
  organization_id: string;
  platform: string;
  action_type: string;
}): Promise<LearnedPattern[]> {
  try {
    const { data, error } = await supabase
      .from('intelligence_patterns')
      .select('pattern_type, success_rate, sample_size, baseline_rate, uplift_ratio')
      .eq('organization_id', input.organization_id)
      .eq('platform', input.platform)
      .eq('action_type', input.action_type)
      .order('sample_size', { ascending: false })
      .limit(12);
    if (error || !data) return [];
    return data.map((r) => ({
      pattern_type: String((r as any).pattern_type || ''),
      success_rate: Number((r as any).success_rate ?? 0),
      sample_size: Number((r as any).sample_size ?? 0),
      baseline_rate: (r as any).baseline_rate != null ? Number((r as any).baseline_rate) : null,
      uplift_ratio:  (r as any).uplift_ratio  != null ? Number((r as any).uplift_ratio)  : null,
    }));
  } catch {
    return [];
  }
}
