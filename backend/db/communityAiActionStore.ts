/**
 * Centralized reads for community_ai_actions.
 * Replaces duplicate inline queries in execute/approve routes.
 */

import { supabase } from './supabaseClient';

/** Raw row from community_ai_actions. */
export type CommunityAiActionRow = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: string;
  target_id: string;
  suggested_text?: string | null;
  tone?: string | null;
  tone_used?: string | null;
  final_text?: string | null;
  risk_level?: string | null;
  requires_human_approval?: boolean | null;
  requires_approval?: boolean | null;
  execution_mode?: string | null;
  playbook_id?: string | null;
  discovered_user_id?: string | null;
  playbook_name?: string | null;
  intent_classification?: unknown;
  status?: string | null;
  execution_result?: unknown;
  scheduled_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
} & Record<string, unknown>;

export async function getCommunityAiActionById(
  actionId: string
): Promise<{ data: CommunityAiActionRow | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('community_ai_actions')
    .select('*')
    .eq('id', actionId)
    .single();

  if (error) {
    return { data: null, error: error as Error };
  }
  return { data: data as CommunityAiActionRow, error: null };
}
