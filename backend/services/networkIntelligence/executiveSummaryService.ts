import {
  fetchNetworkIntelligence,
  type NetworkIntelligenceFilters,
} from './networkIntelligenceService';
import { fetchPlaybookEffectiveness } from './playbookEffectivenessService';

export type ExecutiveSummary = {
  total_discovered_users: number;
  total_eligible_users: number;
  eligibility_rate: number;
  total_actions_created: number;
  total_actions_executed: number;
  execution_rate: number;
  automation_mix: {
    observe: number;
    assist: number;
    automate: number;
  };
  top_playbooks_by_quality: Array<{ playbook_id: string | null; playbook_name: string; quality: number }>;
  top_playbooks_by_volume: Array<{ playbook_id: string | null; playbook_name: string; volume: number }>;
  platform_mix: Array<{ platform: string; discovered_users: number; share: number }>;
  last_activity_at: string | null;
};

const clampRate = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const toIso = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const buildExecutiveSummary = async (filters: NetworkIntelligenceFilters) => {
  const { rows } = await fetchNetworkIntelligence(filters);
  const { records: playbookRecords } = await fetchPlaybookEffectiveness(filters);

  const total_discovered_users = rows.length;
  const total_eligible_users = rows.filter((row) => row.eligibility === true).length;
  const total_actions_created = rows.reduce(
    (sum, row) => sum + (row.total_actions_created ?? 0),
    0
  );
  const total_actions_executed = rows.reduce(
    (sum, row) => sum + (row.total_actions_executed ?? 0),
    0
  );
  const eligibility_rate = clampRate(
    total_discovered_users > 0 ? total_eligible_users / total_discovered_users : 0
  );
  const execution_rate = clampRate(
    total_actions_created > 0 ? total_actions_executed / total_actions_created : 0
  );

  const automationCounts = rows.reduce(
    (acc, row) => {
      const level = row.automation_level || 'observe';
      if (level === 'assist') acc.assist += 1;
      else if (level === 'automate') acc.automate += 1;
      else acc.observe += 1;
      return acc;
    },
    { observe: 0, assist: 0, automate: 0 }
  );
  const automation_mix = {
    observe: clampRate(total_discovered_users ? automationCounts.observe / total_discovered_users : 0),
    assist: clampRate(total_discovered_users ? automationCounts.assist / total_discovered_users : 0),
    automate: clampRate(total_discovered_users ? automationCounts.automate / total_discovered_users : 0),
  };

  const top_playbooks_by_quality = playbookRecords
    .map((record) => ({
      playbook_id: record.playbook_id,
      playbook_name: record.playbook_name,
      quality: clampRate(
        record.discovered_users_count > 0
          ? record.eligible_users_count / record.discovered_users_count
          : 0
      ),
    }))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 5);

  const top_playbooks_by_volume = playbookRecords
    .map((record) => ({
      playbook_id: record.playbook_id,
      playbook_name: record.playbook_name,
      volume: record.discovered_users_count,
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);

  const platformMap = new Map<string, number>();
  rows.forEach((row) => {
    const platform = row.platform || 'unknown';
    platformMap.set(platform, (platformMap.get(platform) || 0) + 1);
  });
  const platform_mix = Array.from(platformMap.entries())
    .map(([platform, discovered_users]) => ({
      platform,
      discovered_users,
      share: clampRate(total_discovered_users ? discovered_users / total_discovered_users : 0),
    }))
    .sort((a, b) => b.discovered_users - a.discovered_users);

  const last_activity_at =
    rows
      .map((row) => toIso(row.last_action_at || row.last_seen_at || row.first_seen_at))
      .filter(Boolean)
      .sort()
      .pop() || null;

  return {
    total_discovered_users,
    total_eligible_users,
    eligibility_rate,
    total_actions_created,
    total_actions_executed,
    execution_rate,
    automation_mix,
    top_playbooks_by_quality,
    top_playbooks_by_volume,
    platform_mix,
    last_activity_at,
  } satisfies ExecutiveSummary;
};
