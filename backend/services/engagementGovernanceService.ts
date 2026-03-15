/**
 * Engagement Governance Service
 * Get and update engagement system controls per organization.
 */

import { supabase } from '../db/supabaseClient';

export type EngagementControls = {
  auto_reply_enabled: boolean;
  bulk_reply_enabled: boolean;
  ai_suggestions_enabled: boolean;
  triage_engine_enabled: boolean;
  opportunity_detection_enabled: boolean;
  response_strategy_learning_enabled: boolean;
  digest_generation_enabled: boolean;
};

const DEFAULTS: EngagementControls = {
  auto_reply_enabled: true,
  bulk_reply_enabled: true,
  ai_suggestions_enabled: true,
  triage_engine_enabled: true,
  opportunity_detection_enabled: true,
  response_strategy_learning_enabled: true,
  digest_generation_enabled: true,
};

export async function getControls(organizationId: string): Promise<EngagementControls> {
  if (!organizationId) return DEFAULTS;

  const { data, error } = await supabase
    .from('engagement_system_controls')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error || !data) return DEFAULTS;

  return {
    auto_reply_enabled: data.auto_reply_enabled ?? true,
    bulk_reply_enabled: data.bulk_reply_enabled ?? true,
    ai_suggestions_enabled: data.ai_suggestions_enabled ?? true,
    triage_engine_enabled: data.triage_engine_enabled ?? true,
    opportunity_detection_enabled: data.opportunity_detection_enabled ?? true,
    response_strategy_learning_enabled: data.response_strategy_learning_enabled ?? true,
    digest_generation_enabled: data.digest_generation_enabled ?? true,
  };
}

export async function updateControls(
  organizationId: string,
  controls: Partial<EngagementControls>
): Promise<EngagementControls> {
  if (!organizationId) return DEFAULTS;

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    updated_at: now,
  };
  if (typeof controls.auto_reply_enabled === 'boolean') payload.auto_reply_enabled = controls.auto_reply_enabled;
  if (typeof controls.bulk_reply_enabled === 'boolean') payload.bulk_reply_enabled = controls.bulk_reply_enabled;
  if (typeof controls.ai_suggestions_enabled === 'boolean') payload.ai_suggestions_enabled = controls.ai_suggestions_enabled;
  if (typeof controls.triage_engine_enabled === 'boolean') payload.triage_engine_enabled = controls.triage_engine_enabled;
  if (typeof controls.opportunity_detection_enabled === 'boolean') payload.opportunity_detection_enabled = controls.opportunity_detection_enabled;
  if (typeof controls.response_strategy_learning_enabled === 'boolean') payload.response_strategy_learning_enabled = controls.response_strategy_learning_enabled;
  if (typeof controls.digest_generation_enabled === 'boolean') payload.digest_generation_enabled = controls.digest_generation_enabled;

  const { data, error } = await supabase
    .from('engagement_system_controls')
    .upsert(payload, { onConflict: 'organization_id' })
    .select()
    .single();

  if (error) {
    console.warn('[engagementGovernance] updateControls error', error.message);
    return getControls(organizationId);
  }

  return {
    auto_reply_enabled: data?.auto_reply_enabled ?? true,
    bulk_reply_enabled: data?.bulk_reply_enabled ?? true,
    ai_suggestions_enabled: data?.ai_suggestions_enabled ?? true,
    triage_engine_enabled: data?.triage_engine_enabled ?? true,
    opportunity_detection_enabled: data?.opportunity_detection_enabled ?? true,
    response_strategy_learning_enabled: data?.response_strategy_learning_enabled ?? true,
    digest_generation_enabled: data?.digest_generation_enabled ?? true,
  };
}
