/**
 * Strategy domain — the canonical server-side CampaignStrategy entity.
 * Phase-2 Step-5.
 *
 * Additive: persisted as an immutable snapshot inside the existing
 * campaign_versions.campaign_snapshot.canonical_strategy key (no schema
 * change, no hard migration). Latest version row = active strategy.
 */

import type { StrategyAudience } from './StrategyAudience';
import type { StrategyMessagingPillar, StrategyContentPillar } from './StrategyMessaging';
import type { StrategyTheme } from './StrategyTheme';
import type { StrategyContentSource } from './StrategyContentSource';

export type StrategyApprovalState =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'reapproval_required';

export interface StrategyPlatformStrategy {
  platform: string;
  posting_frequency?: number;
  content_types?: string[];
  notes?: string;
}

export interface StrategyOrchestrationMetadata {
  /** How this strategy version was produced. */
  source: 'planner' | 'planner-finalize' | 'recommendation' | 'hydrated' | 'manual' | 'unknown';
  hydrated_from?: 'canonical' | 'campaign_versions_snapshot' | 'planner_handoff' | 'none';
  linkage_count?: number;
  owned_content_count?: number;
  last_synced_at?: string | null;
}

export interface CampaignStrategy {
  campaign_id: string;
  strategy_id: string;
  version: number;
  objective: string;
  target_audience: StrategyAudience;
  audience_segments: StrategyAudience['segments'];
  key_messaging: StrategyMessagingPillar[];
  content_pillars: StrategyContentPillar[];
  campaign_themes: StrategyTheme[];
  platform_strategy: StrategyPlatformStrategy[];
  posting_philosophy: string;
  content_mix: string[];
  ai_generation_preferences: Record<string, unknown>;
  owned_content_sources: StrategyContentSource[];
  approval_state: StrategyApprovalState;
  orchestration_metadata: StrategyOrchestrationMetadata;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Strategy ↔ execution linkage stamped onto canonical execution items. */
export interface ExecutionStrategyLink {
  strategy_id: string;
  strategy_version: number;
  theme_id?: string | null;
  theme_title?: string | null;
  messaging_pillar_id?: string | null;
  content_pillar_id?: string | null;
}
