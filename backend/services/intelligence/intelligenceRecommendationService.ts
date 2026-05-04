import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { createHash } from 'crypto';

/**
 * Recommendation tracking service.
 *
 * A recommendation is "shown" when /api/intelligence/context returns
 * one. We record it with a stable shown-id so follow-up calls (e.g.
 * the user clicking "Try This") can flip it to accepted without a
 * round-trip through the feedback endpoint.
 *
 * The shown-id is deterministic:
 *   sha256(org|platform|action|target|pattern|day) → hex slice
 * so repeated fetches in the same day for the same (org, pattern,
 * target) all reuse one row and don't spam the table.
 */

export type RecordShownInput = {
  organization_id: string;
  platform: string | null;
  action_type: string | null;
  pattern_type: string;
  label?: string | null;
  confidence_score?: number | null;
  target_id?: string | null;
  execution_correlation_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Deterministic id for the (org, platform, action, target, pattern) tuple on a given UTC day. */
function deterministicShownId(input: RecordShownInput): string {
  const day = new Date().toISOString().slice(0, 10);
  const basis = [
    input.organization_id,
    (input.platform || '').toLowerCase(),
    (input.action_type || '').toLowerCase(),
    input.target_id || '',
    input.pattern_type,
    day,
  ].join('|');
  return 'rec:' + createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

/**
 * Record that a recommendation was shown. Idempotent for the same
 * (org, platform, action, target, pattern, day) combination.
 */
export async function recordRecommendationShown(input: RecordShownInput): Promise<{
  shown_id: string;
  recorded: boolean;
}> {
  const shownId = deterministicShownId(input);
  try {
    // Upsert-style: check if a row already exists under this shown-id
    // in metadata; if not, insert.
    const { data: existing } = await supabase
      .from('intelligence_recommendations')
      .select('id')
      .eq('organization_id', input.organization_id)
      .eq('pattern_type', input.pattern_type)
      .eq('target_id', input.target_id ?? '')
      .gte('shown_at', new Date(new Date().toISOString().slice(0, 10)).toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return { shown_id: shownId, recorded: false };

    const { error } = await supabase.from('intelligence_recommendations').insert({
      organization_id: input.organization_id,
      platform: input.platform ?? null,
      action_type: input.action_type ?? null,
      pattern_type: input.pattern_type,
      label: input.label ?? null,
      confidence_score: input.confidence_score ?? null,
      target_id: input.target_id ?? null,
      execution_correlation_id: input.execution_correlation_id ?? null,
      metadata: { shown_id: shownId, ...(input.metadata ?? {}) },
    });
    if (error) {
      console.warn('[intelligenceRecommendation] shown insert failed:', error.message);
      return { shown_id: shownId, recorded: false };
    }
    return { shown_id: shownId, recorded: true };
  } catch (err: any) {
    console.warn('[intelligenceRecommendation] shown exception:', err?.message || err);
    return { shown_id: shownId, recorded: false };
  }
}

/**
 * Flip the most recent shown row for the scope to accepted / rejected.
 * Idempotent — replay is a no-op via the outcome-exclusive CHECK.
 */
export async function recordRecommendationOutcome(input: {
  organization_id: string;
  pattern_type: string;
  target_id?: string | null;
  outcome: 'accepted' | 'rejected';
  execution_correlation_id?: string | null;
}): Promise<{ updated: boolean; row_id?: string; error?: string }> {
  try {
    let q = supabase
      .from('intelligence_recommendations')
      .select('id, accepted_at, rejected_at')
      .eq('organization_id', input.organization_id)
      .eq('pattern_type', input.pattern_type)
      .is('accepted_at', null)
      .is('rejected_at', null)
      .order('shown_at', { ascending: false })
      .limit(1);
    if (input.target_id) q = q.eq('target_id', input.target_id);

    const { data: row } = await q.maybeSingle();
    if (!row) return { updated: false, error: 'NOT_FOUND_OR_ALREADY_DECIDED' };

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updated_at: now,
      [input.outcome === 'accepted' ? 'accepted_at' : 'rejected_at']: now,
    };
    if (input.execution_correlation_id) {
      patch.execution_correlation_id = input.execution_correlation_id;
    }

    const { error } = await supabase
      .from('intelligence_recommendations')
      .update(patch)
      .eq('id', (row as any).id);
    if (error) return { updated: false, error: error.message };
    return { updated: true, row_id: (row as any).id };
  } catch (err: any) {
    return { updated: false, error: err?.message || 'OUTCOME_RECORD_FAILED' };
  }
}
