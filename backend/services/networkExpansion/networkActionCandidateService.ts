import { supabase } from '../../db/supabaseClient';
import { getPlaybookById } from '../playbooks/playbookService';

type CandidateInput = {
  tenant_id: string;
  organization_id: string;
  playbook_id: string;
  limit?: number;
};

const resolveExecutionMode = (executionModes?: {
  manual_only?: boolean;
  api_allowed?: boolean;
  rpa_allowed?: boolean;
}) => {
  if (executionModes?.manual_only) return 'manual';
  if (executionModes?.api_allowed) return 'api';
  if (executionModes?.rpa_allowed) return 'rpa';
  return 'manual';
};

const prioritizeActions = (allowed: string[] = []) => {
  const priority = ['reply', 'follow', 'like'];
  return priority.filter((action) => allowed.includes(action));
};

export const generateNetworkActionCandidates = async (input: CandidateInput) => {
  const playbook = await getPlaybookById(
    input.playbook_id,
    input.tenant_id,
    input.organization_id
  );

  const networkConfig = (playbook as any)?.network_eligibility;
  if (!networkConfig || networkConfig.enabled !== true) {
    return { created_count: 0, skipped_count: 0, reason: 'Network eligibility disabled' };
  }

  const allowedClassifications: string[] = Array.isArray(networkConfig.allowed_classifications)
    ? networkConfig.allowed_classifications
    : [];
  if (allowedClassifications.length === 0) {
    return { created_count: 0, skipped_count: 0, reason: 'No allowed classifications' };
  }

  const excludedClassifications: string[] = Array.isArray(networkConfig.excluded_classifications)
    ? networkConfig.excluded_classifications
    : [];
  const allowedSources: string[] = Array.isArray(networkConfig.allowed_discovery_sources)
    ? networkConfig.allowed_discovery_sources
    : [];

  const maxPerDay = Number(networkConfig.max_new_users_per_day || 0);
  if (maxPerDay <= 0) {
    return { created_count: 0, skipped_count: 0, reason: 'Max new users per day not set' };
  }

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  const { data: engagedToday } = await supabase
    .from('community_ai_actions')
    .select('id')
    .eq('tenant_id', input.tenant_id)
    .eq('organization_id', input.organization_id)
    .eq('playbook_id', input.playbook_id)
    .eq('status', 'executed')
    .eq('intent_classification', 'network_expansion')
    .gte('created_at', dayStartIso);

  const alreadyEngaged = engagedToday?.length ?? 0;
  const remaining = Math.max(maxPerDay - alreadyEngaged, 0);
  if (remaining === 0) {
    return { created_count: 0, skipped_count: 0, reason: 'Daily cap reached' };
  }

  const requestedLimit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : remaining;
  const finalLimit = Math.min(requestedLimit, remaining);

  let discoveryQuery = supabase
    .from('community_ai_discovered_users')
    .select('*')
    .eq('tenant_id', input.tenant_id)
    .eq('organization_id', input.organization_id)
    .eq('eligible_for_engagement', true)
    .in('classification', allowedClassifications)
    .order('last_seen_at', { ascending: true })
    .limit(finalLimit);

  if (allowedSources.length > 0) {
    discoveryQuery = discoveryQuery.in('discovery_source', allowedSources);
  }

  const { data: discoveredUsers, error: discoverError } = await discoveryQuery;
  if (discoverError) {
    throw new Error(`Failed to load discovered users: ${discoverError.message}`);
  }

  const filteredDiscovered =
    excludedClassifications.length > 0
      ? (discoveredUsers || []).filter(
          (user) => !excludedClassifications.includes(user.classification)
        )
      : discoveredUsers || [];

  if (filteredDiscovered.length === 0) {
    return { created_count: 0, skipped_count: 0, reason: 'No eligible users found' };
  }

  const allowedActions: string[] = Array.isArray(networkConfig.allowed_actions)
    ? networkConfig.allowed_actions
    : [];
  const prioritized = prioritizeActions(allowedActions);
  if (prioritized.length === 0) {
    return { created_count: 0, skipped_count: filteredDiscovered.length, reason: 'No allowed actions' };
  }

  const discoveredIds = filteredDiscovered.map((user) => user.id);
  const { data: existingActions } = await supabase
    .from('community_ai_actions')
    .select('discovered_user_id, action_type, status')
    .eq('tenant_id', input.tenant_id)
    .eq('organization_id', input.organization_id)
    .in('discovered_user_id', discoveredIds)
    .in('action_type', prioritized)
    .in('status', ['pending', 'executed']);

  const existingKey = new Set(
    (existingActions || []).map(
      (row) => `${row.discovered_user_id}:${row.action_type}`
    )
  );

  const executionMode = resolveExecutionMode(playbook?.execution_modes);

  const rows: Record<string, any>[] = [];
  let skipped = 0;

  for (const user of filteredDiscovered) {
    const actionType = prioritized[0];
    if (!actionType) {
      skipped += 1;
      continue;
    }
    const key = `${user.id}:${actionType}`;
    if (existingKey.has(key)) {
      skipped += 1;
      continue;
    }
    rows.push({
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
      platform: user.platform,
      action_type: actionType,
      target_id: user.profile_url,
      suggested_text: null,
      risk_level: 'low',
      requires_human_approval: true,
      execution_mode: executionMode,
      playbook_id: playbook?.id || input.playbook_id,
      playbook_name: playbook?.name || null,
      intent_classification: {
        type: 'network_expansion',
      },
      status: 'pending',
      discovered_user_id: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    return { created_count: 0, skipped_count: skipped, reason: 'All candidates deduplicated' };
  }

  const { error: insertError } = await supabase.from('community_ai_actions').insert(rows);
  if (insertError) {
    throw new Error(`Failed to insert network actions: ${insertError.message}`);
  }

  return { created_count: rows.length, skipped_count: skipped };
};
