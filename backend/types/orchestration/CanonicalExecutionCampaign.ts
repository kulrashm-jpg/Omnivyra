/**
 * CanonicalExecutionCampaign — the campaign-level canonical orchestration view.
 * Phase-2 Step-1. Read contract only.
 */

import type { CanonicalExecutionWeek } from './CanonicalExecutionWeek';

export interface CanonicalOrchestrationMetadata {
  /** Which legacy sources contributed (campaign_week_plan / daily_content_plans / legacy). */
  sources_present: {
    blueprint: boolean;
    daily_content_plans: boolean;
  };
  /** Counts for quick drift diagnostics. */
  counts: {
    blueprint_items: number;
    row_items: number;
    reconciled_items: number;
    execution_id_mismatches: number;
  };
  resolved_at: string;
}

export interface CanonicalExecutionCampaign {
  campaign_id: string;
  /** Strategy context as snapshotted in the blueprint / planning context (loose). */
  strategy_context: Record<string, unknown> | null;
  weeks: CanonicalExecutionWeek[];
  orchestration_metadata: CanonicalOrchestrationMetadata;
}
