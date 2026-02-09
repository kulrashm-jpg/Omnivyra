import { supabase } from '../../db/supabaseClient';

export type NetworkIntelligenceRow = {
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
  total_actions_created: number | null;
  total_actions_executed: number | null;
  last_action_type: string | null;
  last_action_at: string | null;
};

export type NetworkIntelligenceFilters = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  playbook_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type SummaryRow = {
  key: string;
  label: string;
  discovered_users: number;
  actions_created: number;
  actions_executed: number;
};

type NetworkIntelligenceSummary = {
  totals: {
    discovered_users: number;
    actions_created: number;
    actions_executed: number;
  };
  by_playbook: SummaryRow[];
  by_platform: SummaryRow[];
  by_day: SummaryRow[];
};

const toDateKey = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const getEffectiveDate = (row: NetworkIntelligenceRow) =>
  row.last_action_at || row.last_seen_at || row.first_seen_at || null;

const sumCounts = (rows: NetworkIntelligenceRow[]) =>
  rows.reduce(
    (acc, row) => {
      acc.discovered_users += 1;
      acc.actions_created += row.total_actions_created ?? 0;
      acc.actions_executed += row.total_actions_executed ?? 0;
      return acc;
    },
    { discovered_users: 0, actions_created: 0, actions_executed: 0 }
  );

const buildSummary = (
  rows: NetworkIntelligenceRow[],
  keyFn: (row: NetworkIntelligenceRow) => { key: string; label: string }
): SummaryRow[] => {
  const map = new Map<string, SummaryRow>();
  rows.forEach((row) => {
    const { key, label } = keyFn(row);
    const existing = map.get(key) || {
      key,
      label,
      discovered_users: 0,
      actions_created: 0,
      actions_executed: 0,
    };
    existing.discovered_users += 1;
    existing.actions_created += row.total_actions_created ?? 0;
    existing.actions_executed += row.total_actions_executed ?? 0;
    map.set(key, existing);
  });
  return Array.from(map.values());
};

export const fetchNetworkIntelligence = async (filters: NetworkIntelligenceFilters) => {
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
    throw new Error('FAILED_TO_LOAD_NETWORK_INTELLIGENCE');
  }

  let rows = (data || []) as NetworkIntelligenceRow[];
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

  const totals = sumCounts(rows);
  const by_playbook = buildSummary(rows, (row) => ({
    key: row.playbook_id || 'unassigned',
    label: row.playbook_name || 'Unassigned',
  }));
  const by_platform = buildSummary(rows, (row) => ({
    key: row.platform || 'unknown',
    label: row.platform || 'unknown',
  }));
  const by_day = buildSummary(rows, (row) => {
    const dayKey = toDateKey(getEffectiveDate(row)) || 'unknown';
    return { key: dayKey, label: dayKey };
  });

  const summaries: NetworkIntelligenceSummary = {
    totals,
    by_playbook,
    by_platform,
    by_day,
  };

  return { rows, summaries };
};
