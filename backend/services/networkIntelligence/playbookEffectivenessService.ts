import { supabase } from '../../db/supabaseClient';

export type PlaybookEffectivenessRow = {
  tenant_id: string;
  organization_id: string;
  platform: string;
  discovered_user_id: string;
  discovery_source: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  classification: string | null;
  eligibility: boolean | null;
  playbook_id: string | null;
  playbook_name: string | null;
  automation_level: 'observe' | 'assist' | 'automate' | null;
  total_actions_created: number | null;
  total_actions_executed: number | null;
  last_action_type: string | null;
  last_action_at: string | null;
};

export type PlaybookEffectivenessFilters = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type PlaybookEffectivenessMetrics = {
  playbook_id: string | null;
  playbook_name: string;
  discovered_users_count: number;
  eligible_users_count: number;
  ineligible_users_count: number;
  actions_created_count: number;
  actions_executed_count: number;
  execution_rate: number;
  automation_level: 'observe' | 'assist' | 'automate';
  top_platforms: Array<{ platform: string; discovered_users_count: number }>;
  last_activity_at: string | null;
};

const getEffectiveDate = (row: PlaybookEffectivenessRow) =>
  row.last_action_at || row.last_seen_at || row.first_seen_at || null;

const toDateKey = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const clampRate = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const buildTopPlatforms = (rows: PlaybookEffectivenessRow[]) => {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const platform = row.platform || 'unknown';
    map.set(platform, (map.get(platform) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([platform, discovered_users_count]) => ({ platform, discovered_users_count }))
    .sort((a, b) => b.discovered_users_count - a.discovered_users_count);
};

const resolveAutomationLevel = (rows: PlaybookEffectivenessRow[]) => {
  const level = rows.find((row) => row.automation_level)?.automation_level;
  return level === 'assist' || level === 'automate' ? level : 'observe';
};

export const fetchPlaybookEffectiveness = async (filters: PlaybookEffectivenessFilters) => {
  const { tenant_id, organization_id, platform, playbook_id, start_date, end_date } = filters;
  let query = supabase
    .from('community_ai_network_intelligence')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('organization_id', organization_id);

  if (platform) {
    query = query.eq('platform', platform);
  }

  if (playbook_id) {
    query = query.eq('playbook_id', playbook_id);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error('FAILED_TO_LOAD_PLAYBOOK_EFFECTIVENESS');
  }

  let rows = (data || []) as PlaybookEffectivenessRow[];
  if (start_date || end_date) {
    const start = start_date ? new Date(start_date) : null;
    const end = end_date ? new Date(end_date) : null;
    rows = rows.filter((row) => {
      const effective = getEffectiveDate(row);
      if (!effective) return false;
      const value = new Date(effective);
      if (Number.isNaN(value.getTime())) return false;
      if (start && value < start) return false;
      if (end && value > end) return false;
      return true;
    });
  }

  const grouped = new Map<string, PlaybookEffectivenessRow[]>();
  rows.forEach((row) => {
    const key = row.playbook_id || 'unassigned';
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  });

  const metrics = Array.from(grouped.entries()).map(([key, group]) => {
    const playbookName =
      group.find((row) => row.playbook_name)?.playbook_name || 'Unassigned';
    const discovered_users_count = group.length;
    const eligible_users_count = group.filter((row) => row.eligibility === true).length;
    const ineligible_users_count = group.filter((row) => row.eligibility === false).length;
    const actions_created_count = group.reduce(
      (sum, row) => sum + (row.total_actions_created ?? 0),
      0
    );
    const actions_executed_count = group.reduce(
      (sum, row) => sum + (row.total_actions_executed ?? 0),
      0
    );
    const execution_rate = clampRate(
      actions_created_count > 0 ? actions_executed_count / actions_created_count : 0
    );
    const last_activity_at = group
      .map((row) => toDateKey(getEffectiveDate(row)))
      .filter(Boolean)
      .sort()
      .pop() || null;

    return {
      playbook_id: key === 'unassigned' ? null : key,
      playbook_name: playbookName,
      discovered_users_count,
      eligible_users_count,
      ineligible_users_count,
      actions_created_count,
      actions_executed_count,
      execution_rate,
      automation_level: resolveAutomationLevel(group),
      top_platforms: buildTopPlatforms(group),
      last_activity_at,
    } as PlaybookEffectivenessMetrics;
  });

  return { records: metrics };
};
