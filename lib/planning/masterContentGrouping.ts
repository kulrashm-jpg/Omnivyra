/**
 * Master Content Group Detection — foundation for repurposing workspace.
 * Detects: one idea → multiple platform execution units.
 * Detection only: no DB writes, no schema changes, no UI.
 */

import type { UnifiedExecutionUnit } from './unifiedExecutionAdapter';

export interface MasterContentGroup {
  group_id: string;
  topic_key: string;
  title: string;
  units: UnifiedExecutionUnit[];
  platforms: string[];
  week_number: number;
}

function resolveTopicKey(unit: UnifiedExecutionUnit): string {
  return (
    (unit.topic && String(unit.topic).trim()) ||
    (unit.title && String(unit.title).trim()) ||
    unit.execution_id
  );
}

/**
 * Groups units by topic (fallback: title → execution_id). Same topic across platforms → one group.
 * Does not mutate units. Pure grouping only.
 */
export function detectMasterContentGroups(
  units: UnifiedExecutionUnit[]
): MasterContentGroup[] {
  if (!units?.length) return [];

  const map = new Map<string, UnifiedExecutionUnit[]>();

  for (const unit of units) {
    const key = resolveTopicKey(unit);

    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(unit);
  }

  const groups: MasterContentGroup[] = [];

  for (const [key, grouped] of map) {
    const weekNumber = grouped[0]?.week_number ?? 0;
    groups.push({
      group_id: `${weekNumber}-${key}`,
      topic_key: key,
      title: grouped[0]?.title || key,
      units: grouped,
      platforms: [...new Set(grouped.map((u) => u.platform))],
      week_number: weekNumber,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(
      '[MasterContentGroups]',
      groups.map((g) => ({
        group: g.title,
        platforms: g.platforms,
        count: g.units.length,
      }))
    );
  }

  return groups;
}
