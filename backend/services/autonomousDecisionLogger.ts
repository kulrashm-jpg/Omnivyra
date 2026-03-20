/**
 * Autonomous Decision Logger
 *
 * Every autonomous action (generate, scale, pause, optimize, etc.)
 * MUST be logged here before executing. This is the audit trail that
 * powers the human control panel's "AI decisions" view.
 */

import { supabase } from '../db/supabaseClient';

export type AutonomousDecisionType =
  | 'generate'
  | 'approve'
  | 'reject'
  | 'auto_activate'
  | 'optimize'
  | 'scale'
  | 'pause'
  | 'recover'
  | 'learn';

export type AutonomousDecision = {
  company_id: string;
  campaign_id?: string | null;
  decision_type: AutonomousDecisionType;
  reason: string;
  metrics_used?: Record<string, unknown>;
  outcome?: string;
};

export async function logDecision(decision: AutonomousDecision): Promise<void> {
  try {
    await supabase.from('autonomous_decision_logs').insert({
      company_id:    decision.company_id,
      campaign_id:   decision.campaign_id ?? null,
      decision_type: decision.decision_type,
      reason:        decision.reason,
      metrics_used:  decision.metrics_used ?? {},
      outcome:       decision.outcome ?? null,
      created_at:    new Date().toISOString(),
    });
  } catch (err) {
    // Logging must never block the main pipeline
    console.warn('[autonomousDecisionLogger] Failed to log decision', err);
  }
}

export async function getDecisionLog(
  companyId: string,
  options: { limit?: number; decision_type?: AutonomousDecisionType; campaign_id?: string } = {}
): Promise<Array<{
  id: string;
  company_id: string;
  campaign_id: string | null;
  decision_type: AutonomousDecisionType;
  reason: string;
  metrics_used: Record<string, unknown>;
  outcome: string | null;
  created_at: string;
}>> {
  let query = supabase
    .from('autonomous_decision_logs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);

  if (options.decision_type) query = query.eq('decision_type', options.decision_type);
  if (options.campaign_id)   query = query.eq('campaign_id', options.campaign_id);

  const { data } = await query;
  return (data ?? []) as ReturnType<typeof getDecisionLog> extends Promise<infer T> ? T : never;
}
