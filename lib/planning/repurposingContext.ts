/**
 * Repurposing context — multi-platform sibling awareness for activity workspace.
 * Read-only enrichment: no schema changes, no DB writes.
 */

import type { UnifiedExecutionUnit } from './unifiedExecutionAdapter';
import { detectMasterContentGroups } from './masterContentGrouping';

export interface RepurposingContext {
  group_id: string;
  master_title: string;
  platforms: string[];
  sibling_execution_ids: string[];
}

/**
 * Build repurposing context for an execution: group_id, master_title, platforms, sibling_execution_ids.
 * Returns null if executionId is not in any group (e.g. legacy row or no units).
 */
export function buildRepurposingContext(
  units: UnifiedExecutionUnit[],
  executionId: string
): RepurposingContext | null {
  const groups = detectMasterContentGroups(units);

  const group = groups.find((g) =>
    g.units.some((u) => u.execution_id === executionId)
  );

  if (!group) return null;

  const context: RepurposingContext = {
    group_id: group.group_id,
    master_title: group.title,
    platforms: group.platforms,
    sibling_execution_ids: group.units.map((u) => u.execution_id),
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('[RepurposingContext]', executionId, context);
  }

  return context;
}
