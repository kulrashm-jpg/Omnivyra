import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

/**
 * Append-only automation audit logger. Every decision — allowed or
 * blocked — is written here before any automation effect lands on
 * the execution pipeline. NO LOG, NO AUTOMATION: if the log insert
 * fails, the caller treats the decision as BLOCKED rather than
 * letting it proceed un-audited.
 */

export type AutomationDecision = 'allowed' | 'blocked';

export async function recordAutomationDecision(input: {
  organization_id: string;
  action_id?: string | null;
  platform?: string | null;
  action_type?: string | null;
  target_id?: string | null;
  decision: AutomationDecision;
  reason: string;
  confidence_level?: 'low' | 'medium' | 'high' | null;
  confidence_score?: number | null;
  pattern_type?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; row_id?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('automation_logs')
      .insert({
        organization_id: input.organization_id,
        action_id: input.action_id ?? null,
        platform: input.platform ?? null,
        action_type: input.action_type ?? null,
        target_id: input.target_id ?? null,
        decision: input.decision,
        reason: input.reason,
        confidence_level: input.confidence_level ?? null,
        confidence_score: input.confidence_score ?? null,
        pattern_type: input.pattern_type ?? null,
        metadata: input.metadata ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[automationLogger] insert failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, row_id: (data as any).id };
  } catch (err: any) {
    console.error('[automationLogger] insert exception:', err?.message || err);
    return { ok: false, error: err?.message || 'AUDIT_LOG_FAILED' };
  }
}

export async function readRecentAutomationLogs(input: {
  organization_id: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  try {
    const { data } = await supabase
      .from('automation_logs')
      .select('id, action_id, platform, action_type, target_id, decision, reason, confidence_level, confidence_score, pattern_type, created_at, metadata')
      .eq('organization_id', input.organization_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}
